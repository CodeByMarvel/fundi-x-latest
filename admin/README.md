# Fundi-X admin console

The staff website. It talks to the same server as the phone app, under
`/admin`, and signs in with Google (only emails in the server's `staff`
table get in).

## Run it locally

1. Start the server: `cd server && npm run dev` (port 3000).
2. Start this site: `cd admin && npm run dev`, then open http://localhost:5173.

Sign-in needs `GOOGLE_CLIENT_ID` in `server/.env`. The site has no
settings of its own: it asks the server (`GET /admin/config`).

## Rules

- Nothing secret ever goes in this folder. Everything here is downloaded
  by browsers, so anyone can read it.
- The only build setting is `VITE_API_URL` (see `.env.example`), and
  only when the site and the API live at different addresses.
