import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Hono } from 'hono'

interface PackageInfo {
  name: string
  version: string
}

let packageInfo: PackageInfo | null = null

function getPackageInfo(): PackageInfo {
  if (packageInfo) return packageInfo
  try {
    const pkg = JSON.parse(
      readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'),
    ) as { name?: string; version?: string }
    packageInfo = {
      name: pkg.name ?? 'wa-bot-service',
      version: pkg.version ?? '0.0.0',
    }
  } catch {
    packageInfo = { name: 'wa-bot-service', version: '0.0.0' }
  }
  return packageInfo
}

const app = new Hono()

app.get('/', (c) => {
  const pkg = getPackageInfo()
  return c.json({
    name: pkg.name,
    version: pkg.version,
    status: 'ok',
  })
})

export default app