import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  type WAVersion,
  type WASocket,
} from "@whiskeysockets/baileys";
import { getConfig } from "../config.js";
import {
  deleteAuthState,
  getAuthState,
  listAuthSessionIds,
} from "./auth.js";

export type ConnectionStatus =
  "connecting" | "connected" | "disconnected" | "logged_out";

export type SessionMode = "pairing" | "qr";

export interface SessionView {
  sessionId: string;
  mode: SessionMode;
  status: ConnectionStatus;
  connected: boolean;
  me: string | null;
  hasQr: boolean;
  hasPairingCode: boolean;
  pairingError: string | null;
}

export interface StartSessionOptions {
  mode: SessionMode;
  phone: string | null;
}

interface SessionHandle {
  id: string;
  mode: SessionMode;
  phone: string | null;
  sock: WASocket | null;
  status: ConnectionStatus;
  lastQr: string | null;
  pairingCode: string | null;
  pairingError: string | null;
  pairingRequestedAt: number | null;
  reconnectTimer: ReturnType<typeof setTimeout> | null;
  starting: boolean;
  generation: number;
  reconnectAttempt: number;
}

const RECONNECT_BASE_MS = 2000;
const RECONNECT_MAX_MS = 60000;
const RECONNECT_JITTER_MS = 1000;
const RESTORE_DELAY_MS = 1500;
const PAIRING_REQUEST_COOLDOWN_MS = 60000;
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]{1,32}$/;

const sessions = new Map<string, SessionHandle>();

export type SessionDownHandler = (sessionId: string, reason: string) => void;

let sessionDownHandler: SessionDownHandler | null = null;

export function setSessionDownHandler(
  handler: SessionDownHandler | null,
): void {
  sessionDownHandler = handler;
}

function notifySessionDown(handle: SessionHandle, reason: string): void {
  sessionDownHandler?.(handle.id, reason);
}

export class WaNotConnectedError extends Error {
  constructor() {
    super("WhatsApp is not connected");
    this.name = "WaNotConnectedError";
  }
}

export class SessionNotFoundError extends Error {
  constructor(sessionId: string) {
    super(`Session not found: ${sessionId}`);
    this.name = "SessionNotFoundError";
  }
}

export class SessionActiveError extends Error {
  constructor(status: ConnectionStatus) {
    super(`Session is ${status}`);
    this.name = "SessionActiveError";
  }
}

export class SessionLimitError extends Error {
  constructor(max: number) {
    super(`Maximum sessions reached (${max})`);
    this.name = "SessionLimitError";
  }
}

let versionPromise: Promise<{ version: WAVersion }> | null = null;

async function getWaVersion(): Promise<WAVersion> {
  if (!versionPromise) versionPromise = fetchLatestBaileysVersion();
  try {
    return (await versionPromise).version;
  } catch (err) {
    versionPromise = null;
    throw err;
  }
}

function createHandle(id: string, options: StartSessionOptions): SessionHandle {
  return {
    id,
    mode: options.mode,
    phone: options.phone,
    sock: null,
    status: "connecting",
    lastQr: null,
    pairingCode: null,
    pairingError: null,
    pairingRequestedAt: null,
    reconnectTimer: null,
    starting: false,
    generation: 0,
    reconnectAttempt: 0,
  };
}

function isCurrent(handle: SessionHandle, generation: number): boolean {
  return sessions.get(handle.id) === handle && handle.generation === generation;
}

function toView(handle: SessionHandle): SessionView {
  return {
    sessionId: handle.id,
    mode: handle.mode,
    status: handle.status,
    connected: handle.status === "connected",
    me: handle.sock?.user?.id ?? null,
    hasQr: handle.lastQr !== null,
    hasPairingCode: handle.pairingCode !== null,
    pairingError: handle.pairingError,
  };
}

export function toJid(to: string): string {
  if (to.includes("@")) return to;
  return `${to.replace(/\D/g, "")}@s.whatsapp.net`;
}

function clearReconnectTimer(handle: SessionHandle): void {
  if (!handle.reconnectTimer) return;
  clearTimeout(handle.reconnectTimer);
  handle.reconnectTimer = null;
}

function clearAuth(handle: SessionHandle): void {
  deleteAuthState(handle.id).catch((err) => {
    console.error(`[${handle.id}] Failed to delete auth state:`, err);
  });
}

function scheduleReconnect(handle: SessionHandle, reason: string): void {
  if (!sessions.has(handle.id) || handle.reconnectTimer) return;
  const exponential = Math.min(
    RECONNECT_MAX_MS,
    RECONNECT_BASE_MS * 2 ** handle.reconnectAttempt,
  );
  const delay = exponential + Math.floor(Math.random() * RECONNECT_JITTER_MS);
  handle.reconnectAttempt += 1;
  console.log(`[${handle.id}] Reconnecting in ${delay}ms (${reason})`);
  handle.reconnectTimer = setTimeout(() => {
    handle.reconnectTimer = null;
    void beginSocket(handle);
  }, delay);
}

