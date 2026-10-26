# Files: documents and photos

**Version 1.1 — 2026-10-26.** Where uploaded files live and who can see
them. Used by mechanic onboarding ([mechanic-onboarding.md](mechanic-onboarding.md))
and dispute evidence.

## 1. Where

Cloudflare R2, spoken to in the S3 format (`server/src/storage/files.ts`),
so another S3-compatible store only needs new settings.

One bucket, `fundix-dev`, for both the laptop and the Render test server
while testing (file names are random ids, so they never clash). Real
users get their own bucket at launch.

It is **private**: no public access, no `r2.dev` link, no custom domain.

## 2. Who gets in

- Only the server holds keys: an R2 API token with **Object Read & Write**
  on this bucket only. Never in the app, the admin website, git or
  chat.
- The phone uploads with a link for **one file** that works for 5 minutes.
- Staff see a file through a viewing link that works for 5 minutes; the
  admin page asks for a new one each time it opens.

## 3. Settings

`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`
in `server/.env` and on Render. All empty: file storage is off (shown in
Engineering → System). Some set: the server refuses to start.

`npm run files-check` (in `server/`) saves, uploads through a link, reads
back, checks the bucket is private, and deletes.

## 4. Uploading (server/src/files/)

1. `POST /files` `{ purpose, kind, jobId?, contentType, bytes }`: every
   check below; the file is recorded as PENDING and the answer has a link,
   `method: PUT` and the `headers` to send (exactly that content-type).
2. The app PUTs the bytes to the link (5 minutes).
3. `POST /files/:id/confirm`: the server looks at what R2 holds. Too big,
   empty or a different type: deleted on the spot, 400. Otherwise READY;
   a new mechanic document replaces the previous one of the same kind.

Also `GET /files` (own READY files, details only, never links) and
`DELETE /files/:id` (not for a verified mechanic's documents, nor dispute
photos after the decision).

| Purpose | Kinds | Formats | Who |
|---|---|---|---|
| `MECHANIC_DOCUMENT` | profile_photo, id_front, id_back, selfie | JPEG, PNG, WebP | any mechanic |
| | good_conduct, trade_certificate | + PDF | |
| `DISPUTE_PHOTO` | evidence | JPEG, PNG, WebP | the job's customer or mechanic, while DISPUTED |

Staff: `GET /admin/files?ownerId=…` (documents, `users.view`) or
`?jobId=…` (dispute photos, `jobs.view`); `POST /admin/files/:id/link`
gives a 5-minute viewing link and writes `file.view` to the audit log;
`GET /admin/files/usage` feeds Engineering → File storage.

## 5. Limits: no surprise bills

R2 is free up to 10 GB stored, 1 million uploads and 10 million reads a
month. Nothing reaches R2 except through this server, so these limits
bound what it can cost:

| Limit | Value | When reached |
|---|---|---|
| File size | 5 MB (app compresses photos to ~300 KB) | refused, or deleted after upload |
| Files held at once | 10 documents per mechanic; 6 photos per person per dispute | 409 `too_many_files` |
| Upload links per person | 20 an hour | 429 `too_many_uploads` |
| Uploads, whole app | setting `uploads_per_day_max` (2,000 / 24 h) | 503 `uploads_paused` + `storage` incident |
| Stored, whole app | setting `storage_max_mb` (8,000 MB) | 503 `uploads_paused` + `storage` incident |
| Reads | staff viewing links only | — |

Every minute, housekeeping deletes uploads never confirmed (after an
hour) and looks at each new file once more after its link expired, so a
second upload through the same link can't swap in something bigger.

On top of that, every API route is limited per signed-in account (or per
address before sign-in): `API_REQUESTS_PER_MINUTE`, 300 by default; sign-in
has its own 10 a minute. On a host, `trustProxy` reads the caller's
address from the proxy, otherwise everyone would share one limit.

Outside the code: a Cloudflare **Usage Based Billing** notification for
R2 at about $1, and a valid card. Cloudflare has no hard spending cap.

## 6. Not yet

- The app screens (mechanic documents, dispute photos), compressing photos
  before upload.
- The mechanic review page in the admin portal.
- Keeping and deleting ID images (mechanic-onboarding.md, "Still to decide").
