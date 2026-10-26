# Files: documents and photos

**Version 1.0 — 2026-10-26.** Where uploaded files live and who can see
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

## 4. Not yet

- Upload endpoints and the app screens (mechanic documents, dispute photos).
- The mechanic review page in the admin portal.
- Keeping and deleting ID images (mechanic-onboarding.md, "Still to decide").
