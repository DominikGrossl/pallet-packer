# Plánovač nakládky (paketo.group)

Vite + React app for planning truck loads. Deployed on Vercel.

## Password gate

The site is protected by a shared password (no database).

- Default password: `paketoheslo01`
- Override on Vercel with env var `SITE_PASSWORD`
- Unauthenticated visitors are redirected to `/login.html`
- After a correct password, an `HttpOnly` cookie unlocks the app for 30 days

This gate runs via Vercel Edge Middleware + `/api/login`. Locally, the same check is applied by the Vite dev/preview server plugin so `npm run dev` and `npm run preview` also require the password.

## Scripts

```bash
npm install
npm run dev
npm run build
```
