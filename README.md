# wa-bot-service

WhatsApp bot service multi-sesi memakai [Hono](https://hono.dev) + [Baileys](https://github.com/WhiskeySockets/Baileys).

Satu sesi = satu socket WhatsApp = satu baris auth di SQLite. Beberapa sesi bisa login dan mengirim pesan secara independen dalam satu proses server. Job broadcast dan log pesan keluar juga tersimpan di SQLite sehingga tidak hilang saat restart.

Dokumentasi API: [API.md](./API.md).

## Setup

```bash
npm install
cp .env.example .env   # set API_KEY dan PORT
npm run dev
```

Butuh **Node.js >= 24** karena memakai `node:sqlite` bawaan.

| Env                  | Default         | Keterangan                                      |
| -------------------- | --------------- | ----------------------------------------------- |
| `API_KEY`            | (wajib)         | Header `x-api-key` untuk `/sessions/*`, `/customers/*`, `/stats`, `/messages` |
| `PORT`               | `8365`          | Port HTTP                                       |
| `DB_PATH`            | `data/app.db`   | SQLite untuk auth, customer, job broadcast, dan `message_log` |
| `MAX_SESSIONS`       | `10`            | Batas jumlah sesi aktif                         |
| `LOG_RETENTION_DAYS` | `30`            | Retensi `message_log`, dibersihkan tiap 24 jam  |

- `GET /` → info service dalam JSON.
- `GET /demo` → dashboard UI.
- Semua endpoint `/sessions/*`, `/customers/*`, `/stats`, dan `/messages` memerlukan header `x-api-key` yang cocok dengan `API_KEY`.

## Database

- DB dibuat otomatis saat start (folder `data/` dibuat jika belum ada) dan memakai WAL + `busy_timeout`.
- File `*.db`, `*.db-wal`, dan `*.db-shm` gitignored. Jangan commit isinya.
- Jalankan **satu proses server saja** per file DB; SQLite tidak cocok untuk dua instance penulis.
- `DB_PATH` berisi kunci privat setara kredensial login (tabel `credentials`, `signal_keys`). Backup harus diperlakukan seperti rahasia.
- Migrasi schema berjalan otomatis dan dicatat di tabel `schema_migrations`.

## Alur sistem

Urutan start di `src/index.ts`:

```
loadEnvFile → getConfig → initAppDb (buka DB + migrasi) → scheduler.initialize
           → serve(:PORT) → restoreSessions → scheduler.start
```

Lapisan kode — route tipis, semua akses socket lewat satu modul:

- `src/app.ts` merangkai route + `x-api-key`. Route tidak pernah membuat socket.
- `src/wa/manager.ts` pemilik socket: `startSession`, `sendText`, `logoutSession`, `deleteSession`, `restoreSessions`.
- `src/db/auth.ts` menyimpan state Baileys (`credentials`, `signal_keys`) memakai koneksi DB yang sama dengan data aplikasi (`src/db/app.ts`).
- `src/broadcast/store.ts` query + recovery job; `src/broadcast/scheduler.ts` tick 1 detik mengambil penerima yang jatuh tempo.

| Operasi | Jalur | Yang ditulis |
| --- | --- | --- |
| Pairing / sesi baru | `POST /sessions` → `startSession` → ambil QR atau kode lewat `GET /sessions/:id/qr` / `.../pairing` | `credentials`, `signal_keys` |
| Kirim pesan | `POST /sessions/:id/send` → `sendText` | `message_log` |
| Broadcast | `POST /sessions/:id/broadcast` → `createJob` (render `{nama}`, dedupe JID) → scheduler → `sendText` | `broadcast_jobs`, `broadcast_recipients`, `message_log` |
| Restart | `restoreSessions()` membaca `credentials` → connect ulang atau QR; sisa status `sending` jadi `failed` (`interrupted`) | `broadcast_recipients` |
| Dashboard | `GET /sessions`, `GET /stats`, `GET /messages` | baca saja |

Pesan masuk tidak disimpan; hanya pesan keluar yang masuk `message_log`.

## Konsep sesi

- Sesi dibuat lewat `POST /sessions` dengan `sessionId` unik. Jumlah sesi aktif dibatasi `MAX_SESSIONS`; melebihinya menghasilkan `409`.
- Auth state disimpan di tabel `credentials` dan `signal_keys` pada `DB_PATH`. Tidak ada lagi folder `data/auth/<sessionId>/`.
- Saat server start, semua sesi yang punya baris `credentials` dipulihkan otomatis dengan jeda antar sesi. Sesi yang sudah terpasang langsung connect tanpa pairing ulang; sesi yang belum selesai pairing dipulihkan dalam mode QR.
- Satu `sessionId` hanya boleh punya satu socket. Sesi yang putus akan reconnect sendiri dengan exponential backoff (2 detik sampai 60 detik + jitter) tanpa mengganggu sesi lain.
- Logout menghapus baris auth sesi tersebut. Untuk pairing ulang, panggil `POST /sessions` dengan `sessionId` yang sama (status sesi harus `logged_out`/`disconnected`).
- `DELETE /sessions/:id` logout jika perlu, menghapus auth, menghapus sesi dari manager, dan menandai job broadcast yang berjalan sebagai `failed`. Riwayat `message_log` dan job lama tidak dihapus.
- Auth single-session lama di `data/auth/` **tidak** dimigrasi otomatis. Sesi lama perlu pairing ulang lewat `POST /sessions`.

`sessionId` divalidasi dengan pola `^[a-zA-Z0-9_-]{1,32}$`. Nilai seperti `../`, garis miring, atau lebih dari 32 karakter ditolak `400` untuk mencegah path traversal.

## Customer

- Daftar nomor WhatsApp customer disimpan di tabel `customers` pada `DB_PATH`: `name`, `phone` (digit-only, unik), dan `note` bebas.
- Customer bersifat global, tidak terikat sesi. UI memakainya untuk memilih penerima broadcast dan menampilkan nama di riwayat pengiriman.
- Broadcast bisa memakai `customerIds`; token `{nama}` pada teks diganti nama customer per penerima. Nomor manual lewat `recipients` tetap didukung untuk integrasi API.
- CRUD tersedia di `/customers` (lihat [API.md](./API.md)).

## Mode login

### Pairing code

```bash
curl -X POST http://localhost:8365/sessions \
  -H "x-api-key: <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"sessionId": "sales-1", "mode": "pairing", "phone": "6281234567890"}'
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
  -d '{"sessionId": "sales-2", "mode": "qr"}'
```

Ambil QR terbaru sebagai data-URL PNG di `GET /sessions/:id/qr`. QR diperbarui otomatis oleh Baileys.

## API

Kontrak API lengkap — request, response, status code, dan contoh — ada di **[API.md](./API.md)**.

| Method   | Path                                    | Keterangan              |
| -------- | --------------------------------------- | ----------------------- |
| `GET`    | `/`                                     | Info service (publik)   |
| `POST`   | `/sessions`                             | Buat sesi / mulai login |
| `GET`    | `/sessions`                             | Daftar sesi             |
| `GET`    | `/sessions/:id/status`                  | Status satu sesi        |
| `GET`    | `/sessions/:id/qr`                      | QR sebagai data-URL     |
| `GET`    | `/sessions/:id/pairing`                 | Kode pairing            |
| `POST`   | `/sessions/:id/send`                    | Kirim satu pesan        |
| `GET`    | `/sessions/:id/messages`                | Riwayat pesan keluar per sesi |
| `POST`   | `/sessions/:id/broadcast`               | Mulai job broadcast     |
| `GET`    | `/sessions/:id/broadcast/:jobId`        | Status job broadcast    |
| `POST`   | `/sessions/:id/broadcast/:jobId/cancel` | Batalkan job broadcast  |
| `POST`   | `/sessions/:id/logout`                  | Logout dan hapus auth   |
| `DELETE` | `/sessions/:id`                         | Hapus sesi              |
| `GET`    | `/customers`                            | Daftar/cari customer    |
| `POST`   | `/customers`                            | Tambah customer         |
| `PATCH`  | `/customers/:id`                        | Ubah customer           |
| `DELETE` | `/customers/:id`                        | Hapus customer          |
| `GET`    | `/stats`                                | Ringkasan dashboard     |
| `GET`    | `/messages`                             | Riwayat semua sesi      |

Semua endpoint di atas (kecuali `GET /`) memerlukan header `x-api-key`. Error berbentuk `{ "error": "..." }`; error validasi menambahkan `details`.

## Bot ping-pong

Pesan teks masuk `"ping"` dari chat mana pun otomatis dibalas `"pong"` pada sesi yang menerimanya. Pesan masuk tidak disimpan.

## UI Demo

Buka `http://localhost:<PORT>/demo`. Dashboard menyediakan:

- input API key (disimpan di localStorage),
- kartu ringkasan: status server + ping, sesi aktif, jeda anti-ban, total pesan,
- pengaturan jeda anti-ban dengan preset 10s / 30s / 1mnt / 2mnt atau rentang min–maks bebas (10–600 detik, acak per pesan),
- daftar sesi dalam kartu: status, nomor, pesan hari ini, QR/pairing, badge broadcast berjalan, tombol logout, dan hapus,
- panel customer (dashboard): cari, tambah, edit, hapus — daftar customer global,
- riwayat pengiriman gabungan semua sesi (dashboard) dengan filter per sesi,
- halaman per sesi di `#/session/<sessionId>` (hash routing, dari tombol "Kirim Pesan" di kartu sesi): header status, picker penerima dari daftar customer global (pilihan teringat per sesi), komposer broadcast dengan template `{nama}`, estimasi durasi, progres, hitung mundur, tombol batal, dan riwayat sesi tersebut.

File statis ada di `public/`, disajikan khusus di `/demo`.

## Breaking changes

- Endpoint lama `/status`, `/qr`, `/send`, `/login`, `/logout`, dan `/broadcast` dihapus. Gunakan endpoint `/sessions/*`.
- UI demo pindah dari `/` ke `/demo`. `GET /` sekarang hanya info service JSON.
- Auth pindah dari folder `data/auth/` ke SQLite, sekarang satu file `DB_PATH` (default `data/app.db`) bersama tabel customer, broadcast, dan log pesan. `AUTH_DB_PATH`/`APP_DB_PATH` dihapus; sesi lama perlu pairing ulang.
- Runtime minimal Node.js 24 karena memakai `node:sqlite`.
- Server tidak lagi otomatis login saat tanpa sesi; buat sesi lewat `POST /sessions`.
- Broadcast sekarang asinkron (`202 + jobId`) dan memakai `delayMinMs`/`delayMaxMs` (minimum **10 detik**), bukan `delayMs`.
- Broadcast menerima `customerIds` dan merender token `{nama}` per penerima. Teks per penerima disimpan di `broadcast_recipients.text`.
- Tabel `customers` (migrasi 3) ditambahkan untuk daftar nomor customer.
- `GET /sessions` menyertakan `sentToday`; `GET /sessions` tidak lagi hanya objek session mentah.
- Endpoint baru: `/customers`, `/stats`, `/messages` (riwayat gabungan).
- Broadcast tidak lagi hilang saat restart: job `running` dilanjutkan, penerima `sending` menjadi `failed (interrupted)`.
- QR tidak lagi dicetak ke terminal. QR tersedia lewat API/UI sebagai data-URL.
- Dependency `qrcode-terminal` dihapus.

## Di luar scope

Saran pengembangan berikut tidak dikerjakan di versi ini:

- Purge otomatis riwayat job broadcast lama (`message_log` sudah dipurge sesuai retensi).
- Penyimpanan isi atau metadata pesan masuk.
- Migrasi otomatis auth folder lama `data/auth/`.
- Auth per-user / multi-tenant.
- Sharding multi-instance (satu sesi hanya boleh dipegang satu proses).
- Webhook untuk status pengiriman atau pesan masuk.