# My vehicles

Status: **built** 2026-10-22.

A customer's cars, offered first when booking and listed on the Account
screen. (An earlier draft called this "garage"; "garage" now only means a
garage business as a provider, see garage-providers.md.)

## How it works

- Server: `vehicles` table, `server/src/accounts/vehicles.ts`.
  - `GET /me/vehicles`: the customer's cars, newest first
  - `POST /me/vehicles`: add one (registration, make, model; year, engine
    cc and fuel optional), returns it with its `veh_…` id
  - `PUT /me/vehicles/:id`: change details
  - `DELETE /me/vehicles/:id`: remove (hidden, not erased)
- App: `src/customer/data/vehicles.ts` (one shared list), the booking's
  vehicle step, Account → My vehicles (tap to remove, "Add a vehicle").
  Demo mode keeps the two sample cars in memory.
- A booking still sends the whole vehicle with the job, so editing or
  removing a car never changes a past job or the price it was quoted on.

## Rules (defaults chosen 2026-10-22, open to change)

| Question | Choice |
|---|---|
| Engine size / fuel | Optional when adding. Maintenance prices use them when given, else the model's usual engine. |
| Make / model | Free text for now. A make/model list can come later (fewer typos, better price class). |
| Registration | Tidied (upper case, single spaces) but any format accepted: diplomatic, government and motorbike plates differ. The same car can't be added twice by one person however it's typed (`KDA123A` = `KDA 123A`); two different customers can both have it. |
| Removing | Hidden (`removed_at`); the same car can be added again. |
| Account deletion | All the person's vehicles are removed with it; past jobs keep their own copy. |
| Car typed in while booking | Kept with the booking and saved to My vehicles when the booking is sent, except for an inspection of a car being bought ("I'm buying this car"). A finished job on a car that isn't saved offers "Save to My vehicles" (2026-10-23). |
| Service history for mechanics | Not shown. Useful, but it's the previous owner's data once a car is sold. |
