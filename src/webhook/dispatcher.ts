import { createHmac } from 'node:crypto'
import { getConfig } from '../config.js'
import {
  claimDueEvents,
  markAttemptFailed,
  markDelivered,
  purgeWebhookEvents,
  type WebhookEventRow,
} from './store.js'

const DISPATCH_INTERVAL_MS = 2000;
const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 10000;
const BATCH_SIZE = 20;

let dispatchTimer: ReturnType<typeof setInterval> | null = null;
let purgeTimer: ReturnType<typeof setInterval> | null = null;
let dispatching = false;

function sign(secret: string, timestamp: number, body: string): string {
  return createHmac('sha256', secret)
    .update(`${timestamp}.${body}`)
    .digest('hex');
}

async function deliverEvent(event: WebhookEventRow): Promise<void> {
  const config = getConfig();
  if (!config.webhookUrl || !config.webhookSecret) return;

  const timestamp = Date.now();
  const signature = sign(config.webhookSecret, timestamp, event.payload);

  try {
    const res = await fetch(config.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-wa-event': event.type,
        'x-wa-event-id': event.id,
        'x-wa-timestamp': String(timestamp),
        'x-wa-signature': `sha256=${signature}`,
      },
      body: event.payload,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (res.ok) {
      markDelivered(event.id);
      return;
    }
    const text = await res.text().catch(() => '');
    markAttemptFailed(
      event.id,
      event.attempts + 1,
      `HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ''}`,
    );
  } catch (err) {
    markAttemptFailed(
      event.id,
      event.attempts + 1,
      err instanceof Error ? err.message : 'webhook request failed',
    );
  }
}

async function dispatch(): Promise<void> {
  if (dispatching) return;
  const config = getConfig();
  if (!config.webhookUrl) return;

  dispatching = true;
  try {
    for (const event of claimDueEvents(BATCH_SIZE)) {
      await deliverEvent(event);
    }
  } catch (err) {
    console.error('Webhook dispatch failed:', err);
  } finally {
    dispatching = false;
  }
}

function purge(): void {
  try {
    purgeWebhookEvents(getConfig().webhookRetentionDays);
  } catch (err) {
    console.error('Failed to purge webhook events:', err);
  }
}

export function start(): void {
  if (dispatchTimer) return;
  purge();
  dispatchTimer = setInterval(() => {
    void dispatch();
  }, DISPATCH_INTERVAL_MS);
  purgeTimer = setInterval(purge, PURGE_INTERVAL_MS);
}

export function stop(): void {
  if (dispatchTimer) clearInterval(dispatchTimer);
  if (purgeTimer) clearInterval(purgeTimer);
  dispatchTimer = null;
  purgeTimer = null;
}
