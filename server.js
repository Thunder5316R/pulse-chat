// Pulse Chat — zero-dependency real-time chat server (Node 18+)
// Transport: Server-Sent Events (server -> client) + fetch POST (client -> server)
const http = require('http'), fs = require('fs'), path = require('path'),
      crypto = require('crypto'), zlib = require('zlib');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const DB = process.env.DB_FILE || path.join(__dirname, 'data.json');
const KEEP = 200, INIT = 60, MAX_BODY = 1e6, MAX_IMG = 7e5;

// ---------- state ----------
let S = { users: {}, rooms: { general: room('general', 'General', 'group') } };
try { S = JSON.parse(fs.readFileSync(DB, 'utf8')); } catch {}
let dirty = false;
setInterval(() => { if (dirty) { dirty = false; fs.writeFile(DB, JSON.stringify(S), () => {}); } }, 5000);

function room(id, name, type, members) { return { id, name, type, members, read: {}, msgs: [] }; }
const clients = new Map();                       // userId -> Set<res>
const pid = k => crypto.createHash('sha256').update(String(k)).digest('hex').slice(0, 12);
const nid = () => Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
const online = id => clients.has(id);
const canSee = (r, id) => r.type !== 'dm' || r.members.includes(id);
const pubUser = u => ({ ...u, online: online(u.id) });
const view = r => ({ ...r, msgs: r.msgs.slice(-INIT) });

