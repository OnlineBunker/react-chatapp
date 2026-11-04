// Self-check: needs Mongo on localhost:27017 (docker compose up -d mongo). Uses a throwaway DB.
const assert = require('assert');
const { MongoClient } = require('mongodb');
const { makeApp } = require('./server');
(async () => {
  const client = await MongoClient.connect('mongodb://localhost:27017');
  const db = client.db('chatapp_test'); await db.dropDatabase();
  const srv = (await makeApp(db)).listen(0);
  const base = `http://localhost:${srv.address().port}`;
  const call = async (who, method, path, body) => {
    const r = await fetch(base + path, { method, headers: { Authorization: `Basic ${who}`, 'Content-Type': 'application/json' }, body: body && JSON.stringify(body) });
    return { status: r.status, body: await r.json() };
  };
  const a = (await call('alice:pw', 'GET', '/user/profile')).body;
  const b = (await call('bob:pw', 'GET', '/user/profile')).body;
  assert.equal((await call('alice:wrong', 'GET', '/user')).status, 401);
  const dm = (await call('alice:pw', 'POST', '/conversation', { type: 'DM', participants_ids: [b.id] })).body;
  assert.equal(dm.name, '[DM] bob');
  assert.equal((await call('bob:pw', 'POST', '/conversation', { type: 'DM', participants_ids: [a.id] })).body.id, dm.id); // dedup
  for (let i = 0; i < 25; i++) await call('alice:pw', 'POST', '/message', { conversation_id: dm.id, content: 'm' + i });
  const p1 = (await call('bob:pw', 'GET', `/message?conversation_id=${dm.id}`)).body;
  assert.equal(p1.count, 20); assert.equal(p1.data.at(-1).content, 'm24');
  const p2 = (await call('bob:pw', 'GET', `/message?conversation_id=${dm.id}&from_message_cursor=${p1.nextCursor}`)).body;
  assert.equal(p2.count, 5); assert.equal(p2.nextCursor, null);
  assert.equal((await call('alice:pw', 'POST', '/message', { conversation_id: dm.id })).status, 400);
  const c = (await call('carol:pw', 'GET', '/user/profile')).body;
  assert.equal((await call('carol:pw', 'GET', `/message?conversation_id=${dm.id}`)).status, 404); // not a participant
  console.log('ok'); srv.close(); await client.close();
})().catch((e) => { console.error(e); process.exit(1); });
