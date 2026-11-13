import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router'
import { ArrowLeft, KeyRound, LogOut, RefreshCw, Trash2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { BroadcastTab } from '~/components/session/BroadcastTab'
import { KirimTab } from '~/components/session/KirimTab'
import { KoneksiTab } from '~/components/session/KoneksiTab'
import { RiwayatTab } from '~/components/session/RiwayatTab'
import { ConfirmDialog, TokenOnceModal } from '~/components/dialogs'
import { StatusBadge } from '~/components/StatusBadge'
import { Card } from '~/components/ui'
import { api } from '~/lib/api'
import { usePolling } from '~/lib/format'
import type { BroadcastJob, SessionListItem } from '~/lib/types'

type TabKey = 'koneksi' | 'kirim' | 'broadcast' | 'riwayat'

interface DetailData {
  session: SessionListItem
  job: BroadcastJob | null
}

const TABS: { key: TabKey; label: string }[] = [
  { key: 'koneksi', label: 'Koneksi' },
  { key: 'kirim', label: 'Kirim' },
  { key: 'broadcast', label: 'Broadcast' },
  { key: 'riwayat', label: 'Riwayat' },
]

export const Route = createFileRoute('/_auth/numbers_/$sessionId')({
  loader: async ({ params }): Promise<DetailData> => {
    const session = await api<SessionListItem>(
      `/sessions/${encodeURIComponent(params.sessionId)}/status`,
    )
    let job: BroadcastJob | null = null
    try {
      job = await api<BroadcastJob>(
        `/sessions/${encodeURIComponent(params.sessionId)}/broadcast/current`,
      )
    } catch {
      job = null
    }
    return { session, job }
  },
  component: SessionDetailPage,
})

function SessionDetailPage(): ReactNode {
  const { session, job } = Route.useLoaderData()
  const { sessionId } = Route.useParams()
  const router = useRouter()
  const navigate = useNavigate()
  const [tab, setTab] = useState<TabKey>('koneksi')
  const [token, setToken] = useState<{ sessionId: string; token: string } | null>(null)
  const [confirm, setConfirm] = useState<'logout' | 'delete' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Keep the connection status fresh so a scanned QR flips the page to connected
  // (and the QR panel stops) without a manual reload.
  usePolling(
    () => {
      void router.invalidate()
    },
    3_000,
    session.status !== 'connected' && session.status !== 'logged_out',
  )

  const refresh = async () => {
    setBusy(true)
    try {
      await router.invalidate()
    } finally {
      setBusy(false)
    }
  }

  const rotateToken = async () => {
    setBusy(true)
    setError(null)
    try {
      const res = await api<{ sessionId: string; token: string }>(
        `/sessions/${sessionId}/token`,
        { method: 'POST' },
      )
      setToken(res)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat token baru.')
    } finally {
      setBusy(false)
    }
  }

  const logout = async () => {
    setBusy(true)
    setError(null)
    try {
      await api(`/sessions/${sessionId}/logout`, { method: 'POST' })
      setConfirm(null)
      await router.invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal logout sesi.')
    } finally {
      setBusy(false)
    }
  }

  const remove = async () => {
    setBusy(true)
    setError(null)
    try {
      await api(`/sessions/${sessionId}`, { method: 'DELETE' })
      setConfirm(null)
      void navigate({ to: '/numbers' })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal menghapus sesi.')
      setBusy(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Link to="/numbers" className="flex items-center gap-1 hover:text-slate-700">
          <ArrowLeft className="size-4" />
          Nomor
        </Link>
        <span>/</span>
        <span className="font-mono font-semibold text-slate-700">{sessionId}</span>
      </div>

      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <StatusBadge status={session.status} />
            <span className="font-mono text-sm font-bold text-slate-800">{session.sessionId}</span>
            <span className="text-sm text-slate-500">Sales: {session.salesId ?? '-'}</span>
            {session.agentId ? (
              <span className="text-sm text-slate-500">Agent: {session.agentId}</span>
            ) : null}
            {session.me ? (
              <span className="text-sm text-slate-500">
                Nomor: <span className="font-mono">{session.me.replace(/@.*/, '')}</span>
              </span>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-ghost" onClick={refresh} disabled={busy}>
              <RefreshCw className={`size-4 ${busy ? 'animate-spin' : ''}`} />
              Segarkan
            </button>
            <button type="button" className="btn btn-ghost" onClick={rotateToken} disabled={busy}>
              <KeyRound className="size-4" />
              Rotasi token
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => setConfirm('logout')}
              disabled={busy}
            >
              <LogOut className="size-4" />
              Logout
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={() => setConfirm('delete')}
              disabled={busy}
            >
              <Trash2 className="size-4" />
              Hapus
            </button>
          </div>
        </div>
        {error ? <p className="mt-3 text-sm font-medium text-red-600">{error}</p> : null}
      </Card>

      <div className="flex gap-1 border-b border-slate-200">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            className={`-mb-px cursor-pointer border-b-2 px-4 py-2.5 text-sm font-semibold transition-colors ${
              tab === entry.key
                ? 'border-emerald-500 text-emerald-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
            onClick={() => setTab(entry.key)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === 'koneksi' ? <KoneksiTab session={session} /> : null}
      {tab === 'kirim' ? <KirimTab sessionId={sessionId} /> : null}
      {tab === 'broadcast' ? <BroadcastTab key={job?.jobId ?? 'none'} sessionId={sessionId} /> : null}
      {tab === 'riwayat' ? <RiwayatTab sessionId={sessionId} /> : null}

      <TokenOnceModal token={token} onClose={() => setToken(null)} />
      <ConfirmDialog
        open={confirm === 'logout'}
        title={`Logout sesi ${sessionId}?`}
        description="Sesi akan keluar dari WhatsApp dan auth-nya dihapus. Untuk pairing ulang, buat sesi baru dengan Session ID yang sama."
        confirmLabel="Ya, logout"
        onConfirm={logout}
        onCancel={() => setConfirm(null)}
      />
      <ConfirmDialog
        open={confirm === 'delete'}
        title={`Hapus sesi ${sessionId}?`}
        description="Sesi dihapus dari service beserta auth dan token-nya. Riwayat pesan tetap tersimpan."
        confirmLabel="Ya, hapus"
        onConfirm={remove}
        onCancel={() => setConfirm(null)}
      />
    </div>
  )
}
