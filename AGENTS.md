# AGENTS.md

A [Hono](https://hono.dev) app running on Node.js. The Hono app is `src/app.ts` (default export); `src/index.ts` serves it with `@hono/node-server` on `PORT` (default 8365).

## Run

The commands below are written for npm. If the project has a `pnpm-lock.yaml`, `yarn.lock`, or `bun.lock`, use that package manager instead.

- `npm install`
- `npm run dev` starts the server with tsx in watch mode. It is for humans; do not start it to check your work.
- `npm run build` compiles with tsc to `dist/`; `npm start` runs it.

## Hono CLI

Run `npx hono --help` first, and use the CLI instead of a dev server.
The app is not at the default path, so pass `src/app.ts` to every command: `npx hono routes src/app.ts`.
The CLI bundles the app, so CJS packages must be marked external or it crashes: add `-e @whiskeysockets/baileys -e qrcode` to every `hono` CLI command.

## Docs

Fetch https://hono.dev/llms.txt to find the page, then fetch it with the `Accept: text/markdown` header, for example `curl -H "Accept: text/markdown" https://hono.dev/docs/guides/best-practices`.

## Baileys

- WhatsApp uses `@whiskeysockets/baileys` (ESM, requires Node >= 20; this project requires Node >= 24 because it uses `node:sqlite`). One socket per session; never create a socket inside a request handler.
- Socket lifecycle and the session manager live in `src/wa/manager.ts` (`startSession`, `sendText`, `logoutSession`, `deleteSession`, `restoreSessions`, `setSessionDownHandler`). Routes in `src/routes/` must only call these functions.
- Auth state per session is stored in SQLite (`src/wa/auth.ts` over `src/db/auth.ts`), not in folders. Never log or return credentials/signal keys. Logging out deletes only that session's rows; create the session again with `POST /sessions` to pair.
- All sessions with rows in `credentials` are restored at startup with a delay between sessions. Sessions that never finished pairing restore in QR mode.
- Broadcast lives in `src/broadcast/store.ts` (SQL queries, recovery) and `src/broadcast/scheduler.ts` (1-second tick, `createJob`, `getJob`, `cancelJob`). Jobs and recipients are persisted, one running job per session, random delay per message (`delayMinMs` >= 10000, `delayMaxMs` <= 600000).
- Broadcast may take `customerIds` instead of raw numbers. `{nama}` is rendered per recipient at job creation; the rendered text lives in `broadcast_recipients.text`. Recipients are deduplicated by normalized JID.
- Customers are global contacts in the app DB (`customers` table, migration 3). Queries live in `src/db/app.ts`, routes in `src/routes/customers.ts`. Contacts are never tied to a session.
- Dashboard aggregates come from `GET /stats`; recent outgoing messages across sessions come from `GET /messages` (`src/routes/history.ts`), which joins `customers` by phone for display names.
- Broadcast is at-most-once: write recipient status `sending` before calling `sendText`, then `sent`/`failed`. Never auto-retry `sending` rows on restart; they become `failed` with error `interrupted`.
- `src/db/sqlite.ts` opens the SQLite DB (WAL, `busy_timeout`, `foreign_keys`) and runs migrations. Auth state and app data live in one file (`DB_PATH`). Single process only.
- `.env` (API_KEY, PORT, DB_PATH, MAX_SESSIONS, LOG_RETENTION_DAYS) must never be committed; `.env.example` is the template.
- All `/sessions/*`, `/customers/*`, `/stats`, and `/messages` endpoints require the `x-api-key` header matching `API_KEY`. `GET /` is public service info and `GET /demo` serves the static dashboard.
- Request bodies are validated with Zod schemas shared from `src/validation.ts`.
- Outgoing messages are logged to `message_log` (`src/db/app.ts`) and exposed via `GET /sessions/:id/messages`. Incoming message content is never stored.
- QR is returned as a data-URL via `GET /sessions/:id/qr`; do not add terminal QR printing.
- Do not add features, abstractions, or dependencies outside this scope.
