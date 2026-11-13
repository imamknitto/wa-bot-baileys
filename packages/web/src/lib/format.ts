import { useEffect, useRef } from 'react'

const dateTimeFormat = new Intl.DateTimeFormat('id-ID', {
  dateStyle: 'medium',
  timeStyle: 'short',
})

const timeFormat = new Intl.DateTimeFormat('id-ID', {
  timeStyle: 'medium',
})

export function formatDateTime(timestamp: number): string {
  return dateTimeFormat.format(new Date(timestamp))
}

export function formatTime(timestamp: number): string {
  return timeFormat.format(new Date(timestamp))
}

export function formatNumber(value: number): string {
  return new Intl.NumberFormat('id-ID').format(value)
}

export function phoneFromJid(jid: string): string {
  return jid.replace(/@.*/, '')
}

export function digitsOnly(value: string): string {
  return value.replace(/\D/g, '')
}

export function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return minutes > 0 ? `${minutes} m ${seconds} d` : `${seconds} d`
}

export function truncate(value: string | null, max = 60): string {
  if (!value) return '-'
  return value.length > max ? `${value.slice(0, max)}…` : value
}

export function usePolling(
  fn: () => void,
  intervalMs: number,
  enabled = true,
): void {
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    if (!enabled) return
    const id = setInterval(() => ref.current(), intervalMs)
    return () => clearInterval(id)
  }, [intervalMs, enabled])
}
