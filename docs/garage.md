# My garage (saved vehicles): parked for review

Status: **not built on the server on purpose** (decided 2026-10-22). We
review this once the app is proven working end to end against the server.

## What happens today

- The customer's vehicles come from `src/customer/data/mockVehicles.ts`:
  two sample cars (Toyota Fielder KDA 123A, Mercedes C200 KXX 456B). Every
  account sees them, signed in or not.
- "Add a vehicle" in the booking flow (`VehicleStep`) adds the car to the
  screen's own state only. It is gone when the booking screen closes
  (`RequestFlowScreen.tsx`: "TODO: load from and save to the customer's
  garage on the backend").
- The Account screen's "My vehicles" lists the same sample cars.
- **Booking still works:** the job stores a full copy of the chosen
  vehicle (registration, make, model, year, engine cc, fuel) inside the
  job's request details. The server, mechanic app and admin portal read
  the vehicle from the job, never from a garage. So a real customer can
  book with a car they add, as long as they add it in the same booking.

What this means while testing: a signed-in customer sees the two sample
cars. Use them, or add your own car during the booking.

## Proposal to review

### Data

`vehicles` table, one row per car per customer:

| column | notes |
|---|---|
| id | `veh_…` |
| user_id | owner (customer) |
| registration | normalised: upper case, single spaces (`KDA 123A`) |
| make, model | free text for now |
| year | optional |
| engine_cc, fuel | optional; decide the maintenance price class (see maintenance pricing) |
| created_at, updated_at, removed_at | "removed" hides it; past jobs keep their own copy |

Unique on (user_id, registration) while not removed, so the same car can't
be added twice by one person. Two different customers *can* have the same
registration (a car changes hands, or a family shares it).

### Endpoints

- `GET /me/vehicles`: the customer's cars, newest first
- `POST /me/vehicles`: add one, returns it with its id
- `PUT /me/vehicles/:id`: fix details (e.g. add engine size)
- `DELETE /me/vehicles/:id`: remove (soft)

The booking keeps sending the full vehicle with the job (as today), so a
car edited or removed later never changes a past job or its price.

### App changes

- `RequestFlowScreen`/`VehicleStep` load from and save to `/me/vehicles`.
- Account screen "My vehicles": list, add, edit, remove.
- Demo mode keeps the sample cars.
- `vehicleName()` moves out of `mockVehicles.ts` into the domain (it's used
  by both apps and isn't sample data).

### Admin portal

Customer page shows their vehicles; job page already shows the job's copy.

### Questions for the review

1. Ask for engine size/fuel when adding a car, or only when booking a
   maintenance job (where it decides the price)?
2. Look up make/model from a list (fewer typos, better price class) or keep
   free text for now?
3. Check registration format (Kenyan plates `KAA 000A`, plus diplomatic,
   government and motorbike formats), or accept anything?
4. Should a mechanic see a car's past Fundi-X jobs (service history)? It's
   useful, but it's the previous owner's data once a car is sold.
5. Account deletion: remove the vehicles with the account (proposed: yes,
   past jobs keep their copy).
