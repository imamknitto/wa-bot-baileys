import { Badge } from '~/components/ui'

export function StatusBadge({
  status,
}: {
  status: 'connecting' | 'connected' | 'disconnected' | 'logged_out'
}) {
  const map = {
    connected: { tone: 'green' as const, label: 'Terhubung' },
    connecting: { tone: 'amber' as const, label: 'Menyambungkan' },
    disconnected: { tone: 'red' as const, label: 'Terputus' },
    logged_out: { tone: 'slate' as const, label: 'Logout' },
  }
  const entry = map[status]
  return <Badge tone={entry.tone}>{entry.label}</Badge>
}
