import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Hono } from 'hono'

interface PackageInfo {
  name: string
  version: string
}

const FALLBACK: PackageInfo = { name: 'wa-bot-service', version: '0.0.0' }

let packageInfo: PackageInfo | null = null

function packageInfoPaths(): string[] {
  const paths: string[] = []
  try {
    paths.push(fileURLToPath(new URL('../package.json', import.meta.url)))
  } catch {
    // Bundlers (Hono CLI) may expose a non-file module URL; fall through to cwd.
  }
  paths.push(resolve(process.cwd(), 'packages/api/package.json'))
  paths.push(resolve(process.cwd(), 'package.json'))
  return paths
}

function getPackageInfo(): PackageInfo {
  if (packageInfo) return packageInfo
  for (const path of packageInfoPaths()) {
    try {
      const pkg = JSON.parse(readFileSync(path, 'utf8')) as {
        name?: string
        version?: string
      }
      if (typeof pkg.name === 'string') {
        packageInfo = { name: pkg.name, version: pkg.version ?? '0.0.0' }
        return packageInfo
      }
    } catch {
      // Try the next candidate.
    }
  }
  return FALLBACK
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