async function beginSocket(handle: SessionHandle): Promise<void> {
  if (!sessions.has(handle.id) || handle.sock || handle.starting) return;
  handle.starting = true;
  handle.status = "connecting";
  const generation = ++handle.generation;

  try {
    const { state, saveCreds } = await getAuthState(handle.id);
    if (!isCurrent(handle, generation)) return;

    const version = await getWaVersion();
    if (!isCurrent(handle, generation)) return;

    const sock = makeWASocket({
      version,
      auth: {
        creds: state.creds,
        keys: makeCacheableSignalKeyStore(state.keys),
      },
      browser: Browsers.macOS("Chrome"),
    });
    handle.sock = sock;
    handle.status = "connecting";
    attachSocketHandlers(handle, sock, generation, saveCreds);
  } catch (err) {
    if (!isCurrent(handle, generation)) return;
    handle.status = "disconnected";
    console.error(`[${handle.id}] Failed to start WhatsApp socket:`, err);
    scheduleReconnect(handle, "start error");
  } finally {
    handle.starting = false;
  }
}

function attachSocketHandlers(
  handle: SessionHandle,
  sock: WASocket,
  generation: number,
  saveCreds: () => Promise<void>,
): void {
  sock.ev.on("creds.update", () => {
    if (!isCurrent(handle, generation)) return;
    void saveCreds().catch((err) => {
      console.error(`[${handle.id}] Failed to save credentials:`, err);
    });
  });

  sock.ev.on("connection.update", (update) => {
    if (!isCurrent(handle, generation)) return;
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      if (handle.mode === "qr") {
        handle.lastQr = qr;
      } else {
        void maybeRequestPairingCode(handle, sock, generation);
      }
    }

    if (connection === "open") {
      handle.lastQr = null;
      handle.pairingError = null;
      handle.reconnectAttempt = 0;
      handle.status = "connected";
      console.log(
        `[${handle.id}] WhatsApp connected: ${sock.user?.id ?? "unknown"}`,
      );
    }

    if (connection === "close") {
      if (!isCurrent(handle, generation)) return;
      handle.sock = null;
      handle.lastQr = null;
      const statusCode = (
        lastDisconnect?.error as
          { output?: { statusCode?: number } } | undefined
      )?.output?.statusCode;

      if (statusCode === DisconnectReason.loggedOut) {
        clearReconnectTimer(handle);
        clearAuth(handle);
        handle.lastQr = null;
        handle.pairingCode = null;
        handle.pairingError = null;
        handle.status = "logged_out";
        notifySessionDown(handle, "Session logged out");
        console.log(`[${handle.id}] WhatsApp logged out`);
        return;
      }

      if (!sock.authState.creds.registered) {
        handle.pairingCode = null;
        handle.pairingError = null;
      }
      handle.status = "disconnected";
      notifySessionDown(handle, "Session disconnected");
      scheduleReconnect(
        handle,
        lastDisconnect?.error?.message ?? "unknown error",
      );
    }
  });

  sock.ev.on("messages.upsert", async (upsert) => {
    if (!isCurrent(handle, generation) || upsert.type !== "notify") return;
    for (const msg of upsert.messages) {
      if (msg.key.fromMe || !msg.key.remoteJid) continue;
      const text =
        msg.message?.conversation ?? msg.message?.extendedTextMessage?.text;
      if (text?.trim().toLowerCase() !== "ping") continue;
      try {
        await sock.sendMessage(msg.key.remoteJid, { text: "pong" });
      } catch (err) {
        console.error(`[${handle.id}] Failed to reply:`, err);
      }
    }
  });
}

async function maybeRequestPairingCode(
  handle: SessionHandle,
  sock: WASocket,
  generation: number,
): Promise<void> {
  if (handle.mode !== "pairing" || !handle.phone) return;
  if (sock.authState.creds.registered) return;
  if (handle.pairingCode) return;
  const now = Date.now();
  if (
    handle.pairingRequestedAt !== null &&
    now - handle.pairingRequestedAt < PAIRING_REQUEST_COOLDOWN_MS
  ) {
    return;
  }

  handle.pairingRequestedAt = now;
  try {
    const code = await sock.requestPairingCode(handle.phone);
    if (!isCurrent(handle, generation)) return;
    handle.pairingCode = code;
    handle.pairingError = null;
    console.log(`[${handle.id}] Pairing code requested`);
  } catch (err) {
    if (!isCurrent(handle, generation)) return;
    handle.pairingError =
      err instanceof Error ? err.message : "Failed to request pairing code";
    console.error(`[${handle.id}] Pairing code request failed:`, err);
  }
}

