import { useEffect, type ReactNode } from 'react'
import { SuccessBanner } from '~/components/ui'

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  tone = 'danger',
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  tone?: 'danger' | 'primary'
  busy?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onCancel])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      onClick={onCancel}
    >
      <div
        className="card w-full max-w-md p-6"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <h3 className="text-base font-bold text-slate-800">{title}</h3>
        <p className="mt-2 text-sm text-slate-500">{description}</p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn btn-ghost" onClick={onCancel}>
            Batal
          </button>
          <button
            type="button"
            className={`btn ${tone === 'danger' ? 'bg-red-500 text-white hover:bg-red-600' : 'btn-primary'}`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? 'Memproses…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export function Modal({
  open,
  title,
  children,
  onClose,
}: {
  open: boolean
  title: string
  children: ReactNode
  onClose: () => void
}) {
  useEffect(() => {
    if (!open) return
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 p-4"
      onClick={onClose}
    >
      <div
        className="card w-full max-w-lg p-6"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-800">{title}</h3>
          <button
            type="button"
            className="cursor-pointer rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            onClick={onClose}
            aria-label="Tutup"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

export function TokenOnceModal({
  token,
  onClose,
}: {
  token: { sessionId: string; token: string } | null
  onClose: () => void
}) {
  return (
    <Modal open={token !== null} title="Token sesi dibuat" onClose={onClose}>
      {token ? (
        <div className="space-y-3">
          <SuccessBanner message={`Token untuk sesi ${token.sessionId} berhasil dibuat.`} />
          <code className="block rounded-lg bg-slate-100 px-3 py-2.5 font-mono text-xs break-all text-slate-700">
            {token.token}
          </code>
          <p className="text-sm text-slate-500">
            Token hanya ditampilkan sekali. Salin sekarang sebelum menutup dialog ini.
          </p>
          <div className="flex justify-end">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                void navigator.clipboard?.writeText(token.token)
                onClose()
              }}
            >
              Salin & tutup
            </button>
          </div>
        </div>
      ) : null}
    </Modal>
  )
}
