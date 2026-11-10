# wa-bot-service

WhatsApp bot service minimal memakai [Hono](https://hono.dev) + [Baileys](https://github.com/WhiskeySockets/Baileys).

## Setup

```bash
npm install
cp .env.example .env   # set API_KEY dan PORT
npm run dev
```

Saat pertama kali dijalankan, QR code muncul di terminal dan di UI demo. Scan dengan WhatsApp → *Settings* → *Linked devices*. Setelah terpasang, auth state tersimpan di `data/auth` sehingga restart tidak perlu scan lagi. Logout (via API/UI atau dari HP) otomatis menghapus `data/auth`; panggil `POST /login` untuk pairing ulang tanpa restart.

Semua endpoint memerlukan header `x-api-key` yang cocok dengan `API_KEY` di `.env`.

## UI Demo

Buka `http://localhost:<PORT>` di browser. UI demo menyediakan: input API key (disimpan di localStorage), status koneksi, QR pairing, toggle login/logout, form kirim pesan, dan form broadcast (nomor tujuan, isi pesan, delay antar pesan). File statis ada di `public/`.

## API

### `GET /status`

Status koneksi WhatsApp.

```bash
curl -H "x-api-key: <API_KEY>" http://localhost:3000/status
```

```json
{ "status": "connected", "connected": true }
```

`status`: `connecting` | `connected` | `disconnected` | `logged_out`

### `GET /qr`

QR pairing sebagai data-URL PNG untuk UI demo. Mengembalikan `{ "qr": null }` jika tidak ada QR aktif (sudah terpasang atau logged out). QR diperbarui otomatis oleh Baileys setiap kedaluwarsa.

```bash
curl -H "x-api-key: <API_KEY>" http://localhost:3000/qr
```

```json
{ "qr": "data:image/png;base64,iVBORw0KGgo..." }
```

### `POST /send`

Kirim pesan teks.

```bash
curl -X POST http://localhost:3000/send \
  -H "x-api-key: <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"to": "6281234567890", "text": "hello"}'
```

| Field | Tipe   | Keterangan                                                             |
| ----- | ------ | ---------------------------------------------------------------------- |
| `to`  | string | Nomor tujuan (format `62xxx`, otomatis diberi akhiran `@s.whatsapp.net`) atau JID lengkap |
| `text`| string | Isi pesan, minimal 1 karakter                                          |

Sukses:

```json
{ "ok": true, "id": "3EB0B430B6F8BEH20C7FAD25" }
```

Error:

| Kode | Penyebab                                    |
| ---- | ------------------------------------------- |
| 400  | Body bukan JSON valid atau gagal validasi   |
| 401  | Header `x-api-key` hilang / salah           |
| 503  | WhatsApp belum terhubung                    |
| 502  | Gagal mengirim (mis. nomor tidak terdaftar) |

### `POST /login`

Mulai pairing (buat socket baru + tampilkan QR). Gagal 409 jika sudah `connected`/`connecting`. Dipanggil otomatis saat server start.

```bash
curl -X POST -H "x-api-key: <API_KEY>" http://localhost:3000/login
```

```json
{ "ok": true, "status": "connecting" }
```

### `POST /logout`

Logout dari WhatsApp dan hapus `data/auth`. Untuk pairing ulang, panggil `POST /login` (atau tombol *Mulai Pairing* di UI).

```bash
curl -X POST -H "x-api-key: <API_KEY>" http://localhost:3000/logout
```

```json
{ "ok": true, "status": "logged_out" }
```

### `POST /broadcast`

Kirim pesan yang sama ke banyak nomor, satu per satu dengan delay antar pesan untuk meniru perilaku manusia.

```bash
curl -X POST http://localhost:3000/broadcast \
  -H "x-api-key: <API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"recipients": ["6281234567890", "6289876543210"], "text": "promo hari ini", "delayMs": 3000}'
```

| Field        | Tipe     | Keterangan                                        |
| ------------ | -------- | ------------------------------------------------- |
| `recipients` | string[] | 1–100 nomor/JID                                   |
| `text`       | string   | Isi pesan                                         |
| `delayMs`    | number   | Jeda antar kirim, default 3000, min 1000, max 600000 |

Sukses:

```json
{ "ok": true, "sent": 2, "failed": 0, "disconnected": false, "results": [{ "to": "6281234567890", "ok": true }] }
```

Request berjalan lama (total ≈ `delayMs × (jumlah penerima − 1)`); respons dikembalikan setelah semua selesai dengan rekap per nomor. Delay terlalu pendek berisiko diblokir WhatsApp.

### Bot ping-pong

Pesan teks masuk `"ping"` dari chat mana pun otomatis dibalas `"pong"`.
