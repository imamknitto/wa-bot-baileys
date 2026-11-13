import { existsSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface Config {
  port: number;
  host: string;
  dbPath: string;
  maxSessions: number;
  logRetentionDays: number;
  webhookUrl: string | null;
  webhookSecret: string | null;
  webhookMaxAttempts: number;
  webhookRetentionDays: number;
}

let cached: Config | null = null;

let projectRootCache: string | null | undefined;

/**
 * Monorepo root, detected by walking up from this file looking for
 * pnpm-workspace.yaml. Relative DB_PATH values resolve against it so the
 * database location does not depend on the process working directory.
 */
function getProjectRoot(): string | null {
  if (projectRootCache !== undefined) return projectRootCache;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth += 1) {
    if (existsSync(resolve(dir, "pnpm-workspace.yaml"))) {
      projectRootCache = dir;
      return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  projectRootCache = null;
  return null;
}

function resolveDbPath(value: string): string {
  if (isAbsolute(value)) return value;
  const root = getProjectRoot();
  return root ? resolve(root, value) : resolve(value);
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

function stringEnv(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw.trim();
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
    host: stringEnv("HOST", "0.0.0.0"),
    dbPath: resolveDbPath(pathEnv("DB_PATH", "data/app.db")),
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
