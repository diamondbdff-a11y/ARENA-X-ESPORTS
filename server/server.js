// ARENA X ESPORTS - নিরাপদ সার্ভার (জয়েন + উইথড্র)
const express = require('express');
const cors = require('cors');
const zlib = require('zlib');
const admin = require('firebase-admin');

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT || '{}');
admin.initializeApp({
  credential: admin.credential.cert(sa),
  databaseURL: process.env.DATABASE_URL || 'https://arena-x-esports-b4b37-default-rtdb.europe-west1.firebasedatabase.app'
});
const db = admin.database();

const app = express();
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json({ limit: '10kb' }));

app.get('/health', (req, res) => { if (Date.now() - lastTick > 30000) tick(); res.send('ok'); });

// ---------- অ্যাপ আইকন (সার্ভার নিজেই PNG বানায়, আপলোড লাগে না) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function makeIcon(size) {
  const rowLen = size * 4 + 1;
  const raw = Buffer.alloc(rowLen * size);
  const half = size / 2;
  const th = size * 0.075;   // X এর মোটা ভাব
  const reach = size * 0.24; // X কতটা বড়
  for (let y = 0; y < size; y++) {
    raw[y * rowLen] = 0;
    // ব্যাকগ্রাউন্ড গ্রেডিয়েন্ট (#0f172a থেকে #1e1b4b)
    const gt = y / size;
    const br = Math.round(15 + (30 - 15) * gt);
    const bg = Math.round(23 + (27 - 23) * gt);
    const bb = Math.round(42 + (75 - 42) * gt);
    for (let x = 0; x < size; x++) {
      let r = br, g = bg, b = bb;
      const cx = x - half, cy = y - half;
      if (Math.abs(cx) <= reach && Math.abs(cy) <= reach) {
        const d1 = Math.abs(cx - cy) / Math.SQRT2;
        const d2 = Math.abs(cx + cy) / Math.SQRT2;
        const d = Math.min(d1, d2);
        const a = Math.max(0, Math.min(1, th - d + 0.5));
        if (a > 0) {
          // কমলা গ্রেডিয়েন্ট (#ff9a00 থেকে #ff4d00)
          const t2 = (cy + reach) / (2 * reach);
          const xr = 255, xg = Math.round(154 + (77 - 154) * t2), xb = 0;
          r = Math.round(r + (xr - r) * a);
          g = Math.round(g + (xg - g) * a);
          b = Math.round(b + (xb - b) * a);
        }
      }
      const i = y * rowLen + 1 + x * 4;
      raw[i] = r; raw[i + 1] = g; raw[i + 2] = b; raw[i + 3] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}
const ICONS = {};
function sendIcon(size) {
  return (req, res) => {
    if (!ICONS[size]) ICONS[size] = makeIcon(size);
    res.set({ 'Content-Type': 'image/png', 'Cache-Control': 'public, max-age=86400', 'Access-Control-Allow-Origin': '*' });
    res.send(ICONS[size]);
  };
}
app.get('/icon-192.png', sendIcon(192));
app.get('/icon-512.png', sendIcon(512));

async function auth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) throw new Error('no token');
    req.user = await admin.auth().verifyIdToken(h.slice(7));
    next();
  } catch (e) { res.status(401).json({ error: 'লগইন করুন' }); }
}

// ---------- ব্যান সিস্টেম ----------
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'khelobangladeshlive344@gmail.com';

// ব্যান করা ইউজার জয়েন বা উইথড্র করতে পারবে না
async function notBanned(req, res, next) {
  try {
    const b = (await db.ref('banned/' + req.user.uid).get()).val();
    if (b) return res.status(403).json({ error: 'আপনার অ্যাকাউন্ট ব্যান করা হয়েছে' + (b.reason ? ' (কারণ: ' + b.reason + ')' : '') });
    next();
  } catch (e) {
    console.error('ban check error', e);
    res.status(500).json({ error: 'সার্ভারে সমস্যা, আবার চেষ্টা করুন' });
  }
}

