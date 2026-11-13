import { useState, type FormEvent, type ReactNode } from 'react'
import { Send } from 'lucide-react'
import { Card, CardHeader, ErrorBanner, SuccessBanner } from '~/components/ui'
import { api } from '~/lib/api'
import type { SendResult } from '~/lib/types'
import { phoneFromJid } from '~/lib/format'

export function KirimTab({ sessionId }: { sessionId: string }): ReactNode {
  const [to, setTo] = useState('')
  const [text, setText] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [customerName, setCustomerName] = useState('')
  const [referenceId, setReferenceId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!to.trim() || !text.trim()) {
      setError('Nomor tujuan dan isi pesan wajib diisi.')
      return
    }
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const res = await api<SendResult>(`/sessions/${sessionId}/send`, {
        method: 'POST',
        body: JSON.stringify({
          to: to.trim(),
          text: text.trim(),
          ...(customerId.trim() ? { customerId: customerId.trim() } : {}),
          ...(customerName.trim() ? { customerName: customerName.trim() } : {}),
          ...(referenceId.trim() ? { referenceId: referenceId.trim() } : {}),
        }),
      })
      setResult(
        res.duplicate
          ? `Request duplikat — pesan sudah pernah dikirim (status: ${res.status}).`
          : res.ok
            ? `Pesan terkirim ke ${phoneFromJid(to.trim())}.`
            : 'Pesan gagal dikirim.',
      )
      setText('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengirim pesan.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Kirim pesan"
        description="Pesan dikirim apa adanya sebagai teks biasa, tanpa template."
      />
      <form onSubmit={submit} noValidate className="space-y-4 px-5 py-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="to">
              Nomor tujuan
            </label>
            <input
              id="to"
              className="input"
              inputMode="numeric"
              placeholder="6281234567890"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="referenceId">
              Reference ID (opsional)
            </label>
            <input
              id="referenceId"
              className="input"
              placeholder="order-991"
              value={referenceId}
              onChange={(event) => setReferenceId(event.target.value)}
            />
            <p className="mt-1 text-xs text-slate-400">
              Untuk idempotency: request dengan reference ID sama tidak mengirim ulang.
            </p>
          </div>
        </div>
        <div>
          <label className="label" htmlFor="text">
            Isi pesan
          </label>
          <textarea
            id="text"
            className="input min-h-28"
            maxLength={4000}
            placeholder="Halo, terima kasih sudah memesan…"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
          <p className="mt-1 text-right text-xs text-slate-400">{text.length}/4000</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="label" htmlFor="customerId">
              Customer ID (opsional)
            </label>
            <input
              id="customerId"
              className="input"
              placeholder="CUST-991"
              value={customerId}
              onChange={(event) => setCustomerId(event.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor="customerName">
              Nama customer (opsional)
            </label>
            <input
              id="customerName"
              className="input"
              placeholder="Budi"
              value={customerName}
              onChange={(event) => setCustomerName(event.target.value)}
            />
            <p className="mt-1 text-xs text-slate-400">
              Hanya untuk catatan riwayat; service tidak menyimpan data pelanggan.
            </p>
          </div>
        </div>
        {error ? <ErrorBanner message={error} /> : null}
        {result ? <SuccessBanner message={result} /> : null}
        <button type="submit" className="btn btn-primary" disabled={busy}>
          <Send className="size-4" />
          {busy ? 'Mengirim…' : 'Kirim pesan'}
        </button>
      </form>
    </Card>
  )
}
