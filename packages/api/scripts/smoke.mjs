import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dbPath = fileURLToPath(new URL('../data/.smoke.db', import.meta.url));
rmSync(dbPath, { force: true });
process.env.API_KEY = 'secret';
process.env.DB_PATH = dbPath;
process.env.WEBHOOK_URL = 'http://example.test/hook';
process.env.WEBHOOK_SECRET = 'whsec';

const { initAppDb, getSessionMeta, setSessionMeta, listRecentMessages, recordMessage, findMessageByReference } =
  await import('../src/db/app.ts');
const tokens = await import('../src/auth/session-token.ts');
const store = await import('../src/broadcast/store.ts');
const webhook = await import('../src/webhook/store.ts');

initAppDb(dbPath);

// session meta
setSessionMeta('sales-12', 'S-12', 'A-3');
assert.equal(getSessionMeta('sales-12').salesId, 'S-12');
assert.equal(getSessionMeta('sales-12').agentId, 'A-3');

// tokens
const token = tokens.issueSessionToken('sales-12');
assert.equal(tokens.resolveSessionToken(token).sessionId, 'sales-12');
const rotated = tokens.issueSessionToken('sales-12');
assert.equal(tokens.resolveSessionToken(token), null, 'old token revoked');
assert.equal(tokens.resolveSessionToken(rotated).sessionId, 'sales-12');
tokens.revokeSessionTokens('sales-12');
assert.equal(tokens.resolveSessionToken(rotated), null);

// message log + reference idempotency
recordMessage({
  sessionId: 'sales-12',
  source: 'send',
  toJid: '628111@s.whatsapp.net',
  text: 'hi',
  status: 'sent',
  salesId: 'S-12',
  agentId: 'A-3',
  customerRef: 'CUST-1',
  recipientName: 'Budi',
  referenceId: 'ref-1',
});
const found = findMessageByReference('sales-12', 'ref-1');
assert.equal(found.customerId, 'CUST-1');
assert.equal(found.customerName, 'Budi');
assert.equal(found.salesId, 'S-12');
const recent = listRecentMessages(5, 'sales-12');
assert.equal(recent[0].customerName, 'Budi');

let duplicateError = null;
try {
  recordMessage({
    sessionId: 'sales-12',
    source: 'send',
    toJid: '628111@s.whatsapp.net',
    text: 'hi',
    status: 'sent',
    referenceId: 'ref-1',
  });
} catch (err) {
  duplicateError = err;
}
assert.ok(duplicateError, 'duplicate referenceId must be rejected');

// broadcast job recipients carry customer refs
const jobId = store.createJob('sales-12', {
  text: 'promo',
  delayMinMs: 10000,
  delayMaxMs: 20000,
  salesId: 'S-12',
  referenceId: 'job-ref-1',
  recipients: [
    { to: '628111@s.whatsapp.net', text: 'promo', customerRef: 'CUST-1', recipientName: 'Budi' },
  ],
});
assert.equal(store.findJobByReference('sales-12', 'job-ref-1'), jobId);
const view = store.getJobView('sales-12', jobId);
assert.equal(view.referenceId, 'job-ref-1');
assert.equal(view.total, 1);

// webhook queue
webhook.enqueueWebhook('message.sent', 'sales-12', {
  eventId: webhook.newEventId(),
  type: 'message.sent',
  occurredAt: Date.now(),
  salesId: 'S-12',
  agentId: 'A-3',
  sessionId: 'sales-12',
  referenceId: 'ref-1',
  customerId: 'CUST-1',
  customerName: 'Budi',
  to: '628111@s.whatsapp.net',
  text: 'hi',
  messageId: '3EB0',
  status: 'sent',
});
const due = webhook.claimDueEvents(10);
assert.equal(due.length, 1);
assert.equal(due[0].type, 'message.sent');
webhook.markAttemptFailed(due[0].id, 1, 'boom');
assert.equal(webhook.claimDueEvents(10).length, 0, 'backoff delays retry');
assert.equal(webhook.claimDueEvents(10, Date.now() + 6000).length, 1);
webhook.markDelivered(due[0].id);
assert.equal(webhook.claimDueEvents(10, Date.now() + 600000).length, 0);

const { closeAppDb } = await import('../src/db/app.ts');
closeAppDb();
rmSync(dbPath, { force: true });
rmSync(`${dbPath}-wal`, { force: true });
rmSync(`${dbPath}-shm`, { force: true });
console.log('smoke ok');
