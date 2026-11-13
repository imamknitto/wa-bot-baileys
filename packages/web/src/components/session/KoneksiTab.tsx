import { QrCode, RefreshCw } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { useRouter } from '@tanstack/react-router'
import { StatusBadge } from '~/components/StatusBadge'
import { Card, CardHeader, ErrorBanner, SuccessBanner } from '~/components/ui'
import { api } from '~/lib/api'
import type { PairingInfo, SessionView } from '~/lib/types'
import { usePolling } from '~/lib/format'

export function KoneksiTab({ session }: { session: SessionView }): ReactNode {
  if (session.connected) {
    return (
      <Card>
        <CardHeader title="Koneksi" description="Sesi WhatsApp terhubung" />
        <div className="px-5 py-5">
          <SuccessBanner message="Nomor ini sudah terhubung dan siap mengirim pesan." />
          {session.me ? (
            <p className="mt-3 text-sm text-slate-500">
              Login sebagai:{' '}
              <span className="font-mono font-semibold text-slate-700">
                {session.me.replace(/@.*/, '')}
              </span>
            </p>
          ) : null}
        </div>
      </Card>
    )
  }

  if (session.status === 'logged_out') {
    return <LoggedOutPanel session={session} />
  }

  return session.mode === 'qr' ? <QrPanel session={session} /> : <PairingPanel session={session} />
}

function LoggedOutPanel({ session }: { session: SessionView }): ReactNode {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const relogin = async () => {
    setBusy(true)
    setError(null)
    try {
      await api(`/sessions/${session.sessionId}/login`, { method: 'POST' })
      await router.invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal memulai login ulang.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader title="Koneksi" description="Sesi sudah logout" />
      <div className="px-5 py-5">
        <p className="text-sm text-slate-500">
          Sesi ini sudah logout dari WhatsApp. Login ulang untuk menautkan perangkat lagi dengan
          Session ID yang sama.
        </p>
        {error ? (
          <div className="mt-3">
            <ErrorBanner message={error} />
          </div>
        ) : null}
        <button type="button" className="btn btn-primary mt-4" onClick={relogin} disabled={busy}>
          <QrCode className="size-4" />
          {busy ? 'Memulai…' : 'Login ulang dengan QR'}
        </button>
      </div>
    </Card>
  )
}

function QrPanel({ session }: { session: SessionView }): ReactNode {
  const [qr, setQr] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchQr = useCallback(async () => {
    try {
      const res = await api<{ qr: string | null }>(`/sessions/${session.sessionId}/qr`)
      setQr(res.qr)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengambil QR.')
    }
  }, [session.sessionId])

  useEffect(() => {
    void fetchQr()
  }, [fetchQr])

  usePolling(fetchQr, 3_000, session.status === 'connecting')

  return (
    <Card>
      <CardHeader
        title="Scan QR"
        description={`Buka WhatsApp > Perangkat tertaut > Tautkan perangkat untuk sesi ${session.sessionId}`}
      />
      <div className="flex flex-col items-center gap-4 px-5 py-6">
        {error ? <ErrorBanner message={error} /> : null}
        {qr ? (
          <img
            src={qr}
            alt={`QR code untuk sesi ${session.sessionId}`}
            className="size-64 rounded-lg border border-slate-200"
          />
        ) : (
          <div className="flex size-64 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-400">
            <div className="flex flex-col items-center gap-2">
              <QrCode className="size-10 animate-pulse" />
              <span className="text-sm">Menunggu QR…</span>
            </div>
          </div>
        )}
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <RefreshCw className="size-4 animate-spin" />
          QR diperbarui otomatis setiap 3 detik.
        </div>
        <StatusBadge status={session.status} />
      </div>
    </Card>
  )
}

function PairingPanel({ session }: { session: SessionView }): ReactNode {
  const [pairing, setPairing] = useState<PairingInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  const fetchPairing = useCallback(async () => {
    try {
      const res = await api<PairingInfo>(`/sessions/${session.sessionId}/pairing`)
      setPairing(res)
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal mengambil kode pairing.')
    }
  }, [session.sessionId])

  useEffect(() => {
    void fetchPairing()
  }, [fetchPairing])

  usePolling(fetchPairing, 3_000, session.status === 'connecting')

  const code = pairing?.pairingCode ?? null

  return (
    <Card>
      <CardHeader
        title="Kode pairing"
        description={`Masukkan kode ini di WhatsApp untuk sesi ${session.sessionId}`}
      />
      <div className="flex flex-col items-center gap-4 px-5 py-8">
        {error ? <ErrorBanner message={error} /> : null}
        {pairing?.error ? <ErrorBanner message={pairing.error} /> : null}
        {code ? (
          <p
            className="select-all rounded-xl border border-emerald-200 bg-emerald-50 px-8 py-5 font-mono text-4xl font-bold tracking-[0.3em] text-emerald-700"
            aria-label="Kode pairing"
          >
            {code}
          </p>
        ) : (
          <div className="flex size-64 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-slate-400">
            <span className="text-sm">Menunggu kode pairing…</span>
          </div>
        )}
        <p className="text-center text-sm text-slate-500">
          Buka WhatsApp &gt; Perangkat tertaut &gt; Tautkan dengan nomor telepon, lalu masukkan
          kode di atas. Kode diperbarui otomatis setiap 3 detik.
        </p>
        <StatusBadge status={session.status} />
      </div>
    </Card>
  )
}
