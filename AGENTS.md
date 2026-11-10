# AGENTS.md

A [Hono](https://hono.dev) app running on Node.js. The Hono app is `src/app.ts` (default export); `src/index.ts` serves it with `@hono/node-server` on port 3000.

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

- WhatsApp uses `@whiskeysockets/baileys` (ESM, requires Node >= 20). One socket instance per process; never create a socket inside a request handler.
- Socket lifecycle lives in `src/wa/socket.ts` (`startWhatsApp`, `sendText`, `getStatus`). Routes in `src/routes/` must only call these functions.
- Auth state is stored in `data/auth` (gitignored). Never commit it. Logging out (`POST /logout` or from the phone) automatically deletes `data/auth`; use `POST /login` to pair again without restarting.
- Broadcast (`POST /broadcast`) sends sequentially with a configurable `delayMs` (min 1000ms) to avoid bans; do not remove the delay.
- `.env` (API_KEY, PORT) must never be committed; `.env.example` is the template.
- All endpoints require the `x-api-key` header matching `API_KEY`.
- Request bodies are validated with Zod in `src/routes/send.ts`.
- QR login prints to the terminal via `qrcode-terminal`; Baileys 7 removed `printQRInTerminal`.
- Do not add features, abstractions, or dependencies outside this scope.
