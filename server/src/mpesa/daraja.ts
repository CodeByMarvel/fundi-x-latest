import { darajaPhone, MpesaError, type MpesaGateway, type StkOutcome, stkFailureReason } from './gateway';

/**
 * Safaricom Daraja settings, all from server/.env (or the host's
 * environment); none are ever in code, the app, or the admin website.
 * docs/mpesa.md says where each one comes from.
 */
export type DarajaConfig = {
  environment: 'sandbox' | 'production';
  consumerKey: string;
  consumerSecret: string;
  /** The paybill (or till's store number) that receives STK payments. */
  shortcode: string;
  /** M-Pesa Express passkey for that shortcode. */
  passkey: string;
  /** 'paybill' (CustomerPayBillOnline) or 'till' (CustomerBuyGoodsOnline). */
  stkType: 'paybill' | 'till';
  /** For a till: the till number customers pay (PartyB). */
  tillNumber: string | null;
  /** B2C: the shortcode money is sent from, and its API operator. */
  b2cShortcode: string | null;
  b2cInitiatorName: string | null;
  /** The initiator password encrypted with Safaricom's certificate (from the Daraja portal). */
  b2cSecurityCredential: string | null;
  /** Public https address of this server, e.g. https://api.fundix.co.ke */
  callbackBaseUrl: string;
  /** Random secret in the callback addresses, so nobody can guess them. */
  callbackSecret: string;
};

const HOSTS = {
  sandbox: 'https://sandbox.safaricom.co.ke',
  production: 'https://api.safaricom.co.ke',
};

/**
 * Reads the Daraja settings. Returns null when none are set (development
 * then uses the simulator); throws if they're half set, so a typo is
 * caught at startup rather than at a customer's first payment.
 */
export function darajaConfigFromEnv(env: NodeJS.ProcessEnv): DarajaConfig | null {
  const required = {
    MPESA_CONSUMER_KEY: env.MPESA_CONSUMER_KEY,
    MPESA_CONSUMER_SECRET: env.MPESA_CONSUMER_SECRET,
    MPESA_SHORTCODE: env.MPESA_SHORTCODE,
    MPESA_PASSKEY: env.MPESA_PASSKEY,
    MPESA_CALLBACK_BASE_URL: env.MPESA_CALLBACK_BASE_URL,
    MPESA_CALLBACK_SECRET: env.MPESA_CALLBACK_SECRET,
  };
  const set = Object.entries(required).filter(([, v]) => v?.trim());
  if (set.length === 0) {
    return null;
  }
  const missing = Object.entries(required).filter(([, v]) => !v?.trim()).map(([k]) => k);
  if (missing.length) {
    throw new Error(`M-Pesa is partly configured: set ${missing.join(', ')} in server/.env`);
  }
  const base = required.MPESA_CALLBACK_BASE_URL!.trim().replace(/\/+$/, '');
  if (!base.startsWith('https://')) {
    throw new Error('MPESA_CALLBACK_BASE_URL must be a public https:// address (Safaricom only calls https)');
  }
  if (required.MPESA_CALLBACK_SECRET!.trim().length < 24) {
    throw new Error('MPESA_CALLBACK_SECRET must be at least 24 random characters');
  }
  const environment = env.MPESA_ENV === 'production' ? 'production' : 'sandbox';
  return {
    environment,
    consumerKey: required.MPESA_CONSUMER_KEY!.trim(),
    consumerSecret: required.MPESA_CONSUMER_SECRET!.trim(),
    shortcode: required.MPESA_SHORTCODE!.trim(),
    passkey: required.MPESA_PASSKEY!.trim(),
    stkType: env.MPESA_STK_TYPE === 'till' ? 'till' : 'paybill',
    tillNumber: env.MPESA_TILL_NUMBER?.trim() || null,
    b2cShortcode: env.MPESA_B2C_SHORTCODE?.trim() || null,
    b2cInitiatorName: env.MPESA_B2C_INITIATOR_NAME?.trim() || null,
    b2cSecurityCredential: env.MPESA_B2C_SECURITY_CREDENTIAL?.trim() || null,
    callbackBaseUrl: base,
    callbackSecret: required.MPESA_CALLBACK_SECRET!.trim(),
  };
}

/** The paths Safaricom calls back on (registered in mpesa/routes.ts). */
export const callbackPaths = (secret: string) => ({
  stk: `/mpesa/${secret}/stk`,
  b2cResult: `/mpesa/${secret}/b2c/result`,
  b2cTimeout: `/mpesa/${secret}/b2c/timeout`,
});

/** yyyyMMddHHmmss in Kenya time, as Daraja expects. */
export function darajaTimestamp(at = new Date()) {
  const local = new Date(at.getTime() + 3 * 3_600_000); // Nairobi is UTC+3 all year
  return local.toISOString().replace(/[-:T]/g, '').slice(0, 14);
}

type Fetch = typeof fetch;

