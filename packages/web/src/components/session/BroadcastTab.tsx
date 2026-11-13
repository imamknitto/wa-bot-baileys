import { Ban, ListChecks, Loader2 } from 'lucide-react'
import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react'
import { Badge, Card, CardHeader, ErrorBanner, SuccessBanner } from '~/components/ui'
import { api } from '~/lib/api'
import type { BroadcastJob } from '~/lib/types'
import { digitsOnly, formatTime, phoneFromJid, usePolling } from '~/lib/format'
import { loadDelay, saveDelay, type DelaySetting } from '~/lib/delay'

interface ParsedRecipient {
  to: string
  name?: string
}

export function BroadcastTab({ sessionId }: { sessionId: string }): ReactNode {
  const [job, setJob] = useState<BroadcastJob | null>(null)
  const [jobError, setJobError] = useState<string | null>(null)
  const [recipients, setRecipients] = useState('')
  const [text, setText] = useState('')
  const [delay, setDelay] = useState<DelaySetting>(() => loadDelay())
  const [referenceId, setReferenceId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [started, setStarted] = useState<string | null>(null)
  const [delayTouched, setDelayTouched] = useState(false)

  const running = job?.status === 'running'

  const refreshJob = useCallback(async () => {
    try {
      setJob(await api<BroadcastJob>(`/sessions/${sessionId}/broadcast/current`))
      setJobError(null)
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Gagal mengambil job.'
      if (message.includes('Tidak ada broadcast')) {
        setJob(null)
        setJobError(null)
      } else {
        setJobError(message)
      }
    }
  }, [sessionId])

  useEffect(() => {
    void refreshJob()
  }, [refreshJob])

  usePolling(refreshJob, 2_000, running)

  const parseRecipients = (raw: string): ParsedRecipient[] => {
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        const parts = line.split(',').map((part) => part.trim())
        return parts[0] ? { to: parts[0], ...(parts[1] ? { name: parts[1] } : {}) } : null
      })
      .filter((entry): entry is ParsedRecipient => entry !== null)
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const parsed = parseRecipients(recipients)
    if (parsed.length === 0) {
      setError('Minimal satu penerima, satu per baris: nomor atau nomor,nama.')
      return
    }
    if (parsed.length > 100) {
      setError('Maksimal 100 penerima per job.')
      return
    }
    if (!text.trim()) {
      setError('Isi pesan broadcast wajib diisi.')
      return
    }
    for (const entry of parsed) {
      const valid = entry.to.includes('@')
        ? /^[^@\s]+@[^@\s]+$/.test(entry.to)
        : digitsOnly(entry.to).length >= 8 && digitsOnly(entry.to).length <= 15
      if (!valid) {
        setError(`Nomor tidak valid: ${entry.to}`)
        return
      }
    }
    if (delay.minSeconds < 10 || delay.maxSeconds > 600 || delay.maxSeconds < delay.minSeconds) {
      setError('Delay harus 10–600 detik dan maksimal ≥ minimal.')
      return
    }
    setBusy(true)
    setError(null)
    setStarted(null)
    try {
      const res = await api<{ jobId: string }>(`/sessions/${sessionId}/broadcast`, {
        method: 'POST',
        body: JSON.stringify({
          text: text.trim(),
          delayMinMs: delay.minSeconds * 1000,
          delayMaxMs: delay.maxSeconds * 1000,
          ...(referenceId.trim() ? { referenceId: referenceId.trim() } : {}),
          recipients: parsed.map((entry) => ({
            to: entry.to,
            ...(entry.name ? { name: entry.name } : {}),
          })),
        }),
      })
      setStarted(res.jobId)
      setRecipients('')
      await refreshJob()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membuat broadcast.')
    } finally {
      setBusy(false)
    }
  }

  const cancel = async () => {
    if (!job) return
    setBusy(true)
    try {
      await api(`/sessions/${sessionId}/broadcast/${job.jobId}/cancel`, { method: 'POST' })
      await refreshJob()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Gagal membatalkan broadcast.')
    } finally {
      setBusy(false)
    }
  }

  const updateDelay = (patch: Partial<DelaySetting>) => {
    const next = { ...delay, ...patch }
    setDelay(next)
    setDelayTouched(true)
    if (next.maxSeconds >= next.minSeconds) saveDelay(next)
  }

  const done = job ? job.sent + job.failed : 0
  const percent = job && job.total > 0 ? Math.round((done / job.total) * 100) : 0

  return (
    <div className="space-y-5">
      {job ? (
        <Card>
          <CardHeader
            title="Progres broadcast"
            description={`Job ${job.jobId.slice(0, 8)}… · dibuat ${formatTime(job.createdAt)}`}
            action={
              running ? (
                <button type="button" className="btn btn-danger" onClick={cancel} disabled={busy}>
                  <Ban className="size-4" />
                  Batalkan
                </button>
              ) : (
                <Badge tone={job.status === 'completed' ? 'green' : job.status === 'running' ? 'amber' : 'red'}>
                  {job.status === 'completed'
                    ? 'Selesai'
                    : job.status === 'cancelled'
                      ? 'Dibatalkan'
                      : job.status === 'failed'
                        ? 'Gagal'
                        : 'Berjalan'}
                </Badge>
              )
            }
          />
          <div className="space-y-3 px-5 py-5">
            <div className="flex items-center justify-between text-sm text-slate-500">
              <span className="flex items-center gap-2">
                {running ? <Loader2 className="size-4 animate-spin text-emerald-600" /> : <ListChecks className="size-4" />}
                {done}/{job.total} diproses
                {running && job.nextSendAt ? ` · kirim berikutnya ${formatTime(job.nextSendAt)}` : ''}
              </span>
              <span>
                {job.sent} terkirim · {job.failed} gagal
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${percent}%` }}
              />
            </div>
            {job.error ? <ErrorBanner message={job.error} /> : null}
            {job.results.length > 0 ? (
              <div className="max-h-52 overflow-y-auto rounded-lg border border-slate-200">
                <table className="w-full">
                  <tbody className="divide-y divide-slate-100">
                    {job.results.map((entry) => (
                      <tr key={entry.to}>
                        <td className="px-4 py-2 font-mono text-xs">{phoneFromJid(entry.to)}</td>
                        <td className="px-4 py-2 text-sm">{entry.customerName ?? '-'}</td>
                        <td className="px-4 py-2 text-right">
                          {entry.ok ? (
                            <Badge tone="green">Terkirim</Badge>
                          ) : (
                            <Badge tone="red">{truncateError(entry.error)}</Badge>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Broadcast baru"
          description="Satu pesan per penerima dengan jeda acak untuk menjaga reputasi nomor."
        />
        {jobError ? (
          <div className="px-5 pt-4">
            <ErrorBanner message={jobError} />
          </div>
        ) : null}
        <form onSubmit={submit} noValidate className="space-y-4 px-5 py-5">
          <div>
            <label className="label" htmlFor="recipients">
              Penerima ({parseRecipients(recipients).length}/100)
            </label>
            <textarea
              id="recipients"
              className="input min-h-36 font-mono text-xs"
              placeholder={'6281234567890, Budi\n6281298765432, Sari'}
              value={recipients}
              onChange={(event) => setRecipients(event.target.value)}
              disabled={running}
            />
            <p className="mt-1 text-xs text-slate-400">
              Satu baris per penerima: <span className="font-mono">nomor</span> atau{' '}
              <span className="font-mono">nomor,nama</span>. Duplikat otomatis dibuang.
            </p>
          </div>
          <div>
            <label className="label" htmlFor="broadcastText">
              Isi pesan
            </label>
            <textarea
              id="broadcastText"
              className="input min-h-28"
              maxLength={4000}
              placeholder="Promo spesial hari ini…"
              value={text}
              onChange={(event) => setText(event.target.value)}
              disabled={running}
            />
          </div>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="label" htmlFor="delayMin">
                Jeda minimum (detik)
              </label>
              <input
                id="delayMin"
                className="input"
                type="number"
                min={10}
                max={600}
                value={delay.minSeconds}
                onChange={(event) => updateDelay({ minSeconds: Number(event.target.value) })}
                disabled={running}
              />
            </div>
            <div>
              <label className="label" htmlFor="delayMax">
                Jeda maksimum (detik)
              </label>
              <input
                id="delayMax"
                className="input"
                type="number"
                min={10}
                max={600}
                value={delay.maxSeconds}
                onChange={(event) => updateDelay({ maxSeconds: Number(event.target.value) })}
                disabled={running}
              />
            </div>
            <div>
              <label className="label" htmlFor="broadcastRef">
                Reference ID (opsional)
              </label>
              <input
                id="broadcastRef"
                className="input"
                placeholder="promo-nov"
                value={referenceId}
                onChange={(event) => setReferenceId(event.target.value)}
                disabled={running}
              />
            </div>
          </div>
          {delayTouched ? (
            <p className="text-xs text-slate-400">
              Jeda disimpan sebagai default untuk broadcast berikutnya.
            </p>
          ) : null}
          {error ? <ErrorBanner message={error} /> : null}
          {started ? (
            <SuccessBanner message={`Broadcast dimulai. Progres diperbarui otomatis.`} />
          ) : null}
          <button type="submit" className="btn btn-primary" disabled={busy || running}>
            {running ? 'Broadcast sedang berjalan' : busy ? 'Memulai…' : 'Mulai broadcast'}
          </button>
        </form>
      </Card>
    </div>
  )
}

function truncateError(message: string | undefined): string {
  if (!message) return 'Gagal'
  return message.length > 32 ? `${message.slice(0, 32)}…` : message
}
