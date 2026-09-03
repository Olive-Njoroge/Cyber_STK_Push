# Cyber STK Push

M-Pesa payments at a cyber café counter, via PayHero STK push.

The attendant types the customer's phone number and the amount, hits **Send STK
Push**, and watches the row go green. If the callback never arrives, the row
turns grey — **Unknown**, not failed — with a **Check status** button that asks
PayHero directly. The attendant is never left guessing whether to let the
customer walk away.

```
client/   React + Vite, one screen, plain CSS
server/   Express + Mongoose + PayHero
```

## Setup

Requires Node 18+ (developed on 24) and a MongoDB you can reach.

### 1. Server

```bash
cd server
npm install
cp .env.example .env      # then fill it in
npm run dev
```

| Variable | What it is |
| --- | --- |
| `PAYHERO_API_USERNAME` / `PAYHERO_API_PASSWORD` | From the PayHero dashboard, **API Keys → Add new API Key**. Base64'd into the Basic auth header. |
| `PAYHERO_BASIC_AUTH_TOKEN` | Optional. If the dashboard handed you the finished Basic token, paste it here and the username/password are ignored. |
| `PAYHERO_CHANNEL_ID` | **Payment Channels → My Payment Channels**. Numeric. |
| `CALLBACK_URL` | Full public URL of the webhook, ending in `/api/payments/callback`. **The server refuses to start if this is blank or still a placeholder** — see below. |
| `MONGODB_URI` | e.g. `mongodb://127.0.0.1:27017/cyber_stk`, or an Atlas `mongodb+srv://…` string. |
| `CORS_ORIGIN` | Comma-separated browser origins allowed to call the API. Blank = any origin. Set it in production. |
| `PORT` | Express port, default `5000`. Render injects its own — leave it unset there. |
| `ENABLE_STALE_SWEEP` | `true` turns on the background verifier (below). Default off. |

### 2. Client

```bash
cd client
npm install
npm run dev          # http://localhost:5173
```

Vite proxies `/api` to `http://localhost:5000`. If Express runs elsewhere, set
`VITE_API_TARGET` (see `client/.env.example`).

For the counter PC, build once and serve the static files:
`npm run build` → `client/dist/`.

### 3. Callbacks need a public URL

**PayHero has to reach your server.** A laptop or a café PC behind NAT is not
reachable, so either deploy (below) or run a tunnel while developing:

```bash
ngrok http 5000
```

Take the `https://…ngrok-free.app` URL and set
`CALLBACK_URL=https://abc123.ngrok-free.app/api/payments/callback`, then restart
the server. The URL changes each time ngrok restarts on the free plan.

Without a reachable callback the app still works: every transaction goes STALE
after two minutes and the attendant resolves it with **Check status**. That is
the fallback doing its job, but it costs one API call per payment instead of
zero.

#### The server refuses to start on a placeholder callback URL

A blank `CALLBACK_URL` announces itself. A *placeholder* one is worse: every
check passes, pushes go out normally, and the callbacks vanish into a host that
does not exist — so the attendant watches good payments go STALE and never
learns why. The check runs before the database connection and exits `1`:

```
[config] CALLBACK_URL is still a placeholder — its host contains "your-tunnel": …
[config] PayHero must be able to POST to this URL from the public internet.
```

Rejected: blank, unparseable, a non-http(s) scheme, or a **hostname** containing
`your-tunnel`, `your-service`, `your-app`, `your-domain`, `example.com/.org/
.net/.test`, `localhost`, `127.0.0.1` or `0.0.0.0`. Only the hostname is
inspected, so a real host with `example` somewhere in the path is fine.

A URL that passes but whose path is not `/api/payments/callback` produces a
warning and boots anyway — PayHero posts to the path verbatim, and nothing else
on this server answers there.

## Deploying — Render (API) + Vercel (UI)

### Database: MongoDB Atlas

Create a free M0 cluster and a database user. Under **Network Access**, allow
`0.0.0.0/0` — Render's free plan has no fixed egress IP, so an IP allowlist will
lock you out. The connection string looks like
`mongodb+srv://user:pass@cluster.xxxxx.mongodb.net/cyber_stk?retryWrites=true&w=majority`.
Note the `/cyber_stk` database name before the `?`; without it you land in
`test`.

### Backend on Render

`render.yaml` in the repo root describes the service, so **New → Blueprint** and
point Render at this repo. Or configure by hand:

| Setting | Value |
| --- | --- |
| Root directory | `server` |
| Build command | `npm ci` |
| Start command | `npm start` |
| Health check path | `/api/health` |

Environment variables to set in the Render dashboard — **not** in git:
`PAYHERO_API_USERNAME`, `PAYHERO_API_PASSWORD`, `PAYHERO_CHANNEL_ID`,
`MONGODB_URI`, `CALLBACK_URL`, `CORS_ORIGIN`, `ENABLE_STALE_SWEEP=true`.

Do **not** set `PORT`. Render injects it and the app already reads it.

`CALLBACK_URL` is chicken-and-egg: you only learn the service URL after the
first deploy. Deploy, copy the `https://….onrender.com` URL, set
`CALLBACK_URL=https://….onrender.com/api/payments/callback`, and redeploy. The
URL is read at boot and baked into every push, so the redeploy is required.

> **The free plan spins down after 15 minutes idle.** A cold start takes ~50s,
> and a PayHero callback arriving at a sleeping instance can time out and be
> lost outright. This is exactly the failure the STALE design exists for, which
> is why `render.yaml` turns `ENABLE_STALE_SWEEP=true` on — but the cron only
> runs while the instance is awake, so unresolved rows are recovered on the next
> wake, not immediately. For a café taking real money, the paid instance type is
> worth it. Either way, **Check status** always works on demand.

