const DELAY_KEY = 'broadcast_delay'

export interface DelaySetting {
  minSeconds: number
  maxSeconds: number
}

const DEFAULT_DELAY: DelaySetting = { minSeconds: 30, maxSeconds: 60 }

export function loadDelay(): DelaySetting {
  try {
    const raw = localStorage.getItem(DELAY_KEY)
    if (!raw) return DEFAULT_DELAY
    const parsed = JSON.parse(raw) as Partial<DelaySetting>
    return {
      minSeconds: clampDelay(parsed.minSeconds, DEFAULT_DELAY.minSeconds),
      maxSeconds: clampDelay(parsed.maxSeconds, DEFAULT_DELAY.maxSeconds),
    }
  } catch {
    return DEFAULT_DELAY
  }
}

export function saveDelay(value: DelaySetting): void {
  localStorage.setItem(
    DELAY_KEY,
    JSON.stringify({
      minSeconds: clampDelay(value.minSeconds, DEFAULT_DELAY.minSeconds),
      maxSeconds: clampDelay(value.maxSeconds, DEFAULT_DELAY.maxSeconds),
    }),
  )
}

function clampDelay(value: number | undefined, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(600, Math.max(10, Math.round(value)))
}
