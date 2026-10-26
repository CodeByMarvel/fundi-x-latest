# Fundi-X Admin Portal Specification

**Version 1.0 — 2026-10-13.** The agreed design for the staff portal (the
`admin/` website and the server's `/admin` API). It sits beside
[job-flow.md](job-flow.md), which stays the source of truth for jobs and
money; this document only says how staff see and act on them.

---

## 1. The principle

> **The Admin Portal is an operational control system, not a backdoor into
> the application.**

The customer asks for a mechanic, the mechanic does the job, and the portal
makes sure the whole system runs correctly, safely and profitably. Staff go
through sign-in, permissions and the same backend rules as everyone else.
Being staff never means skipping a rule.

### Rules that apply everywhere

1. **The backend is the authority.** The portal never sets a job's status
   or a payment's state directly. There is no "edit status" button.
2. **Mostly read, sometimes intervene.** The portal's job is to *inspect*
   and *investigate*. Changes happen only through **controlled operations**
   (named actions such as "cancel job", "retry timer", "suspend provider"),
   each one a backend endpoint that applies the domain rules.
3. **Every intervention has a reason.** The server refuses an intervention
   without a written reason, and the audit log keeps it: **who, what, when,
   why**, plus the value before and after.
4. **Interventions on jobs are made as `SYSTEM`.** job-flow.md has three
   actors (`CUSTOMER`, `PROVIDER`, `SYSTEM`, where `SYSTEM` includes
   support). A staff action is a `SYSTEM` event whose metadata names the
   staff member and the reason, so a job's timeline shows exactly who
   stepped in.
5. **Least privilege.** Each person sees and does only what their role
   needs. A developer investigating an error doesn't get refund buttons.
6. **The portal shows only what the backend can produce.** A section
   appears when the server feature behind it exists. No placeholder
   numbers.

---

## 2. Sign-in and staff

- Staff are a separate kind of account from app users (`staff` table),
  signed in by **Google** (email must be in `staff`; bound to the Google
  account on first sign-in). Sessions last 12 hours, are stored hashed, and
  end at once on sign-out or when the account is disabled.
- The first owner comes from `OWNER_EMAIL` (server `.env` or the host's
  settings), used once while no staff exist. Never hard-coded.
- **Development only:** `ADMIN_DEV_SIGN_IN=true` adds "Sign in as owner",
  answered only for requests from the server's own computer and never in
  production.
- Changes must come from the portal's own address (`ADMIN_ORIGIN`).
- **Security → Staff** (`staff.manage`): add a Google email with a role,
  change a role, disable (ends their sessions at once) or enable. Each needs
  a reason. Nobody changes their own access, and the last active owner
  can't be demoted or disabled.

---

## 3. Sections

```text
ADMIN PORTAL
├── Dashboard            what is happening right now; alerts first
├── Operations
│   ├── Jobs             search, detail, timeline, step in     ✅ built
│   └── Mechanics        verification, reliability, status     ✅ built
├── Customer care
│   ├── Disputes         queue, decision, money split          ✅ built
│   ├── Customers        directory, history, suspend, notes    ✅ built
│   └── Evidence         photos on disputes                    ⏳ needs uploads
├── Finance
│   ├── Money            in, out, commission, per day          ✅ built
│   ├── Escrow           held per job                          ✅ built
│   ├── Books            double-entry ledger, checked          ✅ built
│   ├── M-Pesa out       payouts and refunds via B2C           ✅ built
│   └── Reconciliation   against M-Pesa statements             ⏳ next
├── Engineering
│   ├── System health    database, timers, worker              ✅ built
│   ├── Incidents        errors and failures, grouped          ✅ built
│   ├── Requests         recent requests, errors, slow ones    ✅ built
│   └── System           versions, switches, tables            ✅ built
├── Configuration
│   ├── Catalog          maintenance prices, models, history   ✅ built
│   └── Settings         call-out fee, matching, commission    ✅ built
└── Security
    ├── Audit log        who, what, when, why                  ✅ built
    └── Staff & roles    add people, assign roles              ⏳ when hiring
```

### 3.1 Dashboard

Answers "what is happening in Fundi-X right now?". Alerts come first (open
incidents, failed timers), then job counts by stage and today's totals. Each
tile appears only for people allowed to open the section behind it.
Mechanics online, payments pending and revenue arrive with matching and
M-Pesa.

### 3.2 Jobs

- **Search** by job id, customer name or phone, or vehicle registration.
  Filter by status. Newest first.
- **Job detail:** customer, provider, vehicle, request, pricing mode, the
  job's position in the state machine (§4), money (charges, payments,
  refunds, payouts, from the facts in job-flow.md §8 and §12), quotes, its
  timers, and the **full timeline** of `job_events` with the actor of each
  step.
