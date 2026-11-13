import { getConfig } from "../config.js";
import {
  getSessionMeta,
  purgeMessageLog,
  recordMessage,
  type MessageLogInput,
} from "../db/app.js";
import {
  enqueueWebhook,
  newEventId,
  type BroadcastWebhookPayload,
} from "../webhook/store.js";
import {
  SessionNotFoundError,
  WaNotConnectedError,
  getSessionView,
  sendText,
  setSessionDownHandler,
  toJid,
} from "../wa/manager.js";
import {
  BroadcastBusyError,
  BroadcastNotRunningError,
  cancelJob as cancelStoredJob,
  createJob as createStoredJob,
  drainFinishedJobs,
  failJob,
  failSessionJobs,
  getJobSessionId,
  getJobView,
  getNextDueRecipient,
  getRunningJob,
  hasPending,
  listRunningJobs,
  markFailed,
  markSending,
  markSent,
  recoverInterrupted,
  rescheduleRunningJobs,
  scheduleNext,
  setJobFinishedHandler,
  completeIfDone,
  type BroadcastInput,
  type BroadcastJobView,
  type RunningJob,
} from "./store.js";

export {
  BroadcastBusyError,
  BroadcastNotRunningError,
  type BroadcastInput,
  type BroadcastJobView,
};

const TICK_INTERVAL_MS = 1000;
const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

const pumping = new Set<string>();
let tickTimer: ReturnType<typeof setInterval> | null = null;
let purgeTimer: ReturnType<typeof setInterval> | null = null;

function logMessage(input: MessageLogInput): void {
  try {
    recordMessage(input);
  } catch (err) {
    console.error(`[${input.sessionId}] Failed to record message:`, err);
  }
}

function purge(): void {
  try {
    purgeMessageLog(getConfig().logRetentionDays);
  } catch (err) {
    console.error("Failed to purge message log:", err);
  }
}

function emitJobEvent(jobId: string): void {
  const sessionId = getJobSessionId(jobId);
  if (!sessionId) return;
  const job = getJobView(sessionId, jobId);
  if (!job) return;
  if (job.status !== "completed" && job.status !== "failed" && job.status !== "cancelled") {
    return;
  }

  const meta = getSessionMeta(sessionId);
  const payload: BroadcastWebhookPayload = {
    eventId: newEventId(),
    type: `broadcast.${job.status}`,
    occurredAt: Date.now(),
    salesId: meta?.salesId ?? null,
    agentId: meta?.agentId ?? null,
    sessionId,
    referenceId: job.referenceId,
    jobId: job.jobId,
    status: job.status,
    total: job.total,
    sent: job.sent,
    failed: job.failed,
    results: job.results.map((result) => ({
      customerId: result.customerId,
      customerName: result.customerName,
      to: result.to,
      ok: result.ok,
      ...(result.messageId === undefined ? {} : { messageId: result.messageId }),
      ...(result.error === undefined ? {} : { error: result.error }),
      sentAt: result.sentAt,
    })),
    ...(job.error === null ? {} : { error: job.error }),
  };
  enqueueWebhook(payload.type, sessionId, payload);
}

export function initialize(): void {
  setJobFinishedHandler(emitJobEvent);
  setSessionDownHandler((sessionId, reason) => {
    failSessionJobs(sessionId, reason);
    drainFinishedJobs();
  });
  recoverInterrupted();
  rescheduleRunningJobs();
  drainFinishedJobs();
}

export function start(): void {
  if (tickTimer) return;
  purge();
  tickTimer = setInterval(() => {
    void tick();
  }, TICK_INTERVAL_MS);
  purgeTimer = setInterval(purge, PURGE_INTERVAL_MS);
}

export function stop(): void {
  if (tickTimer) clearInterval(tickTimer);
  if (purgeTimer) clearInterval(purgeTimer);
  tickTimer = null;
  purgeTimer = null;
}

export function createJob(
  sessionId: string,
  input: BroadcastInput,
): BroadcastJobView {
  const session = getSessionView(sessionId);
  if (!session) throw new SessionNotFoundError(sessionId);
  if (!session.connected) throw new WaNotConnectedError();

  const meta = getSessionMeta(sessionId);
  const jobId = createStoredJob(sessionId, {
    ...input,
    salesId: meta?.salesId ?? null,
    recipients: input.recipients.map((recipient) => ({
      ...recipient,
      to: toJid(recipient.to),
    })),
  });

  void pump(sessionId).catch((err) => {
    console.error(`[${sessionId}] Broadcast pump failed:`, err);
  });

  const view = getJobView(sessionId, jobId);
  if (!view) throw new Error(`Broadcast job ${jobId} was not created`);
  return view;
}

export function getJob(
  sessionId: string,
  jobId: string,
): BroadcastJobView | null {
  return getJobView(sessionId, jobId);
}

export function getRunningJobView(
  sessionId: string,
): BroadcastJobView | null {
  const running = getRunningJob(sessionId);
  if (!running) return null;
  return getJobView(sessionId, running.jobId);
}

export function cancelJob(
  sessionId: string,
  jobId: string,
): BroadcastJobView | null {
  const job = cancelStoredJob(sessionId, jobId);
  drainFinishedJobs();
  return job;
}

async function sendRecipient(
  sessionId: string,
  job: RunningJob,
  recipient: {
    id: number;
    position: number;
    toJid: string;
    text: string | null;
    customerRef: string | null;
    recipientName: string | null;
  },
): Promise<void> {
  const text = recipient.text ?? job.text;
  const meta = getSessionMeta(sessionId);
  const baseLog = {
    sessionId,
    source: "broadcast" as const,
    toJid: recipient.toJid,
    text,
    broadcastJobId: job.jobId,
    salesId: meta?.salesId ?? job.salesId,
    agentId: meta?.agentId ?? null,
    customerRef: recipient.customerRef,
    recipientName: recipient.recipientName,
  };
  try {
    const messageId = await sendText(sessionId, recipient.toJid, text);
    markSent(recipient.id, job.jobId, messageId);
    logMessage({ ...baseLog, waMessageId: messageId, status: "sent" });
  } catch (err) {
    const message = err instanceof Error ? err.message : "send failed";
    markFailed(recipient.id, job.jobId, message);
    logMessage({ ...baseLog, status: "failed", error: message });
    if (err instanceof WaNotConnectedError) {
      failJob(job.jobId, "WhatsApp disconnected");
      drainFinishedJobs();
      return;
    }
  }

  scheduleNext(job.jobId, recipient.position, job.delayMinMs, job.delayMaxMs);
  drainFinishedJobs();
}

async function pump(sessionId: string): Promise<void> {
  if (pumping.has(sessionId)) return;
  pumping.add(sessionId);
  try {
    const job = getRunningJob(sessionId);
    if (!job) return;

    const session = getSessionView(sessionId);
    if (!session || session.status === "logged_out") {
      failJob(job.jobId, "Session is not available");
      drainFinishedJobs();
      return;
    }
    if (!session.connected) return;

    const recipient = getNextDueRecipient(job.jobId, Date.now());
    if (!recipient) {
      if (!hasPending(job.jobId)) {
        completeIfDone(job.jobId);
        drainFinishedJobs();
      }
      return;
    }

    if (!markSending(recipient.id, job.jobId)) return;
    await sendRecipient(sessionId, job, recipient);
  } finally {
    pumping.delete(sessionId);
  }
}

async function tick(): Promise<void> {
  for (const sessionId of listRunningJobs()) {
    try {
      await pump(sessionId);
    } catch (err) {
      console.error(`[${sessionId}] Broadcast tick failed:`, err);
    }
  }
}
