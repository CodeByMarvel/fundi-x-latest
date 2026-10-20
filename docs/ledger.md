# Fundi-X Ledger

**Version 1.0 — 2026-10-21.** How Fundi-X keeps its books: every shilling
that comes in through M-Pesa is followed until it reaches a mechanic, goes
back to a customer, or becomes Fundi-X commission. Sits beside
[job-flow.md](job-flow.md) (when money moves) and
[admin-portal.md](admin-portal.md) (where staff see it).

---

## 1. Why double-entry

The money records (payments, refunds, releases) say what happened to one
job. The ledger answers the questions those can't: how much does Fundi-X
hold right now, and whose is it? It's double-entry, the way every bank
and accountant keeps books:

- Every money event is one **entry** made of **lines**.
- Each line moves an amount into or out of an **account**.
- **An entry's lines always add up to zero.** Money moves; it is never
  created or lost. If the books don't balance, something is wrong, and
  the system says so.

Amounts are whole cents (KSh × 100). A positive line is a **debit** (money
arriving in an asset, or a debt paid down); a negative line is a
**credit** (money now owed to someone, or earned).

## 2. Accounts

| Account | What it is | Balance means |
|---|---|---|
| `mpesa` | Money Fundi-X holds at Safaricom | Positive: cash we hold |
| `escrow:<jobId>` | Money held for one job | Negative: held for that job |
| `provider:<userId>` | Earned by a mechanic, not yet sent | Negative: we owe them |
| `customer:<userId>` | Refunds not yet sent | Negative: we owe them |
| `revenue:CALL_OUT` / `SERVICE` / `PARTS` | Fundi-X commission | Negative: earned |

At any moment: **cash at M-Pesa = held in escrow + owed to mechanics +
owed to customers + commission earned.**

## 3. Entries

| Entry | When | Lines |
|---|---|---|
| `PAYMENT_RECEIVED` | M-Pesa confirms a payment | `mpesa` +amount, `escrow:job` −amount |
| `RELEASE` | Money paid out to the mechanic (parts at payment; call-out and labour when the job ends) | `escrow:job` +gross, `provider:id` −net, `revenue:<purpose>` −commission per kind |
| `REFUND` | Money returned to the customer | `escrow:job` +amount, `customer:id` −amount |
| `PAYOUT_SENT` | M-Pesa B2C paid the mechanic | `provider:id` +amount, `mpesa` −amount |
| `REFUND_SENT` | M-Pesa B2C paid the customer back | `customer:id` +amount, `mpesa` −amount |

Example: an oil change with parts, KSh 800 call-out + KSh 800 labour +
KSh 4,900 parts.

```
PAYMENT_RECEIVED  call-out    mpesa +800        escrow:J −800
PAYMENT_RECEIVED  service     mpesa +5,700      escrow:J −5,700
RELEASE           parts       escrow:J +4,900   provider:B −4,655   revenue:PARTS −245
RELEASE           job ends    escrow:J +1,600   provider:B −1,280   revenue:CALL_OUT −160   revenue:SERVICE −160
PAYOUT_SENT       (B2C)       provider:B +5,935 mpesa −5,935
```

Escrow for the job ends at zero, the mechanic is paid in full, and Fundi-X
keeps KSh 565.

**Commission is rounded to whole shillings**, so every payout is whole
shillings: M-Pesa can't send cents.

## 4. Guarantees

1. **One way in.** Money records are only created by
   `server/src/money/records.ts`, which writes the record and its entry in
   the same database transaction. If either fails, neither is saved.
2. **The database enforces the rules** (`drizzle/0012_ledger_rules.sql`),
   so no code path, script or console session can break them:
   - ledger rows can't be edited or deleted (append-only; a mistake is
     corrected by a new entry that reverses it),
   - an entry whose lines don't add up to zero is refused at commit,
   - a line can't be zero.
3. **The books are checked against the records** (`server/src/money/check.ts`,
   the Finance page's "Books" panel, and `npm run books`):
   - all lines together add up to zero,
   - each job's escrow account holds exactly what its records say
     (paid in − refunded − paid out),
   - every payment, release and refund has its entry,
   - no mechanic or customer account was paid more than it was owed.
   Anything found is a bug to investigate, never something to fix by
   editing rows.
4. **Concurrency.** Each job's money moves under that job's row lock, and
   each payment under its own, so thousands of jobs can move money at the
   same time without waiting on each other or double-counting.

## 5. Not yet

- **Reconciliation with Safaricom:** comparing our `mpesa` account with
  M-Pesa statements and the account balance API, daily. Needs Daraja.
- **M-Pesa fees:** B2C transaction charges will be an expense entry
  (`expense:mpesa_fees`) once the real charges are known.
- **Cash jobs** (if allowed later): the mechanic would owe the commission
  (`provider:id` positive), deducted from their next payouts.
