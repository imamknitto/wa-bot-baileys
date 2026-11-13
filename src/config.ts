export interface Config {
  port: number;
  dbPath: string;
  maxSessions: number;
  logRetentionDays: number;
  webhookUrl: string | null;
  webhookSecret: string | null;
  webhookMaxAttempts: number;
  webhookRetentionDays: number;
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

function optionalEnv(name: string): string | null {
  const raw = process.env[name];
  if (raw === undefined) return null;
  const value = raw.trim();
  return value === "" ? null : value;
}

export function getConfig(): Config {
  if (cached) return cached;

  const webhookUrl = optionalEnv("WEBHOOK_URL");
  const webhookSecret = optionalEnv("WEBHOOK_SECRET");
  if (webhookUrl && !webhookSecret) {
    throw new Error("WEBHOOK_SECRET is required when WEBHOOK_URL is set");
  }

  cached = {
    port: intEnv("PORT", 8365, 1, 65535),
    dbPath: pathEnv("DB_PATH", "data/app.db"),
    maxSessions: intEnv("MAX_SESSIONS", 10, 1, 1000),
    logRetentionDays: intEnv("LOG_RETENTION_DAYS", 30, 1, 3650),
    webhookUrl,
    webhookSecret,
    webhookMaxAttempts: intEnv("WEBHOOK_MAX_ATTEMPTS", 5, 1, 20),
    webhookRetentionDays: intEnv("WEBHOOK_RETENTION_DAYS", 7, 1, 365),
  };
  return cached;
}

export function isWebhookEnabled(): boolean {
  return getConfig().webhookUrl !== null;
}
