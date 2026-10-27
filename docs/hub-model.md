# Fundi-X Hubs: business model for garages (parked)

Status: **idea, paused on purpose** (brainstormed 2026-10-27). Nothing here
is built or decided. Pick it up again once the app is live on Google Play
and mobile mechanics have proven the model with real jobs. Until then
garages stay hidden (see garage-providers.md).

## The idea

Fundi-X does not hire mechanics and pay salaries. Instead:

> **Fundi-X provides an operating base and brings the work; independent
> mechanics operate from that base and earn from the jobs they complete.**

```text
   Customers     Companies    Insurance
       └────────────┼────────────┘
                    ↓
             FUNDI-X PLATFORM
                    ↓
              FUNDI-X HUB
        ┌───────────┼───────────┐
     Mechanic A  Mechanic B  Mechanic C
     (independent, not employees)
```

What Fundi-X gives mechanics that they struggle to get alone: customers,
corporate and fleet contracts, a professional base, digital payments,
records, diagnostic equipment, fast parts, marketing, dispute handling.
What mechanics give Fundi-X: capacity and expertise, without Fundi-X
owning every mechanic.

## Freedom for hub mechanics

- A mechanic's **own customers**: they keep their normal earnings.
- **Fundi-X customers**: go through the Fundi-X system; the mechanic gets
  the agreed payout and Fundi-X keeps its network margin.

## Levels

| Level | What it means |
|---|---|
| **Network Mechanic** | No physical base; gets jobs through the app. This is what is being built now. |
| **Hub Mechanic** | Has an operating position at a Fundi-X hub: facilities, tools, dispatch, corporate and fleet jobs, parts network. |
| **Certified Specialist** | Highly trusted in a speciality: German vehicles, electrical/diagnostics, transmissions, hybrid/EV, diesel, heavy commercial. |

The levels give mechanics something to aim for.

## The hub is a dispatch node, not a waiting room

Example: 20 mechanics registered at Hub 01, 5–7 dispatched on a normal
day. The rest do their own work, are off duty, work elsewhere, or wait
for specialist and fleet jobs. When demand grows, capacity grows without
hiring.

## Strengths

- Corporate, fleet and insurance work is the steady money, and single
  mechanics can't win it alone.
- Capacity grows without salaries; much more capital-efficient than a
  garage chain.
- Fits the app: jobs, escrow, ratings and payouts already work per
  mechanic; ratings and history can decide who moves up a level.

## Risks to design around

1. **Customers going around Fundi-X (the biggest risk).** With "own
   customers" allowed, a Fundi-X customer can become "my customer" on the
   second visit. Needs a clear rule (a customer Fundi-X brought stays a
   Fundi-X customer) and reasons to stay in the app: warranty, dispute
   protection, service history, fleet invoices. The code of conduct ("no
   side cash deals", mechanic-onboarding.md) must separate Fundi-X
   customers (always through the app) from the mechanic's own.
2. **Mechanics treated as employees in law.** If Fundi-X sets hours,
   uniforms, exclusivity or shifts, Kenyan law may see employees (NSSF,
   SHIF, leave); platform-worker cases are active in Kenya. Freedom to
   choose hours, decline jobs and keep own customers protects Fundi-X.
   **See a lawyer before the first hub.**
3. **Who owns the hub.** Leasing premises costs money. Cheapest path:
   turn existing good garages into Fundi-X hubs, the garage owner being
   the "hub owner".
4. **Fleet money works differently.** Today is prepaid escrow; companies
   pay invoices after 30–60 days while mechanics want paying now, so
   Fundi-X needs cash to cover the gap.
5. **Damage and liability at the hub** (car damaged or stolen overnight):
   insurance needed.

## Draft split of a KSh 10,000 job (proposal, not agreed)

Fundi-X customer served at a partner-owned hub:

| Who | Share | For what |
|---|---|---|
| Mechanic | KSh 7,000 (70%) | The work |
| Hub owner | KSh 1,000 (10%) | Bay, tools, security |
| Fundi-X | KSh 2,000 (20%) | Customer, payment, escrow, disputes, tech |

- At a Fundi-X-owned hub, Fundi-X keeps the hub share (30%).
- Network Mechanics: unchanged, 20% commission (job-flow.md).
- Suggested: **no monthly membership at the start** (mechanics resent
  paying before earning); per-job only, plus optional bay rent for
  mechanics who want a fixed bay to serve their own customers too.
- Parts buying power can earn Fundi-X a small margin.

## Open questions (unanswered)

1. **Who owns hubs:** Fundi-X leases them, partner garages become hubs,
   or both?
2. **A mechanic's own customers at the hub:** free, or do they pay bay
   rent?
3. **Specialist certification:** who tests them (a Fundi-X test, NITA,
   brand training)? Do specialists earn a higher share or charge higher
   prices?
4. **The split itself:** how exactly mechanic, hub owner and Fundi-X
   divide one job; membership vs commission vs hub access fees, so
   mechanics don't feel exploited.
5. **Fleet and insurance terms:** invoice periods, who covers the cash gap,
   whether fleet jobs skip escrow.
6. **Rules for "whose customer":** how to tell a Fundi-X customer from a
   mechanic's own, and what happens when one goes around the app.

## What the app would need (later)

Most of garage-providers.md ("What garages need"), plus: a hub record
(location, owner, bays, opening hours), provider level (network / hub /
specialist), drive-in jobs at the hub, three-way payouts (mechanic + hub
owner via M-Pesa B2B), fleet accounts with invoices.
