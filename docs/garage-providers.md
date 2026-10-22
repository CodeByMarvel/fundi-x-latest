# Garages as providers: parked for later

Status: **hidden in the app on purpose** (decided 2026-10-22). Fundi-X
starts with mobile mechanics only; garage businesses come later.

## What exists today

- `providers.type` is `'mechanic' | 'garage'` and `providers.business_name`
  holds a garage's trading name. The server still accepts both (`PUT
  /me/provider`), and the admin portal shows the type.
- Matching, pricing, payouts and ratings treat a garage exactly like a
  mobile mechanic: one account, one live position, one person doing the
  job.
- Demo data has one garage (Kilimani Auto Garage).

## What was hidden in the app

- Sign-in: "I'm a mechanic or garage" → "I'm a mechanic".
- Mechanic profile: the Mobile mechanic / Garage picker and "Garage name"
  (`TYPES` in `ProviderProfileScreen.tsx`; adding the garage entry back
  brings both back).
- Customer home: the "Garage" card under "Find a provider".

## What garages need that mobile mechanics don't

To review before switching them on:

1. **Where the work happens.** Does the garage come to the customer (then
   it's a mechanic with a business name) or does the customer drive in
   (booking a slot, opening hours, the job's location is the garage's,
   not the car's)? Probably both, as separate job kinds.
2. **Fixed location.** Matching uses the garage's address, not a phone's
   GPS; the "online" switch becomes opening hours.
3. **Several mechanics.** A garage owner with staff: team logins, who gets
   the job, whose rating it is, payouts to the business.
4. **Payouts.** To a till or paybill (M-Pesa B2B) rather than a phone
   (B2C), and possibly invoices with the business's KRA PIN.
5. **Checks.** Business permit, premises photos, maybe KRA PIN, on top of
   the owner's ID (see mechanic-onboarding.md).
6. **Pricing.** Garages have overheads; same commission and labour prices,
   or garage rates?
7. **Customer side.** How garages appear: on the map, by rating, by
   distance from the car or from home.
