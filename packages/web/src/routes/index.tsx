import { createFileRoute, redirect } from '@tanstack/react-router'
import { hasApiKey } from '~/lib/auth'

export const Route = createFileRoute('/')({
  beforeLoad: () => {
    throw redirect({ to: hasApiKey() ? '/overview' : '/login' })
  },
})