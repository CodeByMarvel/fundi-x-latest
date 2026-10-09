# Fundi-X Job Flow & Financial Settlement Specification

**Version 1.0 — 2026-10-09.** The source of truth for the mock backend, both
apps, and the future backend API. Items marked **CONFIGURABLE** are decided
in shape but their numbers live in backend configuration.

> **Status of the code:** the mock backend and both apps implement this
> version (§19). Anything in §17 is still open.

---

## 1. The principle

> **Before work starts, Fundi-X protects the customer's ability to leave.
> Once work starts, Fundi-X protects the provider's approved payment, while
> preserving the customer's right to dispute the work.**

A **Job** is the single source of truth connecting a customer's vehicle need,
the assigned provider, the work, the quotes, and every shilling paid, held,
released or refunded. The customer app and the mechanic app are two windows
onto it. The backend is the referee: it owns the state machine, prices,
matching, the money and every rule below.

### Rules that apply everywhere

1. **One job, three actors:** `CUSTOMER`, `PROVIDER`, `SYSTEM` (the platform,
   including support). Every status change is made by exactly one actor and
   recorded as a `JobEvent`.
2. **Status is lifecycle; money is facts.** Status says where the *work* is.
   Whether money moved lives on `Payment`, `Refund` and `Release` records.
3. **Escrow.** All customer money goes into Fundi-X escrow. It leaves only
   when the job ends: released to the provider (minus commission) or refunded.
4. **Store facts, calculate balances.** Charges and payments are immutable;
   balances are always calculated.
5. **The backend sets every price.** Apps display prices; they never
   calculate them. Bookings carry the price the customer saw, and the backend
   refuses them if it no longer matches.
6. **Agreed prices are frozen.** Prices are copied into the job's quote when
   agreed. Later catalog changes never alter an existing job.
7. **No surprise charges.** Every amount is shown and accepted before it can
   be charged.
8. **A closed job never leaves a debt.** All service money is collected
   before work starts, so a job can end without anyone owing anything; unpaid
   charges on a closed job are void.

---

## 2. Pricing modes

The backend decides each job's pricing mode at booking.

| Mode | Who prices | Price known | Typical example |
|---|---|---|---|
| `FIXED` | Fundi-X pricing engine | Before booking | Oil service, full service; later, common repairs once the data supports it |
| `QUOTED` | Provider, after diagnosis | On site | Engine fault, accident damage, unusual repairs, services the catalog can't price |

**Additional quotes** (provider-issued) can be added to either mode during
`IN_PROGRESS` for extra work found on site. They add to the agreed price;
they never change it.

The flow forks on pricing mode, not on repair vs service, so moving a type
of work from `QUOTED` to `FIXED` only needs a catalog entry, never a change
to the apps.

---

## 3. Pricing engine (backend)

### 3.1 Call-out fee

- Covers the provider's **transport and inspection**. No separate inspection
  fee exists.
- **CONFIGURABLE:** a backend pricing rule (`call_out_rules`, with
  `effective_from`). v1.0 value: **KSh 800**, flat.
- Flat is fair because matching is **ring-limited with H3** (§4): no provider
  further than the maximum ring is ever offered the job.
- Later: per-area overrides keyed by a coarse H3 parent cell.

### 3.2 Fixed-price catalog

- Tables: service packages → package items, part prices, labour rates,
  vehicle adjustments; every price has `effective_from`.
- Inputs: vehicle (make, model, year, engine), service package, location zone.
- Output: line items with standard **service codes** and a total.
- Temporary by design: Fundi-X prices maintenance only until real job data
  supports a better model. The engine sits behind one interface
  (`PricingService`) so it can be replaced without touching the job flow.

### 3.3 Quotes

```
Quote
  kind: BASE | ADDITIONAL
  issuedBy: FUNDI_X | PROVIDER
  version            // revisions of a PROVIDER BASE quote
  status: PENDING | APPROVED | REJECTED | SUPERSEDED
  items[]: { serviceCode, kind, description, quantity, unitPrice, total }
  reason?            // ADDITIONAL: why it's needed
  respondedAt?, respondedBy?
```

- Item kinds: `PART | LABOUR | CONSUMABLE | OTHER`. Never call-out.
- **Service codes** (e.g. `BRAKE_PAD_FRONT`) come from a standard list;
  free-text description is kept, and an `OTHER` code covers anything not
  listed. This is what makes the pricing data analysable.
