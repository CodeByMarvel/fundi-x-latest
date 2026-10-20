import { describe, expect, it } from 'vitest';
import { darajaConfigFromEnv, darajaGateway, darajaTimestamp, type DarajaConfig } from '../src/mpesa/daraja';
import { MpesaError } from '../src/mpesa/gateway';

const CONFIG: DarajaConfig = {
  environment: 'sandbox',
  consumerKey: 'key',
  consumerSecret: 'secret',
  shortcode: '174379',
  passkey: 'passkey',
  stkType: 'paybill',
  tillNumber: null,
  b2cShortcode: '600000',
  b2cInitiatorName: 'testapi',
  b2cSecurityCredential: 'encrypted',
  callbackBaseUrl: 'https://api.example.com',
  callbackSecret: 'a-long-random-callback-secret-123',
};

type Call = { url: string; init: RequestInit };

/** A pretend Safaricom: answers by path and records every request. */
function fakeSafaricom(answers: Record<string, () => Response>) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const path = new URL(url).pathname;
    const answer = answers[path];
    return answer ? answer() : new Response('not found', { status: 404 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

const json = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const token = () => json({ access_token: 'tok', expires_in: '3599' });
const body = (call: Call) => JSON.parse(String(call.init.body));

describe('Daraja client', () => {
  it('sends a PIN prompt shaped the way Safaricom expects, reusing the token', async () => {
    const { calls, fetchImpl } = fakeSafaricom({
      '/oauth/v1/generate': token,
      '/mpesa/stkpush/v1/processrequest': () =>
        json({ ResponseCode: '0', ResponseDescription: 'ok', CheckoutRequestID: 'ws_CO_1', MerchantRequestID: 'm1' }),
    });
    const mpesa = darajaGateway(CONFIG, fetchImpl);
    const sent = await mpesa.stkPush({ phone: '254700000001', shillings: 800, accountReference: 'FX1234567890XYZ', description: 'Call-out fee for job' });
    await mpesa.stkPush({ phone: '254700000001', shillings: 800, accountReference: 'FX1', description: 'Call-out' });

    expect(sent).toEqual({ checkoutRequestId: 'ws_CO_1', merchantRequestId: 'm1' });
    expect(calls.filter(c => c.url.includes('oauth'))).toHaveLength(1);
    expect(calls[0].init.headers).toMatchObject({ authorization: `Basic ${Buffer.from('key:secret').toString('base64')}` });
    const push = body(calls[1]);
    expect(push).toMatchObject({
      BusinessShortCode: '174379',
      TransactionType: 'CustomerPayBillOnline',
      Amount: 800,
      PartyA: '254700000001',
      PartyB: '174379',
      PhoneNumber: '254700000001',
      CallBackURL: 'https://api.example.com/mpesa/a-long-random-callback-secret-123/stk',
      AccountReference: 'FX1234567890', // 12 characters at most
      TransactionDesc: 'Call-out fee ', // 13 at most
    });
    expect(Buffer.from(push.Password, 'base64').toString()).toBe(`174379passkey${push.Timestamp}`);
    expect(push.Timestamp).toMatch(/^\d{14}$/);
  });

  it('reports refusals clearly, and says which are worth retrying', async () => {
    const { fetchImpl } = fakeSafaricom({
      '/oauth/v1/generate': token,
      '/mpesa/stkpush/v1/processrequest': () => json({ errorCode: '400.002.02', errorMessage: 'Bad Request - Invalid Amount' }, 400),
    });
    const err = await darajaGateway(CONFIG, fetchImpl)
      .stkPush({ phone: '254700000001', shillings: 1, accountReference: 'x', description: 'x' })
      .catch(e => e);
    expect(err).toBeInstanceOf(MpesaError);
    expect(err.message).toMatch(/Invalid Amount/);
    expect(err.retryable).toBe(false);

    const down = fakeSafaricom({ '/oauth/v1/generate': () => new Response('busy', { status: 503 }) });
    const busy = await darajaGateway(CONFIG, down.fetchImpl).stkQuery('ws_CO_1').catch(e => e);
    expect(busy.retryable).toBe(true);
  });

  it('reads how a prompt ended from the status query', async () => {
    const answer = (code: string) =>
      fakeSafaricom({ '/oauth/v1/generate': token, '/mpesa/stkpushquery/v1/query': () => json({ ResultCode: code, ResultDesc: 'desc' }) });
    expect(await darajaGateway(CONFIG, answer('0').fetchImpl).stkQuery('x')).toEqual({ state: 'SUCCESS', receipt: null });
    expect(await darajaGateway(CONFIG, answer('1032').fetchImpl).stkQuery('x')).toMatchObject({ state: 'FAILED', reason: 'cancelled_by_user' });
    expect(await darajaGateway(CONFIG, answer('1').fetchImpl).stkQuery('x')).toMatchObject({ state: 'FAILED', reason: 'insufficient_funds' });

    const processing = fakeSafaricom({
      '/oauth/v1/generate': token,
      '/mpesa/stkpushquery/v1/query': () => json({ errorCode: '500.001.1001', errorMessage: 'The transaction is being processed' }, 500),
    });
    expect(await darajaGateway(CONFIG, processing.fetchImpl).stkQuery('x')).toEqual({ state: 'PENDING' });
  });

  it('sends B2C with our transfer id, so a transfer is sent once', async () => {
    const { calls, fetchImpl } = fakeSafaricom({
      '/oauth/v1/generate': token,
      '/mpesa/b2c/v3/paymentrequest': () => json({ ResponseCode: '0', ResponseDescription: 'ok', ConversationID: 'AG_1' }),
    });
    const sent = await darajaGateway(CONFIG, fetchImpl).b2c({ transferId: 'trf_1', phone: '254712000101', shillings: 5935, remarks: 'Fundi-X payout' });
    expect(sent).toEqual({ conversationId: 'AG_1' });
    expect(body(calls[1])).toMatchObject({
      OriginatorConversationID: 'trf_1',
      InitiatorName: 'testapi',
      SecurityCredential: 'encrypted',
      CommandID: 'BusinessPayment',
      Amount: 5935,
      PartyA: '600000',
      PartyB: '254712000101',
      ResultURL: 'https://api.example.com/mpesa/a-long-random-callback-secret-123/b2c/result',
    });
  });

  it('uses Kenya time for timestamps', () => {
    expect(darajaTimestamp(new Date('2026-10-21T21:30:05Z'))).toBe('20261022003005');
  });
});

describe('Daraja settings', () => {
  const full = {
    MPESA_CONSUMER_KEY: 'k',
    MPESA_CONSUMER_SECRET: 's',
    MPESA_SHORTCODE: '174379',
    MPESA_PASSKEY: 'p',
    MPESA_CALLBACK_BASE_URL: 'https://x.trycloudflare.com/',
    MPESA_CALLBACK_SECRET: 'abcdefghijklmnopqrstuvwxyz',
  };

  it('is off when nothing is set, and refuses half a setup', () => {
    expect(darajaConfigFromEnv({})).toBeNull();
    expect(() => darajaConfigFromEnv({ MPESA_CONSUMER_KEY: 'k' })).toThrow(/MPESA_SHORTCODE/);
    expect(() => darajaConfigFromEnv({ ...full, MPESA_CALLBACK_BASE_URL: 'http://localhost:3000' })).toThrow(/https/);
    expect(() => darajaConfigFromEnv({ ...full, MPESA_CALLBACK_SECRET: 'short' })).toThrow(/24/);
  });

  it('defaults to the sandbox', () => {
    expect(darajaConfigFromEnv(full)).toMatchObject({ environment: 'sandbox', callbackBaseUrl: 'https://x.trycloudflare.com' });
    expect(darajaConfigFromEnv({ ...full, MPESA_ENV: 'production' })?.environment).toBe('production');
  });
});
