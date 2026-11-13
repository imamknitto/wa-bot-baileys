# wa-bot-service

WhatsApp bot platform multi-sesi memakai [Hono](https://hono.dev) + [Baileys](https://github.com/WhiskeySockets/Baileys), dengan dashboard web React + TanStack Router di `packages/web`.

Service ini adalah **lapisan pengiriman WhatsApp** untuk aplikasi remarketing. Service **tidak menyimpan data customer**; data customer, sales, dan template tetap milik aplikasi remarketing. Satu sesi = satu socket WhatsApp = satu nomor milik satu sales.

Tugas service:

1. Menjaga koneksi WhatsApp per sales (pairing/QR, reconnect, logout).
2. Mengirim pesan (single dan broadcast) dengan jeda anti-ban.
3. Menyimpan log pesan keluar dan state job broadcast.
4. Memberi tahu aplikasi remarketing lewat webhook (per pesan untuk single send, per job untuk broadcast).

Dokumentasi API: [API.md](./API.md).

## Setup

Repo ini adalah **monorepo pnpm workspace** dengan dua package:

- `packages/api` — service Hono + Baileys (API WhatsApp).
- `packages/web` — dashboard React + TanStack Router + Tailwind (dilayani di `/app`).

```bash
pnpm install
cp .env.example .env   # set API_KEY dan PORT
pnpm dev               # api di :8365 + web (vite) di :5173/app/
```

Butuh **Node.js >= 24** (karena `node:sqlite`) dan **pnpm >= 9** (`corepack enable pnpm`).

Script utama di root:

| Script         | Isi                                                        |
| -------------- | ---------------------------------------------------------- |
| `pnpm dev`     | api (`tsx watch`) + web (`vite`) paralel                    |
| `pnpm dev:api` | hanya api                                                   |
| `pnpm dev:web` | hanya web (proxy API mengikuti `PORT` di `.env`)             |
| `pnpm build`   | build semua package (api → `dist/`, web → `packages/web/dist`) |
| `pnpm start`   | jalankan hasil build api                                    |
| `pnpm smoke*`  | smoke test DB/HTTP/migrasi                                  |

`.env` tetap di root dan dibaca api dari lokasi mana pun (fallback: `.env` → `../../.env`). `DB_PATH` relatif di-resolve terhadap root monorepo, bukan cwd proses. Proxy vite dev membaca `.env` root yang sama; `PORT` dipakai sebagai port api, `API_PORT` menimpanya bila diisi.

| Env                      | Default         | Keterangan                                                          |
| ------------------------ | --------------- | ------------------------------------------------------------------- |
| `API_KEY`                | (wajib)         | Header `x-api-key`, kunci admin untuk semua endpoint                 |
| `PORT`                   | `8365`          | Port HTTP                                                           |
| `HOST`                   | `0.0.0.0`       | Alamat bind; set `127.0.0.1` agar hanya bisa diakses dari mesin ini |
| `SERVE_WEB`              | `true`          | `false` = jangan layani `packages/web/dist` di `/app` (dev: api otomatis `false`) |
| `DB_PATH`                | `data/app.db`   | SQLite untuk auth, sesi, job broadcast, `message_log`, `webhook_events` |
| `MAX_SESSIONS`           | `10`            | Batas jumlah sesi aktif                                             |
| `LOG_RETENTION_DAYS`     | `30`            | Retensi `message_log`, dibersihkan tiap 24 jam                      |
| `WEBHOOK_URL`            | (kosong)        | URL webhook app remarketing; webhook mati jika kosong               |
| `WEBHOOK_SECRET`         | (wajib jika URL) | Secret HMAC-SHA256 untuk tanda tangan webhook                     |
| `WEBHOOK_MAX_ATTEMPTS`   | `5`             | Percobaan kirim webhook sebelum ditandai `failed`                   |
| `WEBHOOK_RETENTION_DAYS` | `7`             | Retensi baris `webhook_events` yang sudah selesai                   |

- `GET /` → info service dalam JSON.
- `GET /docs` → API reference interaktif (Scalar) dari `GET /docs/openapi.json`. Publik, tanpa API key.
- `GET /app/` → dashboard web (hasil build `packages/web`, dilayani oleh api). Saat `pnpm dev:api`, `/app` tidak menyajikan `dist` dan dialihkan ke `http://localhost:5173/app/` (vite).
- Endpoint `/sessions/*`, `/stats`, dan `/messages` menerima `x-api-key` (admin) atau `Authorization: Bearer <token>` (akses satu sesi).

## Database

- DB dibuat otomatis saat start (folder `data/` dibuat jika belum ada) dan memakai WAL + `busy_timeout`.
- File `*.db`, `*.db-wal`, dan `*.db-shm` gitignored. Jangan commit isinya.
- Jalankan **satu proses server saja** per file DB; SQLite tidak cocok untuk dua instance penulis.
- `DB_PATH` berisi kunci privat setara kredensial login (tabel `credentials`, `signal_keys`). Backup harus diperlakukan seperti rahasia.
- Migrasi schema berjalan otomatis dan dicatat di tabel `schema_migrations`. Migrasi 5 menghapus tabel `customers` dan menambah `session_meta`, `session_tokens`, `webhook_events`, serta kolom customer/sales di `message_log` dan `broadcast_recipients`.

## Alur sistem

Urutan start di `packages/api/src/index.ts`:

```
loadEnvFile → getConfig → initAppDb (buka DB + migrasi) → scheduler.initialize
           → serve(:PORT) → restoreSessions → scheduler.start + webhook.start
```

Lapisan kode (semua di `packages/api/src`) — route tipis, semua akses socket lewat satu modul:

- `app.ts` merangkai route + auth admin/sales + penyajian web. Route tidak pernah membuat socket.
- `auth/session-token.ts` menerbitkan, memutar, dan memverifikasi token sesi (SHA-256 hash, plaintext hanya dikembalikan sekali).
- `wa/manager.ts` pemilik socket: `startSession`, `sendText`, `logoutSession`, `deleteSession`, `restoreSessions`.
- `db/auth.ts` menyimpan state Baileys (`credentials`, `signal_keys`) memakai koneksi DB yang sama dengan data aplikasi (`db/app.ts`).
- `broadcast/store.ts` query + recovery job; `broadcast/scheduler.ts` tick 1 detik mengambil penerima yang jatuh tempo.
- `webhook/store.ts` antrean event; `webhook/dispatcher.ts` pengirim dengan retry + tanda tangan HMAC.

| Operasi | Jalur | Yang ditulis |
| --- | --- | --- |
| Pairing / sesi baru | `POST /sessions` → `startSession` → ambil QR atau kode lewat `GET /sessions/:id/qr` / `.../pairing` | `credentials`, `signal_keys`, `session_meta`, `session_tokens` |
| Login ulang setelah logout | `POST /sessions/:id/login` → `startSession` (mode QR) → `GET /sessions/:id/qr` | `credentials`, `signal_keys` |
| Kirim pesan | `POST /sessions/:id/send` → `sendText` | `message_log`, `webhook_events` |
| Broadcast | `POST /sessions/:id/broadcast` → `createJob` (dedupe JID) → scheduler → `sendText` | `broadcast_jobs`, `broadcast_recipients`, `message_log`, `webhook_events` |
| Restart | `restoreSessions()` membaca `credentials` → connect ulang atau QR; sisa status `sending` jadi `failed` (`interrupted`) | `broadcast_recipients` |
| Dashboard | `GET /sessions`, `GET /stats`, `GET /messages` | baca saja |

Pesan masuk tidak disimpan; hanya pesan keluar yang masuk `message_log`.

## Kepemilikan sesi dan akses

- Satu sales punya satu nomor WhatsApp = satu sesi. `POST /sessions` menyimpan `salesId` (wajib) dan `agentId` (opsional) di `session_meta`. `sessionId` default sama dengan `salesId`.
- `sessionId` yang sudah dimiliki sales lain tidak bisa dipakai ulang (`409`).
- Respons `POST /sessions` mengembalikan `token` **sekali saja**. Simpan di app remarketing.
- Token hanya bisa dipakai untuk sesi miliknya: request ke `/sessions/<id-lain>/*` menghasilkan `403`, bukan `404`.
- Endpoint lifecycle sesi (`POST /sessions`, `POST /sessions/:id/login`, `POST /sessions/:id/token`, `POST /sessions/:id/logout`, `DELETE /sessions/:id`) hanya untuk admin (`x-api-key`).
- `GET /sessions` menerima keduanya: admin melihat semua sesi, token sales hanya melihat sesinya sendiri.
- Sales boleh memakai: `GET /sessions`, `GET /sessions/:id/status`, `.../qr`, `.../pairing`, `POST .../send`, `POST .../broadcast`, `GET .../broadcast/*`, `GET .../messages`.
- `POST /sessions/:id/logout` dan `DELETE /sessions/:id` mem-revoke semua token sesi tersebut.
- `POST /sessions/:id/token` memutar token: token lama langsung tidak berlaku.

## Konsep sesi

- Sesi dibuat lewat `POST /sessions`. Jumlah sesi aktif dibatasi `MAX_SESSIONS`; melebihinya menghasilkan `409`.
- Auth state disimpan di tabel `credentials` dan `signal_keys` pada `DB_PATH`.
- Saat server start, semua sesi yang punya baris `credentials` dipulihkan otomatis dengan jeda antar sesi. Sesi yang sudah terpasang langsung connect tanpa pairing ulang; sesi yang belum selesai pairing dipulihkan dalam mode QR.
- Satu `sessionId` hanya boleh punya satu socket. Sesi yang putus akan reconnect sendiri dengan exponential backoff (2 detik sampai 60 detik + jitter) tanpa mengganggu sesi lain.
- Logout menghapus baris auth sesi tersebut. Untuk pairing ulang, panggil `POST /sessions/:id/login` (mode QR, tanpa token/meta baru) atau `POST /sessions` dengan `sessionId` yang sama (status sesi harus `logged_out`/`disconnected`).
- `DELETE /sessions/:id` logout jika perlu, menghapus auth, meta sesi, token, dan sesi dari manager, serta menandai job broadcast yang berjalan sebagai `failed`. Riwayat `message_log` dan job lama tidak dihapus.

`sessionId` divalidasi dengan pola `^[a-zA-Z0-9_-]{1,32}$`. Nilai seperti `../`, garis miring, atau lebih dari 32 karakter ditolak `400` untuk mencegah path traversal.

## Data penerima (tanpa tabel customer)

Service tidak menyimpan customer. Penerima dikirim inline pada setiap request:

- Single send: `{ to, text, customerId?, customerName?, referenceId? }`.
- Broadcast: `recipients: [{ to, customerId?, name?, text? }]`.

`customerId` adalah ID customer di aplikasi remarketing (string bebas, maks 128 karakter) dan hanya disimpan sebagai referensi di `message_log` / `broadcast_recipients` (`customer_ref`). `customerName`/`name` disimpan sebagai `recipient_name` untuk ditampilkan di riwayat dan webhook.

Teks dikirim apa adanya (plain text). Tidak ada rendering template atau token `{nama}` di service ini — aplikasi remarketing yang merender sebelum memanggil API.

## Idempotensi

- `referenceId` (opsional, maks 128 karakter) unik per sesi pada `message_log` dan `broadcast_jobs`.
- `POST /sessions/:id/send` dengan `referenceId` yang sudah ada mengembalikan hasil tercatat dengan `duplicate: true` dan **tidak** mengirim ulang.
- `POST /sessions/:id/broadcast` dengan `referenceId` yang sudah ada mengembalikan `jobId` lama dengan `duplicate: true`.

## Webhook ke aplikasi remarketing

Aktif hanya jika `WEBHOOK_URL` diset. Setiap event disimpan dulu di tabel `webhook_events` (`pending`) lalu dikirim oleh dispatcher tiap 2 detik.

- Event per pesan: `message.sent`, `message.failed` (dari `POST /sessions/:id/send`).
- Event per job: `broadcast.completed`, `broadcast.failed`, `broadcast.cancelled` (payload membawa `results[]` per penerima).

Header:

```http
x-wa-event: message.sent
x-wa-event-id: <uuid>
x-wa-timestamp: <unix ms>
x-wa-signature: sha256=<hex>
```

`x-wa-signature` = `HMAC-SHA256(WEBHOOK_SECRET, "<timestamp>.<raw body>")`. Aplikasi penerima wajib memverifikasi tanda tangan ini dan memperlakukan `x-wa-event-id` sebagai idempotency key.

Retry exponential 5s → 25s → 125s → 625s, maksimal `WEBHOOK_MAX_ATTEMPTS` percobaan. Setelah habis, event menjadi `failed` dengan `last_error`. Event yang sudah `delivered`/`failed` dibersihkan setelah `WEBHOOK_RETENTION_DAYS`. Dispatcher berjalan terpisah dan tidak memblokir pengiriman WhatsApp.

## Mode login

### Pairing code

```bash
curl -X POST http://localhost:8365/sessions \
  -H "x-api-key: <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"salesId": "S-12", "agentId": "A-3", "mode": "pairing", "phone": "6281234567890"}'
```

- `mode` default `pairing`.
- Nomor disanitasi menjadi digit saja; wajib 8–15 digit.
- Kode pairing diminta otomatis setelah socket siap dan hanya jika sesi belum terdaftar.
- Ambil kode di `GET /sessions/:id/pairing`. Request kode dibatasi (cooldown 60 detik per sesi) agar tidak spam ke WhatsApp.

### QR code

```bash
curl -X POST http://localhost:8365/sessions \
  -H "x-api-key: <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"salesId": "S-13", "sessionId": "sales-2", "mode": "qr"}'
```

Ambil QR terbaru sebagai data-URL PNG di `GET /sessions/:id/qr`. QR diperbarui otomatis oleh Baileys.

## API

Kontrak API lengkap — request, response, status code, dan contoh — ada di **[API.md](./API.md)**.

Referensi interaktif tersedia di `http://localhost:<PORT>/docs` (Scalar, dibangun dari `packages/api/src/openapi.ts`). Dokumen OpenAPI mentahnya di `GET /docs/openapi.json` — publik, bisa diimpor ke Postman atau dipakai untuk codegen. Halaman `/docs` memuat script Scalar dari CDN jsDelivr, jadi butuh koneksi internet di browser; API-nya sendiri tidak.

| Method   | Path                                    | Akses  | Keterangan                     |
| -------- | --------------------------------------- | ------ | ------------------------------ |
| `GET`    | `/`                                     | publik | Info service                   |
| `GET`    | `/docs`                                 | publik | API reference (Scalar)         |
| `GET`    | `/docs/openapi.json`                    | publik | Dokumen OpenAPI 3.1            |
| `POST`   | `/sessions`                             | admin  | Buat sesi + terbitkan token    |
| `GET`    | `/sessions`                             | admin/sales | Daftar sesi (sales: hanya miliknya) |
| `POST`   | `/sessions/:id/token`                   | admin  | Putar token sesi               |
| `GET`    | `/sessions/:id/status`                  | admin/sales | Status satu sesi          |
| `GET`    | `/sessions/:id/qr`                      | admin/sales | QR sebagai data-URL       |
| `GET`    | `/sessions/:id/pairing`                 | admin/sales | Kode pairing              |
| `POST`   | `/sessions/:id/send`                    | admin/sales | Kirim satu pesan          |
| `GET`    | `/sessions/:id/messages`                | admin/sales | Riwayat pesan per sesi    |
| `POST`   | `/sessions/:id/broadcast`               | admin/sales | Mulai job broadcast       |
| `GET`    | `/sessions/:id/broadcast/current`       | admin/sales | Job yang sedang berjalan  |
| `GET`    | `/sessions/:id/broadcast/:jobId`        | admin/sales | Status job broadcast      |
| `POST`   | `/sessions/:id/broadcast/:jobId/cancel` | admin/sales | Batalkan job broadcast    |
| `POST`   | `/sessions/:id/logout`                  | admin  | Logout dan hapus auth          |
| `DELETE` | `/sessions/:id`                         | admin  | Hapus sesi                     |
| `GET`    | `/stats`                                | admin  | Ringkasan dashboard            |
| `GET`    | `/messages`                             | admin  | Riwayat semua sesi             |
| `DELETE` | `/messages/:id`                         | admin  | Hapus satu baris riwayat       |

Endpoint `/sessions/*` menerima `x-api-key` (admin) atau `Authorization: Bearer <token sesi>`. `/stats` dan `/messages` hanya `x-api-key`. Error berbentuk `{ "error": "..." }`; error validasi menambahkan `details`.

## Bot ping-pong

Pesan teks masuk `"ping"` dari chat mana pun otomatis dibalas `"pong"` pada sesi yang menerimanya. Pesan masuk tidak disimpan.

## Dashboard web

Buka `http://localhost:<PORT>/app/` (hasil build) atau `http://localhost:5173/app/` saat `pnpm dev`.

- Login memakai API key admin; key disimpan di `sessionStorage` tab (hilang saat tab ditutup).
- Halaman `/app/overview`: kartu ringkasan (sesi terhubung, pesan hari ini, total pesan, broadcast berjalan), status service, dan progres job broadcast aktif.
- Halaman `/app/numbers`: tabel sesi (sales, agent, status, terkirim hari ini) + dialog tambah nomor (mode QR atau pairing, token ditampilkan sekali).
- Halaman `/app/numbers/<sessionId>` dengan tab Koneksi (QR/pairing otomatis di-refresh, tombol “Login ulang dengan QR” saat sesi logout), Kirim (single send dengan `referenceId`), Broadcast (penerima `nomor,nama` per baris, delay min–maks 10–600 detik, progres live, batal), dan Riwayat sesi.
- Halaman `/app/history`: riwayat pesan gabungan semua sesi + filter Session ID + hapus catatan.
- Halaman `/app/settings`: default delay broadcast (localStorage), info service, catatan privasi.

Kode ada di `packages/web` (React 19 + TanStack Router file-based + Tailwind v4). Saat produksi, api menyajikan `packages/web/dist` di `/app` dengan fallback SPA untuk `Accept: text/html`; path API tidak pernah tertabrak UI.

## Breaking changes

- Dashboard vanilla (`public/` di `/demo`) diganti aplikasi React di `/app`. Route API tidak berubah.
- Repo berubah menjadi monorepo pnpm (`packages/api`, `packages/web`); pakai `pnpm`, bukan `npm`.
- Endpoint lama `/status`, `/qr`, `/send`, `/login`, `/logout`, dan `/broadcast` dihapus. Gunakan endpoint `/sessions/*`.
- `GET /` tetap info service JSON; UI pindah ke `/app`.
- Auth pindah dari folder `data/auth/` ke SQLite, sekarang satu file `DB_PATH` (default `data/app.db`). `AUTH_DB_PATH`/`APP_DB_PATH` dihapus; sesi lama perlu pairing ulang.
- Runtime minimal Node.js 24 karena memakai `node:sqlite`.
- Server tidak lagi otomatis login saat tanpa sesi; buat sesi lewat `POST /sessions`.
- Broadcast sekarang asinkron (`202 + jobId`) dan memakai `delayMinMs`/`delayMaxMs` (minimum **10 detik**), bukan `delayMs`.
- Broadcast tidak lagi hilang saat restart: job `running` dilanjutkan, penerima `sending` menjadi `failed (interrupted)`.
- QR tidak lagi dicetak ke terminal. QR tersedia lewat API/UI sebagai data-URL.
- Dependency `qrcode-terminal` dihapus.
- **Migrasi 5 (integrasi remarketing):** tabel `customers` dan seluruh endpoint `/customers` dihapus; data customer hilang dan tidak dimigrasi. `customerIds` pada broadcast diganti `recipients[]` inline. Token `{nama}` dihapus. `POST /sessions` kini wajib `salesId` dan mengembalikan `token`. `GET /stats` tidak lagi memuat `customers`.
- Semua pemanggil API harus pindah dari `x-api-key` ke token sesi untuk operasi sales (atau tetap `x-api-key` untuk admin).

## Di luar scope

Saran pengembangan berikut tidak dikerjakan di versi ini:

- Penyimpanan data customer/sales/template (menjadi tanggung jawab aplikasi remarketing).
- Penyimpanan isi atau metadata pesan masuk.
- Purge otomatis riwayat job broadcast lama (`message_log` dan `webhook_events` sudah dipurge sesuai retensi).
- Migrasi otomatis auth folder lama `data/auth/`.
- Sharding multi-instance (satu sesi hanya boleh dipegang satu proses).
- Webhook untuk pesan masuk.
