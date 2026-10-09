# Fundi-X Job Flow

**Status:** contract v0.2 (2026-10-09). Items marked **OPEN** are undecided;
everything else is decided and implemented in the mock backend
(`src/data/mock/mockBackend.ts`).

A **Job** is the single source of truth connecting a customer's vehicle need,
the assigned provider, the work, the quotes, and every shilling paid, held,
released or refunded. The customer app and the mechanic app are two windows
onto the same job. The backend is the referee: it owns the state machine,
the money, and every rule below.

---

## 1. Principles

1. **One job, three actors.** `CUSTOMER`, `PROVIDER`, `SYSTEM`. Every change
   to a job is made by exactly one of them and recorded as a `JobEvent`.
2. **Status is lifecycle; payments are facts.** A job's status says where the
   *work* is. Whether money moved lives on `Payment`, `Refund` and `Release`
   records, never as a job status.
3. **Escrow.** Every customer payment goes into Fundi-X escrow. Money leaves
   escrow only when the job ends: **released** to the provider (minus
   commission) or **refunded** to the customer.
4. **Store facts, calculate balances.** Charges and payments are stored as
   immutable records. "Amount due" and "provider earnings" are always worked
   out from them, never stored.
5. **Each actor controls only their own decisions.** Customers approve prices
   and confirm work. Providers do and describe the work. Only the system
   matches, confirms payments, moves money and enforces the rules.
6. **No surprise charges.** The customer sees and accepts every amount before
   it can be charged.

---

## 2. Job types

The flow forks on a job's **pricing mode**, set by the backend at booking:
`FIXED` when Fundi-X can price the work from its catalog, `QUOTED` when the
provider must diagnose and quote. Maintenance is normally `FIXED`, but a
service the catalog can't price ("Other service") is `QUOTED`, so the rules
key off pricing mode rather than job type.

| | **Repair** (`requestType: 'repair'`) | **Maintenance** (`requestType: 'service'`) |
|---|---|---|
| Example | "Grinding noise when braking" | "Full service, Toyota Fielder" |
| Price known at booking? | No, only the call-out | Yes: Fundi-X base quote + call-out |
| Who writes the main quote | Provider, after diagnosis | Fundi-X, before booking |
| After arrival | `DIAGNOSING` → `QUOTE_SENT` → customer approves | Straight to `IN_PROGRESS` |
| Extra work found on site | Additional quote (provider) | Additional quote (provider) |

---

## 3. Money

### 3.1 Records

| Record | Meaning | Created by |
|---|---|---|
| `Charge` | Something the customer owes: `CALL_OUT`, or the total of an approved quote | SYSTEM |
| `Payment` | Money the customer sent into escrow. `purpose: CALL_OUT \| SERVICE` | SYSTEM, on M-Pesa confirmation |
| `Refund` | Money returned from escrow to the customer | SYSTEM |
| `Release` | Money paid out of escrow to the provider: gross, commission, net | SYSTEM, when the job ends |

All amounts are integer cents (`Cents`). Commission is in basis points.

```
balance due   = Σ charges − Σ successful payments
provider net  = Σ released − commission
```

### 3.2 Call-out fee

- Covers **transport and inspection**. There is no separate inspection fee.
- Calculated by Fundi-X, never by the provider:
  `call-out = base + distance component (+ category adjustment)`.
  Starting point: base KSh 500 + distance component. **OPEN:** exact formula;
  distance bands or zones.
- Shown to the customer before they pay. Paid **before** dispatch.
- Belongs to the provider who attends, minus commission, released at job end.

### 3.3 Commission

- Configurable per charge kind (`CALL_OUT`, `SERVICE`) and later per provider
  type. Default 10% (1000 bp) on both.
- Taken at release time. If nothing is released, nothing is earned.

### 3.4 Customer view

Stored as a full ledger; shown as "already paid / still to pay":

```
Call-out (paid)            KSh   800  ✓
Service                    KSh 7,000
───────────────────────────────────────
Still to pay               KSh 7,000
```

### 3.5 Outcomes: where escrow money goes

