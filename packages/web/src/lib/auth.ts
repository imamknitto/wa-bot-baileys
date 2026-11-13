const KEY = 'wa_platform_api_key'

export function getApiKey(): string | null {
  return sessionStorage.getItem(KEY)
}

export function setApiKey(value: string): void {
  sessionStorage.setItem(KEY, value)
}

export function clearApiKey(): void {
  sessionStorage.removeItem(KEY)
}

export function hasApiKey(): boolean {
  return getApiKey() !== null
}
