# AGENTS.md

A pnpm monorepo. `packages/api` is a [Hono](https://hono.dev) app running on Node.js: the Hono app is `packages/api/src/app.ts` (default export); `packages/api/src/index.ts` serves it with `@hono/node-server` on `PORT` (default 8365). `packages/web` is the React + TanStack Router + Tailwind dashboard; the api serves its build output at `/app` (dev: `dev:api` passes `--dev`, sets `SERVE_WEB=false`, and `/app` redirects to the vite dev server instead of the stale `dist`).

## Run

The commands below are written for pnpm (requires Node >= 24, pnpm >= 9).

- `pnpm install`
- `pnpm build` builds every package (api: tsc to `packages/api/dist`; web: vite to `packages/web/dist`); `pnpm start` runs the built api.
- `pnpm smoke` (DB/token/webhook store), `pnpm smoke:http` (auth + routing), `pnpm smoke:migrate` (migration 5 on a legacy DB) are fast checks that do not start a server or touch `data/app.db`.
- `pnpm dev` runs api (tsx watch) + web (vite) in parallel; `pnpm dev:api` and `pnpm dev:web` run one package. Dev servers are for humans; do not start them to check your work.
- `.env` stays at the repo root; the api finds it from any cwd (`.env` → `../../.env`). Relative `DB_PATH` resolves against the monorepo root, not the process cwd.

## Hono CLI

Run `npx hono --help` first, and use the CLI instead of a dev server.
The app is not at the default path, so pass `packages/api/src/app.ts` to every command: `npx hono routes packages/api/src/app.ts`.
The CLI bundles the app, so CJS packages must be marked external or it crashes: add `-e @whiskeysockets/baileys -e qrcode` to every `hono` CLI command.

## Web (packages/web)

- React 19 + TanStack Router (file-based routes in `packages/web/src/routes`, route tree generated to `routeTree.gen.ts` — committed) + Tailwind v4 + lucide-react. No TanStack Query; data flows through router loaders plus local polling.
- Base path is `/app/` (vite `base`) and router `basepath: '/app'` — keep both in sync. UI routes are `/app/login`, `/app/overview`, `/app/numbers`, `/app/numbers/$sessionId`, `/app/history`, `/app/settings`; never add UI routes named like API paths (`/sessions`, `/stats`, `/messages`).
- Dev uses the vite proxy for `/sessions`, `/stats`, `/messages` → `http://localhost:8365`; API calls stay absolute-path and origin-agnostic.
- The admin API key is entered at runtime and kept in `sessionStorage` (`src/lib/auth.ts`); never bake keys into env/bundle. `api()` in `src/lib/api.ts` clears it on 401.
- Route files may only export `Route` (auto code splitting); shared components belong in `src/components`.
- Production: the api serves `packages/web/dist` at `/app` (serveStatic + SPA fallback via `app.notFound` for `Accept: text/html`); API paths always answer JSON.

## Docs

Fetch https://hono.dev/llms.txt to find the page, then fetch it with the `Accept: text/markdown` header, for example `curl -H "Accept: text/markdown" https://hono.dev/docs/guides/best-practices`.

## Baileys

- WhatsApp uses `@whiskeysockets/baileys` (ESM, requires Node >= 20; this project requires Node >= 24 because it uses `node:sqlite`). One socket per session; never create a socket inside a request handler.
- Socket lifecycle and the session manager live in `packages/api/src/wa/manager.ts` (`startSession`, `sendText`, `logoutSession`, `deleteSession`, `restoreSessions`, `setSessionDownHandler`). Routes in `packages/api/src/routes/` must only call these functions.
- Auth state per session is stored in SQLite (`packages/api/src/wa/auth.ts` over `packages/api/src/db/auth.ts`), not in folders. Never log or return credentials/signal keys. Logging out deletes only that session's rows; create the session again with `POST /sessions` to pair.
- All sessions with rows in `credentials` are restored at startup with a delay between sessions. Sessions that never finished pairing restore in QR mode.
- Broadcast lives in `packages/api/src/broadcast/store.ts` (SQL queries, recovery) and `packages/api/src/broadcast/scheduler.ts` (1-second tick, `createJob`, `getJob`, `cancelJob`). Jobs and recipients are persisted, one running job per session, random delay per message (`delayMinMs` >= 10000, `delayMaxMs` <= 600000).
- Broadcast takes an inline `recipients[]` array (`to`, `customerId?`, `name?`, `text?`). There is no customer table: this service never stores customer data. Recipients are deduplicated by normalized JID.
- Text is sent verbatim (plain text). Template rendering (e.g. `{nama}`) belongs to the calling app, not this service.
- Every session is owned by one sales: `session_meta` (`sales_id`, `agent_id`) is written on `POST /sessions`, and `sessionId` defaults to `salesId`.
- Session access uses per-session bearer tokens (`packages/api/src/auth/session-token.ts`, SHA-256 hashed, plaintext returned once). A sales token may only reach its own session; cross-session request returns `403`. Lifecycle endpoints (`POST /sessions`, `GET /sessions`, token rotation, logout, delete) are admin-only.
- `x-api-key` remains the admin/service key for the calling backend, `/stats`, and `/messages`.
- `referenceId` gives per-session idempotency: unique index on `message_log(session_id, reference_id)` and `broadcast_jobs(session_id, reference_id)`. Duplicate requests must not resend.
- Webhooks live in `packages/api/src/webhook/store.ts` (queue table `webhook_events`) and `packages/api/src/webhook/dispatcher.ts` (2-second poll, HMAC-SHA256 signature over `<timestamp>.<raw body>`, exponential retry, max `WEBHOOK_MAX_ATTEMPTS`). Events: `message.sent`/`message.failed` per send, `broadcast.completed|failed|cancelled` per job with `results[]`. Never send webhooks inline inside a request handler.
- Dashboard aggregates come from `GET /stats`; recent outgoing messages across sessions come from `GET /messages` (`packages/api/src/routes/history.ts`), reading `customer_ref`/`recipient_name` from `message_log`.
- Broadcast is at-most-once: write recipient status `sending` before calling `sendText`, then `sent`/`failed`. Never auto-retry `sending` rows on restart; they become `failed` with error `interrupted`.
- `packages/api/src/db/sqlite.ts` opens the SQLite DB (WAL, `busy_timeout`, `foreign_keys`) and runs migrations. Auth state and app data live in one file (`DB_PATH`). Single process only.
- `.env` (API_KEY, PORT, HOST, SERVE_WEB, DB_PATH, MAX_SESSIONS, LOG_RETENTION_DAYS, WEBHOOK_URL, WEBHOOK_SECRET, WEBHOOK_MAX_ATTEMPTS, WEBHOOK_RETENTION_DAYS) must never be committed; `.env.example` is the template.
- `/sessions/*` accepts `x-api-key` or a session bearer token; `/stats` and `/messages` require `x-api-key`. `GET /` is public service info, `GET /docs` (Scalar) and `GET /docs/openapi.json` are the public API reference, and `/app` serves the dashboard (dev: `http://localhost:5173/app/`).
- The OpenAPI document is hand-written in `packages/api/src/openapi.ts` and served by `packages/api/src/routes/docs.ts`. Request bodies and path params must come from the Zod schemas in `validation.ts` via `z.toJSONSchema`; only response shapes are spelled out there. When you add or change a route, update the document too.
- Request bodies are validated with Zod schemas shared from `packages/api/src/validation.ts`.
- Outgoing messages are logged to `message_log` (`packages/api/src/db/app.ts`) and exposed via `GET /sessions/:id/messages`. Incoming message content is never stored.
- QR is returned as a data-URL via `GET /sessions/:id/qr`; do not add terminal QR printing.
- Keep `README.md` and `API.md` in sync with every API, env, or schema change.
- Do not add features, abstractions, or dependencies outside this scope.
