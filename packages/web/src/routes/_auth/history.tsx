import { createFileRoute } from '@tanstack/react-router'
import { RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { ConfirmDialog } from '~/components/dialogs'
import { Badge, Card, CardHeader, EmptyState, ErrorBanner } from '~/components/ui'
import { api } from '~/lib/api'
import type { RecentMessage } from '~/lib/types'
import { formatDateTime, phoneFromJid, truncate } from '~/lib/format'

const PAGE_LIMIT = 50

export const Route = createFileRoute('/_auth/history')({
  validateSearch: (search: Record<string, unknown>) => ({
    sessionId: typeof search.sessionId === 'string' ? search.sessionId : undefined,
  }),
  component: HistoryPage,
})

function HistoryPage(): ReactNode {
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const [messages, setMessages] = useState<RecentMessage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [target, setTarget] = useState<RecentMessage | null>(null)
  const [busy, setBusy] = useState(false)

  const fetchMessages = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const query = new URLSearchParams({ limit: String(PAGE_LIMIT) })
      if (search.sessionId) query.set('sessionId', search.sessionId)
      const res = await api<{ messages: RecentMessage[] }>(`/messages?${query}`)
      setMessages(res.messages)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat riwayat.')
    } finally {
      setLoading(false)
    }
  }, [search.sessionId])

  useEffect(() => {
    void fetchMessages()
  }, [fetchMessages])

  const remove = async () => {
    if (!target) return
    setBusy(true)
    try {
      await api(`/messages/${target.id}`, { method: 'DELETE' })
      setMessages((current) => current.filter((message) => message.id !== target.id))
      setTarget(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus pesan.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Riwayat pesan keluar"
        description="Pesan terbaru dari semua sesi. Isi pesan dan data pelanggan tidak diekspos lebih dari yang tersimpan."
        action={
          <button type="button" className="btn btn-ghost" onClick={() => void fetchMessages()} disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
            Segarkan
          </button>
        }
      />
      {error ? (
        <div className="px-5 pt-4">
          <ErrorBanner message={error} />
        </div>
      ) : null}
      <div className="px-5 py-4">
        <label className="label" htmlFor="sessionFilter">
          Filter sesi
        </label>
        <input
          id="sessionFilter"
          className="input max-w-xs font-mono"
          placeholder="Semua sesi"
          defaultValue={search.sessionId ?? ''}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              const value = (event.target as HTMLInputElement).value.trim()
              void navigate({ to: '/history', search: { sessionId: value || undefined } })
            }
          }}
        />
        <p className="mt-1 text-xs text-slate-400">Ketik Session ID lalu tekan Enter.</p>
      </div>
      {loading ? (
        <p className="py-10 text-center text-sm text-slate-400">Memuat riwayat…</p>
      ) : messages.length === 0 ? (
        <EmptyState
          title="Belum ada pesan keluar"
          description="Pesan yang dikirim lewat service ini akan tampil di sini."
        />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-100 bg-slate-50/60">
              <tr>
                <th className="th">Waktu</th>
                <th className="th">Sesi</th>
                <th className="th">Tujuan</th>
                <th className="th">Customer</th>
                <th className="th">Isi</th>
                <th className="th">Status</th>
                <th className="th text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {messages.map((message) => (
                <tr key={message.id} className="hover:bg-slate-50/60">
                  <td className="td whitespace-nowrap text-xs text-slate-500">
                    {formatDateTime(message.createdAt)}
                  </td>
                  <td className="td font-mono text-xs font-semibold">{message.sessionId}</td>
                  <td className="td font-mono text-xs">{phoneFromJid(message.to)}</td>
                  <td className="td text-xs">
                    {message.customerName ?? '-'}
                    {message.customerId ? (
                      <span className="block text-slate-400">{message.customerId}</span>
                    ) : null}
                  </td>
                  <td className="td max-w-72">{truncate(message.text, 70)}</td>
                  <td className="td">
                    {message.status === 'sent' ? (
                      <Badge tone="green">Terkirim</Badge>
                    ) : (
                      <Badge tone="red">{truncate(message.error ?? 'Gagal', 32)}</Badge>
                    )}
                  </td>
                  <td className="td text-right">
                    <button
                      type="button"
                      className="btn btn-danger px-2.5 py-1.5"
                      onClick={() => setTarget(message)}
                      aria-label={`Hapus pesan ke ${message.to}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ConfirmDialog
        open={target !== null}
        busy={busy}
        title="Hapus catatan pesan ini?"
        description="Catatan dihapus dari riwayat service. Pesan yang sudah terkirim di WhatsApp tidak ikut terhapus."
        confirmLabel="Ya, hapus"
        onConfirm={remove}
        onCancel={() => setTarget(null)}
      />
    </Card>
  )
}
