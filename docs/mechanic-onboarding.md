# Mechanic onboarding

Status: **agreed design, not built** (brainstormed 2026-10-22).

How a mechanic or garage goes from "signed in with Google" to "can go
online and receive jobs". Today it is: phone number, one profile screen
(type, business name, free-text specialty), then PENDING until someone at
Fundi-X verifies them in the admin portal. This replaces that.

## Decisions

| Question | Decision |
|---|---|
| How strict at launch | **Standard**: ID + selfie + Certificate of Good Conduct + M-Pesa name match + a phone call. Trade certificate optional. |
| Skills | **Filter matching by skill**: a mechanic is only offered jobs in categories they picked. |
| Work area | **Home base + travel distance**: matching still uses live GPS, but never offers a job beyond their limit from base. |
| Garages | **One account per garage** for now; team members later. |

## The stages

The app shows them as a checklist with progress, so applicants know where
they stand without phoning Fundi-X.

### 1. Account (built)
Google sign-in (Apple on iOS later), phone number.

### 2. Profile
- Profile photo (shown to customers when the mechanic is on the way).
- Type: mobile mechanic or garage; garage name for garages.
- **Skills**: picked from the job categories (the same ids as
  `src/customer/request/data/categories`), at least one.
- Years of experience.
- Transport: motorbike, car, public transport, none (garage).
- **Base**: set from GPS where they are, plus a description; **travel
  limit** in km (e.g. 3 / 5 / 10 / 15). Garages: the base is the garage,
  plus opening hours.

### 3. Documents
- National ID, front and back.
- Selfie, compared with the ID photo by the reviewer (no automatic face
  matching at launch).
- Certificate of Good Conduct (DCI), with its issue date. Valid 12 months.
- Optional: trade certificate (NITA, TVET…).
- Garages: business permit (county single business permit), 2–4 photos of
  the premises.

Storage: private S3-compatible bucket (proposed: Cloudflare R2), files
encrypted, never public; the app uploads with a short-lived upload link,
staff view with short-lived links, every view written to the audit log.
Keys live in server/.env only.

### 4. Payout check
KSh 1 sent by M-Pesa B2C to the payout number. Safaricom's result
includes the registered name on the line; it must match the ID name
(reviewer confirms; close matches like initials are fine). Uses the
existing transfers outbox; the shilling is an expense in the ledger.

### 5. Review (admin portal)
One page per applicant: profile, documents side by side, M-Pesa name vs ID
name, checklist, notes. Outcomes:
- **Approve** → VERIFIED, can go online.
- **Needs changes** → which items to redo, with words they see in the
  app; they fix and resubmit.
- **Reject** → with a reason.

Plus a phone call before approving (logged as a note).

### 6. Starting out
- Accept the code of conduct in the app (prices only through Fundi-X, no
  side cash deals, behaviour at a customer's home), with version + time
  recorded.
- **Probation** for the first 10 completed jobs: a shorter offer radius
  and a review after any rating of 2★ or less, a no-show or a dispute.
- Good Conduct expires after 12 months: reminder 30 days before, cannot go
  online after expiry until a new one is uploaded and checked.

## Matching changes

- Offer only to providers whose skills include the job's category.
- Skip providers whose live position is beyond their travel limit from
  their base (distance from base to the job).
- Probation: smaller max ring.

## Still to decide (later)

- Code of conduct text (Fundi-X to write).
- How long to keep ID images after a mechanic leaves or is rejected
  (Data Protection Act: no longer than needed; proposal: 6 months after
  rejection, account lifetime + 1 year for approved).
- Whether to list categories as "skills" exactly, or group them for
  mechanics (e.g. "Engine & servicing").
- Garage teams (each mechanic with their own login, payouts to the garage).

## Proposed build order

1. Profile v2 (skills, base + travel limit, transport, experience) + matching
   filters. No file storage needed; fixes the "Nairobi" placeholder.
2. File storage (R2) + document and photo upload + admin review page.
3. Payout name check (KSh 1 B2C).
4. Checklist screen, code of conduct, probation, Good Conduct expiry.
