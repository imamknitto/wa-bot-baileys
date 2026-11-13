import type { ReactNode } from 'react'

export function Card({
  children,
  className = '',
}: {
  children: ReactNode
  className?: string
}) {
  return <div className={`card ${className}`}>{children}</div>
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-5 py-4">
      <div>
        <h2 className="text-base font-bold text-slate-800">{title}</h2>
        {description ? (
          <p className="mt-0.5 text-sm text-slate-500">{description}</p>
        ) : null}
      </div>
      {action}
    </div>
  )
}

export function StatCard({
  label,
  value,
  hint,
  icon,
}: {
  label: string
  value: string
  hint?: string
  icon?: ReactNode
}) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-1.5 text-2xl font-extrabold tracking-tight text-slate-900">
            {value}
          </p>
          {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
        </div>
        {icon ? (
          <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
            {icon}
          </div>
        ) : null}
      </div>
    </Card>
  )
}

const badgeStyles: Record<string, string> = {
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-600/20',
  amber: 'bg-amber-50 text-amber-700 ring-amber-600/20',
  red: 'bg-red-50 text-red-700 ring-red-600/20',
  slate: 'bg-slate-100 text-slate-600 ring-slate-500/20',
}

export function Badge({
  tone,
  children,
}: {
  tone: keyof typeof badgeStyles
  children: ReactNode
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${badgeStyles[tone]}`}
    >
      {children}
    </span>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      <p className="text-base font-bold text-slate-700">{title}</p>
      <p className="max-w-sm text-sm text-slate-500">{description}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  )
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-lg bg-slate-200 ${className}`} />
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
      {message}
    </div>
  )
}

export function SuccessBanner({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
      {message}
    </div>
  )
}