- A **revision** replaces a pending BASE quote (old one `SUPERSEDED`). An
  **additional** quote adds to an approved BASE quote. Different things.
- A `FUNDI_X` BASE quote is created `APPROVED` at booking
  (`respondedBy: CUSTOMER`, `respondedAt`): proof of what was agreed.

---

## 4. Matching (H3)

- The app sends coordinates; the **backend** converts them to an H3 cell.
  The app never chooses its own zone.
- Online providers report location regularly; the backend stores their
  current cell.
- Search ring by ring: the customer's cell (k = 0), then k = 1, k = 2, … up
  to a maximum. **CONFIGURABLE:** resolution (indicative: 8) and max k
  (indicative: ≈ 5 km).
- Candidates: online, not busy (no unfinished job, no open offer), not
  already offered this job. Rank by ring, then reliability and rating.
- Each matching round widens the search by one ring. After the last ring
  with nobody available: `CANCELLED` (`no_provider_available`), call-out
  refunded.
- ETAs come from routing, not H3 (hexagon distance is a straight line).
- Each job also stores a **coarse H3 cell** (indicative: resolution 6) as
  its `locationZone`, for pricing analysis without exposing addresses.

---

## 5. States

`DRAFT` lives only on the customer's phone. The backend lifecycle starts at
booking.

| # | Status | Meaning |
|---|---|---|
| 1 | `CALL_OUT_PAYMENT_PENDING` | Booked; waiting for the call-out |
| 2 | `SEARCHING` | Call-out in escrow; looking for a provider |
| 3 | `OFFERED` | Offered to one provider |
| 4 | `ACCEPTED` | Provider assigned, not yet travelling |
| 5 | `EN_ROUTE` | Provider travelling |
| 6 | `ARRIVED` | Provider at the vehicle |
| 7 | `DIAGNOSING` | *QUOTED only.* Inspecting, preparing a quote |
| 8 | `QUOTE_SENT` | *QUOTED only.* Quote waiting for the customer |
| 9 | `SERVICE_PAYMENT_PENDING` | Price agreed; waiting for the service money to reach escrow |
| 10 | `IN_PROGRESS` | Work under way; service money in escrow |
| 11 | `AWAITING_CONFIRMATION` | Provider says done; customer checking |
| 12 | `COMPLETED` | Confirmed; escrow released |
| 13 | `CANCELLED` | Ended early; escrow refunded or released per §8 |
| 14 | `DISPUTED` | Customer reported a problem; support reviewing |

**Changed from v0.2:** `PAYMENT_PENDING` (after the work) is replaced by
`SERVICE_PAYMENT_PENDING` (before the work). The new name pairs with
`CALL_OUT_PAYMENT_PENDING` and makes clear which money it waits for.

### The two paths

```
QUOTED  … ARRIVED → DIAGNOSING → QUOTE_SENT → SERVICE_PAYMENT_PENDING → IN_PROGRESS → …
FIXED   … ARRIVED ─────────────────────────→ SERVICE_PAYMENT_PENDING → IN_PROGRESS → …
```

**When fixed-price money is collected.** At arrival, not at
booking. The provider checks the vehicle matches the booking (model, engine,
oil spec) and taps "Ready to start"; the customer then pays the agreed price
into escrow. Reasons: same step for both paths; the customer only commits
the larger amount once a provider is actually there; a mismatched vehicle is
caught before money is taken.

---

## 6. Transitions

Anything not listed is forbidden.

