import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState, type ReactNode } from 'react'
import { Card, CardHeader, ErrorBanner, SuccessBanner } from '~/components/ui'
import { api } from '~/lib/api'
import { loadDelay, saveDelay, type DelaySetting } from '~/lib/delay'
import type { ServiceInfo } from '~/lib/types'

export const Route = createFileRoute('/_auth/settings')({
  component: SettingsPage,
})

function SettingsPage(): ReactNode {
  const [delay, setDelay] = useState<DelaySetting>(() => loadDelay())
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [service, setService] = useState<ServiceInfo | null>(null)
  const [serviceError, setServiceError] = useState<string | null>(null)

  const save = () => {
    if (delay.minSeconds < 10 || delay.maxSeconds > 600 || delay.maxSeconds < delay.minSeconds) {
      setError('Delay harus 10–600 detik dan maksimal ≥ minimal.')
      setSaved(false)
      return
    }
    setError(null)
    saveDelay(delay)
    setSaved(true)
  }

  useEffect(() => {
    const loadServiceInfo = async () => {
      try {
        setService(await api<ServiceInfo>('/'))
        setServiceError(null)
      } catch (err) {
        setServiceError(err instanceof Error ? err.message : 'Gagal mengambil info service.')
      }
    }
    void loadServiceInfo()
  }, [])

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader
          title="Default delay broadcast"
          description="Jeda acak per pesan antar penerima untuk meniru perilaku manusia. Dipakai sebagai nilai awal form broadcast."
        />
        <div className="space-y-4 px-5 py-5">
          <div className="grid max-w-md gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="settingMin">
                Minimum (detik)
              </label>
              <input
                id="settingMin"
                className="input"
                type="number"
                min={10}
                max={600}
                value={delay.minSeconds}
                onChange={(event) => setDelay({ ...delay, minSeconds: Number(event.target.value) })}
              />
            </div>
            <div>
              <label className="label" htmlFor="settingMax">
                Maksimum (detik)
              </label>
              <input
                id="settingMax"
                className="input"
                type="number"
                min={10}
                max={600}
                value={delay.maxSeconds}
                onChange={(event) => setDelay({ ...delay, maxSeconds: Number(event.target.value) })}
              />
            </div>
          </div>
          <p className="text-xs text-slate-400">
            Batas yang diterima service: 10–600 detik (10.000–600.000 ms).
          </p>
          {error ? <ErrorBanner message={error} /> : null}
          {saved ? <SuccessBanner message="Default delay tersimpan." /> : null}
          <button type="button" className="btn btn-primary" onClick={save}>
            Simpan
          </button>
        </div>
      </Card>

      <Card>
        <CardHeader title="Info service" description="Identitas service WhatsApp gateway" />
        <div className="px-5 py-5 text-sm">
          {serviceError ? <ErrorBanner message={serviceError} /> : null}
          {service ? (
            <dl className="grid max-w-md grid-cols-[120px_1fr] gap-y-2">
              <dt className="text-slate-500">Nama</dt>
              <dd className="font-semibold text-slate-700">{service.name}</dd>
              <dt className="text-slate-500">Versi</dt>
              <dd className="font-mono text-slate-700">{service.version}</dd>
              <dt className="text-slate-500">Status</dt>
              <dd className="font-semibold text-emerald-700">{service.status}</dd>
            </dl>
          ) : (
            <p className="text-slate-400">Memuat info service…</p>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader title="Catatan privasi & keamanan" />
        <ul className="list-inside list-disc space-y-1.5 px-5 py-5 text-sm text-slate-500">
          <li>Service tidak menyimpan data pelanggan; penerima hanya dipakai saat pengiriman.</li>
          <li>Isi pesan masuk tidak pernah disimpan; hanya pesan keluar yang dicatat.</li>
          <li>API key hanya tersimpan di tab browser ini dan hilang saat tab ditutup.</li>
          <li>Token per sesi hanya ditampilkan sekali saat dibuat atau dirotasi.</li>
        </ul>
      </Card>
    </div>
  )
}
