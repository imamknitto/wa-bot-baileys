export interface SessionView {
  sessionId: string
  mode: 'pairing' | 'qr'
  status: 'connecting' | 'connected' | 'disconnected' | 'logged_out'
  connected: boolean
  me: string | null
  hasQr: boolean
  hasPairingCode: boolean
  pairingError: string | null
}

export interface SessionListItem extends SessionView {
  salesId: string | null
  agentId: string | null
  sentToday: number
}

export interface ServiceInfo {
  name: string
  version: string
  status: string
}

export interface Stats {
  sessions: { total: number; connected: number }
  messages: { total: number; today: number }
}

export type BroadcastStatus = 'running' | 'completed' | 'cancelled' | 'failed'

export interface BroadcastResult {
  to: string
  customerId: string | null
  customerName: string | null
  ok: boolean
  messageId: string | null
  error?: string
  sentAt?: number
}

export interface BroadcastJob {
  jobId: string
  status: BroadcastStatus
  total: number
  sent: number
  failed: number
  nextSendAt: number | null
  results: BroadcastResult[]
  createdAt: number
  delayMinMs: number
  delayMaxMs: number
  referenceId: string | null
  error: string | null
}

export interface MessageLog {
  id: number
  sessionId: string
  source: 'send' | 'broadcast'
  to: string
  text: string | null
  broadcastJobId: string | null
  messageId: string | null
  status: 'sent' | 'failed'
  error: string | null
  createdAt: number
  salesId: string | null
  agentId: string | null
  customerId: string | null
  customerName: string | null
  referenceId: string | null
}

export interface RecentMessage {
  id: number
  sessionId: string
  source: 'send' | 'broadcast'
  to: string
  salesId: string | null
  customerId: string | null
  customerName: string | null
  text: string | null
  status: 'sent' | 'failed'
  error: string | null
  createdAt: number
}

export interface MessagePage {
  messages: MessageLog[]
  nextCursor: number | null
}

export interface PairingInfo {
  pairingCode: string | null
  error: string | null
}

export interface SendResult {
  ok: boolean
  id: string | null
  referenceId: string | null
  status?: string
  duplicate?: boolean
}