| From | To | Actor | Guard / trigger | Reason recorded | Money (§8) |
|---|---|---|---|---|---|
| (booking) | `CALL_OUT_PAYMENT_PENDING` | CUSTOMER | Price matches backend; FIXED quote accepted | – | Call-out `Charge`; FIXED: service `Charge` |
| `CALL_OUT_PAYMENT_PENDING` | `SEARCHING` | SYSTEM | Call-out payment SUCCESS | – | In escrow |
| `CALL_OUT_PAYMENT_PENDING` | `CANCELLED` | CUSTOMER | – | `customer_cancelled` | Nothing paid |
| `CALL_OUT_PAYMENT_PENDING` | `CANCELLED` | SYSTEM | Unpaid 30 min, no payment in flight | `call_out_unpaid` | Nothing paid |
| `SEARCHING` | `OFFERED` | SYSTEM | Candidate found (§4) | – | – |
| `SEARCHING` | `CANCELLED` | CUSTOMER | – | `customer_cancelled` | Refund call-out |
| `SEARCHING` | `CANCELLED` | SYSTEM | Max ring, nobody | `no_provider_available` | Refund call-out |
| `OFFERED` | `ACCEPTED` | PROVIDER | Must be the offered provider | – | – |
| `OFFERED` | `SEARCHING` | PROVIDER | Declines | – | – |
| `OFFERED` | `SEARCHING` | SYSTEM | Offer expired (45 s) | – | – |
| `OFFERED` | `CANCELLED` | CUSTOMER | – | `customer_cancelled` | Refund call-out |
| `ACCEPTED` | `EN_ROUTE` | PROVIDER | Assigned provider; records `expectedArrivalAt` | – | – |
| `ACCEPTED` | `SEARCHING` | PROVIDER | Withdraws; rematch, provider excluded | reliability event | Stays in escrow |
| `ACCEPTED` | `CANCELLED` | CUSTOMER | – | `customer_cancelled` | Refund call-out |
| `EN_ROUTE` | `ARRIVED` | PROVIDER | Assigned provider | – | – |
| `EN_ROUTE` | `SEARCHING` | PROVIDER | Withdraws; rematch | reliability event | Stays in escrow |
| `EN_ROUTE` | `CANCELLED` | CUSTOMER | Before `expectedArrivalAt` + 20 min | `customer_cancelled` | Release call-out |
| `EN_ROUTE` | `CANCELLED` | CUSTOMER | After `expectedArrivalAt` + 20 min | `provider_late` + reliability event | **Refund** call-out |
| `ARRIVED` | `DIAGNOSING` | PROVIDER | QUOTED | – | – |
| `ARRIVED` | `SERVICE_PAYMENT_PENDING` | PROVIDER | FIXED; vehicle matches booking | – | – |
| `ARRIVED` | `CANCELLED` | CUSTOMER | – | `customer_cancelled` | Release call-out |
| `ARRIVED` | `CANCELLED` | PROVIDER | 15 min after `arrivedAt` | `customer_no_show` | Release call-out |
| `DIAGNOSING` | `QUOTE_SENT` | PROVIDER | Valid quote | – | – |
| `DIAGNOSING` | `CANCELLED` | CUSTOMER | – | `customer_cancelled` | Release call-out |
| `QUOTE_SENT` | `SERVICE_PAYMENT_PENDING` | CUSTOMER | Approves the *current* version | – | Quote → `Charge` |
| `QUOTE_SENT` | `DIAGNOSING` | PROVIDER | Revises; old quote `SUPERSEDED` | – | – |
| `QUOTE_SENT` | `CANCELLED` | CUSTOMER | Declines | `quote_declined` | Release call-out |
| `SERVICE_PAYMENT_PENDING` | `IN_PROGRESS` | SYSTEM | Service payment SUCCESS | – | In escrow |
| `SERVICE_PAYMENT_PENDING` | `CANCELLED` | CUSTOMER | Backs out before paying | `customer_cancelled` | Release call-out |
| `SERVICE_PAYMENT_PENDING` | `CANCELLED` | SYSTEM | Unpaid 30 min, no payment in flight | `service_unpaid` | Release call-out |
| `IN_PROGRESS` | `AWAITING_CONFIRMATION` | PROVIDER | No `ADDITIONAL` quote `PENDING` | – | – |
| `AWAITING_CONFIRMATION` | `COMPLETED` | CUSTOMER | Confirms | – | Release all |
| `AWAITING_CONFIRMATION` | `COMPLETED` | SYSTEM | 48 h without response | `auto_confirmed` | Release all |
| `AWAITING_CONFIRMATION` | `DISPUTED` | CUSTOMER | Gives a reason | – | Escrow held |
| `DISPUTED` | `IN_PROGRESS` | SYSTEM | Support: provider fixes it | `rework` | Escrow held |
| `DISPUTED` | `COMPLETED` | SYSTEM | Support: work was fine | `dispute_upheld_provider` | Release all |
| `DISPUTED` | `CANCELLED` | SYSTEM | Support: split decided (§9) | `dispute_resolved` | Per resolution |

