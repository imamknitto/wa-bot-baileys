# API Contract — wa-bot-service

Kontrak HTTP API untuk `wa-bot-service`. Dokumen ini adalah acuan request/response; untuk setup, arsitektur, dan konsep sesi lihat [README.md](./README.md).

- Base URL: `http://localhost:<PORT>` (default `http://localhost:3000`)
- Format: JSON (`Content-Type: application/json` untuk request ber-body)
- Auth: header `x-api-key` wajib untuk `/sessions/*`, `/customers/*`, `/stats`, dan `/messages`; `GET /` publik
- Semua timestamp memakai epoch milliseconds

## Daftar isi

- [Konvensi](#konvensi)
- [Objek umum](#objek-umum)
- [Service](#service)
- [Sesi](#sesi)
- [Customer](#customer)
- [Pesan](#pesan)
- [Broadcast](#broadcast)
- [Statistik dan riwayat](#statistik-dan-riwayat)
- [Perilaku bot](#perilaku-bot)

## Konvensi

### Auth

```http
x-api-key: <API_KEY>
```

Nilai harus sama persis dengan env `API_KEY`. Request tanpa header atau dengan key salah menghasilkan `401`.

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
      "delayMinMs": { "errors": ["Too small: expected number to be >=30000"] }
    }
  }
}
```

### Status code yang dipakai

| Code  | Arti                                                              |
| ----- | ----------------------------------------------------------------- |
| `200` | Sukses sinkron                                                    |
| `201` | Resource baru dibuat (customer)                                   |
| `202` | Diterima; proses berjalan asinkron (buat sesi, mulai broadcast)   |
| `400` | Path/query/body tidak valid                                       |
| `401` | `x-api-key` tidak ada atau salah                                  |
| `404` | Sesi, job, atau customer tidak ditemukan                          |
| `409` | Konflik: sesi aktif, batas sesi, job masih berjalan, nomor duplikat |
| `500` | Kegagalan internal                                                |
| `502` | WhatsApp gagal mengirim pesan                                     |
| `503` | Sesi ada tetapi belum `connected`                                 |

### Batasan input

| Field        | Aturan                                                                 |
| ------------ | ---------------------------------------------------------------------- |
| `sessionId`  | `^[a-zA-Z0-9_-]{1,32}$` (huruf, angka, `_`, `-`; maksimal 32 karakter) |
| `jobId`      | UUID                                                                   |
| `to`         | 8–15 digit (otomatis menjadi `<digit>@s.whatsapp.net`) atau JID lengkap |
| `recipients` | 0–100 item, tiap item mengikuti aturan `to`                            |
| `customerIds` | 0–100 id customer; total `recipients` + `customerIds` maksimal 100    |
| `text`       | 1–4000 karakter                                                        |
| `delayMinMs` | Integer `10000`–`600000`, default `30000`                              |
| `delayMaxMs` | Integer `10000`–`600000`, default `60000`, harus `>= delayMinMs`       |
| `name`       | Nama customer, 1–100 karakter                                          |
| `phone`      | Nomor customer, 8–15 digit (disanitasi menjadi digit saja)             |
| `note`       | Catatan customer, maksimal 500 karakter, boleh `null`                  |
| `limit`      | Integer `1`–`100`, default `50`                                        |
| `cursor`     | Integer positif                                                        |

## Objek umum

### Session

```json
{
  "sessionId": "sales-1",
  "mode": "pairing",
  "status": "connecting",
  "connected": false,
  "me": null,
  "hasQr": false,
  "hasPairingCode": false,
  "pairingError": null
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

### Customer

```json
{
  "id": 1,
  "name": "Budi Santoso",
  "phone": "6281234567890",
  "note": "Hot lead",
  "createdAt": 1762829900000,
  "updatedAt": 1762829900000
}
```

| Field       | Tipe           | Keterangan                                      |
| ----------- | -------------- | ----------------------------------------------- |
| `id`        | number         | ID customer (auto increment)                    |
| `name`      | string         | Nama customer, 1–100 karakter                   |
| `phone`     | string         | Nomor WhatsApp digit-only, unik                 |
| `note`      | string \| null | Catatan bebas, maksimal 500 karakter            |

Customer bersifat global (lintas sesi). Daftar nomor ini dipakai sebagai penerima broadcast dan pencocokan nama di riwayat pengiriman.

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
      "ok": true,
      "messageId": "3EB0...",
      "sentAt": 1762829970000
    }
  ],
  "createdAt": 1762829969000,
  "delayMinMs": 30000,
  "delayMaxMs": 60000
}
```

| Field        | Tipe              | Keterangan                                                        |
| ------------ | ----------------- | ----------------------------------------------------------------- |
| `status`     | string            | `running` \| `completed` \| `cancelled` \| `failed`                |
| `total`      | number            | Jumlah penerima                                                   |
| `sent`       | number            | Penerima berstatus `sent`                                         |
| `failed`     | number            | Penerima berstatus `failed`                                       |
| `nextSendAt` | number \| null    | Jadwal kirim berikutnya; `null` saat sedang mengirim / job selesai |
| `results`    | array             | Hanya penerima `sent`/`failed`, urut posisi                       |
| `results[].ok` | boolean         | `true` untuk `sent`, `false` untuk `failed`                       |
| `results[].error` | string?      | Ada jika `ok === false`                                           |

Job `cancelled`/`failed` boleh memiliki `sent + failed < total` karena sisa penerima tidak diproses.

### Pesan (`message_log`)

```json
{
  "id": 42,
  "sessionId": "sales-1",
  "source": "broadcast",
  "to": "6281234567890@s.whatsapp.net",
  "text": "promo hari ini",
  "broadcastJobId": "0f3f9a4e-7c1d-4b2a-9e8f-1a2b3c4d5e6f",
  "messageId": "3EB0...",
  "status": "sent",
  "error": null,
  "createdAt": 1762829970000
}
```

| Field            | Tipe             | Keterangan                          |
| ---------------- | ---------------- | ----------------------------------- |
| `source`         | `send` \| `broadcast` | Asal pengiriman                |
| `status`         | `sent` \| `failed`    | Hasil percobaan kirim          |
| `broadcastJobId` | string \| null   | Terisi untuk sumber `broadcast`     |
| `messageId`      | string \| null   | `wa_message_id` dari Baileys        |

## Service

### `GET /`

Info service publik. Tidak memerlukan API key.

**Response `200`**

```json
{ "name": "wa-bot-service", "version": "1.0.0", "status": "ok" }
```

## Sesi

### `POST /sessions`

Membuat sesi baru dan mulai login. Jika `sessionId` sudah ada dan berstatus `connected`/`connecting`, atau jumlah sesi mencapai `MAX_SESSIONS`, respons `409`.

**Request**

```json
{
  "sessionId": "sales-1",
  "mode": "pairing",
  "phone": "6281234567890"
}
```

| Field       | Wajib | Keterangan                                                    |
| ----------- | ----- | ------------------------------------------------------------- |
| `sessionId` | ya    | Lihat [batasan input](#batasan-input)                         |
| `mode`      | tidak | `pairing` (default) atau `qr`                                 |
| `phone`     | pairing | 8–15 digit; disanitasi menjadi digit saja                   |

**Response `202`**

```json
{
  "ok": true,
  "sessionId": "sales-1",
  "mode": "pairing",
  "status": "connecting",
  "connected": false,
  "me": null,
  "hasQr": false,
  "hasPairingCode": false,
  "pairingError": null
}
```

**Error**

| Code  | Keterangan                          |
| ----- | ----------------------------------- |
| `400` | Body/field tidak valid              |
| `409` | Sesi aktif atau `MAX_SESSIONS` penuh |
| `500` | Gagal memulai sesi                  |

### `GET /sessions`

Daftar semua sesi yang ada di proses saat ini.

**Response `200`**

```json
{ "sessions": [ { "sessionId": "sales-1", "mode": "qr", "status": "connected", "connected": true, "me": "6281234567890:12@s.whatsapp.net", "hasQr": false, "hasPairingCode": false, "pairingError": null, "sentToday": 12 } ] }
```

`sentToday` adalah jumlah pesan keluar (direct send + broadcast) sesi tersebut sejak awal hari lokal.

**Error:** `401`.

### `GET /sessions/:id/status`

Status satu sesi. Bentuk objek sama dengan [Session](#session).

**Error:** `400` (`sessionId` invalid), `404` sesi tidak ada.

### `GET /sessions/:id/qr`

QR aktif untuk sesi mode `qr`, sebagai data-URL PNG.

**Response `200`**

```json
{ "qr": "data:image/png;base64,iVBORw0KGgo..." }
```

`{ "qr": null }` jika QR belum tersedia, sesi sudah terpasang, sudah logout, atau mode `pairing`.

**Error:** `400`, `404`.

### `GET /sessions/:id/pairing`

Kode pairing terakhir untuk sesi mode `pairing`.

**Response `200`**

```json
{ "pairingCode": "ABCD1234", "error": null }
```

- `pairingCode` bernilai `null` selama kode belum tersedia.
- `error` berisi pesan jika permintaan kode gagal.
- Permintaan kode dibatasi cooldown 60 detik per sesi.

**Error:** `400`, `404`.

### `POST /sessions/:id/logout`

Logout dari WhatsApp dan hapus auth sesi tersebut dari SQLite. Job broadcast yang berjalan ditandai `failed`.

**Response `200`**

```json
{ "ok": true, "sessionId": "sales-1", "status": "logged_out" }
```

**Error:** `400`, `404`.

### `DELETE /sessions/:id`

Logout jika perlu, hapus auth, dan hapus sesi dari manager. Job broadcast yang berjalan ditandai `failed`. Riwayat `message_log` dan job lama **tidak** dihapus.

**Response `200`**

```json
{ "ok": true, "sessionId": "sales-1" }
```

**Error:** `400`, `404`.

## Customer

Daftar nomor WhatsApp customer, global untuk semua sesi. Nomor disimpan sebagai digit saja dan unik.

### `GET /customers`

**Query**

| Param    | Default | Keterangan                                  |
| -------- | ------- | ------------------------------------------- |
| `q`      | –       | Cari pada nama atau nomor (substring)       |
| `limit`  | `50`    | 1–100                                       |
| `cursor` | –       | `id` terakhir dari halaman sebelumnya       |

**Response `200`**

```json
{
  "customers": [ { "id": 1, "name": "Budi Santoso", "phone": "6281234567890", "note": "Hot lead", "createdAt": 1762829900000, "updatedAt": 1762829900000 } ],
  "nextCursor": null
}
```

### `POST /customers`

**Request**

```json
{ "name": "Budi Santoso", "phone": "6281234567890", "note": "Hot lead" }
```

`note` opsional. Nomor duplikat menghasilkan `409`.

**Response `201`**

```json
{ "ok": true, "customer": { "id": 1, "name": "Budi Santoso", "phone": "6281234567890", "note": "Hot lead", "createdAt": 1762829900000, "updatedAt": 1762829900000 } }
```

### `PATCH /customers/:id`

Body boleh berisi sebagian field (`name`, `phone`, `note`). Minimal satu field.

**Response `200`**

```json
{ "ok": true, "customer": { "id": 1, "name": "Budi Santoso", "phone": "6281234567890", "note": null, "createdAt": 1762829900000, "updatedAt": 1762829950000 } }
```

**Error:** `400` (id/body invalid), `404` customer tidak ada, `409` nomor sudah dipakai customer lain.

### `DELETE /customers/:id`

**Response `200`**

```json
{ "ok": true, "id": 1 }
```

**Error:** `400`, `404`.

## Pesan

### `POST /sessions/:id/send`

Kirim satu pesan teks.

**Request**

```json
{ "to": "6281234567890", "text": "hello" }
```

| Field  | Wajib | Keterangan                                              |
| ------ | ----- | ------------------------------------------------------- |
| `to`   | ya    | Nomor 8–15 digit atau JID lengkap                        |
| `text` | ya    | Minimal 1 karakter                                      |

**Response `200`**

```json
{ "ok": true, "id": "3EB0..." }
```

Percobaan sukses/gagal dicatat ke `message_log` dengan `source: "send"`.

**Error**

| Code  | Keterangan             |
| ----- | ---------------------- |
| `400` | Validasi gagal         |
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
  "messages": [ { "id": 42, "sessionId": "sales-1", "source": "broadcast", "to": "6281234567890@s.whatsapp.net", "text": "promo hari ini", "broadcastJobId": "0f3f9a4e-7c1d-4b2a-9e8f-1a2b3c4d5e6f", "messageId": "3EB0...", "status": "sent", "error": null, "createdAt": 1762829970000 } ],
  "nextCursor": 21
}
```

`nextCursor` bernilai `null` jika tidak ada halaman berikutnya.

Baris lebih tua dari `LOG_RETENTION_DAYS` dibersihkan otomatis setiap 24 jam.

**Error:** `400` (query invalid), `404` (sesi tidak ada).

## Broadcast

### `POST /sessions/:id/broadcast`

Memulai job broadcast asinkron. Respons langsung `202`; pengiriman berjalan di background oleh scheduler.

**Request**

```json
{
  "customerIds": [1, 2],
  "recipients": ["6289876543210"],
  "text": "Halo {nama}, promo hari ini!",
  "delayMinMs": 30000,
  "delayMaxMs": 60000
}
```

| Field         | Wajib | Default | Keterangan                                          |
| ------------- | ----- | ------- | --------------------------------------------------- |
| `customerIds` | salah satu | –  | 0–100 id customer; nomor diambil dari daftar customer |
| `recipients`  | salah satu | –  | 0–100 nomor/JID tambahan di luar customer           |
| `text`        | ya    | –       | Isi pesan, 1–4000 karakter                          |
| `delayMinMs`  | tidak | `30000` | Minimal 10 detik                                    |
| `delayMaxMs`  | tidak | `60000` | Maksimum 600 detik, harus `>= delayMinMs`           |

Minimal salah satu dari `customerIds` atau `recipients` harus berisi data; total penerima maksimal 100. Nomor yang sama (setelah normalisasi JID) hanya dikirim sekali.

`{nama}` di dalam `text` diganti dengan nama customer untuk penerima yang berasal dari `customerIds`. Penerima nomor manual tidak punya nama, sehingga `{nama}` menjadi string kosong.

Jeda diambil acak baru untuk setiap penerima. Tidak ada delay sebelum penerima pertama dan setelah penerima terakhir.

**Response `202`**

```json
{ "ok": true, "jobId": "0f3f9a4e-7c1d-4b2a-9e8f-1a2b3c4d5e6f" }
```

**Error**

| Code  | Keterangan                              |
| ----- | --------------------------------------- |
| `400` | Validasi gagal                          |
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

### `GET /sessions/:id/broadcast/:jobId`

Status dan progres job. Bentuk response sama dengan [Broadcast job](#broadcast-job).

**Error:** `400` (`sessionId`/`jobId` invalid), `404` job tidak ada.

### `POST /sessions/:id/broadcast/:jobId/cancel`

Membatalkan job `running`. Delay langsung berhenti; jika ada pengiriman yang sedang in-flight, hasilnya tetap dicatat setelah selesai, tetapi tidak ada jadwal berikutnya.

**Response `200`**

```json
{ "ok": true, "jobId": "0f3f9a4e-7c1d-4b2a-9e8f-1a2b3c4d5e6f", "status": "cancelled" }
```

**Error**

| Code  | Keterangan                                  |
| ----- | ------------------------------------------- |
| `400` | `sessionId`/`jobId` invalid                 |
| `404` | Job tidak ada                               |
| `409` | Job sudah `completed`/`cancelled`/`failed`  |

## Statistik dan riwayat

### `GET /stats`

Ringkasan untuk dashboard.

**Response `200`**

```json
{
  "sessions": { "total": 4, "connected": 2 },
  "messages": { "total": 275, "today": 12 },
  "customers": 134
}
```

`messages.today` dihitung sejak awal hari lokal.

**Error:** `401`.

### `GET /messages`

Riwayat pesan keluar **semua sesi** (direct send + broadcast), terbaru dulu. Berbeda dari `GET /sessions/:id/messages` yang hanya satu sesi dan memakai cursor, endpoint ini memakai `limit`.

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
      "sessionId": "sales-1",
      "source": "broadcast",
      "to": "6281234567890@s.whatsapp.net",
      "customerName": "Budi Santoso",
      "text": "Halo Budi, promo hari ini!",
      "status": "sent",
      "error": null,
      "createdAt": 1762829970000
    }
  ]
}
```

`customerName` diisi jika nomor penerima cocok dengan `customers.phone`, selain itu `null`.

**Error:** `400` (query invalid), `401`.

### `DELETE /messages/:id`

Hapus satu baris riwayat dari `message_log`. Hanya menghapus catatan di database; pesan yang sudah terkirim di WhatsApp tidak terpengaruh.

**Response `200`**

```json
{ "ok": true, "id": 42 }
```

**Error:** `400` (id invalid), `401`, `404` (pesan tidak ada).

## Perilaku bot

Pesan teks masuk `"ping"` dari chat mana pun otomatis dibalas `"pong"` oleh sesi yang menerimanya. Pesan masuk tidak disimpan ke database.