| How the job ends | Call-out in escrow | Service money | Provider gets | Fundi-X gets |
|---|---|---|---|---|
| Call-out payment never completes | – (nothing paid) | – | – | – |
| No provider found | Refund 100% | – | – | – |
| Customer cancels before provider starts trip (`SEARCHING`, `OFFERED`, `ACCEPTED`) | Refund 100% | – | – | – |
| Customer cancels while provider is `EN_ROUTE` | Released | – | call-out − commission | commission |
| Provider withdraws (`ACCEPTED`/`EN_ROUTE`) | **Kept in escrow**, job rematched | – | nothing | – |
| …and no replacement found | Refund 100% | – | – | – |
| Repair quote declined | Released | – | call-out − commission | commission |
| Customer not at location (§6) | Released | – | call-out − commission | commission |
| Completed normally | Released | Released | (call-out + service) − commission | commission |
| Dispute closed without charge | **OPEN** | Refund if paid | **OPEN** | **OPEN** |

> **Check with a lawyer/bank:** holding customer money before passing it to
> providers may require a licensed escrow or trust arrangement in Kenya.
> The design doesn't change, but who holds the account might.

---

## 4. Pricing

| Price | Set by | When | Customer accepts |
|---|---|---|---|
| Call-out | Fundi-X formula | At booking | By paying it |
| Maintenance base quote | Fundi-X pricing catalog | At booking | Explicitly, before paying the call-out (`acceptedAt`, `acceptedBy`) |
| Repair quote | Provider | After diagnosis | In the app (`QUOTE_SENT`) |
| Additional quote | Provider | During `IN_PROGRESS` | In the app; base work continues meanwhile |

### 4.1 Quotes

```ts
Quote {
  kind: 'BASE' | 'ADDITIONAL'
  issuedBy: 'FUNDI_X' | 'PROVIDER'
  version            // revisions of the same quote (repair BASE only)
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED'
  items[]            // PART | LABOUR | CONSUMABLE | OTHER — never call-out
  reason?            // ADDITIONAL: why it's needed ("pads at 2 mm")
  acceptedAt?, acceptedBy?
}
```

- A job can have several quotes: one `BASE` (with versions) and any number
  of `ADDITIONAL`.
- Providers can **never** edit a Fundi-X quote. Differences found on site
  (e.g. a pricier filter) are raised as an `ADDITIONAL` quote with a reason.
- A **revision** replaces a pending quote (old one `SUPERSEDED`). An
  **additional** quote adds to an approved one. These are different things.
- An approved quote becomes a `Charge`.

### 4.2 Maintenance pricing is temporary

Fundi-X sets maintenance prices only for the first years of operation, to
build a dataset for a better pricing model. Therefore:

- Pricing sits behind one interface (`PricingService`) so the catalog can be
  replaced by a model later without touching the job flow.
- Every quote and line item is stored in a structured form (kind, part,
  quantity, unit price) with the vehicle (make, model, engine, year),
  location and date.
- Additional quotes on maintenance jobs are especially valuable: they show
  where the catalog was wrong. Record the reason.
- Repair quotes from providers are recorded the same way, as data for a future
  repair pricing model.

---

## 5. States

`DRAFT` exists only on the customer's phone (`RequestDraft`); the backend's
lifecycle starts when the job is created.

| # | Status | Meaning |
|---|---|---|
| 1 | `CALL_OUT_PAYMENT_PENDING` | Job created; waiting for the call-out payment |
| 2 | `SEARCHING` | Paid; looking for a provider |
| 3 | `OFFERED` | Offered to one provider, waiting for their answer |
| 4 | `ACCEPTED` | Provider assigned, not yet travelling |
| 5 | `EN_ROUTE` | Provider travelling to the vehicle |
| 6 | `ARRIVED` | Provider at the vehicle |
| 7 | `DIAGNOSING` | *Repair only.* Inspecting, preparing a quote |
| 8 | `QUOTE_SENT` | *Repair only.* Quote waiting for the customer |
| 9 | `IN_PROGRESS` | Approved work being done |
| 10 | `AWAITING_CONFIRMATION` | Provider says done; customer checking |
| 11 | `PAYMENT_PENDING` | Customer confirmed; service payment due |
| 12 | `COMPLETED` | Paid in full; escrow released |
| 13 | `CANCELLED` | Ended early; escrow refunded or released per §3.5 |
| 14 | `DISPUTED` | Customer reported a problem; support reviewing |

**Removed from the current code:** `PAID`. Service payment success moves
the job straight from `PAYMENT_PENDING` to `COMPLETED` (principle 2).

---

## 6. Transitions

Anything not listed is forbidden. **Guards** are conditions beyond "right
actor, right status".