**Late arrival after a late cancellation.** Once `CANCELLED`, nothing moves
the job again. A provider who arrives at 2:25 after a 2:21 `provider_late`
cancellation can't claim the call-out: settlement happened at cancellation.

**Who can cancel what (customer):**

| Status | Cancel? | Call-out |
|---|---|---|
| `CALL_OUT_PAYMENT_PENDING` | Yes | Nothing paid |
| `SEARCHING`, `OFFERED`, `ACCEPTED` | Yes | Refunded |
| `EN_ROUTE` (on time) | Yes | Kept by provider |
| `EN_ROUTE` (ETA + 20 min passed) | Yes | **Refunded**; provider reliability event |
| `ARRIVED`, `DIAGNOSING` | Yes | Kept by provider |
| `QUOTE_SENT` | Decline instead | Kept by provider |
| `SERVICE_PAYMENT_PENDING` | Yes | Kept by provider |
| `IN_PROGRESS`, `AWAITING_CONFIRMATION` | No — report a problem | Escrow held |
| `COMPLETED`, `CANCELLED`, `DISPUTED` | No | Settled / support |

---

## 7. Additional quotes

While `IN_PROGRESS` (either mode):

1. `PROVIDER` raises an `ADDITIONAL` quote with items and a reason. Base work
   continues; job status doesn't change.
2. `CUSTOMER` either declines (quote `REJECTED`, extra work not done) or
   **approves and pays in one step**: the quote becomes `APPROVED` and a
   `Charge` is created only once the payment reaches escrow. If the payment
   fails, the quote stays `PENDING` and the customer can retry or decline.
3. The provider can't mark the job complete while any additional quote is
   `PENDING`.

Approving and paying are one step here (unlike the BASE quote, where they're
two job statuses) because an additional quote doesn't change the job's
status, so the quote itself must carry the state.

---

## 8. Escrow settlement

Runs exactly once, when a job reaches `COMPLETED` or `CANCELLED`. One pure
function (`settlementFor`) decides; the backend records the result.

| How the job ended | Call-out in escrow | Service money in escrow |
|---|---|---|
| `call_out_unpaid` | – | – |
| `customer_cancelled` from `CALL_OUT_PAYMENT_PENDING` | – | – |
| `customer_cancelled` from `SEARCHING` / `OFFERED` / `ACCEPTED` | Refund | – |
| `no_provider_available` | Refund | – |
| `provider_late` | Refund | – |
| `customer_cancelled` from `EN_ROUTE` / `ARRIVED` / `DIAGNOSING` / `SERVICE_PAYMENT_PENDING` | Release | – |
| `quote_declined` | Release | – |
| `service_unpaid` | Release | – |
| `customer_no_show` | Release | – |
| `COMPLETED` (confirmed, auto-confirmed, or dispute upheld) | Release | Release |
| `dispute_resolved` | Per resolution (§9) | Per resolution (§9) |

- **Release** = paid to the assigned provider, minus commission.
- **Commission (CONFIGURABLE):** per money purpose (`CALL_OUT`, `SERVICE`) in
  basis points; default 1000 bp (10%) for both. Taken only on released money.
- **Unpaid charges on a closed job are void** (principle 8). There are no
  collections in v1.0.
- **Money that arrives after a job closed** (e.g. the customer completes the
  M-Pesa PIN after cancelling) is refunded automatically.

---

## 9. Disputes

- Raised only from `AWAITING_CONFIRMATION`, with a reason. All money stays in
  escrow.
- Support reviews and records a **resolution**:

```
DisputeResolution
  outcome: REWORK | UPHOLD_PROVIDER | SPLIT
  customerRefund: Cents
  providerPayout: Cents      // gross, before commission
  decidedBy: support agent id
  note
```

- `REWORK` → `IN_PROGRESS` (provider fixes it at no extra cost).
- `UPHOLD_PROVIDER` → `COMPLETED` (normal release).
- `SPLIT` → `CANCELLED` (`dispute_resolved`); settlement follows the split.
- **Invariant:** `customerRefund + providerPayout` must equal exactly what is
  in escrow for the job. The backend rejects any other resolution.
- Commission applies to `providerPayout` only.

---

## 10. Time limits (CONFIGURABLE)