// শুধু অ্যাডমিন ব্যান / আনব্যান করতে পারবে
app.post('/admin/ban', auth, async (req, res) => {
  if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'শুধু অ্যাডমিনের জন্য' });
  const uid = String(req.body.uid || '');
  const ban = req.body.ban === true;
  const reason = String(req.body.reason || '').trim().slice(0, 100);
  if (!/^[\w-]{1,128}$/.test(uid)) return res.status(400).json({ error: 'ভুল ইউজার' });
  if (uid === req.user.uid) return res.status(400).json({ error: 'নিজেকে ব্যান করা যাবে না' });
  try {
    const exists = (await db.ref('users/' + uid).get()).exists();
    if (!exists) return res.status(404).json({ error: 'ইউজার পাওয়া যায়নি' });
    await db.ref().update({
      ['banned/' + uid]: ban ? { reason, date: now() } : null,
      ['users/' + uid + '/banned']: ban ? true : null,
      ['users/' + uid + '/banReason']: ban ? reason : null
    });
    console.log(ban ? 'banned' : 'unbanned', uid);
    res.json({ ok: true });
  } catch (e) {
    console.error('ban error', e);
    res.status(500).json({ error: 'সার্ভারে সমস্যা, আবার চেষ্টা করুন' });
  }
});

const TYPE_COUNT = { solo: 1, duo: 2, squad: 4 };
const now = () => new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' });

// ---------- ম্যাচে জয়েন ----------
app.post('/join', auth, notBanned, async (req, res) => {
  const uid = req.user.uid;
  const matchId = String(req.body.matchId || '');
  let names = Array.isArray(req.body.names) ? req.body.names : [];
  names = names.map(n => String(n).trim().slice(0, 30)).filter(Boolean);
  if (!/^[\w-]{1,60}$/.test(matchId)) return res.status(400).json({ error: 'ভুল ম্যাচ' });
  if (names.length < 1 || names.length > 4) return res.status(400).json({ error: 'নাম ঠিক নেই' });

  try {
    const m = (await db.ref('matches/' + matchId).get()).val();
    if (!m) return res.status(404).json({ error: 'ম্যাচ পাওয়া যায়নি' });
    if (m.status && String(m.status).toLowerCase() !== 'upcoming') return res.status(400).json({ error: 'এই ম্যাচে এখন জয়েন করা যাবে না' });
    if (m.timestamp && m.timestamp < Date.now()) return res.status(400).json({ error: 'ম্যাচ শুরু হয়ে গেছে' });
    const need = TYPE_COUNT[String(m.type || '').toLowerCase()];
    if (need && names.length > need) return res.status(400).json({ error: 'প্লেয়ার সংখ্যা ঠিক নেই' });

    const parts = (await db.ref('match_participants/' + matchId).get()).val() || {};
    if (Object.values(parts).some(p => p.joinedBy === uid)) return res.status(400).json({ error: 'আপনি আগেই জয়েন করেছেন' });

    const count = names.length;
    const total = (Number(m.entry) || 0) * count;
    const maxSlots = Number(m.total) || 0;

    // ১) স্লট রিজার্ভ
    const slot = await db.ref('matches/' + matchId + '/joined').transaction(cur => {
      cur = cur || 0;
      if (maxSlots && cur + count > maxSlots) return; // abort
      return cur + count;
    });
    if (!slot.committed) return res.status(400).json({ error: 'ম্যাচ ফুল হয়ে গেছে' });

    // ২) ব্যালেন্স কাটা
    const bal = await db.ref('users/' + uid).transaction(u => {
      if (u === null) return u; // প্রথমবার ডাটা না থাকলে ফিরিয়ে দাও, Firebase আসল ডাটা নিয়ে আবার চেষ্টা করবে
      if (!u) return;
      let d = Number(u.deposit) || 0, w = Number(u.winning) || 0;
      if (d + w < total) return; // abort
      let rem = total;
      if (d >= rem) { d -= rem; rem = 0; } else { rem -= d; d = 0; w -= rem; }
      u.deposit = d; u.winning = w;
      return u;
    });
    if (!bal.committed) {
      await db.ref('matches/' + matchId + '/joined').transaction(c => Math.max(0, (c || 0) - count));
      return res.status(400).json({ error: 'ব্যালেন্স যথেষ্ট নয়' });
    }

    // ৩) প্লেয়ার যোগ + লেনদেন লগ
    const updates = {};
    names.forEach(n => {
      const k = db.ref('match_participants/' + matchId).push().key;
      updates['match_participants/' + matchId + '/' + k] = { ign: n, joinedBy: uid, kills: 0, win: 0 };
    });
    const tk = db.ref('transactions/' + uid).push().key;
    updates['transactions/' + uid + '/' + tk] = { type: 'Match Join', amount: total, method: 'Wallet', status: 'Success', date: now() };
    await db.ref().update(updates);

    res.json({ ok: true });
  } catch (e) {
    console.error('join error', e);
    res.status(500).json({ error: 'সার্ভারে সমস্যা, আবার চেষ্টা করুন' });
  }
});

