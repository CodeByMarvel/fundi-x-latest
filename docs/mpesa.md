# M-Pesa (Safaricom Daraja)

**Version 1.0 — 2026-10-21.** How money moves through M-Pesa, and how to
connect Fundi-X to Safaricom's Daraja API. The books are in
[ledger.md](ledger.md); when money is due is in [job-flow.md](job-flow.md).

---

## 1. What we use

| Daraja API | For | Where |
|---|---|---|
| **M-Pesa Express** (STK push) | Customer pays: PIN prompt on their phone | call-out, agreed price, extra work |
| **STK push query** | How a prompt ended, if the callback was lost | `mpesa/reconcile.ts` |
| **B2C** (Business to Customer) | Fundi-X sends money: mechanic payouts, customer refunds | `money/transfers.ts` |

M-Pesa works in whole shillings. Our prices and commission are whole
shillings, so every amount sent is too.

## 2. Money in (STK push)

1. The customer taps Pay. The server decides what for and how much
   (never the app), records a `PENDING` payment, and only **after that
   commits** asks Daraja to show the prompt. If Daraja refuses, the payment
   fails as `not_sent` and the customer can try again.
2. Safaricom calls **`/mpesa/<secret>/stk`** with the result. The server
   checks it against our record (known prompt, same amount, a receipt)
   before moving any money; anything odd becomes an **M-Pesa incident** in
   the admin portal. Duplicates are ignored.
3. If no callback arrives within 75 seconds, the server **asks Daraja**
   (STK query) every 30 seconds, and gives up after 5 minutes.
4. A "paid" that arrives after we gave up is real money: it's recorded,
   and refunded automatically if the job has moved on.
5. A successful payment from the customer's own number proves the number
   is theirs (`phoneVerified`).

## 3. Money out (B2C)

1. A payout (release) or refund queues a **transfer** in the same database
   transaction (an "outbox"), so it can't be lost.
2. The **transfer worker** (every 5 s) claims queued transfers and sends
   them. Our transfer id goes to Safaricom as `OriginatorConversationID`,
   so each transfer is one request.
3. Safaricom's answer only means "accepted"; the result comes to
   **`/mpesa/<secret>/b2c/result`**. Success: the ledger records the money
   as sent (`PAYOUT_SENT` / `REFUND_SENT`) and a refund is marked sent.
4. **Failures:** M-Pesa busy or unreachable → retried after 1, 5, 15 and
   60 minutes; anything else, or after 5 tries → `FAILED`, an incident,
   and a red alert on the dashboard. The money stays owed in the books.
   Staff fix the cause (e.g. top up the B2C account) and press **Send
   again** in Finance → M-Pesa out.
5. **Interrupted sends:** if the server stopped after handing a transfer
   to M-Pesa but before hearing back, we can't know if it went. It's marked
   `FAILED` with "check the statement": staff look on the M-Pesa statement
   and either **Send again** or **It arrived** (enter the M-Pesa code).
   Sending blindly could pay twice.

Payouts are sent per release: the parts money as soon as the customer
pays it, the rest when the job ends. Refunds go back to the number that
paid.

## 4. Security

- All Daraja settings live in `server/.env` (or the host's environment).
  Never in code, the phone app or the admin website, never in chat.
- Callback addresses contain **`MPESA_CALLBACK_SECRET`**, a long random
  value only Safaricom is given. Without it the addresses don't exist.
- Optional **`MPESA_ALLOWED_IPS`**: only accept callbacks from Safaricom's
  published addresses (get the current list from Safaricom when going
  live).
- Callbacks are never trusted on their own: each must match a payment or
  transfer we made, for the same amount.
- Production refuses to start without Daraja, and the simulator can't
  run there.

## 5. Setting up the sandbox (free)

1. **Account:** sign up at <https://developer.safaricom.co.ke> and log in.
2. **App:** My Apps → Add a new app → tick **M-Pesa Sandbox** (which
   includes M-Pesa Express and B2C) → create. Open it to see the
   **Consumer Key** and **Consumer Secret**.
3. **Test credentials:** in the portal's APIs → M-Pesa Express → Simulate,
   note the test **shortcode** (`174379`) and its **passkey**. For B2C,
   the portal's test credentials page gives a B2C shortcode, the initiator
   name, and lets you generate the **Security Credential** (the initiator
   password encrypted with Safaricom's certificate).
4. **A public address for callbacks.** Safaricom must reach your computer
   over https. Free, no account needed:
   ```
   cloudflared tunnel --url http://localhost:3000
   ```
   (install: `winget install Cloudflare.cloudflared`). It prints an
   address like `https://something.trycloudflare.com`; it changes each
   time you start it, so update `.env` and restart the server.
5. **A callback secret:** any long random string, e.g. from
   `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`.
6. **Put them in `server/.env`** (never in chat or code):
   ```
   MPESA_ENV=sandbox
   MPESA_CONSUMER_KEY=…
   MPESA_CONSUMER_SECRET=…
   MPESA_SHORTCODE=174379
   MPESA_PASSKEY=…
   MPESA_CALLBACK_BASE_URL=https://something.trycloudflare.com
   MPESA_CALLBACK_SECRET=…
   MPESA_B2C_SHORTCODE=…
   MPESA_B2C_INITIATOR_NAME=…
   MPESA_B2C_SECURITY_CREDENTIAL=…
   ```
7. Restart `npm run dev`. The log says `M-Pesa: Daraja sandbox`, and the
   admin portal's Engineering → System shows Daraja on.
8. Pay a call-out from the app with your own Safaricom number: the prompt
   arrives on your phone. Sandbox requests don't move real money.

## 6. Going live

1. Apply for a **paybill** (or till) and a **B2C** account with Safaricom
   (business registration, KRA PIN, bank details); it takes days to weeks.
2. On the Daraja portal, **Go Live** with that shortcode: you get
   production keys, passkey, and the B2C initiator.
3. Set `MPESA_ENV=production` and the production values on the host. The
   callback base URL is your real API address (https).
4. Keep the **B2C utility account topped up**: payouts fail while it's
   empty (they appear as failed transfers to retry).
5. Daily: compare the Finance page's books with the M-Pesa statement
   (automatic reconciliation is the next step, docs/ledger.md §5).