| Limit | Value | What happens |
|---|---|---|
| Call-out payment window | 30 min | Booking closed (`call_out_unpaid`) unless a payment is in flight |
| M-Pesa prompt | 60 s | Payment `FAILED` (`timeout`); retry allowed |
| Offer response | 45 s | Next provider |
| Matching | Until max H3 ring | `no_provider_available`, refund |
| Late provider grace | ETA + 20 min | Customer may cancel with full refund |
| Not-arrived alert | ETA + 20 min | Reminder to provider; support alerted. **Never** auto-`ARRIVED` |
| No-show wait | 15 min after arrival | Provider may end the job, keeps call-out |
| Service payment window | 30 min | `service_unpaid`; provider keeps call-out |
| Confirmation | 48 h | Auto-confirm → `COMPLETED` |
| Dispute review | Support SLA (**CONFIGURABLE**) | – |

---

## 11. The matrix: one state, three views

| Status | Customer sees / can do | Provider sees / can do | System does | Notify |
|---|---|---|---|---|
| `CALL_OUT_PAYMENT_PENDING` | Price summary; **Pay call-out**; cancel | – | STK push; 30-min window | – |
| `SEARCHING` | "Finding a fundi"; cancel (refund) | – | H3 ring search | – |
| `OFFERED` | "Found a fundi, waiting to confirm"; cancel (refund) | Offer + countdown; **Accept / Decline** | 45-s expiry | Provider: new job |
| `ACCEPTED` | Provider card; cancel (refund) | **I'm on my way**; withdraw | Lock assignment | Customer: confirmed |
| `EN_ROUTE` | Map, ETA; cancel (kept, or refunded if late) | **I've arrived**; withdraw | ETA; late alert | Customer: on the way |
| `ARRIVED` | "Fundi has arrived"; cancel (kept) | QUOTED: **Start inspection**. FIXED: **Ready to start**. **Customer not here** after 15 min | No-show timer | Customer: arrived |
| `DIAGNOSING` | "Inspecting"; cancel (kept) | **Create quote** | – | – |
| `QUOTE_SENT` | Quote; **Approve / Decline** | Waiting; **Change quote** | Track versions | Customer: estimate ready |
| `SERVICE_PAYMENT_PENDING` | Agreed price; **Pay into escrow**; cancel (kept) | "Waiting for payment — don't start yet" | STK push; 30-min window | Customer: pay to start |
| `IN_PROGRESS` | Agreed work; **Approve & pay / Decline** extra quotes | Work; **Quote extra work**; **Mark complete** | – | Customer: extra quote |
| `AWAITING_CONFIRMATION` | Work notes; **Confirm / Report a problem** | Waiting | 48-h auto-confirm | Customer: please confirm |
| `COMPLETED` | Receipt; **Rate** | Earnings breakdown | Release escrow, commission, payout | Both |
| `CANCELLED` | Why; refund status; **Request again** | Why; any call-out earned | Settle per §8 | Both |
| `DISPUTED` | "We're looking into it" | Customer's report | Support review, resolution | Both; support |

---

## 12. Payments, refunds and releases

| Record | Created when | Key fields |
|---|---|---|
| `Charge` | Call-out at booking; service when a quote is approved (FIXED: at booking) | purpose, amount, quoteId |
| `Payment` | Customer starts an STK push | purpose, phone, amount, status, M-Pesa `CheckoutRequestID`, receipt |
| `Refund` | Settlement or late payment | paymentId, amount, reason, status |
| `Release` | Settlement | providerId, lines (per payment: gross, commission), net |

- The **backend decides the purpose and amount** of a payment from the job's
  status; the app only supplies the phone number.
- Only one payment per job may be in flight.
- **Idempotency:** M-Pesa can deliver the same callback more than once. The
  backend processes each `CheckoutRequestID` once; repeats are ignored.
- Refunds go back to the paying M-Pesa number (B2C); a failed refund stays
  `PENDING`, is retried, and alerts support.

---

## 13. Provider reliability

Recorded as events, not fines (v1.0):

| Event | From |
|---|---|
| Offer declined / expired | `OFFERED → SEARCHING` |
| Withdrew after accepting | `ACCEPTED → SEARCHING` |
| Withdrew while en route | `EN_ROUTE → SEARCHING` |
| Late (customer cancelled after grace) | `provider_late` |
| Dispute outcome | `DisputeResolution` |
| Rating | Customer rating |

