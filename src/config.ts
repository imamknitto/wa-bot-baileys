export interface Config {
  port: number;
  authDbPath: string;
  appDbPath: string;
  maxSessions: number;
  logRetentionDays: number;
}

let cached: Config | null = null;

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function pathEnv(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = raw.trim();
  if (!value) throw new Error(`${name} must not be empty`);
  return value;
}

export function getConfig(): Config {
  if (cached) return cached;
  cached = {
    port: intEnv("PORT", 3000, 1, 65535),
    authDbPath: pathEnv("AUTH_DB_PATH", "data/auth.db"),
    appDbPath: pathEnv("APP_DB_PATH", "data/app.db"),
    maxSessions: intEnv("MAX_SESSIONS", 10, 1, 1000),
    logRetentionDays: intEnv("LOG_RETENTION_DAYS", 30, 1, 3650),
  };
  return cached;
}