// ---------- উইথড্র রিকোয়েস্ট ----------
app.post('/withdraw', auth, notBanned, async (req, res) => {
  const uid = req.user.uid;
  const amount = Math.floor(Number(req.body.amount));
  const method = String(req.body.method || '');
  const number = String(req.body.number || '').trim();
  if (!Number.isFinite(amount) || amount < 100) return res.status(400).json({ error: 'সর্বনিম্ন উইথড্র ১০০ টাকা' });
  if (!['bKash', 'Nagad', 'Rocket'].includes(method)) return res.status(400).json({ error: 'ভুল মেথড' });
  if (!/^01\d{9}$/.test(number)) return res.status(400).json({ error: 'সঠিক মোবাইল নম্বর দিন (১১ ডিজিট)' });

  try {
    const r = await db.ref('users/' + uid + '/winning').transaction(w => {
      if (w === null) return w; // প্রথমবার ডাটা না থাকলে আবার চেষ্টা করবে
      w = Number(w) || 0;
      if (w < amount) return; // abort
      return w - amount;
    });
    if (!r.committed) return res.status(400).json({ error: 'উইনিং ব্যালেন্স যথেষ্ট নয়' });

    const u = (await db.ref('users/' + uid).get()).val() || {};
    const requestId = db.ref('withdraw_requests').push().key;
    const txId = db.ref('transactions/' + uid).push().key;
    const date = now();
    await db.ref().update({
      ['withdraw_requests/' + requestId]: {
        userId: uid, userName: u.username || req.user.name || 'Unknown', userEmail: req.user.email || '',
        amount, method, mobileNumber: number, status: 'pending', timestamp: date,
        requestedAt: admin.database.ServerValue.TIMESTAMP
      },
      ['transactions/' + uid + '/' + txId]: {
        type: 'Withdraw Request', amount, method, number, status: 'Pending', date, requestId
      }
    });
    res.json({ ok: true });
  } catch (e) {
    console.error('withdraw error', e);
    res.status(500).json({ error: 'সার্ভারে সমস্যা, আবার চেষ্টা করুন' });
  }
});


