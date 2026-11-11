import { getConfig } from "../config.js";
import {
  purgeMessageLog,
  recordMessage,
  type MessageLogInput,
} from "../db/app.js";
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
  failJob,
  failSessionJobs,
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

export function initialize(): void {
  recoverInterrupted();
  rescheduleRunningJobs();
  setSessionDownHandler((sessionId, reason) => {
    failSessionJobs(sessionId, reason);
  });
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

  const jobId = createStoredJob(sessionId, {
    ...input,
    recipients: input.recipients.map((recipient) => ({
      to: toJid(recipient.to),
      text: recipient.text,
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

export function cancelJob(
  sessionId: string,
  jobId: string,
): BroadcastJobView | null {
  return cancelStoredJob(sessionId, jobId);
}

async function sendRecipient(
  sessionId: string,
  job: RunningJob,
  recipient: { id: number; position: number; toJid: string; text: string | null },
): Promise<void> {
  const text = recipient.text ?? job.text;
  try {
    const messageId = await sendText(sessionId, recipient.toJid, text);
    markSent(recipient.id, job.jobId, messageId);
    logMessage({
      sessionId,
      source: "broadcast",
      toJid: recipient.toJid,
      text,
      broadcastJobId: job.jobId,
      waMessageId: messageId,
      status: "sent",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "send failed";
    markFailed(recipient.id, job.jobId, message);
    logMessage({
      sessionId,
      source: "broadcast",
      toJid: recipient.toJid,
      text,
      broadcastJobId: job.jobId,
      status: "failed",
      error: message,
    });
    if (err instanceof WaNotConnectedError) {
      failJob(job.jobId, "WhatsApp disconnected");
      return;
    }
  }

  scheduleNext(job.jobId, recipient.position, job.delayMinMs, job.delayMaxMs);
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
      return;
    }
    if (!session.connected) return;

    const recipient = getNextDueRecipient(job.jobId, Date.now());
    if (!recipient) {
      if (!hasPending(job.jobId)) completeIfDone(job.jobId);
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