| From | To | Actor | Guard / trigger | Money |
|---|---|---|---|---|
| (new) | `CALL_OUT_PAYMENT_PENDING` | CUSTOMER | Maintenance: base quote accepted | Call-out `Charge` created |
| `CALL_OUT_PAYMENT_PENDING` | `SEARCHING` | SYSTEM | Call-out payment SUCCESS | In escrow |
| `CALL_OUT_PAYMENT_PENDING` | `CANCELLED` | CUSTOMER | Abandons booking | none |
| `CALL_OUT_PAYMENT_PENDING` | `CANCELLED` | SYSTEM | Unpaid after **30 min** | none |
| `SEARCHING` | `OFFERED` | SYSTEM | Provider online, free, not yet asked | – |
| `SEARCHING` | `CANCELLED` | CUSTOMER | – | Refund call-out |
| `SEARCHING` | `CANCELLED` | SYSTEM | No provider after matching window | Refund call-out |
| `OFFERED` | `ACCEPTED` | PROVIDER | Must be the offered provider | – |
| `OFFERED` | `SEARCHING` | PROVIDER | Declines | – |
| `OFFERED` | `SEARCHING` | SYSTEM | Offer expired (45 s) | – |
| `OFFERED` | `CANCELLED` | CUSTOMER | – | Refund call-out |
| `ACCEPTED` | `EN_ROUTE` | PROVIDER | Assigned provider | – |
| `ACCEPTED` | `SEARCHING` | PROVIDER | Withdraws; rematch, provider excluded | Stays in escrow |
| `ACCEPTED` | `CANCELLED` | CUSTOMER | – | Refund call-out |
| `EN_ROUTE` | `ARRIVED` | PROVIDER | Assigned provider | – |
| `EN_ROUTE` | `SEARCHING` | PROVIDER | Withdraws; rematch | Stays in escrow |
| `EN_ROUTE` | `CANCELLED` | CUSTOMER | Warned call-out is non-refundable | Release call-out |
| `ARRIVED` | `DIAGNOSING` | PROVIDER | **`QUOTED`** jobs | – |
| `ARRIVED` | `IN_PROGRESS` | PROVIDER | **`FIXED`** jobs (base quote already approved) | – |
| `ARRIVED` | `CANCELLED` | PROVIDER | Customer not found after **15 min** wait | Release call-out |
| `DIAGNOSING` | `QUOTE_SENT` | PROVIDER | Valid quote | – |
| `QUOTE_SENT` | `IN_PROGRESS` | CUSTOMER | Approves the *current* quote version | Quote → `Charge` |
| `QUOTE_SENT` | `DIAGNOSING` | PROVIDER | Revises; old quote `SUPERSEDED` | – |
| `QUOTE_SENT` | `CANCELLED` | CUSTOMER | Declines repair | Release call-out |
| `IN_PROGRESS` | `AWAITING_CONFIRMATION` | PROVIDER | **No `ADDITIONAL` quote still `PENDING`** | – |
| `AWAITING_CONFIRMATION` | `PAYMENT_PENDING` | CUSTOMER | Confirms work | – |
| `AWAITING_CONFIRMATION` | `PAYMENT_PENDING` | SYSTEM | No response in **48 h** (auto-confirm) | – |
| `AWAITING_CONFIRMATION` | `DISPUTED` | CUSTOMER | Gives a reason | Escrow held |
| `PAYMENT_PENDING` | `COMPLETED` | SYSTEM | Service payment SUCCESS | Release all |
| `DISPUTED` | `IN_PROGRESS` | SYSTEM | Support: provider fixes it at no extra cost | Escrow held |
| `DISPUTED` | `PAYMENT_PENDING` | SYSTEM | Support: work was fine (amount may be adjusted) | – |
| `DISPUTED` | `CANCELLED` | SYSTEM | Support: close without charge | **OPEN** (§3.5) |

**Customer cancellations after arrival** (`ARRIVED`, `DIAGNOSING`) aren't
listed: the customer declines the quote instead. **OPEN:** whether a
maintenance customer may cancel after the provider arrives (would release the
call-out).

**Additional quotes** don't change job status. While `IN_PROGRESS`:
`PROVIDER` raises one → it's `PENDING` → `CUSTOMER` approves (becomes a
`Charge`) or rejects (work not done). Base work continues throughout.

---

## 7. The matrix: one state, three views

