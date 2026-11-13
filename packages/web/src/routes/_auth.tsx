import { createFileRoute, redirect } from '@tanstack/react-router'
import { AppShell } from '~/components/AppShell'
import { hasApiKey } from '~/lib/auth'

export const Route = createFileRoute('/_auth')({
  beforeLoad: ({ location }) => {
    if (!hasApiKey()) {
      throw redirect({ to: '/login', search: { redirect: location.href } })
    }
  },
  component: () => <AppShell />,
})
