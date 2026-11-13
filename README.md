# wa-bot-service

Platform WhatsApp multi-sesi berbasis [Hono](https://hono.dev) + [Baileys](https://github.com/WhiskeySockets/Baileys), lengkap dengan dashboard web React di `packages/web`.

Service ini adalah **lapisan pengiriman WhatsApp** yang bisa dipakai aplikasi apa pun. Service **tidak menyimpan data kontak**; data pelanggan, pengguna, dan template tetap milik aplikasi yang memanggilnya. Satu sesi = satu socket WhatsApp = satu nomor.

Yang dikerjakan service:

1. Menjaga koneksi WhatsApp per sesi (pairing/QR, reconnect, logout).
2. Mengirim pesan (single dan broadcast) dengan jeda anti-ban.
3. Menyimpan log pesan keluar dan state job broadcast.
4. Memberi tahu aplikasi pemanggil lewat webhook.

Kontrak API lengkap: [API.md](./API.md).

## Setup

Monorepo pnpm dengan dua package:

- `packages/api` — Hono + Baileys.
- `packages/web` — dashboard React + TanStack Router + Tailwind, dilayani di `/app`.

```bash
pnpm install
cp .env.example .env   # set API_KEY
pnpm dev               # api :8365 + web (vite) :5173/app/
```

Butuh **Node.js >= 24** (`node:sqlite`) dan **pnpm >= 9** (`corepack enable pnpm`).

| Script         | Isi                                                          |
| -------------- | ------------------------------------------------------------ |
| `pnpm dev`     | api + web paralel                                             |
| `pnpm dev:api` | hanya api                                                     |
| `pnpm dev:web` | hanya web (proxy mengikuti `PORT` di `.env`)                  |
| `pnpm build`   | build semua package (api → `dist/`, web → `packages/web/dist`) |
| `pnpm start`   | jalankan hasil build api                                      |
| `pnpm smoke*`  | smoke test DB/HTTP/migrasi                                    |

## Environment

`.env` di root dibaca api dari lokasi mana pun. `DB_PATH` relatif di-resolve terhadap root monorepo, bukan cwd. Proxy vite dev membaca `.env` yang sama.

| Env                      | Default          | Keterangan                                              |
| ------------------------ | ---------------- | ------------------------------------------------------- |
| `API_KEY`                | (wajib)          | Header `x-api-key`, kunci admin                         |
| `PORT`                   | `8365`           | Port HTTP                                               |
| `HOST`                   | `0.0.0.0`        | Alamat bind                                             |
| `SERVE_WEB`              | `true`           | `false` = jangan layani `packages/web/dist` di `/app`   |
| `DB_PATH`                | `data/app.db`    | File SQLite (auth, sesi, job, log, webhook)             |
| `MAX_SESSIONS`           | `10`             | Batas sesi aktif                                        |
| `LOG_RETENTION_DAYS`     | `30`             | Retensi `message_log`                                   |
| `WEBHOOK_URL`            | (kosong)         | Webhook mati jika kosong                                |
| `WEBHOOK_SECRET`         | (wajib jika URL) | Secret HMAC-SHA256                                      |
| `WEBHOOK_MAX_ATTEMPTS`   | `5`              | Percobaan kirim webhook                                 |
| `WEBHOOK_RETENTION_DAYS` | `7`              | Retensi `webhook_events`                                |

## Endpoint umum

- `GET /` → info service (JSON).
- `GET /docs` → API reference interaktif (Scalar) dari `GET /docs/openapi.json`. Publik.
- `GET /app/` → dashboard. Saat `pnpm dev:api`, `/app` dialihkan ke vite `:5173`.
- `/sessions/*`, `/stats`, `/messages` menerima `x-api-key` (admin) atau `Authorization: Bearer <token>` (akses satu sesi).

## Arsitektur

Urutan start (`packages/api/src/index.ts`):

```
loadEnvFile → getConfig → initAppDb → scheduler.initialize → serve(:PORT)
           → restoreSessions → scheduler.start + webhook.start
```

Route tipis; semua akses socket lewat satu modul:

- `app.ts` — rangkaian route, auth, penyajian web.
- `auth/session-token.ts` — terbitkan/putar/verifikasi token sesi (disimpan sebagai hash).
- `wa/manager.ts` — pemilik socket (`startSession`, `sendText`, `logoutSession`, `deleteSession`, `restoreSessions`).
- `db/auth.ts` — state Baileys (`credentials`, `signal_keys`).
- `broadcast/store.ts` + `broadcast/scheduler.ts` — query job dan tick 1 detik.
- `webhook/store.ts` + `webhook/dispatcher.ts` — antrean event, retry, tanda tangan HMAC.

| Operasi | Jalur | Ditulis ke |
| --- | --- | --- |
| Pairing sesi baru | `POST /sessions` → `startSession` → `GET /sessions/:id/qr` atau `.../pairing` | `credentials`, `signal_keys`, `session_meta`, `session_tokens` |
| Login ulang | `POST /sessions/:id/login` → `GET /sessions/:id/qr` | `credentials`, `signal_keys` |
| Kirim pesan | `POST /sessions/:id/send` → `sendText` | `message_log`, `webhook_events` |
| Broadcast | `POST /sessions/:id/broadcast` → `createJob` → scheduler → `sendText` | `broadcast_jobs`, `broadcast_recipients`, `message_log`, `webhook_events` |
| Restart | `restoreSessions()`; sisa `sending` jadi `failed` (`interrupted`) | `broadcast_recipients` |

Pesan masuk tidak disimpan; hanya pesan keluar masuk `message_log`.

## Sesi dan akses

- `POST /sessions` menyimpan `salesId` (wajib) dan `agentId` (opsional) di `session_meta`. `sessionId` default sama dengan `salesId`, divalidasi `^[a-zA-Z0-9_-]{1,32}$`.
- `sessionId` milik pengguna lain tidak bisa dipakai ulang (`409`).
- Respons `POST /sessions` mengembalikan `token` **sekali saja**. Token hanya berlaku untuk sesinya sendiri (`403` untuk sesi lain).
- Endpoint lifecycle (`POST /sessions`, `.../login`, `.../token`, `.../logout`, `DELETE`) hanya admin.
- `GET /sessions` menerima keduanya: admin melihat semua, token hanya miliknya.
- Logout/delete mem-revoke semua token sesi. `POST /sessions/:id/token` memutar token dan mematikan yang lama.
- Jumlah sesi aktif dibatasi `MAX_SESSIONS`. Satu `sessionId` hanya boleh punya satu socket; putus koneksi reconnect otomatis dengan exponential backoff (2–60 detik + jitter).
- Saat start, semua sesi ber-`credentials` dipulihkan otomatis; yang belum selesai pairing dipulihkan dalam mode QR.

## Data penerima

Service tidak punya tabel kontak. Penerima dikirim inline:

- Single send: `{ to, text, customerId?, customerName?, referenceId? }`.
- Broadcast: `recipients: [{ to, customerId?, name?, text? }]`.

`customerId` disimpan hanya sebagai `customer_ref` di `message_log`/`broadcast_recipients`; `customerName`/`name` sebagai `recipient_name`. Teks dikirim apa adanya (plain text), tanpa rendering template.

## Idempotensi

- `referenceId` unik per sesi pada `message_log` dan `broadcast_jobs`.
- Send dengan `referenceId` duplikat → hasil tercatat, `duplicate: true`, tidak dikirim ulang.
- Broadcast dengan `referenceId` duplikat → `jobId` lama, `duplicate: true`.

## Webhook

Aktif jika `WEBHOOK_URL` diset. Event disimpan `pending` di `webhook_events` lalu dikirim dispatcher tiap 2 detik.

- Per pesan: `message.sent`, `message.failed`.
- Per job: `broadcast.completed`, `broadcast.failed`, `broadcast.cancelled` (payload `results[]`).

```http
x-wa-event: message.sent
x-wa-event-id: <uuid>
x-wa-timestamp: <unix ms>
x-wa-signature: sha256=<hex>
```

`x-wa-signature` = `HMAC-SHA256(WEBHOOK_SECRET, "<timestamp>.<raw body>")`. Penerima wajib memverifikasi tanda tangan dan memakai `x-wa-event-id` sebagai idempotency key. Retry 5s → 25s → 125s → 625s, maks `WEBHOOK_MAX_ATTEMPTS`; setelah itu `failed`.

## Mode login

Pairing code (default):

```bash
curl -X POST http://localhost:8365/sessions \
  -H "x-api-key: <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"salesId": "S-12", "mode": "pairing", "phone": "6281234567890"}'
```

Nomor disanitasi jadi digit saja (8–15 digit). Ambil kode di `GET /sessions/:id/pairing` (cooldown 60 detik per sesi).

QR code:

```bash
curl -X POST http://localhost:8365/sessions \
  -H "x-api-key: <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"salesId": "S-13", "sessionId": "sales-2", "mode": "qr"}'
```

QR terbaru (data-URL PNG) di `GET /sessions/:id/qr`, diperbarui otomatis oleh Baileys. QR tidak pernah dicetak ke terminal.

## Bot ping-pong

Pesan teks masuk `"ping"` dibalas `"pong"` pada sesi penerima. Pesan masuk tidak disimpan.

## Dashboard

`http://localhost:<PORT>/app/` (hasil build) atau `:5173/app/` saat dev.

- Login dengan API key admin, disimpan di `sessionStorage`.
- `/app/overview` — ringkasan sesi, pesan hari ini, total pesan, broadcast berjalan.
- `/app/numbers` — tabel sesi + dialog tambah nomor (QR/pairing, token tampil sekali).
- `/app/numbers/<sessionId>` — tab Koneksi, Kirim, Broadcast (delay 10–600 detik), Riwayat.
- `/app/history` — riwayat gabungan semua sesi + filter.
- `/app/settings` — default delay, info service.

Di produksi api menyajikan `packages/web/dist` di `/app` dengan fallback SPA; path API tidak pernah tertabrak UI.

## Database

- DB dibuat otomatis saat start (WAL + `busy_timeout`), migrasi tercatat di `schema_migrations`.
- `*.db`/`*.db-wal`/`*.db-shm` gitignored. Isi `DB_PATH` setara kredensial login — perlakukan sebagai rahasia.
- Jalankan **satu proses** per file DB.

## Di luar scope

- Penyimpanan data kontak/pengguna/template (tanggung jawab aplikasi pemanggil).
- Penyimpanan isi atau metadata pesan masuk.
- Sharding multi-instance (satu sesi hanya boleh dipegang satu proses).