- This is what answers "my mechanic took my money and disappeared":
  support reads the recorded history, not someone's account of it.
- Interventions (cancel with refund, reassign, resolve dispute) are added
  one at a time as controlled operations, each with a required reason.

### 3.3 Engineering

- **System health:** database answering, timers pending, timers overdue
  (a sign the worker is stuck), timers failed, server uptime.
- **Incidents:** every server error (HTTP 500), failed timer and timer
  worker crash is recorded. Repeats of the same problem are grouped into
  one incident with a count and first/last seen, so a flood of errors
  shows up as one row, not ten thousand.
- **Request ids:** every request gets an id (`req_…`), returned in the
  `x-request-id` header and in every error response. A customer or the
  app can quote it; the incident and the server log carry the same id.
- Incidents are resolved with a note. A problem that happens again after
  being resolved opens a new incident.
- Failed timers can be retried (an intervention: reason required).
- **Recent requests:** the last 500 requests this server answered (method,
  route, status, time taken, who, request id), filterable to errors and
  slow ones. Kept in memory only; the permanent log is the server output.
  Query strings are left out (searches can hold phone numbers).
- **Timers:** every timer, filterable by status.
- **System:** environment, Node and PostgreSQL versions, database size,
  migrations applied, rows per table, and which switches are on (Google,
  Apple, development sign-in, simulated M-Pesa). A development-only switch
  that is on in production is shown in red. Values are on/off only; no
  secret is ever sent to the portal.

### 3.4 Configuration

Values that change without an app release (today: the call-out fee). Each
setting has validation limits, a confirmation, a required reason, and an
audit entry. Some (commission, cancellation rules) are deliberately not
editable from the portal yet; when they are, they will need a second
person's approval (§6).

---

### 3.5 Catalog

The fixed prices for maintenance (job-flow.md §3.2), edited by people with
`catalog.edit`.