function emit(id, ev, data) {
  const set = clients.get(id); if (!set) return;
  const s = `event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of set) res.write(s);
}
function toRoom(r, ev, data, except) {
  const ids = r.type === 'dm' ? r.members : [...clients.keys()];
  for (const id of ids) if (id !== except) emit(id, ev, data);
}
const toAll = (ev, data, except) => { for (const id of clients.keys()) if (id !== except) emit(id, ev, data); };

// keep connections alive behind proxies (Render, Nginx...)
setInterval(() => { for (const set of clients.values()) for (const res of set) res.write(':\n\n'); }, 20000);

// ---------- static files (gzipped & cached in memory) ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.css': 'text/css', '.webmanifest': 'application/manifest+json' };
const cache = {};
function serve(req, res, p) {
  if (p === '/') p = '/index.html';
  const file = path.join(PUB, path.normalize(p).replace(/^(\.\.[\/\\])+/, ''));
  if (!file.startsWith(PUB)) return end(res, 403);
  let c = cache[file];
  if (!c) {
    try { const raw = fs.readFileSync(file); c = cache[file] = { raw, gz: zlib.gzipSync(raw) }; }
    catch { return end(res, 404); }
  }
  const type = MIME[path.extname(file)] || 'application/octet-stream';
  const gz = /gzip/.test(req.headers['accept-encoding'] || '') && !type.startsWith('image/png');
  res.writeHead(200, { 'Content-Type': type + '; charset=utf-8',
    'Cache-Control': p.endsWith('.html') || p.endsWith('sw.js') ? 'no-cache' : 'public, max-age=86400',
    ...(gz ? { 'Content-Encoding': 'gzip' } : {}) });
  res.end(gz ? c.gz : c.raw);
}
function end(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj || { ok: code < 300 }));
}

// ---------- API actions ----------
const A = {
  send(me, b) {
    const r = getRoom(me, b.room); if (!r) return 404;
    const text = String(b.text || '').slice(0, 4000).trim();
    const img = typeof b.img === 'string' && b.img.startsWith('data:image/') && b.img.length < MAX_IMG ? b.img : null;
    if (!text && !img) return 400;
    const m = { id: nid(), from: me.id, text, img, ts: Date.now(), re: {} };
    if (b.reply) { const o = r.msgs.find(x => x.id === b.reply); if (o) m.reply = { id: o.id, from: o.from, text: o.text ? o.text.slice(0, 80) : '📷 Photo' }; }
    r.msgs.push(m); if (r.msgs.length > KEEP) r.msgs.splice(0, r.msgs.length - KEEP);
    r.read[me.id] = m.ts;
    if (r.msgs.length === 1 && r.type === 'dm') toRoom(r, 'room', view(r)); else toRoom(r, 'msg', { room: r.id, m });
  },
  typing(me, b) { const r = S.rooms[b.room]; if (r && canSee(r, me.id)) toRoom(r, 'typing', { room: r.id, from: me.id }, me.id); },
  read(me, b) {
    const r = S.rooms[b.room]; if (!r || !canSee(r, me.id)) return;
    r.read[me.id] = Date.now(); toRoom(r, 'read', { room: r.id, id: me.id, ts: r.read[me.id] });
  },
  react(me, b) {
    const r = S.rooms[b.room]; if (!r || !canSee(r, me.id)) return 404;
    const m = r.msgs.find(x => x.id === b.id); if (!m) return 404;
    const e = String(b.e || '❤️').slice(0, 8), list = (m.re[e] ||= []), i = list.indexOf(me.id);
    i < 0 ? list.push(me.id) : list.splice(i, 1); if (!list.length) delete m.re[e];
    toRoom(r, 'upd', { room: r.id, m });
  },
  unsend(me, b) {
    const r = S.rooms[b.room]; if (!r) return 404;
    const i = r.msgs.findIndex(x => x.id === b.id && x.from === me.id); if (i < 0) return 403;
    r.msgs.splice(i, 1); toRoom(r, 'del', { room: r.id, id: b.id });
  },
  group(me, b) {
    const name = String(b.name || '').trim().slice(0, 40); if (!name) return 400;
    const id = 'g' + nid(), r = S.rooms[id] = room(id, name, 'group');
    toAll('room', view(r));
  },
  profile(me, b) {
    if (b.name) me.name = String(b.name).trim().slice(0, 30) || me.name;
    if (b.color) me.color = String(b.color).slice(0, 7);
    if (typeof b.bio === 'string') me.bio = b.bio.slice(0, 120);
    toAll('user', pubUser(me));
  }
};
function getRoom(me, id) {
  let r = S.rooms[id];
  if (!r && /^dm:/.test(id)) {                    // lazily create a direct chat
    const ids = id.slice(3).split(':');
    if (ids.length === 2 && ids.includes(me.id) && ids.every(x => S.users[x]) && id === 'dm:' + ids.sort().join(':'))
      r = S.rooms[id] = room(id, '', 'dm', ids);
  }
  return r && canSee(r, me.id) ? r : null;
}

// ---------- HTTP ----------
http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');

  if (u.pathname === '/events') {                  // live stream
    const k = u.searchParams.get('k'); if (!k || k.length < 16) return end(res, 401);
    const id = pid(k);
    const me = S.users[id] ||= { id, name: (u.searchParams.get('n') || 'Guest').slice(0, 30), color: u.searchParams.get('c') || '#8b5cf6', bio: '' };
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    const first = !clients.has(id);
    (clients.get(id) || clients.set(id, new Set()).get(id)).add(res);
    const rooms = Object.values(S.rooms).filter(r => canSee(r, id)).map(view);
    res.write(`event: init\ndata: ${JSON.stringify({ me: pubUser(me), users: Object.values(S.users).map(pubUser), rooms })}\n\n`);
    if (first) toAll('user', pubUser(me), id);
    dirty = true;
    req.on('close', () => {
      const set = clients.get(id); set.delete(res);
      if (!set.size) { clients.delete(id); me.seen = Date.now(); dirty = true; toAll('user', pubUser(me)); }
    });
    return;
  }

  if (req.method === 'POST' && u.pathname.startsWith('/api/')) {
    const fn = A[u.pathname.slice(5)]; if (!fn) return end(res, 404);
    let body = '', size = 0;
    req.on('data', c => { size += c.length; if (size > MAX_BODY) req.destroy(); else body += c; });
    req.on('end', () => {
      let b; try { b = JSON.parse(body); } catch { return end(res, 400); }
      const me = S.users[pid(b.k)]; if (!me) return end(res, 401);
      const code = fn(me, b) || 200; dirty = true; end(res, code);
    });
    return;
  }

  if (u.pathname === '/health') return end(res, 200);
  serve(req, res, u.pathname);
}).listen(PORT, () => console.log('Pulse running on http://localhost:' + PORT));
