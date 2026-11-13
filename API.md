# API Contract — wa-bot-service

Kontrak HTTP API untuk `wa-bot-service`. Dokumen ini adalah acuan request/response; untuk setup, arsitektur, dan konsep sesi lihat [README.md](./README.md).

- Base URL: `http://localhost:<PORT>` (default `http://localhost:8365`)
- Format: JSON (`Content-Type: application/json` untuk request ber-body)
- Auth: `x-api-key` (admin) atau `Authorization: Bearer <token sesi>` untuk `/sessions/*`; `/stats` dan `/messages` hanya `x-api-key`; `GET /` publik
- Semua timestamp memakai epoch milliseconds

## Daftar isi

- [Konvensi](#konvensi)
- [Objek umum](#objek-umum)
- [Service](#service)
- [Sesi](#sesi)
- [Pesan](#pesan)
- [Broadcast](#broadcast)
- [Statistik dan riwayat](#statistik-dan-riwayat)
- [Webhook](#webhook)
- [Perilaku bot](#perilaku-bot)

## Konvensi

### Auth

Service ini punya dua tingkat akses.

**Admin** — dipakai backend aplikasi remarketing:

```http
x-api-key: <API_KEY>
```

**Sales** — token milik satu sesi, dikembalikan sekali oleh `POST /sessions` atau `POST /sessions/:id/token`:

```http
Authorization: Bearer <token>
```

Aturan:

- Token sales hanya berlaku untuk sesi pemiliknya. Memanggil `/sessions/<id-lain>/*` menghasilkan `403` (bukan `404`), sehingga keberadaan sesi lain tidak bocor.
- Endpoint lifecycle sesi (`POST /sessions`, `POST /sessions/:id/token`, `POST /sessions/:id/logout`, `DELETE /sessions/:id`) hanya menerima `x-api-key`. Token sales ditolak `403`.
- `GET /sessions` menerima keduanya: admin melihat semua sesi, token sales hanya melihat sesinya sendiri.
- `GET /stats` dan `/messages` hanya menerima `x-api-key`.
- Token disimpan sebagai hash SHA-256. Plaintext tidak bisa diambil ulang; putar token dengan `POST /sessions/:id/token`.
- Logout dan delete sesi mem-revoke semua token sesi tersebut.

### Bentuk error

Semua error memakai bentuk berikut:

```json
{ "error": "Pesan error" }
```

Error validasi menambahkan `details` dari Zod:

```json
{
  "error": "Validation failed",
  "details": {
    "errors": [],
    "properties": {
      "delayMinMs": { "errors": ["Too small: expected number to be >=10000"] }
    }
  }
}
```

### Status code yang dipakai

| Code  | Arti                                                                |
| ----- | ------------------------------------------------------------------- |
| `200` | Sukses sinkron                                                      |
| `202` | Diterima; proses berjalan asinkron (buat sesi, mulai broadcast)     |
| `400` | Path/query/body tidak valid                                         |
| `401` | Kredensial tidak ada atau salah                                      |
| `403` | Kredensial valid tetapi tidak berhak atas resource tersebut          |
| `404` | Sesi, job, atau pesan tidak ditemukan                               |
| `409` | Konflik: sesi aktif, batas sesi, job masih berjalan, sesi milik sales lain |
| `500` | Kegagalan internal                                                  |
| `502` | WhatsApp gagal mengirim pesan                                       |
| `503` | Sesi ada tetapi belum `connected`                                   |

### Batasan input

| Field                  | Aturan                                                                 |
| ---------------------- | ---------------------------------------------------------------------- |
| `sessionId`            | `^[a-zA-Z0-9_-]{1,32}$` (huruf, angka, `_`, `-`; maksimal 32 karakter) |
| `salesId`              | 1–64 karakter, wajib saat membuat sesi                                 |
| `agentId`              | 1–64 karakter, opsional                                                |
| `jobId`                | UUID                                                                   |
| `to`                   | 8–15 digit (otomatis menjadi `<digit>@s.whatsapp.net`) atau JID lengkap |
| `recipients`           | 1–100 item untuk broadcast                                             |
| `customerId`           | String 1–128 karakter; ID customer di aplikasi remarketing             |
| `customerName`/`name`  | 1–100 karakter                                                         |
| `referenceId`          | String 1–128 karakter, unik per sesi                                   |
| `text`                 | 1–4000 karakter                                                        |
| `delayMinMs`           | Integer `10000`–`600000`, default `30000`                              |
| `delayMaxMs`           | Integer `10000`–`600000`, default `60000`, harus `>= delayMinMs`       |
| `limit`                | Integer `1`–`100`, default `50`                                        |
| `cursor`               | Integer positif                                                        |

## Objek umum

### Session

```json
{
  "sessionId": "sales-12",
  "mode": "pairing",
  "status": "connecting",
  "connected": false,
  "me": null,
  "hasQr": false,
  "hasPairingCode": false,
  "pairingError": null,
  "salesId": "S-12",
  "agentId": "A-3"
}
```

| Field            | Tipe             | Keterangan                                                        |
| ---------------- | ---------------- | ----------------------------------------------------------------- |
| `sessionId`      | string           | ID sesi                                                           |
| `mode`           | `pairing` \| `qr`| Mode login terakhir                                               |
| `status`         | string           | `connecting` \| `connected` \| `disconnected` \| `logged_out`     |
| `connected`      | boolean          | `true` hanya jika `status === "connected"`                        |
| `me`             | string \| null   | JID akun WhatsApp yang terpasang                                  |
| `hasQr`          | boolean          | Ada QR aktif yang bisa diambil                                    |
| `hasPairingCode` | boolean          | Ada kode pairing yang bisa diambil                                |
| `pairingError`   | string \| null   | Pesan error terakhir saat meminta kode pairing                    |
| `salesId`        | string \| null   | Pemilik sesi (dari `session_meta`)                                |
| `agentId`        | string \| null   | Agent terkait, opsional                                           |

### Broadcast job

```json
{
  "jobId": "0f3f9a4e-7c1d-4b2a-9e8f-1a2b3c4d5e6f",
  "status": "running",
  "total": 3,
  "sent": 1,
  "failed": 0,
  "nextSendAt": 1762830000000,
  "results": [
    {
      "to": "6281234567890@s.whatsapp.net",
      "customerId": "CUST-991",
      "customerName": "Budi",
      "ok": true,
      "messageId": "3EB0...",
      "sentAt": 1762829970000
    }
  ],
  "createdAt": 1762829969000,
  "delayMinMs": 30000,
  "delayMaxMs": 60000,
  "referenceId": "job-abc-123",
  "error": null
}
```

| Field             | Tipe              | Keterangan                                                        |
| ----------------- | ----------------- | ----------------------------------------------------------------- |
| `status`          | string            | `running` \| `completed` \| `cancelled` \| `failed`                |
| `total`           | number            | Jumlah penerima                                                   |
| `sent`            | number            | Penerima berstatus `sent`                                         |
| `failed`          | number            | Penerima berstatus `failed`                                       |
| `nextSendAt`      | number \| null    | Jadwal kirim berikutnya; `null` saat sedang mengirim / job selesai |
| `results`         | array             | Hanya penerima `sent`/`failed`, urut posisi                       |
| `results[].customerId` | string \| null | `customerId` yang dikirim saat membuat job                      |
| `results[].ok`    | boolean           | `true` untuk `sent`, `false` untuk `failed`                       |
| `results[].error` | string?           | Ada jika `ok === false`                                           |
| `referenceId`     | string \| null    | Idempotency key job bila dikirim                                  |
| `error`           | string \| null    | Alasan job `failed`                                               |

Job `cancelled`/`failed` boleh memiliki `sent + failed < total` karena sisa penerima tidak diproses.

### Pesan (`message_log`)

```json
{
  "id": 42,
  "sessionId": "sales-12",
  "source": "broadcast",
  "to": "6281234567890@s.whatsapp.net",
  "text": "promo hari ini",
  "broadcastJobId": "0f3f9a4e-7c1d-4b2a-9e8f-1a2b3c4d5e6f",
  "messageId": "3EB0...",
  "status": "sent",
  "error": null,
  "createdAt": 1762829970000,
  "salesId": "S-12",
  "agentId": "A-3",
  "customerId": "CUST-991",
  "customerName": "Budi",
  "referenceId": "msg-abc-123"
}
```

| Field            | Tipe             | Keterangan                          |
| ---------------- | ---------------- | ----------------------------------- |
| `source`         | `send` \| `broadcast` | Asal pengiriman                |
| `status`         | `sent` \| `failed`    | Hasil percobaan kirim          |
| `broadcastJobId` | string \| null   | Terisi untuk sumber `broadcast`     |
| `messageId`      | string \| null   | `wa_message_id` dari Baileys        |
| `customerId`     | string \| null   | `customerId` dari request           |
| `customerName`   | string \| null   | `customerName`/`name` dari request  |
| `referenceId`    | string \| null   | Idempotency key pengiriman          |

## Service

### `GET /`

Info service publik. Tidak memerlukan API key.

**Response `200`**

```json
{ "name": "wa-bot-service", "version": "1.0.0", "status": "ok" }
```

## Sesi

### `POST /sessions`

Admin only. Membuat sesi baru, mengikatnya ke satu sales, menerbitkan token akses, dan mulai login.

Jika `sessionId` sudah ada dan berstatus `connected`/`connecting`, atau jumlah sesi mencapai `MAX_SESSIONS`, respons `409`. Jika `sessionId` sudah dimiliki `salesId` lain, respons `409`.

**Request**

```json
{
  "salesId": "S-12",
  "agentId": "A-3",
  "sessionId": "sales-12",
  "mode": "pairing",
  "phone": "6281234567890"
}
```

| Field       | Wajib | Keterangan                                                        |
| ----------- | ----- | ----------------------------------------------------------------- |
| `salesId`   | ya    | ID sales di aplikasi remarketing                                  |
| `agentId`   | tidak | ID agent, disimpan untuk audit webhook                             |
| `sessionId` | tidak | Default = `salesId`. Lihat [batasan input](#batasan-input)         |
| `mode`      | tidak | `pairing` (default) atau `qr`                                     |
| `phone`     | pairing | 8–15 digit; disanitasi menjadi digit saja                       |

**Response `202`**

```json
{
  "ok": true,
  "sessionId": "sales-12",
  "mode": "pairing",
  "status": "connecting",
  "connected": false,
  "me": null,
  "hasQr": false,
  "hasPairingCode": false,
  "pairingError": null,
  "salesId": "S-12",
  "agentId": "A-3",
  "createdAt": 1762829900000,
  "token": "8Kd2...base64url"
}
```

`token` hanya dikembalikan di respons ini. Simpan di aplikasi remarketing dan kirim sebagai `Authorization: Bearer <token>` untuk request atas nama sales tersebut.

**Error**

| Code  | Keterangan                                   |
| ----- | -------------------------------------------- |
| `400` | Body/field tidak valid                       |
| `401` | `x-api-key` salah atau tidak ada             |
| `403` | Memakai token sales (bukan admin)            |
| `409` | Sesi aktif, `MAX_SESSIONS` penuh, atau sesi milik sales lain |
| `500` | Gagal memulai sesi                           |

### `GET /sessions`

Admin melihat semua sesi; token sales hanya melihat sesinya sendiri.

**Response `200`**

```json
{
  "sessions": [
    {
      "sessionId": "sales-12",
      "mode": "qr",
      "status": "connected",
      "connected": true,
      "me": "6281234567890:12@s.whatsapp.net",
      "hasQr": false,
      "hasPairingCode": false,
      "pairingError": null,
      "salesId": "S-12",
      "agentId": "A-3",
      "sentToday": 12
    }
  ]
}
```

`sentToday` adalah jumlah pesan keluar (direct send + broadcast) sesi tersebut sejak awal hari lokal.

**Error:** `401`.

### `POST /sessions/:id/token`

Admin only. Memutar token sesi. Token lama langsung tidak berlaku.

**Response `200`**

```json
{ "ok": true, "sessionId": "sales-12", "token": "8Kd2...base64url" }
```

**Error:** `400`, `401`, `403`, `404`.

### `GET /sessions/:id/status`

Status satu sesi. Bentuk objek sama dengan [Session](#session).

**Error:** `400` (`sessionId` invalid), `401`, `403` (token milik sesi lain), `404`.

### `GET /sessions/:id/qr`

QR aktif untuk sesi mode `qr`, sebagai data-URL PNG.

**Response `200`**

```json
{ "qr": "data:image/png;base64,iVBORw0KGgo..." }
```

`{ "qr": null }` jika QR belum tersedia, sesi sudah terpasang, sudah logout, atau mode `pairing`.

**Error:** `400`, `401`, `403`, `404`.

### `GET /sessions/:id/pairing`

Kode pairing terakhir untuk sesi mode `pairing`.

**Response `200`**

```json
{ "pairingCode": "ABCD1234", "error": null }
```

- `pairingCode` bernilai `null` selama kode belum tersedia.
- `error` berisi pesan jika permintaan kode gagal.
- Permintaan kode dibatasi cooldown 60 detik per sesi.

**Error:** `400`, `401`, `403`, `404`.

### `POST /sessions/:id/logout`

Admin only. Logout dari WhatsApp, hapus auth sesi dari SQLite, dan revoke semua token sesi. Job broadcast yang berjalan ditandai `failed`.

**Response `200`**

```json
{ "ok": true, "sessionId": "sales-12", "status": "logged_out" }
```

**Error:** `400`, `401`, `403`, `404`.

### `DELETE /sessions/:id`

Admin only. Logout jika perlu, hapus auth, hapus `session_meta`, revoke token, dan hapus sesi dari manager. Job broadcast yang berjalan ditandai `failed`. Riwayat `message_log` dan job lama **tidak** dihapus.

**Response `200`**

```json
{ "ok": true, "sessionId": "sales-12" }
```

**Error:** `400`, `401`, `403`, `404`.

## Pesan

### `POST /sessions/:id/send`

Kirim satu pesan teks. Service tidak menyimpan customer; data penerima dikirim inline.

**Request**

```json
{
  "to": "6281234567890",
  "text": "Halo Budi, pesanan Anda sudah dikirim.",
  "customerId": "CUST-991",
  "customerName": "Budi",
  "referenceId": "msg-abc-123"
}
```

| Field          | Wajib | Keterangan                                                      |
| -------------- | ----- | --------------------------------------------------------------- |
| `to`           | ya    | Nomor 8–15 digit atau JID lengkap                                |
| `text`         | ya    | 1–4000 karakter, dikirim apa adanya                              |
| `customerId`   | tidak | ID customer di aplikasi remarketing, disimpan sebagai referensi  |
| `customerName` | tidak | Nama penerima untuk riwayat dan webhook                          |
| `referenceId`  | tidak | Idempotency key per sesi                                         |

**Response `200`**

```json
{ "ok": true, "id": "3EB0...", "referenceId": "msg-abc-123" }
```

Jika `referenceId` sudah pernah dipakai di sesi yang sama, service **tidak** mengirim ulang:

```json
{
  "ok": true,
  "id": "3EB0...",
  "referenceId": "msg-abc-123",
  "status": "sent",
  "duplicate": true
}
```

Percobaan sukses/gagal dicatat ke `message_log` dengan `source: "send"`, beserta `salesId`/`agentId` dari `session_meta`. Webhook `message.sent` atau `message.failed` diantrekan untuk setiap percobaan baru.

**Error**

| Code  | Keterangan             |
| ----- | ---------------------- |
| `400` | Validasi gagal         |
| `401` | Kredensial tidak ada/salah |
| `403` | Token milik sesi lain  |
| `404` | Sesi tidak ada         |
| `502` | WhatsApp gagal kirim   |
| `503` | Sesi belum `connected` |

### `GET /sessions/:id/messages`

Riwayat pesan **keluar** (direct send dan broadcast), terbaru dulu. Pesan masuk tidak disimpan.

**Query**

| Param    | Default | Keterangan                                            |
| -------- | ------- | ----------------------------------------------------- |
| `limit`  | `50`    | 1–100                                                 |
| `cursor` | –       | `id` terakhir dari halaman sebelumnya (pagination)    |

**Response `200`**

```json
{
  "messages": [ { "id": 42, "sessionId": "sales-12", "source": "broadcast", "to": "6281234567890@s.whatsapp.net", "text": "promo hari ini", "broadcastJobId": "0f3f9a4e-7c1d-4b2a-9e8f-1a2b3c4d5e6f", "messageId": "3EB0...", "status": "sent", "error": null, "createdAt": 1762829970000, "salesId": "S-12", "agentId": "A-3", "customerId": "CUST-991", "customerName": "Budi", "referenceId": "msg-abc-123" } ],
  "nextCursor": 21
}
```

`nextCursor` bernilai `null` jika tidak ada halaman berikutnya.

Baris lebih tua dari `LOG_RETENTION_DAYS` dibersihkan otomatis setiap 24 jam.

**Error:** `400` (query invalid), `401`, `403`, `404`.

## Broadcast

### `POST /sessions/:id/broadcast`

Memulai job broadcast asinkron. Respons langsung `202`; pengiriman berjalan di background oleh scheduler.

**Request**

```json
{
  "recipients": [
    { "to": "6281234567890", "customerId": "CUST-991", "name": "Budi" },
    { "to": "6289876543210", "customerId": "CUST-992", "name": "Sinta", "text": "Halo Sinta, promo khusus untukmu!" }
  ],
  "text": "Halo, ada promo khusus hari ini!",
  "delayMinMs": 30000,
  "delayMaxMs": 60000,
  "referenceId": "job-abc-123"
}
```

| Field         | Wajib | Default | Keterangan                                                     |
| ------------- | ----- | ------- | -------------------------------------------------------------- |
| `recipients`  | ya    | –       | 1–100 penerima; tiap item punya `to` wajib                     |
| `recipients[].to` | ya | –      | Nomor/JID penerima                                             |
| `recipients[].customerId` | tidak | – | ID customer di aplikasi remarketing                      |
| `recipients[].name` | tidak | –   | Nama penerima untuk riwayat/webhook                            |
| `recipients[].text` | tidak | –   | Override teks untuk penerima ini                               |
| `text`        | ya    | –       | Teks default, 1–4000 karakter                                  |
| `delayMinMs`  | tidak | `30000` | Minimal 10 detik                                               |
| `delayMaxMs`  | tidak | `60000` | Maksimum 600 detik, harus `>= delayMinMs`                      |
| `referenceId` | tidak | –       | Idempotency key per sesi                                       |

Tidak ada rendering template: `text` dikirim apa adanya. Nomor yang sama (setelah normalisasi JID) hanya dikirim sekali; penerima duplikat diabaikan.

Jeda diambil acak baru untuk setiap penerima. Tidak ada delay sebelum penerima pertama dan setelah penerima terakhir.

**Response `202`**

```json
{ "ok": true, "jobId": "0f3f9a4e-7c1d-4b2a-9e8f-1a2b3c4d5e6f", "referenceId": "job-abc-123" }
```

Jika `referenceId` sudah pernah dipakai di sesi yang sama, respons memakai job lama:

```json
{
  "ok": true,
  "jobId": "0f3f9a4e-7c1d-4b2a-9e8f-1a2b3c4d5e6f",
  "referenceId": "job-abc-123",
  "duplicate": true,
  "status": "running"
}
```

**Error**

| Code  | Keterangan                              |
| ----- | --------------------------------------- |
| `400` | Validasi gagal                          |
| `401` | Kredensial tidak ada/salah              |
| `403` | Token milik sesi lain                   |
| `404` | Sesi tidak ada                          |
| `409` | Masih ada job `running` untuk sesi ini  |
| `500` | Gagal membuat job                       |
| `503` | Sesi belum `connected`                  |

**Semantik job**

- Hanya satu job `running` per sesi (dijamin partial unique index di SQLite).
- Job dan status per penerima persisten; job `running` dilanjutkan setelah server restart.
- At-most-once: status `sending` ditulis sebelum kirim. Penerima yang masih `sending` saat proses mati menjadi `failed` dengan error `interrupted` dan **tidak** dikirim ulang.
- Setelah restart, penerima `pending` dijadwalkan ulang dari waktu start dengan jeda acak baru.
- Jika sesi terputus/logout/dihapus, job menjadi `failed` dan penerima `pending` menjadi `cancelled`.
- Setiap percobaan kirim dicatat di `message_log` dengan `source: "broadcast"`.
- Saat job selesai/gagal/dibatalkan, satu webhook `broadcast.*` diantrekan berisi `results[]` final.

### `GET /sessions/:id/broadcast/current`

Job `running` untuk sesi ini beserta progresnya.

**Response `200`**: bentuk sama dengan [Broadcast job](#broadcast-job).

**Error:** `400`, `401`, `403`, `404` (tidak ada job berjalan).

### `GET /sessions/:id/broadcast/:jobId`

Status dan progres job. Bentuk response sama dengan [Broadcast job](#broadcast-job).

**Error:** `400` (`sessionId`/`jobId` invalid), `401`, `403`, `404` job tidak ada.

### `POST /sessions/:id/broadcast/:jobId/cancel`

Membatalkan job `running`. Delay langsung berhenti; jika ada pengiriman yang sedang in-flight, hasilnya tetap dicatat setelah selesai, tetapi tidak ada jadwal berikutnya. Webhook `broadcast.cancelled` diantrekan.

**Response `200`**

```json
{ "ok": true, "jobId": "0f3f9a4e-7c1d-4b2a-9e8f-1a2b3c4d5e6f", "status": "cancelled" }
```

**Error**

| Code  | Keterangan                                  |
| ----- | ------------------------------------------- |
| `400` | `sessionId`/`jobId` invalid                 |
| `401` | Kredensial tidak ada/salah                  |
| `403` | Token milik sesi lain                       |
| `404` | Job tidak ada                               |
| `409` | Job sudah `completed`/`cancelled`/`failed`  |

## Statistik dan riwayat

### `GET /stats`

Admin only. Ringkasan untuk dashboard.

**Response `200`**

```json
{
  "sessions": { "total": 4, "connected": 2 },
  "messages": { "total": 275, "today": 12 }
}
```

`messages.today` dihitung sejak awal hari lokal. Data customer tidak lagi tersedia di service ini.

**Error:** `401`.

### `GET /messages`

Admin only. Riwayat pesan keluar **semua sesi** (direct send + broadcast), terbaru dulu.

**Query**

| Param       | Default | Keterangan                          |
| ----------- | ------- | ----------------------------------- |
| `limit`     | `20`    | 1–100                               |
| `sessionId` | –       | Filter satu sesi                    |

**Response `200`**

```json
{
  "messages": [
    {
      "id": 42,
      "sessionId": "sales-12",
      "source": "broadcast",
      "to": "6281234567890@s.whatsapp.net",
      "salesId": "S-12",
      "customerId": "CUST-991",
      "customerName": "Budi",
      "text": "Halo Budi, promo hari ini!",
      "status": "sent",
      "error": null,
      "createdAt": 1762829970000
    }
  ]
}
```

`customerName` diisi dari `customerName`/`name` yang dikirim saat request; `null` jika tidak dikirim.

**Error:** `400` (query invalid), `401`.

### `DELETE /messages/:id`

Hapus satu baris riwayat dari `message_log`. Hanya menghapus catatan di database; pesan yang sudah terkirim di WhatsApp tidak terpengaruh.

**Response `200`**

```json
{ "ok": true, "id": 42 }
```

**Error:** `400` (id invalid), `401`, `404` (pesan tidak ada).

## Webhook

Service mengirim webhook ke `WEBHOOK_URL` bila env tersebut diset. Event diantrekan di tabel `webhook_events` dan dikirim oleh dispatcher setiap 2 detik, sehingga tidak memperlambat pengiriman WhatsApp.

### Header

```http
POST <WEBHOOK_URL>
Content-Type: application/json
x-wa-event: message.sent
x-wa-event-id: 1f4d3c2b-...
x-wa-timestamp: 1762830000000
x-wa-signature: sha256=9c1f...
```

| Header           | Keterangan                                                     |
| ---------------- | -------------------------------------------------------------- |
| `x-wa-event`     | Tipe event                                                     |
| `x-wa-event-id`  | UUID unik event; pakai sebagai idempotency key di penerima     |
| `x-wa-timestamp` | Epoch ms saat pengiriman                                       |
| `x-wa-signature` | `sha256=` + HMAC-SHA256(`WEBHOOK_SECRET`, `"<timestamp>.<raw body>"`) |

Penerima **wajib** memverifikasi `x-wa-signature` memakai raw body (bukan hasil parse-ulang) dan menolak request dengan timestamp terlalu jauh (mis. > 5 menit).

### Event per pesan

`message.sent` dan `message.failed` dikirim untuk setiap panggilan `POST /sessions/:id/send` yang bukan duplikat.

```json
{
  "eventId": "1f4d3c2b-...",
  "type": "message.sent",
  "occurredAt": 1762830000000,
  "salesId": "S-12",
  "agentId": "A-3",
  "sessionId": "sales-12",
  "referenceId": "msg-abc-123",
  "customerId": "CUST-991",
  "customerName": "Budi",
  "to": "6281234567890@s.whatsapp.net",
  "text": "Halo Budi, pesanan Anda sudah dikirim.",
  "messageId": "3EB0...",
  "status": "sent"
}
```

Pada `message.failed`, `messageId` bernilai `null` dan ada field `error`.

### Event per job broadcast

`broadcast.completed`, `broadcast.failed`, dan `broadcast.cancelled` dikirim sekali saat job berakhir, membawa rekap per penerima.

```json
{
  "eventId": "6a1b2c3d-...",
  "type": "broadcast.completed",
  "occurredAt": 1762830100000,
  "salesId": "S-12",
  "agentId": "A-3",
  "sessionId": "sales-12",
  "referenceId": "job-abc-123",
  "jobId": "0f3f9a4e-7c1d-4b2a-9e8f-1a2b3c4d5e6f",
  "status": "completed",
  "total": 2,
  "sent": 1,
  "failed": 1,
  "results": [
    {
      "customerId": "CUST-991",
      "customerName": "Budi",
      "to": "6281234567890@s.whatsapp.net",
      "ok": true,
      "messageId": "3EB0...",
      "sentAt": 1762829970000
    },
    {
      "customerId": "CUST-992",
      "customerName": "Sinta",
      "to": "6289876543210@s.whatsapp.net",
      "ok": false,
      "error": "not-authorized",
      "sentAt": 1762830030000
    }
  ]
}
```

`status` pada payload job bernilai `completed`, `failed`, atau `cancelled`; tipe event selalu `broadcast.<status>`. Pada job `failed`/`cancelled`, `sent + failed` bisa lebih kecil dari `total`. Field `error` hanya ada pada job `failed`.

### Retry dan retensi

- Respons non-2xx atau timeout 10 detik dianggap gagal.
- Retry exponential: 5s, 25s, 125s, 625s, maksimal `WEBHOOK_MAX_ATTEMPTS` percobaan (default 5).
- Setelah batas tercapai, baris menjadi `failed` dengan `last_error`.
- Baris `delivered`/`failed` dibersihkan setelah `WEBHOOK_RETENTION_DAYS` (default 7 hari).
- Karena retry bersifat at-least-once, penerima harus idempotent terhadap `x-wa-event-id`.

## Perilaku bot

Pesan teks masuk `"ping"` dari chat mana pun otomatis dibalas `"pong"` oleh sesi yang menerimanya. Pesan masuk tidak disimpan ke database.
