import { clearApiKey, getApiKey } from './auth'

export class ApiError extends Error {
  status: number
  details: unknown

  constructor(status: number, message: string, details?: unknown) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
  }
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  }
  const key = getApiKey()
  if (key) headers['x-api-key'] = key
  if (options.body !== undefined) headers['content-type'] = 'application/json'

  let res: Response
  try {
    res = await fetch(path, { ...options, headers })
  } catch {
    throw new ApiError(0, 'Tidak bisa menghubungi server. Periksa koneksi.')
  }

  let body: unknown = null
  if (res.status !== 204) {
    const text = await res.text()
    if (text) {
      try {
        body = JSON.parse(text)
      } catch {
        throw new ApiError(res.status, 'Respons bukan JSON yang valid.')
      }
    }
  }

  if (!res.ok) {
    if (res.status === 401) clearApiKey()
    const record = body as { error?: unknown; details?: unknown } | null
    const message =
      typeof record?.error === 'string' ? record.error : `HTTP ${res.status}`
    throw new ApiError(res.status, translateError(message), record?.details)
  }
  return body as T
}

function translateError(message: string): string {
  switch (message) {
    case 'Unauthorized':
      return 'API key tidak valid atau kedaluwarsa.'
    case 'Forbidden':
      return 'Akses ditolak untuk resource ini.'
    case 'No running broadcast job':
      return 'Tidak ada broadcast yang sedang berjalan.'
    case 'WhatsApp is not connected':
      return 'WhatsApp belum terhubung untuk sesi ini.'
    case 'Session not found':
      return 'Sesi tidak ditemukan.'
    case 'Validation failed':
      return 'Data yang dikirim tidak valid.'
    default:
      return message
  }
}