// ---------- ম্যাচের সময় অটো চলার সিস্টেম ----------
// demo_ দিয়ে শুরু বা recurring:true ম্যাচ সবসময় এখন থেকে পরের ২০ মিনিটের স্লটে (যেমন ১০:০০, ১০:২০, ১০:৪০) সাজানো থাকে।
// জয়েন থাকলে ম্যাচ সময়মতো Ongoing হয় আর তার জায়গায় নতুন Upcoming ম্যাচ তৈরি হয়।
// অ্যাডমিনের হাতে বানানো ম্যাচ সময় পার হলে শুধু Ongoing হয়।
const STEP = 20 * 60000;
let lastTick = 0, ticking = false;
function fmtTime(ts) {
  const p = {};
  new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
    .formatToParts(new Date(ts)).forEach(x => { p[x.type] = x.value; });
  let h = Number(p.hour) % 24; const ap = h >= 12 ? 'PM' : 'AM'; h = h % 12 || 12;
  return `${p.year}-${p.month}-${p.day} at ${String(h).padStart(2, '0')}:${p.minute} ${ap}`;
}
async function tick() {
  if (ticking) return;
  ticking = true; lastTick = Date.now();
  try {
    const all = (await db.ref('matches').get()).val() || {};
    const t = Date.now();
    let maxNo = 0;
    Object.values(all).forEach(m => { maxNo = Math.max(maxNo, Number(m.match_no) || 0); });
    const up = {};
    const cats = {}; // ক্যাটাগরি অনুযায়ী: busy = যাদের জয়েন আছে (সময় বদলাবে না), free = সময় সাজানো যাবে
    for (const [k, m] of Object.entries(all)) {
      if (String(m.status || '').toLowerCase() !== 'upcoming') continue;
      const ts = Number(m.timestamp) || 0;
      const recurring = m.recurring === true || k.startsWith('demo_');
      if (!recurring) { if (ts && ts <= t) up[k + '/status'] = 'Ongoing'; continue; }
      const c = cats[m.categoryId || 'x'] || (cats[m.categoryId || 'x'] = { busy: new Set(), future: [], expired: [], step: STEP });
      c.step = (Number(m.interval) || 20) * 60000;
      if (Number(m.joined) > 0) {
        if (ts > t) c.busy.add(ts);
        else { up[k + '/status'] = 'Ongoing'; up[k + '/recurring'] = false; c.expired.push({ clone: m }); }
      } else if (ts > t) c.future.push({ key: k, m, ts });
      else c.expired.push({ key: k, m });
    }
    for (const c of Object.values(cats)) {
      c.future.sort((a, b) => a.ts - b.ts || (Number(a.m.match_no) || 0) - (Number(b.m.match_no) || 0));
      c.expired.sort((a, b) => (Number((a.m || a.clone).match_no) || 0) - (Number((b.m || b.clone).match_no) || 0));
      const pool = c.future.concat(c.expired);
      let slot = Math.ceil((t + 2 * 60000) / c.step) * c.step;
      for (const it of pool) {
        while (c.busy.has(slot)) slot += c.step;
        const m = it.m || it.clone;
        if (it.clone) {
          const nk = db.ref('matches').push().key;
          up[nk] = { ...it.clone, joined: 0, timestamp: slot, time: fmtTime(slot), status: 'Upcoming', room_id: '', room_pass: '', recurring: true, match_no: ++maxNo };
        } else if (Number(m.timestamp) !== slot) {
          up[it.key + '/timestamp'] = slot; up[it.key + '/time'] = fmtTime(slot);
          up[it.key + '/room_id'] = ''; up[it.key + '/room_pass'] = '';
        }
        slot += c.step;
      }
    }
    if (Object.keys(up).length) { await db.ref('matches').update(up); console.log('tick updated', Object.keys(up).length); }
  } catch (e) { console.error('tick error', e); }
  ticking = false;
}
setInterval(tick, 60000);
tick();

// Render-এর ফ্রি সার্ভার যেন ঘুমিয়ে না পড়ে: প্রতি ১০ মিনিটে নিজেকে ডাকে
const SELF_URL = process.env.RENDER_EXTERNAL_URL;
if (SELF_URL) setInterval(() => fetch(SELF_URL + '/health').catch(() => {}), 10 * 60000);

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('server on', port));
