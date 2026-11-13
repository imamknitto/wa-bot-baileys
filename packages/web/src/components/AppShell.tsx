import {
  History,
  LayoutDashboard,
  LogOut,
  MessageCircle,
  Settings,
  Smartphone,
} from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Link, Outlet, useNavigate, useRouterState } from '@tanstack/react-router'
import { api } from '~/lib/api'
import { clearApiKey } from '~/lib/auth'
import { usePolling } from '~/lib/format'
import type { ServiceInfo } from '~/lib/types'

const NAV_ITEMS = [
  { to: '/overview', label: 'Ringkasan', icon: LayoutDashboard },
  { to: '/numbers', label: 'Nomor', icon: Smartphone },
  { to: '/history', label: 'Riwayat', icon: History },
  { to: '/settings', label: 'Pengaturan', icon: Settings },
] as const

const TITLES: Record<string, string> = {
  '/overview': 'Ringkasan',
  '/numbers': 'Nomor WhatsApp',
  '/history': 'Riwayat Pesan',
  '/settings': 'Pengaturan',
}

export function AppShell(): ReactNode {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const [serviceUp, setServiceUp] = useState<boolean | null>(null)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)

  usePolling(async () => {
    try {
      await api<ServiceInfo>('/')
      setServiceUp(true)
    } catch {
      setServiceUp(false)
    }
  }, 20_000, true)

  const title =
    pathname.startsWith('/numbers/') ? 'Detail Nomor' : (TITLES[pathname] ?? 'WA Platform')

  const logout = () => {
    clearApiKey()
    void navigate({ to: '/login' })
  }

  return (
    <div className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 flex-col bg-slate-950 lg:flex">
        <div className="flex items-center gap-3 px-5 py-5">
          <div className="flex size-9 items-center justify-center rounded-xl bg-emerald-500 text-white">
            <MessageCircle className="size-5" />
          </div>
          <div>
            <p className="text-sm font-extrabold text-white">WA Platform</p>
            <p className="text-xs text-slate-400">Multi-session console</p>
          </div>
        </div>
        <nav className="mt-2 flex-1 space-y-1 px-3">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:bg-slate-800 hover:text-white [&.active]:bg-emerald-500/10 [&.active]:text-emerald-300"
              activeProps={{ className: 'active' }}
            >
              <item.icon className="size-4.5" />
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="px-5 py-4 text-xs text-slate-500">
          Data pelanggan tidak disimpan di service ini.
        </div>
      </aside>

      <div className="lg:pl-60">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-3 border-b border-slate-200 bg-white px-4 lg:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className="btn btn-ghost px-2 py-1.5 lg:hidden"
              onClick={() => setMobileNavOpen((open) => !open)}
              aria-label="Buka menu"
            >
              ☰
            </button>
            <h1 className="text-base font-bold text-slate-800">{title}</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2 text-xs font-medium text-slate-500">
              <span
                className={`size-2 rounded-full ${serviceUp === null ? 'bg-slate-300' : serviceUp ? 'bg-emerald-500' : 'bg-red-500'}`}
              />
              {serviceUp === null ? 'Memeriksa…' : serviceUp ? 'Service aktif' : 'Service tidak aktif'}
            </span>
            <button type="button" className="btn btn-ghost" onClick={logout}>
              <LogOut className="size-4" />
              Keluar
            </button>
          </div>
        </header>

        {mobileNavOpen ? (
          <nav className="flex gap-1 border-b border-slate-200 bg-white px-4 py-2 lg:hidden">
            {NAV_ITEMS.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 [&.active]:bg-emerald-50 [&.active]:text-emerald-700"
                activeProps={{ className: 'active' }}
                onClick={() => setMobileNavOpen(false)}
              >
                {item.label}
              </Link>
            ))}
          </nav>
        ) : null}

        <main className="mx-auto w-full max-w-6xl p-4 lg:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