### Frontend on Vercel

**New Project → import the repo**, then:

| Setting | Value |
| --- | --- |
| Root directory | `client` |
| Framework preset | Vite (auto-detected) |
| Build command | `npm run build` |
| Output directory | `dist` |

One environment variable:

```
VITE_API_BASE_URL=https://your-service.onrender.com
```

No trailing slash. Vite inlines this at **build** time, so changing it needs a
redeploy, not just a restart.

Finally, go back to Render and set `CORS_ORIGIN` to your Vercel origin
(`https://your-app.vercel.app`, no trailing slash) so the browser is allowed to
call the API. Leaving it blank allows any origin, which works but means anyone
can drive your STK pushes. Preview deployments get their own URLs — add them
comma-separated if you want them working too.

The callback is unaffected by `CORS_ORIGIN`: PayHero is a server, sends no
`Origin` header, and CORS never applies to it.

## How a payment moves

1. **POST `/api/payments`** — the number is normalised to `2547XXXXXXXX`, a
   unique `externalReference` (`CYB-260903-A1B2C3`) is generated, and the row is
   saved as `PENDING` *before* PayHero is called. A crash mid-request still
   leaves something the attendant can verify.
2. PayHero is called. If that request fails — network, bad credentials, wrong
   channel — the row is marked `FAILED` and the API answers `502` with
   *"No prompt was sent…"*. The attendant knows the phone never buzzed.
3. **POST `/api/payments/callback`** — PayHero posts the outcome, matched on
   `externalReference`. Status, result description and M-Pesa receipt are stored.
4. The frontend polls `GET /api/payments/:id` every 3 s and stops after 90 s.

### When the callback never arrives

Tunnels drop, servers restart, the café's internet blips. A row stuck on
`PENDING` is worse than a failed one, so:

- **After 2 minutes**, a `PENDING` row becomes `STALE` — shown grey and labelled
  **Unknown**, never red. Unknown is not failure.
- **Check status** on any `PENDING`/`STALE` row calls
  `GET /api/payments/:id/verify`, which queries PayHero's transaction-status
  endpoint, writes the answer down, and returns the fresh row. The button is
  disabled for 5 s after each click, and the server ignores a second verify
  within 3 s.
- **`ENABLE_STALE_SWEEP=true`** adds a node-cron job that does the same thing in
  the background every minute for up to 10 unresolved rows at a time, oldest
  first, giving up on anything over 24 hours old.

The callback handler and the verify handler both write through
`applyPaymentResult()` in `server/src/services/transactions.js`. That function is
the only thing that sets a final status, and it is idempotent: **once a
transaction is `SUCCESS` nothing can move it**, so a late "cancelled" callback
arriving after a receipt was banked is ignored.

## API

| Route | Purpose |
| --- | --- |
| `POST /api/payments` | Initiate an STK push. `{ phoneNumber, amount, customerName? }` |
| `POST /api/payments/callback` | PayHero webhook. No auth middleware — PayHero cannot authenticate to us. Always answers `200`. |
| `GET /api/payments/:id` | One transaction, for polling. |
| `GET /api/payments/:id/verify` | Ask PayHero for the true status and store it. |
| `GET /api/payments?page=1&limit=50&today=true` | List, newest first, paginated. |
| `GET /api/health` | Liveness, plus which env vars are still missing. |

## Rate limits

PayHero's documented abuse protection, and what this app does about it:

- **10 successive failed or cancelled pushes to one number → that number is
  blocked for 24 hours.** The server refuses a push after **8** consecutive
  failures to the same number, with a message telling the attendant to confirm
  the number with the customer.
- **50 failed requests in a rolling 6 hours → the whole account is restricted**
  (4 hours; longer at 500 and 1000). The per-number guard above is the main
  defence; keep an eye on a run of red rows.
- Resending to a number that already has an unresolved push inside 30 seconds is
  refused with `429`, and the **Send** button shows a countdown instead.

## PayHero integration

Every line of PayHero-specific code lives in `server/src/services/payhero.js`.
It converts their wire format into one canonical `PaymentResult` shape; nothing
else in the codebase knows their API exists.

Verified against <https://docs.payhero.co.ke> on 2026-09-03:

- `POST https://backend.payhero.co.ke/api/v2/payments` — body `amount`,
  `phone_number`, `channel_id`, `provider: "m-pesa"`, `external_reference`,
  `customer_name`, `callback_url`. Returns `201` with
  `{ success, status: "QUEUED", reference, CheckoutRequestID }`.
- `GET https://backend.payhero.co.ke/api/v2/transaction-status?reference=…` —
  the query parameter is **`reference`**, documented as *the reference returned
  in the original transaction request* (an M-Pesa code also works). Returns
  `{ status, success, reference, provider_reference, third_party_reference,
  CheckoutRequestID, … }` with `status` one of `QUEUED | SUCCESS | FAILED`.
  We query by the reference PayHero gave us and fall back to our own
  `externalReference` only if that lookup 404s.
- Callback body: `{ forward_url, status, response: { Amount, CheckoutRequestID,
  ExternalReference, MerchantRequestID, MpesaReceiptNumber, Phone, ResultCode,
  ResultDesc, Status } }`. `ResultCode: 0` means paid.
- Auth is `Authorization: Basic <base64(username:password)>`.

Two notes where the docs differ from a common assumption:

- The status endpoint has **no `ResultCode`/`ResultDesc`** — only `status`. So a
  row resolved by **Check status** carries a description we write ourselves,
  while a row resolved by the callback carries M-Pesa's own wording.
- `QUEUED` is mapped to `PENDING`, never to `FAILED`. An unrecognised status is
  also treated as pending: the app will say *unknown* before it says *failed*.

## Not in v1

No authentication, receipts, refunds or reporting.
