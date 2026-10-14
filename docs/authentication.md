# Fundi-X Authentication

**Version 1.0 — 2026-10-14.** How customers, mechanics and staff sign in.
Decided 2026-10-14: option A, Google and Apple sign-in checked by our own
server (not a hosted auth service).

## The principle

> **Google or Apple proves who someone is. Our database decides what they
> may do.**

Role (customer or mechanic), suspension and mechanic verification live in
our `users` and `providers` tables, so they stay under Fundi-X's control
and nothing is lost if a sign-in provider is added or dropped.

## Who signs in how

| Who | Signs in with | Session | Where |
| --- | --- | --- | --- |
| Customers and mechanics | Google (Android, iOS); Apple (iOS, required by Apple when Google is offered) | 60 days from last use, token in the phone's secure storage | `server/src/accounts/`, `src/auth/` |
| Fundi-X staff | Google, email must be in `staff` | 12 hours, httpOnly cookie | `server/src/admin/`, `admin/` |

Customer and staff sign-in are deliberately separate: a weakness on one
side can never reach the other.

## The flow

1. The app asks the server for the Google client id (`GET /auth/config`).
2. Google's account picker returns a signed credential (ID token).
3. The app sends it with the chosen role (`POST /auth/google`). The server
   checks Google's signature, our client id and the expiry, then finds or
   creates the account: one customer and one mechanic account per Google
   account.
4. The server returns a session token. The app keeps it in the Android
   Keystore / iOS Keychain and sends `Authorization: Bearer <token>`.
5. Every request checks the session and the account: a sign-out,
   suspension or deletion takes effect on the next request.
6. Before the account can be used, the app asks for what is missing
   (`nextStep`): the M-Pesa number, then (mechanics) the work profile.

## Rules

- **Phone number:** required before booking (`phone_required`). Saved in
  M-Pesa form (`2547XXXXXXXX`); one account per number and role
  (`phone_in_use`). It counts as verified once a payment from it succeeds
  (the person typed their M-Pesa PIN), so no SMS codes are needed.
- **Mechanics** start `PENDING` and get no jobs until Fundi-X verifies them.
  Editing the profile never changes the verification decision.
- **Account deletion** (required by both app stores): `DELETE /me` wipes
  name, email, phone and sign-in ids, ends every session and marks the
  account `DELETED`. Job and payment history stays, as financial records
  must be kept. Refused while a job is open (`active_jobs`).
- **Rate limit:** 10 sign-in attempts a minute per address (app and portal).
- **Development header** (`x-dev-user`): accepted only outside production,
  for tests and the app's demo mode.
- Only a SHA-256 hash of each session token is stored.

## Setup (once)

All free. Google Cloud Console → a project for Fundi-X → APIs & Services:

1. **OAuth consent screen:** External; app name "Fundi-X"; your email as a
   test user while in testing.
2. **Credentials → Create OAuth client id → Web application.** Authorized
   JavaScript origins: `http://localhost:5173` (the admin portal; add the
   live address later). Copy the client id into `server/.env` as
   `GOOGLE_CLIENT_ID`. The app and the portal both use this id.
3. **Credentials → Create OAuth client id → Android.** Package name
   `com.fundix.app`; SHA-1 of the signing key. For development builds
   (React Native's standard debug key, `android/app/debug.keystore`):
   `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`.
   Release builds need another Android client with the release key's
   SHA-1 (from Google Play App Signing). Nothing from this client is
   copied anywhere: Google matches the app by package name and key.
4. **App:** copy `.env.example` to `.env` and set `API_URL` (Android
   emulator: `http://10.0.2.2:3000`; a phone on the same Wi-Fi: the
   computer's Wi-Fi address). Restart Metro with `--reset-cache` after
   changing it.
5. **Later, iOS:** set `APPLE_BUNDLE_ID` in `server/.env` and add the
   "Sign in with Apple" button (the server side is ready).

Until step 2 is done, the app's development build offers "Explore with
demo data", and the portal offers its development sign-in.

## Not built yet

- Sign in with Apple button in the app (server ready).
- Marking the phone verified on the first successful M-Pesa payment (comes
  with payments).
- "Sign out everywhere" and a list of a person's sessions in the portal.
- SMS login, if people without a Google account ask for it.
