import { RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Badge, Card, CardHeader, EmptyState, ErrorBanner } from '~/components/ui'
import { api } from '~/lib/api'
import type { MessageLog, MessagePage } from '~/lib/types'
import { formatDateTime, phoneFromJid, truncate } from '~/lib/format'

const PAGE_LIMIT = 20

export function RiwayatTab({ sessionId }: { sessionId: string }): ReactNode {
  const [messages, setMessages] = useState<MessageLog[]>([])
  const [nextCursor, setNextCursor] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchFirstPage = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api<MessagePage>(`/sessions/${sessionId}/messages?limit=${PAGE_LIMIT}`)
      setMessages(res.messages)
      setNextCursor(res.nextCursor)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat riwayat.')
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  useEffect(() => {
    void fetchFirstPage()
  }, [fetchFirstPage])

  const loadMore = async () => {
    if (nextCursor === null) return
    setLoadingMore(true)
    try {
      const res = await api<MessagePage>(
        `/sessions/${sessionId}/messages?limit=${PAGE_LIMIT}&cursor=${nextCursor}`,
      )
      setMessages((current) => [...current, ...res.messages])
      setNextCursor(res.nextCursor)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memuat halaman berikutnya.')
    } finally {
      setLoadingMore(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Riwayat pesan keluar"
        description="Isi pesan disimpan di service untuk keperluan audit."
        action={
          <button type="button" className="btn btn-ghost" onClick={() => void fetchFirstPage()} disabled={loading}>
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
            Segarkan
          </button>
        }
      />
      <div className="px-5 py-5">
        {error ? <div className="mb-3"><ErrorBanner message={error} /></div> : null}
        {loading ? (
          <p className="py-6 text-center text-sm text-slate-400">Memuat riwayat…</p>
        ) : messages.length === 0 ? (
          <EmptyState
            title="Belum ada pesan keluar"
            description="Pesan yang dikirim dari sesi ini akan tercatat di sini."
          />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-slate-200">
            <table className="w-full">
              <thead className="border-b border-slate-100 bg-slate-50/60">
                <tr>
                  <th className="th">Waktu</th>
                  <th className="th">Tujuan</th>
                  <th className="th">Isi</th>
                  <th className="th">Sumber</th>
                  <th className="th text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {messages.map((message) => (
                  <tr key={message.id}>
                    <td className="td whitespace-nowrap text-xs text-slate-500">
                      {formatDateTime(message.createdAt)}
                    </td>
                    <td className="td font-mono text-xs">{phoneFromJid(message.to)}</td>
                    <td className="td max-w-72">{truncate(message.text, 80)}</td>
                    <td className="td text-xs text-slate-500">{message.source}</td>
                    <td className="td text-right">
                      {message.status === 'sent' ? (
                        <Badge tone="green">Terkirim</Badge>
                      ) : (
                        <Badge tone="red">{truncate(message.error ?? 'Gagal', 32)}</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {nextCursor !== null && !loading ? (
          <div className="mt-4 text-center">
            <button type="button" className="btn btn-ghost" onClick={loadMore} disabled={loadingMore}>
              {loadingMore ? 'Memuat…' : 'Muat lebih banyak'}
            </button>
          </div>
        ) : null}
      </div>
    </Card>
  )
}