export async function startSession(
  id: string,
  options: StartSessionOptions,
): Promise<SessionView> {
  let handle = sessions.get(id);

  if (
    handle &&
    (handle.status === "connected" ||
      handle.status === "connecting" ||
      handle.starting)
  ) {
    throw new SessionActiveError(handle.status);
  }

  if (!handle) {
    const max = getConfig().maxSessions;
    if (sessions.size >= max) throw new SessionLimitError(max);
    handle = createHandle(id, options);
    sessions.set(id, handle);
  } else {
    clearReconnectTimer(handle);
    handle.mode = options.mode;
    handle.phone = options.phone;
    handle.lastQr = null;
    handle.pairingCode = null;
    handle.pairingError = null;
    handle.pairingRequestedAt = null;
    handle.status = "connecting";
    handle.reconnectAttempt = 0;

    if (handle.sock) {
      const old = handle.sock;
      handle.sock = null;
      handle.generation++;
      try {
        await old.end(undefined);
      } catch {
        // The socket may already be closed.
      }
    }
  }

  await beginSocket(handle);
  return toView(handle);
}

export function listSessions(): SessionView[] {
  return Array.from(sessions.values()).map(toView);
}

export function getSessionView(id: string): SessionView | null {
  const handle = sessions.get(id);
  return handle ? toView(handle) : null;
}

export function getSessionQr(id: string): string | null | undefined {
  const handle = sessions.get(id);
  if (!handle) return undefined;
  return handle.mode === "qr" ? handle.lastQr : null;
}

export function getSessionPairing(
  id: string,
): { pairingCode: string | null; error: string | null } | null {
  const handle = sessions.get(id);
  if (!handle) return null;
  return { pairingCode: handle.pairingCode, error: handle.pairingError };
}

export async function logoutSession(id: string): Promise<SessionView | null> {
  const handle = sessions.get(id);
  if (!handle) return null;

  clearReconnectTimer(handle);
  notifySessionDown(handle, "Session logged out");
  handle.generation++;
  const sock = handle.sock;
  handle.sock = null;

  if (sock) {
    try {
      await sock.logout();
    } catch {
      try {
        await sock.end(undefined);
      } catch {
        // The socket may already be closed.
      }
    }
  }

  await deleteAuthState(handle.id).catch((err) => {
    console.error(`[${handle.id}] Failed to delete auth state:`, err);
  });
  handle.lastQr = null;
  handle.pairingCode = null;
  handle.pairingError = null;
  handle.pairingRequestedAt = null;
  handle.status = "logged_out";
  return toView(handle);
}

export async function deleteSession(id: string): Promise<boolean> {
  const handle = sessions.get(id);
  if (!handle) return false;

  clearReconnectTimer(handle);
  notifySessionDown(handle, "Session deleted");
  handle.generation++;
  const sock = handle.sock;
  handle.sock = null;
  sessions.delete(id);

  if (sock) {
    try {
      await sock.logout();
    } catch {
      try {
        await sock.end(undefined);
      } catch {
        // The socket may already be closed.
      }
    }
  }

  await deleteAuthState(handle.id).catch((err) => {
    console.error(`[${handle.id}] Failed to delete auth state:`, err);
  });
  return true;
}

export async function restoreSessions(): Promise<void> {
  const existing = (await listAuthSessionIds()).filter((id) =>
    SESSION_ID_PATTERN.test(id),
  );

  if (existing.length === 0) {
    console.log("No WhatsApp sessions to restore");
    return;
  }

  console.log(`Restoring ${existing.length} WhatsApp session(s)`);
  for (const [index, id] of existing.entries()) {
    if (index > 0) await sleep(RESTORE_DELAY_MS);
    if (sessions.has(id)) continue;
    try {
      const handle = createHandle(id, { mode: "qr", phone: null });
      sessions.set(id, handle);
      await beginSocket(handle);
    } catch (err) {
      console.error(`[${id}] Failed to restore session:`, err);
    }
  }
}

export async function sendText(
  sessionId: string,
  to: string,
  text: string,
): Promise<string> {
  const handle = sessions.get(sessionId);
  if (!handle) throw new SessionNotFoundError(sessionId);
  if (!handle.sock || handle.status !== "connected") {
    throw new WaNotConnectedError();
  }
  const result = await handle.sock.sendMessage(toJid(to), { text });
  if (!result) throw new Error("Message send returned no result");
  return result.key.id ?? "";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
