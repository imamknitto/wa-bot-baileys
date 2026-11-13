import { createRootRoute, Link, Outlet } from '@tanstack/react-router'

export const Route = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: () => (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-100 p-6 text-center">
      <p className="text-3xl font-extrabold text-slate-800">404</p>
      <p className="text-sm text-slate-500">
        Halaman yang kamu cari tidak ada atau sudah dipindahkan.
      </p>
      <Link to="/" className="btn btn-primary mt-2">
        Kembali
      </Link>
    </div>
  ),
  errorComponent: ({ error }) => (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-100 p-6 text-center">
      <p className="text-xl font-bold text-slate-800">Terjadi kesalahan</p>
      <p className="max-w-md text-sm text-slate-500">
        {error instanceof Error ? error.message : 'Kesalahan tidak diketahui.'}
      </p>
      <button
        type="button"
        className="btn btn-primary mt-2"
        onClick={() => window.location.reload()}
      >
        Muat ulang
      </button>
    </div>
  ),
})