| Status | Customer sees / can do | Mechanic sees / can do | System does | Notify |
|---|---|---|---|---|
| `CALL_OUT_PAYMENT_PENDING` | Price summary (call-out, + base quote for maintenance). **Pay call-out**, cancel | – | STK push, 60 s per attempt; abandon timer | – |
| `SEARCHING` | "Finding a trusted fundi". Cancel (full refund) | – | Match: online, free, nearest not yet asked; retry window | – |
| `OFFERED` | "We've found a fundi, waiting for them to confirm". Cancel (full refund) | Offer card, countdown. **Accept / Decline** | 45 s expiry → next provider | Mechanic: new job |
| `ACCEPTED` | Provider card. Cancel (full refund) | **I'm on my way**. Withdraw | Lock assignment | Customer: fundi confirmed |
| `EN_ROUTE` | Map, live ETA. Cancel (**call-out not refunded**, warned first) | Navigate. **I've arrived**. Withdraw | ETA updates | Customer: on the way |
| `ARRIVED` | "Your fundi has arrived" | Repair: **Start inspection**. Maintenance: **Start service**. Customer not found | No-show timer | Customer: arrived |
| `DIAGNOSING` | "Inspecting your vehicle" | **Create quote** | – | – |
| `QUOTE_SENT` | Quote. **Approve / Decline** (decline: call-out kept, job ends) | Waiting. **Change quote** | Track versions | Customer: estimate ready |
| `IN_PROGRESS` | Approved work list. **Approve / reject** any additional quote | Work. **Raise additional quote**. **Mark complete** (blocked while one is pending) | – | Customer: additional quote |
| `AWAITING_CONFIRMATION` | Work notes. **Confirm / Report a problem** | Waiting | Auto-confirm timer | Customer: please confirm |
| `PAYMENT_PENDING` | "Paid KSh 800 · still to pay KSh 7,000". **Pay** | Waiting for payment | STK push; reminders | Customer: payment due |
| `COMPLETED` | Receipt. **Rate** | Earnings breakdown | Release escrow, commission, payout | Both: completed / paid out |
| `CANCELLED` | Why it ended; refund status; **Request again** | Why it ended; any call-out earned | Refund or release per §3.5 | Both |
| `DISPUTED` | "We're looking into it" | Customer's report | Support review | Both; support |

---

## 8. Failure scenarios

| Scenario | Handling |
|---|---|
| Call-out STK cancelled / low balance / timeout | Payment `FAILED`; job stays `CALL_OUT_PAYMENT_PENDING`; retry |
| Customer never pays the call-out | Auto-cancel after 30 min (not while a PIN prompt is open); nothing to refund |
| Every provider declines or ignores | `CANCELLED` (SYSTEM), automatic full refund |
| Provider withdraws after accepting | Back to `SEARCHING`, provider excluded, money stays in escrow |
| Provider never presses "arrived" | **OPEN:** support alert after ETA + margin |
| Customer not at the location | Provider waits 15 min, then `CANCELLED`, call-out released |
| Customer acts on an outdated quote | Rejected (`StaleQuoteError`); app shows the current quote |
| Provider tries to finish with an additional quote pending | Blocked by guard |
| Customer doesn't confirm completion | Auto-confirm after 48 h |
| Service payment never made | **OPEN:** reminders, then support/collections; escrow keeps the call-out |
| Refund to M-Pesa fails | Refund stays `PENDING`, retried; support alert |
| Two actions at once (e.g. cancel vs accept) | Backend checks the status at write time; the later action gets `JobTransitionError` |

**OPEN:** providers who withdraw repeatedly (penalties, ranking).

---

## 9. Implementation notes

All of the above runs in the mock backend. Things worth knowing when the
real backend is built:

| Area | Where | Note |
|---|---|---|
| Transition rules | `domain/jobs/transitions.ts` | Guards by `pricingMode` |
| Time limits | `domain/jobs/rules.ts` | 30 min / 15 min / 48 h, shared by backend and apps |
| Escrow rules | `domain/billing/ledger.ts` → `settlementFor()` | Pure function; called once when a job ends |
| Ledger | `Charge`, `Payment`, `Refund`, `Release` | Balances are always calculated, never stored |
| Pricing | `PricingService` + `data/mock/mockPricing.ts` | Backend re-prices every booking (`PriceChangedError`) |
| Cross-record rule | "can't finish with an additional quote pending" | Enforced in the repository, not the table |
| Late payment | Call-out paid after the booking was cancelled | Refunded automatically |
| Dispute closed without charge | `settlementFor()` returns `hold` | Money stays in escrow until the OPEN rule is decided |
| Call-out distance | `CALL_OUT_DISTANCE` | Flat KSh 300 until the formula is decided (OPEN) |
