import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const dbPath = fileURLToPath(new URL('../data/.smoke-http.db', import.meta.url));
rmSync(dbPath, { force: true });
process.env.API_KEY = 'secret';
process.env.DB_PATH = dbPath;

const { initAppDb, closeAppDb } = await import('../src/db/app.ts');
const { issueSessionToken } = await import('../src/auth/session-token.ts');
initAppDb(dbPath);

const app = (await import('../src/app.ts')).default;

const tokenA = issueSessionToken('sales-a');
const tokenB = issueSessionToken('sales-b');

const request = (path, init = {}) => app.request(path, init);

// public
assert.equal((await request('/')).status, 200);

// docs (public): reference page + OpenAPI document
assert.equal((await request('/docs')).status, 200);
const openapi = await request('/docs/openapi.json');
assert.equal(openapi.status, 200);
const document = await openapi.json();
assert.equal(document.openapi, '3.1.0');
assert.ok(document.paths['/sessions/{id}/send']);
assert.ok(document.components.schemas.Error);

// no credentials
assert.equal((await request('/sessions/sales-a/status')).status, 401);
assert.equal((await request('/stats')).status, 401);

// admin key on non-existent session
assert.equal(
  (await request('/sessions/sales-a/status', { headers: { 'x-api-key': 'secret' } })).status,
  404,
);

// sales token scoped to its own session
assert.equal(
  (await request('/sessions/sales-a/status', { headers: { authorization: `Bearer ${tokenA}` } }))
    .status,
  404,
);

// sales token cannot touch another session
assert.equal(
  (await request('/sessions/sales-b/status', { headers: { authorization: `Bearer ${tokenA}` } }))
    .status,
  403,
);
assert.equal(
  (
    await request('/sessions/sales-b/send', {
      method: 'POST',
      headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' },
      body: JSON.stringify({ to: '6281234567890', text: 'hi' }),
    })
  ).status,
  403,
);

// sales token can list only its own session
const ownList = await request('/sessions', {
  headers: { authorization: `Bearer ${tokenA}` },
});
assert.equal(ownList.status, 200);
const ownListBody = await ownList.json();
assert.ok(
  ownListBody.sessions.every((session) => session.sessionId === 'sales-a'),
  'sales token only sees its own session',
);

// sales token cannot create sessions
assert.equal(
  (
    await request('/sessions', {
      method: 'POST',
      headers: { authorization: `Bearer ${tokenA}`, 'content-type': 'application/json' },
      body: JSON.stringify({ salesId: 'S-9', mode: 'qr' }),
    })
  ).status,
  403,
);

// admin-only for session lifecycle
assert.equal(
  (
    await request('/sessions/sales-a', {
      method: 'DELETE',
      headers: { authorization: `Bearer ${tokenA}` },
    })
  ).status,
  403,
);

// customers endpoint is gone
assert.equal(
  (await request('/customers', { headers: { 'x-api-key': 'secret' } })).status,
  404,
);

// stats no longer exposes customers
const stats = await request('/stats', { headers: { 'x-api-key': 'secret' } });
assert.equal(stats.status, 200);
const statsBody = await stats.json();
assert.equal('customers' in statsBody, false);

// broadcast requires inline recipients
const badBroadcast = await request('/sessions/sales-a/broadcast', {
  method: 'POST',
  headers: { 'x-api-key': 'secret', 'content-type': 'application/json' },
  body: JSON.stringify({ text: 'hi', customerIds: [1] }),
});
assert.equal(badBroadcast.status, 400);

closeAppDb();
rmSync(dbPath, { force: true });
rmSync(`${dbPath}-wal`, { force: true });
rmSync(`${dbPath}-shm`, { force: true });
console.log('http smoke ok');
