import { createFileRoute, redirect } from '@tanstack/react-router'
import { useState, type FormEvent, type ReactNode } from 'react'
import { MessageCircle } from 'lucide-react'
import { api } from '~/lib/api'
import { hasApiKey, setApiKey } from '~/lib/auth'
import type { Stats } from '~/lib/types'

type LoginSearch = { redirect?: string }

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    redirect:
      typeof search.redirect === 'string' ? search.redirect : undefined,
  }),
  beforeLoad: () => {
    if (hasApiKey()) throw redirect({ to: '/overview' })
  },
  component: LoginPage,
})

function LoginPage(): ReactNode {
  const search = Route.useSearch()
  const [apiKey, setKey] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    const value = apiKey.trim()
    if (!value) {
      setError('Masukkan API key terlebih dahulu.')
      return
    }
    setBusy(true)
    setError(null)
    setApiKey(value)
    try {
      await api<Stats>('/stats')
      const target = search.redirect
      if (target && target.startsWith('/app/')) {
        window.location.assign(target)
        return
      }
      window.location.assign('/app/overview')
    } catch (err) {
      setBusy(false)
      setError(err instanceof Error ? err.message : 'Gagal memvalidasi API key.')
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-100 p-4">
      <div className="card w-full max-w-sm p-7">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-emerald-500 text-white">
            <MessageCircle className="size-6" />
          </div>
          <div>
            <h1 className="text-lg font-extrabold text-slate-900">
              Masuk ke WA Platform
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              Gunakan API key admin untuk mengelola sesi WhatsApp.
            </p>
          </div>
        </div>
        <form onSubmit={submit} noValidate>
          <label className="label" htmlFor="apiKey">
            API key
          </label>
          <input
            id="apiKey"
            className="input"
            type="password"
            autoComplete="off"
            autoFocus
            placeholder="x-api-key"
            value={apiKey}
            onChange={(event) => setKey(event.target.value)}
          />
          {error ? (
            <p className="mt-2 text-sm font-medium text-red-600" role="alert">
              {error}
            </p>
          ) : null}
          <button
            type="submit"
            className="btn btn-primary mt-5 w-full"
            disabled={busy}
          >
            {busy ? 'Memeriksa…' : 'Masuk'}
          </button>
        </form>
        <p className="mt-4 text-center text-xs text-slate-400">
          API key disimpan di tab ini saja dan hilang saat tab ditutup.
        </p>
      </div>
    </div>
  )
}
