// Small replica of the NestJS chat backend: same routes, same "Basic user:pass" auth (auto-creates users).
const express = require('express');
const { MongoClient, ObjectId } = require('mongodb');

const PAGE = 20;
const asId = (d) => d && { ...d, id: String(d._id), _id: undefined };
const oid = (s) => (ObjectId.isValid(s) ? new ObjectId(s) : null);
const bad = (code, message) => Object.assign(new Error(message), { code });

async function makeApp(db) {
  const users = db.collection('users');
  const convs = db.collection('conversations');
  const msgs = db.collection('messages');
  await users.createIndex({ name: 1 }, { unique: true });

  const app = express();
  app.use(express.json({ limit: '10mb' }));

  // Auth: "Authorization: Basic <username>:<password>" (plain text). Unknown username => created.
  app.use(async (req, res, next) => {
    try {
      const h = req.headers.authorization || '';
      const cred = h.startsWith('Basic ') ? h.slice(6).trim() : '';
      const i = cred.indexOf(':');
      const name = cred.slice(0, i).trim();
      const pass = cred.slice(i + 1).trim();
      if (i < 0 || !name || !pass) throw bad(401, 'Expected Authorization: Basic <username>:<password>');
      let u = await users.findOne({ name });
      if (!u) {
        await users.updateOne({ name }, { $setOnInsert: { name, password: pass, bio: null } }, { upsert: true });
        u = await users.findOne({ name });
      }
      if (u.password !== pass) throw bad(401, `Invalid password for user '${name}'`);
      req.user = u;
      next();
    } catch (e) { next(e); }
  });

  const wrap = (fn) => (req, res, next) => fn(req, res).then((r) => res.status(req.method === 'POST' ? 201 : 200).json(r), next);
  const pub = (u) => ({ id: String(u._id), name: u.name, bio: u.bio });

  app.get('/user', wrap(async () => (await users.find().sort({ name: 1 }).toArray()).map(pub)));

  app.get('/user/profile', wrap(async (req) => {
    if (!req.query.user_id) return pub(req.user);
    const id = oid(req.query.user_id);
    const u = id && (await users.findOne({ _id: id }));
    if (!u) throw bad(404, 'User not found');
    return pub(u);
  }));

  const convOut = (c) => ({ ...asId(c), participants_ids: c.participants_ids.map(String), createdBy: String(c.createdBy) });

  app.get('/conversation', wrap(async (req) =>
    (await convs.find({ participants_ids: req.user._id }).sort({ createdAt: -1 }).toArray()).map(convOut)));

  app.post('/conversation', wrap(async (req) => {
    const { type, name, participants_ids } = req.body;
    const others = [...new Set(participants_ids || [])].filter((s) => s !== String(req.user._id));
    if (!others.length) throw bad(400, 'At least one other participant is required');
    const ids = others.map(oid);
    if (ids.includes(null)) throw bad(400, 'Invalid participant id');
    const found = await users.find({ _id: { $in: ids } }).toArray();
    if (found.length !== ids.length) throw bad(404, 'One or more participant users not found');

    const t = type || (ids.length > 1 ? 'GROUP' : 'DM');
    if (t === 'DM') {
      if (ids.length !== 1) throw bad(400, 'A DM has exactly one other participant');
      const existing = await convs.findOne({ type: 'DM', participants_ids: { $all: [req.user._id, ids[0]] } });
      if (existing) return convOut(existing);
    }
    const doc = {
      type: t,
      name: t === 'DM' ? `[DM] ${found[0].name}` : name || null,
      createdAt: new Date(),
      createdBy: req.user._id,
      participants_ids: [req.user._id, ...ids],
    };
    doc._id = (await convs.insertOne(doc)).insertedId;
    return convOut(doc);
  }));

  // Cursor pagination: newest PAGE messages (older than cursor if given), returned oldest-first.
  app.get('/message', wrap(async (req) => {
    const cid = oid(req.query.conversation_id);
    if (!cid) throw bad(400, 'conversation_id is required and must be a valid id');
    const conv = await convs.findOne({ _id: cid, participants_ids: req.user._id });
    if (!conv) throw bad(404, 'Conversation not found');
    const q = { conversationId: cid };
    if (req.query.from_message_cursor) {
      const c = oid(req.query.from_message_cursor);
      if (!c || !(await msgs.findOne({ _id: c }))) throw bad(404, 'Cursor message not found');
      q._id = { $lt: c };
    }
    const page = await msgs.find(q).sort({ _id: -1 }).limit(PAGE).toArray();
    const out = (m) => ({ ...asId(m), senderId: String(m.senderId), conversationId: String(m.conversationId) });
    return {
      data: page.reverse().map(out),
      nextCursor: page.length === PAGE ? String(page[0]._id) : null,
      count: page.length,
    };
  }));

  app.post('/message', wrap(async (req) => {
    const { conversation_id, content, imageInfo } = req.body;
    if (!content && !imageInfo) throw bad(400, 'Message must contain content or imageInfo');
    const cid = oid(conversation_id);
    const conv = cid && (await convs.findOne({ _id: cid, participants_ids: req.user._id }));
    if (!conv) throw bad(404, 'Conversation not found');
    const status = {};
    for (const p of conv.participants_ids) status[p] = { delivered: p.equals(req.user._id), read: p.equals(req.user._id) };
    const m = {
      content: content || null,
      imageInfo: imageInfo ? (imageInfo.startsWith('data:') ? imageInfo : `data:image/jpeg;base64,${imageInfo}`) : null,
      createdAt: new Date(), senderId: req.user._id, conversationId: cid, status,
    };
    m._id = (await msgs.insertOne(m)).insertedId;
    console.log(`[MSG] ${conv.name || conv.type} | ${req.user.name}: ${content || '[IMG]'}`);
    return { ...asId(m), senderId: String(m.senderId), conversationId: String(cid) };
  }));

  app.use((err, req, res, next) => {
    if (!err.code) console.error(err);
    res.status(err.code || 500).json({ message: err.code ? err.message : 'Internal error' });
  });
  return app;
}

module.exports = { makeApp };

if (require.main === module) {
  (async () => {
    const client = await MongoClient.connect(process.env.MONGO_URL || 'mongodb://localhost:27017');
    const app = await makeApp(client.db('chatapp'));
    app.listen(process.env.PORT || 3000, () => console.log('API on :' + (process.env.PORT || 3000)));
  })();
}
