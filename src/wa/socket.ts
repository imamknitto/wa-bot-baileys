import { rmSync } from 'node:fs'
import makeWASocket, {
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WASocket,
} from '@whiskeysockets/baileys'
import qrcode from 'qrcode-terminal'

export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'logged_out'

const AUTH_DIR = 'data/auth'
const RECONNECT_DELAY_MS = 3000

export class WaNotConnectedError extends Error {
  constructor() {
    super('WhatsApp is not connected')
    this.name = 'WaNotConnectedError'
  }
}

let sock: WASocket | null = null
let starting = false
let status: ConnectionStatus = 'disconnected'
let reconnectTimer: ReturnType<typeof setTimeout> | null = null
let lastQr: string | null = null
let logoutRequested = false

export function getStatus(): { status: ConnectionStatus; connected: boolean } {
  return { status, connected: status === 'connected' }
}

export function getQr(): string | null {
  return lastQr
}

function clearAuth(): void {
  rmSync(AUTH_DIR, { recursive: true, force: true })
}

export async function logout(): Promise<void> {
  logoutRequested = true
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  lastQr = null
  const s = sock
  if (!s) {
    clearAuth()
    status = 'logged_out'
    return
  }
  try {
    await s.logout()
  } catch {
    s.end(undefined)
  }
}

function toJid(to: string): string {
  if (to.includes('@')) return to
  return `${to.replace(/\D/g, '')}@s.whatsapp.net`
}

export async function sendText(to: string, text: string): Promise<string> {
  if (!sock || status !== 'connected') throw new WaNotConnectedError()
  const result = await sock.sendMessage(toJid(to), { text })
  if (!result) throw new Error('Message send returned no result')
  return result.key.id ?? ''
}

function scheduleReconnect(reason: string): void {
  if (reconnectTimer) return
  console.log(`Reconnecting in ${RECONNECT_DELAY_MS}ms (${reason})`)
  reconnectTimer = setTimeout(() => {
    reconnectTimer = null
    startWhatsApp().catch((err) => {
      console.error('Reconnect failed:', err)
      scheduleReconnect('reconnect error')
    })
  }, RECONNECT_DELAY_MS)
}

export async function startWhatsApp(): Promise<void> {
  if (sock || starting) return
  starting = true
  logoutRequested = false
  try {
    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)
    const { version } = await fetchLatestBaileysVersion()

    const s = makeWASocket({ version, auth: state })
    sock = s
    status = 'connecting'

    s.ev.on('creds.update', saveCreds)

    s.ev.on('connection.update', (update) => {
      const { connection, lastDisconnect, qr } = update

      if (qr) {
        lastQr = qr
        console.log('Scan this QR code with WhatsApp (Linked devices):')
        qrcode.generate(qr, { small: true })
      }

      if (connection === 'open') {
        lastQr = null
        status = 'connected'
        console.log('WhatsApp connected:', s.user?.id)
      }

      if (connection === 'close') {
        sock = null
        const statusCode = (
          lastDisconnect?.error as
            | { output?: { statusCode?: number } }
            | undefined
        )?.output?.statusCode

        if (logoutRequested || statusCode === DisconnectReason.loggedOut) {
          logoutRequested = false
          clearAuth()
          lastQr = null
          status = 'logged_out'
          console.log('WhatsApp logged out. Use login to pair again.')
          return
        }

        status = 'disconnected'
        scheduleReconnect(lastDisconnect?.error?.message ?? 'unknown error')
      }
    })

    s.ev.on('messages.upsert', async (upsert) => {
      if (upsert.type !== 'notify') return
      for (const msg of upsert.messages) {
        if (msg.key.fromMe || !msg.key.remoteJid) continue
        const text =
          msg.message?.conversation ?? msg.message?.extendedTextMessage?.text
        if (text?.trim().toLowerCase() !== 'ping') continue
        try {
          await s.sendMessage(msg.key.remoteJid, { text: 'pong' })
        } catch (err) {
          console.error('Failed to reply:', err)
        }
      }
    })
  } finally {
    starting = false
  }
}