**Policy (CONFIGURABLE thresholds):** occasional events → nothing; repeated
accept-then-withdraw → warning; repeated en-route withdrawals or lateness →
lower matching priority; severe → temporary suspension pending review.

---

## 14. Events and audit trail

- Every status change: `JobEvent` (from, to, actor, time, metadata).
- Every money movement: its own immutable record (§12).
- Quotes keep every version; nothing is edited after the customer answers.
- Support decisions: `DisputeResolution` with agent and note.
- Non-lifecycle updates (ETA ticks, location) are not events.

---

## 15. Race conditions

| Race | Outcome |
|---|---|
| Customer cancels as provider accepts | Whichever reaches the backend first wins; the other gets `JobTransitionError` |
| Offer expires as provider accepts | Expiry checks the offer is still the same one; accept checks it's still offered |
| Customer approves a quote being revised | `StaleQuoteError`; customer sees the new version |
| Customer cancels with the M-Pesa prompt open, then pays | Payment refunded automatically |
| Provider arrives after a `provider_late` cancellation | `JobTransitionError`; settlement already done |
| Duplicate M-Pesa callback | Ignored (idempotency, §12) |
| Two payments started at once | Second refused while the first is in flight |
| Double taps | Blocked in the app; the backend's status checks are the real guard |
| Timer fires after the state moved on | Every timer re-checks the current state before acting |

---

## 16. Required data (backend database)

| Area | Tables (indicative) |
|---|---|
| People | customers, providers (online, current H3 cell, last location time, rating), provider_reliability_events |
| Vehicles | vehicles (make, model, year, engine, registration) |
| Jobs | jobs (status, pricing mode, H3 cells, timestamps, cancellation), job_events |
| Quotes | quotes, quote_items (service code, kind, qty, unit price) |
| Pricing | service_codes, service_packages, package_items, part_prices, labour_rates, vehicle_adjustments, call_out_rules — all with `effective_from` |
| Money | charges, payments, refunds, releases, commission_rules |
| Support | dispute_resolutions |
| Feedback | ratings |

---

## 17. Still open

- Exact H3 resolution, max ring, and matching round timing.
- Reliability thresholds and their effect on matching.
- Support SLA for disputes.
- What happens when a FIXED job's vehicle doesn't match the booking (e.g.
  different engine): re-price on site, switch to QUOTED, or cancel with the
  call-out kept.

---

## 18. Decisions added in v1.0 (accepted 2026-10-09)

1. **`SERVICE_PAYMENT_PENDING`** as the state name (replacing `PAYMENT_PENDING`).
2. **Fixed-price money collected at arrival** after "Ready to start", not at
   booking (§5).
3. **Customer may back out at `SERVICE_PAYMENT_PENDING`** (call-out kept):
   work hasn't started, so the "customer can leave" principle applies.
4. **30-minute service payment window**, then `service_unpaid`.
5. **Additional quotes: approve and pay in one step** (§7).
6. **Disputes can end in `COMPLETED`** when support upholds the provider.

---

## 19. Implemented (v0.2 → v1.0)

| Area | Change |
|---|---|
| `JobStatus` | `PAYMENT_PENDING` → `SERVICE_PAYMENT_PENDING`, moved before `IN_PROGRESS` |
| `TRANSITIONS` | Per §6, incl. `ARRIVED → SERVICE_PAYMENT_PENDING` (FIXED), customer cancel at `ARRIVED`/`DIAGNOSING`/`SERVICE_PAYMENT_PENDING`, `DISPUTED → COMPLETED` |
| Late provider | `expectedArrivalAt` on `startTrip`; `provider_late` reason; refund |
| Settlement | New reasons; dispute split from `DisputeResolution` instead of hold |
| Payments | Service paid before work; additional quotes approve-and-pay |
| Pricing | Single configurable call-out (KSh 800) |
| Quotes | `serviceCode` on items; standard code list in the quote builder |
| Reliability | Record events from withdrawals, lateness, disputes |
| Customer UI | Pay-to-start step; late-cancel with refund; cancel at arrival/diagnosis |
| Provider UI | "Ready to start" (FIXED); "Waiting for payment — don't start yet" |
