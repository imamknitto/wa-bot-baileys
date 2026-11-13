import { createFileRoute } from '@tanstack/react-router'
import { ArrowRight, MessageSquareText, Smartphone, Users } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, useRouter } from '@tanstack/react-router'
import { StatusBadge } from '~/components/StatusBadge'
import { Badge, Card, CardHeader, EmptyState, StatCard } from '~/components/ui'
import { api } from '~/lib/api'
import { formatNumber, usePolling } from '~/lib/format'
import type { BroadcastJob, ServiceInfo, SessionListItem, Stats } from '~/lib/types'

interface OverviewData {
  service: ServiceInfo
  stats: Stats
  sessions: SessionListItem[]
  running: { sessionId: string; job: BroadcastJob }[]
}

export const Route = createFileRoute('/_auth/overview')({
  loader: async (): Promise<OverviewData> => {
    const [service, stats, sessionsRes] = await Promise.all([
      api<ServiceInfo>('/'),
      api<Stats>('/stats'),
      api<{ sessions: SessionListItem[] }>('/sessions'),
    ])
    const sessions = sessionsRes.sessions
    const running = (
      await Promise.allSettled(
        sessions
          .filter((session) => session.connected)
          .map(async (session) => ({
            sessionId: session.sessionId,
            job: await api<BroadcastJob>(`/sessions/${session.sessionId}/broadcast/current`),
          })),
      )
    )
      .filter((entry) => entry.status === 'fulfilled')
      .map((entry) => (entry as PromiseFulfilledResult<{ sessionId: string; job: BroadcastJob }>).value)
    return { service, stats, sessions, running }
  },
  component: OverviewPage,
})

function OverviewPage(): ReactNode {
  const data = Route.useLoaderData()
  const [refreshing, setRefreshing] = useState(false)
  const router = useRouter()

  usePolling(() => {
    void router.invalidate()
  }, 15_000, true)

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
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Sesi terhubung"
          value={formatNumber(data.stats.sessions.connected)}
          hint={`dari ${formatNumber(data.stats.sessions.total)} sesi terdaftar`}
          icon={<Users className="size-5" />}
        />
        <StatCard
          label="Pesan hari ini"
          value={formatNumber(data.stats.messages.today)}
          hint="keluar, semua sesi"
          icon={<MessageSquareText className="size-5" />}
        />
        <StatCard
          label="Total pesan"
          value={formatNumber(data.stats.messages.total)}
          hint="sejak service berjalan"
          icon={<MessageSquareText className="size-5" />}
        />
        <StatCard
          label="Broadcast berjalan"
          value={formatNumber(data.running.length)}
          hint="job aktif saat ini"
          icon={<Smartphone className="size-5" />}
        />
      </div>

      <Card>
        <CardHeader
          title="Status service"
          description="Service WhatsApp gateway"
          action={
            <button type="button" className="btn btn-ghost" onClick={refresh} disabled={refreshing}>
              {refreshing ? 'Menyegarkan…' : 'Segarkan'}
            </button>
          }
        />
        <div className="flex flex-wrap items-center gap-x-8 gap-y-2 px-5 py-4 text-sm">
          <span className="flex items-center gap-2">
            <Badge tone={data.service.status === 'ok' ? 'green' : 'red'}>
              {data.service.status === 'ok' ? 'Sehat' : 'Bermasalah'}
            </Badge>
          </span>
          <span className="text-slate-500">
            {data.service.name} <span className="font-mono text-xs">v{data.service.version}</span>
          </span>
          <span className="text-slate-500">
            Nomor:{' '}
            <span className="font-semibold text-slate-700">
              {data.stats.sessions.connected}/{data.stats.sessions.total} terhubung
            </span>
          </span>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Broadcast berjalan"
          description="Job broadcast aktif per sesi"
        />
        {data.running.length === 0 ? (
          <EmptyState
            title="Tidak ada broadcast berjalan"
            description="Job broadcast yang sedang berjalan akan muncul di sini beserta progresnya."
          />
        ) : (
          <ul className="divide-y divide-slate-100">
            {data.running.map(({ sessionId, job }) => {
              const done = job.sent + job.failed
              const percent = job.total > 0 ? Math.round((done / job.total) * 100) : 0
              return (
                <li key={job.jobId} className="px-5 py-4">
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <Link
                      to="/numbers/$sessionId"
                      params={{ sessionId }}
                      className="font-mono text-sm font-semibold text-emerald-700 hover:underline"
                    >
                      {sessionId}
                    </Link>
                    <span className="text-xs text-slate-500">
                      {done}/{job.total} diproses · {job.sent} terkirim · {job.failed} gagal
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full bg-emerald-500 transition-all"
                      style={{ width: `${percent}%` }}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Nomor WhatsApp"
          description={`${data.sessions.length} sesi terdaftar`}
          action={
            <Link to="/numbers" className="btn btn-ghost">
              Kelola nomor <ArrowRight className="size-4" />
            </Link>
          }
        />
        {data.sessions.length === 0 ? (
          <EmptyState
            title="Belum ada nomor tersambung"
            description="Tambahkan nomor sales pertama untuk mulai mengirim pesan."
            action={
              <Link to="/numbers" className="btn btn-primary">
                Tambah nomor
              </Link>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-100 bg-slate-50/60">
                <tr>
                  <th className="th">Session ID</th>
                  <th className="th">Sales</th>
                  <th className="th">Status</th>
                  <th className="th text-right">Terkirim hari ini</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.sessions.slice(0, 5).map((session) => (
                  <tr key={session.sessionId}>
                    <td className="td font-mono text-xs font-semibold">
                      <Link
                        to="/numbers/$sessionId"
                        params={{ sessionId: session.sessionId }}
                        className="text-emerald-700 hover:underline"
                      >
                        {session.sessionId}
                      </Link>
                    </td>
                    <td className="td">{session.salesId ?? '-'}</td>
                    <td className="td">
                      <StatusBadge status={session.status} />
                    </td>
                    <td className="td text-right tabular-nums">{formatNumber(session.sentToday)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