- **Packages:** each line with a price per vehicle class, parts marked
  optional, and what the customer pays per class with and without parts.
  Add, edit, or switch a package off (it's then quoted by the mechanic).
- **Vehicle models:** each model's usual engine size and fuel, used when
  the customer doesn't give theirs.
- **Premium makes.**
- **Price check:** what a given car pays for a package right now.
- **History:** every saved version with who, when and why; any version can
  be restored. A save made from an outdated version is refused, so two
  people editing at once can't silently undo each other.

### 3.6 Customer care

- **Disputes:** customers who reported a problem after the work, oldest
  first, with what is still held. The decision is made on the job's page
  (whole history in view): **mechanic fixes it** (back to work, counts
  against reliability), **work was fine** (completes, money released), or
  **divide the money** (the refund and the payout must add up to exactly
  what's held; on a fixed-price job the parts were already paid out, so
  only call-out and labour are divided). `disputes.resolve`.
- **Stepping in on a job** (`jobs.cancel`), as `SYSTEM` with the staff
  member and reason in the event (rule 4):
  - **Cancel and refund** from any status before the work is finished;
    everything still held goes back to the customer
    (`support_cancelled`). Finished work goes through a dispute instead.
  - **Find another mechanic** while the assigned one is accepted or on
    the way: the job searches again from the first ring, the call-out
    stays held.
- **Customers:** search by name, phone, email or id; a person's page shows
  their account, sign-in devices, bookings and money.
- **Suspend / lift suspension** (`users.suspend`): every request from the
  person's app is refused until lifted; a suspended mechanic goes offline.
- **Notes** on a job or a person, only ever added, so the next person on
  the case sees the story.

### 3.7 Mechanics

- **Waiting** list first, oldest first: a mechanic can't go online until
  verified. The person page shows who they are and their record.
- **Verify** or **reject** (`providers.verify`), with a reason. A rejection
  reason is shown to the mechanic in the app; when they update their
  profile it goes back to waiting. Rejecting a verified mechanic takes
  them offline.
- **Record:** jobs done, rating, reliability events in the last 30 days
  (facts; thresholds are still open, job-flow.md §17) and payouts.
- Not yet: documents (ID, permits) and photos, which need file storage.

### 3.8 Finance

Read-only, calculated from the payment, refund and payout records.

- For 7, 30 or 90 days: paid in, Fundi-X commission, refunds, and a daily
  chart (with a table view). Paid in and commission per kind of money
  (call-out, labour, parts).
- Now: held in escrow (and on how many jobs), refunds waiting to be sent,
  payouts recorded.
- Lists: payments in, refunds, payouts, jobs with money held (oldest
  first), and earnings per mechanic with their payout number.
- **Books** (docs/ledger.md): where every shilling at M-Pesa is (escrow,
  owed to mechanics, owed to customers, commission), and the check that
  the ledger agrees with the records.
- **M-Pesa out** (docs/mpesa.md): every payout and refund sent through
  B2C, problems first. A failed one can be sent again or recorded as
  received (with the M-Pesa code) by people with `money.refund`.
- Not yet: automatic reconciliation with M-Pesa statements.

## 4. The job state machine, as the portal shows it

Taken from job-flow.md §5. The portal shows the main path and highlights
the steps a job has reached, with side exits for cancellation and disputes.

```text
CALL_OUT_PAYMENT_PENDING → SEARCHING → OFFERED → ACCEPTED → EN_ROUTE → ARRIVED
   → (QUOTED only: DIAGNOSING → QUOTE_SENT)
   → SERVICE_PAYMENT_PENDING → IN_PROGRESS → AWAITING_CONFIRMATION → COMPLETED

Side exits: CANCELLED (from most states), DISPUTED (→ COMPLETED or CANCELLED)
```

Payment is not a status: whether money moved is shown from payment,
refund and release records.

---

## 5. Roles and permissions

Permissions are small named actions; every `/admin` endpoint requires one.
Roles are bundles of permissions, defined in
`server/src/admin/permissions.ts`.

| Permission | Allows |
|---|---|
| `jobs.view` | Search jobs, open job detail and timeline |
| `jobs.cancel` | Cancel and refund a job, or reassign its mechanic |
| `disputes.resolve` | Decide a dispute |
| `money.view` | Finance pages |
| `money.refund` | Send a failed M-Pesa transfer again, or record it received |
| `users.view` | Customers, mechanics, person pages, notes on people |
| `users.suspend` | Suspend or restore an app account |
| `providers.verify` | Verify or reject a mechanic |
| `settings.edit` | View and change settings |
| `catalog.edit` | View and change the maintenance catalog |
| `logs.view` | Audit log, incidents, system health |
| `incidents.resolve` | Mark an incident resolved |
| `timers.retry` | Retry a failed timer |
| `staff.manage` | Add staff, change roles, disable or enable staff |

| Role | Gets |
|---|---|
| **OWNER** (super admin) | Everything |
| Operations | jobs.view, jobs.cancel, users.view, users.suspend, providers.verify |
| Support | jobs.view, jobs.cancel, users.view |
| Finance | jobs.view, money.view, money.refund |
| Developer | jobs.view, logs.view, incidents.resolve, timers.retry |
| Compliance | jobs.view, users.view, providers.verify, disputes.resolve, logs.view |
| Manager | jobs.view, users.view, money.view, logs.view (read-only) |

Settings and the catalog stay with the owner for now.

More permissions (`payouts.manage`, `reports.view`) are added with the
features that need them.

---

## 6. Sensitive actions

- **Validation limits** on every setting (e.g. call-out fee between
  KSh 100 and KSh 10,000, whole shillings).
- **Confirmation** in the portal before saving.
- **Required reason**, stored in the audit log.
- **Second approval (planned):** commission changes and large refunds will
  need a second staff member to approve. Built when Fundi-X has more than
  one person; the audit log already records who did what, which approval
  builds on.

---

## 7. Audit log

Append-only (`audit_log`): staff member, action, target, value before and
after, **reason**, IP address and request id. It records every sign-in,
refused sign-in, sign-out, setting change and intervention. Entries are
never edited or deleted.

---

## 8. Implemented (v1.0)

| Area | Where |
|---|---|
| Staff, sessions, Google + development sign-in | `server/src/admin/` |
| Permissions and the OWNER role | `server/src/admin/permissions.ts` |
| Audit log with required reasons | `audit_log`, `/admin/audit` |
| Settings | `/admin/settings` |
| Jobs search and detail | `/admin/jobs`, `/admin/jobs/:id` |
| Dashboard summary | `/admin/dashboard` |
| Incidents, request ids, system health, timer retry | `incidents`, `/admin/incidents`, `/admin/health`, `/admin/timers/:id/retry` |
| Catalog (2026-10-20) | `catalog_versions`, `/admin/catalog/*` |
| Customer care: disputes, cancel, reassign, notes, customers, suspend (2026-10-21) | `server/src/admin/support.ts`, `server/src/jobs/support.ts`, `support_notes` |
| Mechanics: verification, record (2026-10-21) | `server/src/admin/mechanics.ts` |
| Finance (2026-10-21) | `server/src/admin/finance.ts` |
| Recent requests, timers, system (2026-10-21) | `server/src/requestLog.ts`, `/admin/requests`, `/admin/timers`, `/admin/system` |
| Staff and roles (2026-10-26) | `server/src/admin/staff.ts`, `/admin/staff` |
| Files: list, audited viewing links, storage use and upload limits (2026-10-26) | `server/src/admin/files.ts`, docs/files.md |
| Website | `admin/` (Vite + React) |
