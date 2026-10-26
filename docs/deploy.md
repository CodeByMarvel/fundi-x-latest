# Test deployment (Render free tier)

**Version 1.0 — 2026-10-26.** Runs Fundi-X on the internet for testing on
real phones: no USB, no `localhost`, no tunnel, and the same failures real
users would meet. Set up from [`render.yaml`](../render.yaml). Payments
stay on the Daraja sandbox ([mpesa.md](mpesa.md)).

---

## 1. What runs where

| Piece | Render service | Address |
|---|---|---|
| API (the server) | `fundix-api`, free web service, Frankfurt | `https://fundix-api.onrender.com` |
| Admin website | Vercel project `fundi-x-latest` (root `admin/`) | `https://fundi-x-latest.vercel.app` |
| Database | `fundix-db`, free PostgreSQL | private, only the API reaches it |

The admin website passes its `/admin` calls on to the API
([`admin/vercel.json`](../admin/vercel.json)), so the browser
sees one address and the sign-in cookie works as it does locally.

The server runs with `NODE_ENV=production`: real Google sign-in only, no
sample data, no test mechanic, no simulated M-Pesa. Testing a job needs
**two phones**: one customer, one mechanic approved in the admin website.

## 2. Free tier limits

- **The API sleeps after 15 minutes without requests** and takes about a
  minute to wake. Timers, M-Pesa checks and payouts stop while it sleeps,
  and Safaricom's callbacks would arrive late. Keep it awake with
  UptimeRobot (step 6). One service awake all month fits in Render's 750
  free hours.
- **The free database is deleted after 30 days.** Recreate it (all data
  goes) or move to a paid plan before then.
- 512 MB of memory and a slow CPU: fine for testing, not for real users.

## 3. Create the services

1. Push `render.yaml` to GitHub (it's in the repository root).
2. On <https://render.com>, sign up with GitHub, then **New → Blueprint**
   and pick `fundi-x-latest`, branch `main`.
3. Render lists the three services and asks for each value marked
   `sync: false` (never put these in the repository):

   | Setting | Value |
   |---|---|
   | `OWNER_EMAIL` | your Google email: the first admin |
   | `GOOGLE_CLIENT_ID` | same as in `server/.env` |
   | `ADMIN_ORIGIN` | `https://fundi-x-latest.vercel.app` |
   | `MPESA_CONSUMER_KEY`, `MPESA_CONSUMER_SECRET`, `MPESA_PASSKEY`, `MPESA_B2C_SECURITY_CREDENTIAL` | same as in `server/.env` |
   | `MPESA_CALLBACK_BASE_URL` | `https://fundix-api.onrender.com` |
   | `MPESA_CALLBACK_SECRET` | a new one: `node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"` |

4. **Apply.** The first build takes a few minutes. The API's log should
   end with `M-Pesa: Daraja sandbox` and `Server listening`, and
   `https://fundix-api.onrender.com/health` shows `{"ok":true}`.

**If a name is taken**, Render adds letters to the address (e.g.
`fundix-api-x1y2.onrender.com`). Then use the real addresses in
`ADMIN_ORIGIN` and `MPESA_CALLBACK_BASE_URL`, change the rewrite
`destination` at the bottom of `render.yaml`, and push.

Every push to `main` redeploys whatever changed.

## 4. Google sign-in

In Google Cloud Console → APIs & Services → Credentials → the **Web
client** used for `GOOGLE_CLIENT_ID`: add
`https://fundi-x-latest.vercel.app` to **Authorized JavaScript origins**.
The phone app needs no change: the release build is signed with the same
key as the development build.

## 4a. Admin website on Vercel

The admin site is hosted on Vercel (the `fundix-admin` static site in
`render.yaml` does the same job; only the address in `ADMIN_ORIGIN` can
sign in and make changes).

- Vercel project settings: **Root Directory** `admin`, framework **Vite**
  (build `npm run build`, output `dist`). Every push to `main` redeploys.
- **No `VITE_API_URL`** on Vercel. `admin/vercel.json` passes `/admin/*`
  and `/health` to the API, so the browser sees one address and the
  sign-in cookie stays first-party.
- If the API's address changes, change it in `admin/vercel.json`.

## 5. The app on a phone

1. Create `.env.production` in the project root (next to `.env`):
   ```
   API_URL=https://fundix-api.onrender.com
   ```
   Release builds read it on top of `.env`; development keeps using `.env`.
2. Build, in PowerShell:
   ```
   cd android
   .\gradlew.bat assembleRelease --max-workers=2 -PreactNativeArchitectures=arm64-v8a -PnativeJobs=2
   ```
   The flags keep the build inside 8 GB of memory: one phone chip type
   (arm64, what current Android phones use) and two C++ files at a time.
   Without them the compiler crashes and Windows' swap file can fill the
   disk. About 15 minutes the first time.
3. The app is `android/app/build/outputs/apk/release/app-release.apk`.
   Install it over USB with `adb install -r <that file>` once, or send the
   file to a tester's phone. After that, no cable or computer is needed.

Rebuild after changing app code: a release build carries its code inside
and doesn't use Metro.

## 6. Knowing when it breaks

- **UptimeRobot** (free): add an HTTP monitor for
  `https://fundix-api.onrender.com/health` every 5 minutes. It keeps the
  API awake and emails you when it's down.
- **Render logs**: the `fundix-api` service's Logs tab, including M-Pesa
  failures ("M-Pesa did not send the prompt" with Safaricom's reason).
- **Admin website**: Engineering → System, and M-Pesa incidents.

## 7. Breakdowns worth trying

- Restart the API (Render → Manual Deploy → Restart) while a payment
  prompt is open: the server should ask Safaricom how it ended.
- Turn off the mechanic's mobile data mid-trip, then back on.
- Pay, then cancel the job: the money should be refunded or released as
  [job-flow.md](job-flow.md) says.
