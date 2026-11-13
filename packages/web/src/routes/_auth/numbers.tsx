import { createFileRoute } from '@tanstack/react-router'
import { Plus, RefreshCw } from 'lucide-react'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useRouter } from '@tanstack/react-router'
import { StatusBadge } from '~/components/StatusBadge'
import { Modal, TokenOnceModal } from '~/components/dialogs'
import { Card, CardHeader, EmptyState, ErrorBanner } from '~/components/ui'
import { api } from '~/lib/api'
import { digitsOnly, formatNumber, usePolling } from '~/lib/format'
import type { SessionListItem } from '~/lib/types'

export const Route = createFileRoute('/_auth/numbers')({
  loader: () => api<{ sessions: SessionListItem[] }>('/sessions'),
  component: NumbersPage,
})

function NumbersPage(): ReactNode {
  const data = Route.useLoaderData()
  const router = useRouter()
  const navigate = useNavigate()
  const [refreshing, setRefreshing] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [newToken, setNewToken] = useState<{ sessionId: string; token: string } | null>(null)

  usePolling(() => void router.invalidate(), 10_000, true)

  const refresh = async () => {
    setRefreshing(true)
    try {
      await router.invalidate()
    } finally {
      setRefreshing(false)
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Daftar nomor"
          description={`${data.sessions.length} sesi · maksimal aktif tergantung konfigurasi service`}
          action={
            <div className="flex gap-2">
              <button type="button" className="btn btn-ghost" onClick={refresh} disabled={refreshing}>
                <RefreshCw className={`size-4 ${refreshing ? 'animate-spin' : ''}`} />
                Segarkan
              </button>
              <button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>
                <Plus className="size-4" />
                Tambah nomor
              </button>
            </div>
          }
        />
        {data.sessions.length === 0 ? (
          <EmptyState
            title="Belum ada nomor tersambung"
            description="Klik “Tambah nomor” untuk membuat sesi baru, lalu pairing atau scan QR dari WhatsApp."
            action={
              <button type="button" className="btn btn-primary" onClick={() => setAddOpen(true)}>
                <Plus className="size-4" />
                Tambah nomor
              </button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-100 bg-slate-50/60">
                <tr>
                  <th className="th">Session ID</th>
                  <th className="th">Sales</th>
                  <th className="th">Agent</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Terkirim hari ini</th>
                  <th className="th text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.sessions.map((session) => (
                  <tr key={session.sessionId} className="hover:bg-slate-50/60">
                    <td className="td">
                      <Link
                        to="/numbers/$sessionId"
                        params={{ sessionId: session.sessionId }}
                        className="font-mono text-xs font-bold text-emerald-700 hover:underline"
                      >
                        {session.sessionId}
                      </Link>
                      {session.me ? (
                        <span className="block text-xs text-slate-400">{session.me.replace(/@.*/, '')}</span>
                      ) : null}
                    </td>
                    <td className="td">{session.salesId ?? '-'}</td>
                    <td className="td">{session.agentId ?? '-'}</td>
                    <td className="td">
                      <StatusBadge status={session.status} />
                    </td>
                    <td className="td text-right tabular-nums">{formatNumber(session.sentToday)}</td>
                    <td className="td text-right">
                      <Link
                        to="/numbers/$sessionId"
                        params={{ sessionId: session.sessionId }}
                        className="btn btn-ghost px-3 py-1.5 text-xs"
                      >
                        Buka
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <AddSessionModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onCreated={(sessionId, token) => {
          setAddOpen(false)
          setNewToken({ sessionId, token })
          void router.invalidate()
        }}
      />

      <TokenOnceModal
        token={newToken}
        onClose={() => {
          const sessionId = newToken?.sessionId
          setNewToken(null)
          if (sessionId) void navigate({ to: '/numbers/$sessionId', params: { sessionId } })
        }}
      />
    </div>
  )
}

function AddSessionModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (sessionId: string, token: string) => void
}) {
  const [salesId, setSalesId] = useState('')
  const [agentId, setAgentId] = useState('')
  const [mode, setMode] = useState<'pairing' | 'qr'>('qr')
  const [phone, setPhone] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const trimmedSales = salesId.trim()
    if (!/^[a-zA-Z0-9_-]{1,32}$/.test(trimmedSales)) {
      setError('Session ID wajib 1–32 karakter huruf, angka, “-” atau “_”.')
      return
    }
    if (mode === 'pairing' && digitsOnly(phone).length < 8) {
      setError('Nomor WhatsApp wajib 8–15 digit untuk mode pairing.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const res = await api<{ sessionId: string; token: string }>('/sessions', {
        method: 'POST',
        body: JSON.stringify({
          sessionId: trimmedSales,
          salesId: trimmedSales,
          ...(agentId.trim() ? { agentId: agentId.trim() } : {}),
          mode,
          ...(mode === 'pairing' ? { phone: digitsOnly(phone) } : {}),
        }),
      })
      onCreated(res.sessionId, res.token)
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : 'Gagal membuat sesi.')
    }
  }

  return (
    <Modal open={open} title="Tambah nomor baru" onClose={onClose}>
      <form onSubmit={submit} noValidate className="space-y-4">
        <div>
          <label className="label" htmlFor="sessionId">
            Session ID
          </label>
          <input
            id="sessionId"
            className="input font-mono"
            placeholder="sales-12"
            value={salesId}
            onChange={(event) => setSalesId(event.target.value)}
            autoFocus
          />
          <p className="mt-1 text-xs text-slate-400">
            Dipakai sebagai Session ID dan identitas sales. Sesudah logout, buat lagi dengan ID yang sama untuk pairing ulang.
          </p>
        </div>
        <div>
          <label className="label" htmlFor="agentId">
            Agent ID (opsional)
          </label>
          <input
            id="agentId"
            className="input"
            placeholder="A-3"
            value={agentId}
            onChange={(event) => setAgentId(event.target.value)}
          />
        </div>
        <div>
          <span className="label">Mode login</span>
          <div className="flex gap-2">
            {(['qr', 'pairing'] as const).map((value) => (
              <button
                key={value}
                type="button"
                className={`btn flex-1 ${mode === value ? 'bg-emerald-500 text-white hover:bg-emerald-600' : 'btn-ghost'}`}
                onClick={() => setMode(value)}
              >
                {value === 'qr' ? 'Scan QR' : 'Kode pairing'}
              </button>
            ))}
          </div>
        </div>
        {mode === 'pairing' ? (
          <div>
            <label className="label" htmlFor="phone">
              Nomor WhatsApp
            </label>
            <input
              id="phone"
              className="input"
              inputMode="numeric"
              placeholder="6281234567890"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
            <p className="mt-1 text-xs text-slate-400">
              Masukkan nomor lengkap tanpa spasi, lalu masukkan kode pairing di WhatsApp.
            </p>
          </div>
        ) : null}
        {error ? <ErrorBanner message={error} /> : null}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Batal
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {busy ? 'Membuat…' : 'Buat sesi'}
          </button>
        </div>
      </form>
    </Modal>
  )
}