/** The real M-Pesa, through Safaricom's Daraja API. */
export function darajaGateway(config: DarajaConfig, fetchImpl: Fetch = fetch): MpesaGateway {
  const host = HOSTS[config.environment];
  const paths = callbackPaths(config.callbackSecret);
  let token: { value: string; expiresAt: number } | null = null;

  async function accessToken() {
    if (token && token.expiresAt > Date.now()) {
      return token.value;
    }
    const basic = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString('base64');
    const res = await call(`${host}/oauth/v1/generate?grant_type=client_credentials`, {
      headers: { authorization: `Basic ${basic}` },
    });
    const data = (await res.json()) as { access_token: string; expires_in: string | number };
    // Renewed a minute early, so a token never expires mid-request.
    token = { value: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) - 60) * 1000 };
    return token.value;
  }

  async function call(url: string, init: RequestInit) {
    let res: Response;
    try {
      res = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(20_000) });
    } catch (err) {
      throw new MpesaError(`M-Pesa could not be reached: ${(err as Error).message}`, true);
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      // Daraja answers errors as { errorCode, errorMessage }. 5xx and rate
      // limits are worth retrying; 4xx means our request is wrong.
      let message = body.slice(0, 300);
      try {
        const parsed = JSON.parse(body) as { errorMessage?: string; errorCode?: string };
        message = `${parsed.errorCode ?? res.status}: ${parsed.errorMessage ?? message}`;
      } catch {}
      throw new MpesaError(`M-Pesa refused the request (${res.status}) ${message}`, res.status >= 500 || res.status === 429);
    }
    return res;
  }

  async function post<T>(path: string, body: object): Promise<T> {
    const res = await call(`${host}${path}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return (await res.json()) as T;
  }

  const stkPassword = (timestamp: string) =>
    Buffer.from(`${config.shortcode}${config.passkey}${timestamp}`).toString('base64');

  return {
    name: 'daraja',

    async stkPush({ phone, shillings, accountReference, description }) {
      const timestamp = darajaTimestamp();
      const data = await post<{
        ResponseCode: string;
        ResponseDescription: string;
        CheckoutRequestID: string;
        MerchantRequestID: string;
      }>('/mpesa/stkpush/v1/processrequest', {
        BusinessShortCode: config.shortcode,
        Password: stkPassword(timestamp),
        Timestamp: timestamp,
        TransactionType: config.stkType === 'till' ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
        Amount: shillings,
        PartyA: darajaPhone(phone),
        PartyB: config.stkType === 'till' ? (config.tillNumber ?? config.shortcode) : config.shortcode,
        PhoneNumber: darajaPhone(phone),
        CallBackURL: `${config.callbackBaseUrl}${paths.stk}`,
        AccountReference: accountReference.slice(0, 12),
        TransactionDesc: description.slice(0, 13),
      });
      if (data.ResponseCode !== '0') {
        throw new MpesaError(`M-Pesa did not send the prompt: ${data.ResponseDescription}`, false);
      }
      return { checkoutRequestId: data.CheckoutRequestID, merchantRequestId: data.MerchantRequestID };
    },

    async stkQuery(checkoutRequestId): Promise<StkOutcome> {
      const timestamp = darajaTimestamp();
      try {
        const data = await post<{ ResultCode?: string; ResultDesc?: string }>('/mpesa/stkpushquery/v1/query', {
          BusinessShortCode: config.shortcode,
          Password: stkPassword(timestamp),
          Timestamp: timestamp,
          CheckoutRequestID: checkoutRequestId,
        });
        const code = Number(data.ResultCode);
        if (code === 0) {
          // The query doesn't return the receipt; the callback (or
          // reconciliation with statements) supplies it.
          return { state: 'SUCCESS', receipt: null };
        }
        return { state: 'FAILED', reason: stkFailureReason(code), detail: data.ResultDesc ?? `code ${code}` };
      } catch (err) {
        // "The transaction is being processed": the customer hasn't answered yet.
        if (err instanceof MpesaError && /being processed/i.test(err.message)) {
          return { state: 'PENDING' };
        }
        throw err;
      }
    },

    async b2c({ transferId, phone, shillings, remarks }) {
      if (!config.b2cShortcode || !config.b2cInitiatorName || !config.b2cSecurityCredential) {
        throw new MpesaError(
          'B2C is not configured: set MPESA_B2C_SHORTCODE, MPESA_B2C_INITIATOR_NAME and MPESA_B2C_SECURITY_CREDENTIAL',
          false,
        );
      }
      const data = await post<{ ResponseCode: string; ResponseDescription: string; ConversationID: string }>(
        '/mpesa/b2c/v3/paymentrequest',
        {
          OriginatorConversationID: transferId,
          InitiatorName: config.b2cInitiatorName,
          SecurityCredential: config.b2cSecurityCredential,
          CommandID: 'BusinessPayment',
          Amount: shillings,
          PartyA: config.b2cShortcode,
          PartyB: darajaPhone(phone),
          Remarks: remarks.slice(0, 100),
          QueueTimeOutURL: `${config.callbackBaseUrl}${paths.b2cTimeout}`,
          ResultURL: `${config.callbackBaseUrl}${paths.b2cResult}`,
          Occassion: transferId.slice(0, 100), // sic: Daraja's spelling
        },
      );
      if (data.ResponseCode !== '0') {
        throw new MpesaError(`M-Pesa did not accept the transfer: ${data.ResponseDescription}`, false);
      }
      return { conversationId: data.ConversationID };
    },
  };
}
