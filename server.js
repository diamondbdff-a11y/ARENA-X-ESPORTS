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

// ---------- ব্যান সিস্টেম (অ্যাকাউন্ট + ডিভাইস + মোবাইল নম্বর + উইথড্র নম্বর) ----------
// ডাটাবেসে যা জমা থাকে:
//   banned/{uid}            -> ব্যানের তথ্য (কারণ, কোন ডিভাইস/নম্বর ব্যান হয়েছে)
//   banned_devices/{did}    -> ব্যান বা লক হওয়া ডিভাইস (allowedUid থাকলে শুধু ওই অ্যাকাউন্ট চলবে)
//   banned_phones/{phone}   -> ব্যান হওয়া মোবাইল নম্বর
//   banned_numbers/{number} -> ব্যান হওয়া উইথড্র নম্বর (bKash/Nagad/Rocket)
//   user_devices/{uid}/{did}-> কোন ইউজার কোন ডিভাইস থেকে ঢুকেছে
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'khelobangladeshlive344@gmail.com';
const DEVICE_RE = /^[\w-]{16,64}$/;
const PHONE_RE = /^01\d{9}$/;
const val = async p => (await db.ref(p).get()).val();
const getDeviceId = req => { const d = String(req.headers['x-device-id'] || '').trim(); return DEVICE_RE.test(d) ? d : ''; };
const MSG_DEVICE = 'এই ডিভাইসে হবে না';
const MSG_PHONE = 'এই মোবাইল নম্বরটি ব্যান করা আছে';

// ডিভাইস ব্যান/লক থাকলে এন্ট্রি ফেরত দেয়। যে অ্যাকাউন্টকে অনুমতি দেওয়া হয়েছে (আনব্যান হওয়া মালিক) তার জন্য null।
async function deviceBlocked(did, uid) {
  const d = await val('banned_devices/' + did);
  if (!d) return null;
  if (d.allowedUid && d.allowedUid === uid) return null;
  return d;
}

// ব্যান করা ইউজার, ব্যান ডিভাইস বা ব্যান নম্বর জয়েন বা উইথড্র করতে পারবে না
async function notBanned(req, res, next) {
  try {
    const uid = req.user.uid;
    const b = await val('banned/' + uid);
    if (b) return res.status(403).json({ code: 'user_banned', error: 'আপনার অ্যাকাউন্ট ব্যান করা হয়েছে' + (b.reason ? ' (কারণ: ' + b.reason + ')' : '') });
    const did = getDeviceId(req);
    if (!did) return res.status(400).json({ error: 'অ্যাপ রিফ্রেশ করে আবার চেষ্টা করুন' });
    if (await deviceBlocked(did, uid)) return res.status(403).json({ code: 'device_blocked', error: MSG_DEVICE });
    const phone = String((await val('users/' + uid + '/phone')) || '');
    if (PHONE_RE.test(phone)) {
      const pb = await val('banned_phones/' + phone);
      if (pb && pb.uid !== uid) return res.status(403).json({ code: 'phone_banned', error: MSG_PHONE });
    }
    next();
  } catch (e) {
    console.error('ban check error', e);
    res.status(500).json({ error: 'সার্ভারে সমস্যা, আবার চেষ্টা করুন' });
  }
}

// অ্যাকাউন্ট খোলার আগে অ্যাপ জিজ্ঞেস করে: এই ডিভাইসে নতুন অ্যাকাউন্ট খোলা যাবে কিনা (লগইন লাগে না)
app.get('/device/check', async (req, res) => {
  try {
    const id = String(req.query.id || '');
    if (!DEVICE_RE.test(id)) return res.json({ blocked: false });
    res.json({ blocked: !!(await val('banned_devices/' + id)) });
  } catch (e) { res.json({ blocked: false }); }
});

// লগইন বা সাইনআপের পর অ্যাপ ডিভাইস জানায়। ডিভাইস/নম্বর ব্যান থাকলে নতুন অ্যাকাউন্ট মুছে দেওয়া হয়
app.post('/device/register', auth, async (req, res) => {
  const uid = req.user.uid;
  const did = getDeviceId(req);
  if (!did) return res.status(400).json({ error: 'ভুল ডিভাইস' });
  try {
    const banInfo = await val('banned/' + uid);
    const blocked = await deviceBlocked(did, uid);
    const phone = String((await val('users/' + uid + '/phone')) || '');
    let phoneBlocked = false;
    if (PHONE_RE.test(phone)) {
      const pb = await val('banned_phones/' + phone);
      phoneBlocked = !!(pb && pb.uid !== uid);
    }
    if (blocked || phoneBlocked) {
      // একদম নতুন অ্যাকাউন্ট (১০ মিনিটের মধ্যে খোলা) হলে মুছে ফেলা হয়
      let deleted = false;
      try {
        const rec = await admin.auth().getUser(uid);
        const age = Date.now() - new Date(rec.metadata.creationTime).getTime();
        if (age < 10 * 60000) {
          await admin.auth().deleteUser(uid);
          await db.ref('users/' + uid).remove();
          deleted = true;
        }
      } catch (e) { console.error('delete new account error', e); }
      console.log('blocked register', uid, blocked ? 'device' : 'phone', deleted ? 'deleted' : '');
      return res.status(403).json({ code: blocked ? 'device_blocked' : 'phone_banned', error: blocked ? MSG_DEVICE : MSG_PHONE, deleted });
    }
    const up = { ['user_devices/' + uid + '/' + did]: now() };
    // ব্যান থাকা ইউজার নতুন ডিভাইসে ঢুকলে সেটাও ব্যান হয়ে যায়
    if (banInfo) up['banned_devices/' + did] = { uid, reason: banInfo.reason || '', date: now() };
    await db.ref().update(up);
    res.json({ ok: true });
  } catch (e) {
    console.error('device register error', e);
    res.status(500).json({ error: 'সার্ভারে সমস্যা' });
  }
});

// শুধু অ্যাডমিন ব্যান / আনব্যান করতে পারবে
app.post('/admin/ban', auth, async (req, res) => {
  if (req.user.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'শুধু অ্যাডমিনের জন্য' });
  const uid = String(req.body.uid || '');
  const ban = req.body.ban === true;
  const reason = String(req.body.reason || '').trim().slice(0, 100);
  if (!/^[\w-]{1,128}$/.test(uid)) return res.status(400).json({ error: 'ভুল ইউজার' });
  if (uid === req.user.uid) return res.status(400).json({ error: 'নিজেকে ব্যান করা যাবে না' });
  try {
    const u = (await db.ref('users/' + uid).get()).val();
    if (!u) return res.status(404).json({ error: 'ইউজার পাওয়া যায়নি' });
    const date = now();
    const devices = Object.keys((await val('user_devices/' + uid)) || {}).filter(d => DEVICE_RE.test(d));
    const up = {};

    if (ban) {
      const phone = PHONE_RE.test(String(u.phone || '')) ? String(u.phone) : '';
      const nums = new Set();
      if (phone) nums.add(phone);
      const tx = (await val('transactions/' + uid)) || {};
      Object.values(tx).forEach(t => { if (t && t.type === 'Withdraw Request' && PHONE_RE.test(String(t.number || ''))) nums.add(String(t.number)); });
      const numbers = [...nums];
      up['banned/' + uid] = { reason, date, devices, phone, numbers };
      up['users/' + uid + '/banned'] = true;
      up['users/' + uid + '/banReason'] = reason;
      devices.forEach(d => { up['banned_devices/' + d] = { uid, reason, date }; });
      if (phone) up['banned_phones/' + phone] = { uid, reason, date };
      numbers.forEach(n => { up['banned_numbers/' + n] = { uid, reason, date }; });
      await db.ref().update(up);
      console.log('banned', uid, 'devices', devices.length, 'numbers', numbers.length);
      return res.json({ ok: true, devices: devices.length, phones: phone ? 1 : 0, numbers: numbers.length });
    }

    // আনব্যান: অ্যাকাউন্ট, মোবাইল নম্বর ও উইথড্র নম্বর ছাড়া পায়।
    // ডিভাইস লক থেকে যায়: ওই ডিভাইসে শুধু এই অ্যাকাউন্ট চলবে, অন্য কোনো অ্যাকাউন্ট খোলা বা লগইন করা যাবে না।
    const info = (await val('banned/' + uid)) || {};
    const all = new Set([...(info.devices || []), ...devices]);
    all.forEach(d => { up['banned_devices/' + d] = { uid, allowedUid: uid, date }; });
    if (info.phone) up['banned_phones/' + info.phone] = null;
    (info.numbers || []).forEach(n => { up['banned_numbers/' + n] = null; });
    up['banned/' + uid] = null;
    up['users/' + uid + '/banned'] = null;
    up['users/' + uid + '/banReason'] = null;
    await db.ref().update(up);
    console.log('unbanned', uid, 'devices locked to owner', all.size);
    res.json({ ok: true, devices: all.size });
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
    if (await val('banned_numbers/' + number)) return res.status(403).json({ code: 'number_banned', error: 'এই নম্বরে উইথড্র করা যাবে না' });
  } catch (e) { return res.status(500).json({ error: 'সার্ভারে সমস্যা, আবার চেষ্টা করুন' }); }

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

// ---------- রাত ১২টার পর আজকের সব ম্যাচ অটো তৈরি (অ্যাডমিন > Auto Schedule এর সেটিং অনুযায়ী) ----------
const SCH_DEFAULT = {
  lw2: { on: true, title: 'Lone Wolf 2 VS 2 | [ 1,3 Vs 2,4 ]', no_suffix: true,  blocks:'10:30', per:48, gap:20, types: 'Solo',           map: 'Bermuda',   fee: 50, prize: 150, kill: 0, slots: 4 },
  br:  { on: true, title: '{type} Time',                      no_suffix: false, blocks:'08:00', per:48, gap:20, types: 'Squad,Solo,Duo', map: 'Bermuda',   fee: 10, prize: 405, kill: 5, slots: 48 },
  cs2: { on: true, title: 'CS 2 VS 2',                        no_suffix: false, blocks:'10:00', per:48, gap:20, types: 'Solo',           map: 'Bermuda',   fee: 50, prize: 150, kill: 0, slots: 4 },
  cs:  { on: true, title: 'CS 4 VS 4',                        no_suffix: false, blocks:'09:00', per:48, gap:20, types: 'Solo',           map: 'Bermuda',   fee: 50, prize: 320, kill: 0, slots: 8 },
  lw1: { on: true, title: 'Lone Wolf 1 VS 1',                 no_suffix: true,  blocks:'11:30',       per:48, gap:20, types: 'Solo',           map: 'Lone Wolf', fee: 20, prize: 30,  kill: 0, slots: 2 }
};
const pad2 = x => String(x).padStart(2, '0');
function schMinutes(c) {
  const list = [];
  String(c.blocks || '').split(',').map(x => x.trim()).filter(Boolean).forEach(b => {
    const [h, mi] = b.split(':').map(Number);
    if (isNaN(h) || isNaN(mi)) return;
    for (let k = 0; k < (Number(c.per) || 1); k++) { const t = h * 60 + mi + k * (Number(c.gap) || 20); if (t < 24 * 60) list.push(t); }
  });
  return list.sort((a, b) => a - b);
}
async function autoGenerate() {
  const st = (await db.ref('app_settings').get()).val() || {};
  if (st.schedule_auto === false || !st.schedule) return; // অ্যাডমিন থেকে একবার SAVE SCHEDULE করলে চালু হবে
  const d = new Date(Date.now() + 6 * 3600000); // বাংলাদেশ সময় (UTC+6)
  const Y = d.getUTCFullYear(), M = d.getUTCMonth() + 1, D = d.getUTCDate();
  const today = `${Y}-${pad2(M)}-${pad2(D)}`;
  if (st.schedule_last === today) return;
  const cfg = {}; Object.keys(SCH_DEFAULT).forEach(id => { cfg[id] = Object.assign({}, SCH_DEFAULT[id], st.schedule[id] || {}, { blocks: SCH_DEFAULT[id].blocks, per: SCH_DEFAULT[id].per, gap: SCH_DEFAULT[id].gap }); }); // সময় সবসময় কোডের ডিফল্ট থেকে (পুরনো সেভ করা সময় ধরবে না)
  const existing = (await db.ref('matches').get()).val() || {};
  let n = 164900; Object.values(existing).forEach(x => { const v = Number(x && x.match_no); if (v > n) n = v; });
  const add = {};
  for (const [id, c] of Object.entries(cfg)) {
    if (!c.on) continue;
    const types = String(c.types).split(',').map(x => x.trim()).filter(Boolean); if (!types.length) types.push('Solo');
    schMinutes(c).forEach((t, i) => {
      const hh = Math.floor(t / 60), mm = t % 60;
      const key = `auto_${Y}${pad2(M)}${pad2(D)}_${id}_${pad2(hh)}${pad2(mm)}`;
      if (existing[key]) return;
      const ts = Date.UTC(Y, M - 1, D, hh, mm) - 6 * 3600000;
      const type = types[i % types.length];
      add[key] = { categoryId: id, title: String(c.title).replace('{type}', type), no_suffix: !!c.no_suffix, type, entry: Number(c.fee) || 0, total: Number(c.slots) || 1, joined: 0,
        total_prize: Number(c.prize) || 0, per_kill: Number(c.kill) || 0, map: c.map, version: 'MOBILE', timestamp: ts, status: 'Upcoming', match_no: ++n,
        time: fmtTime(ts), room_id: '', room_pass: '' };
    });
  }
  const keys = Object.keys(add);
  for (let i = 0; i < keys.length; i += 100) { const chunk = {}; keys.slice(i, i + 100).forEach(k => { chunk[k] = add[k]; }); await db.ref('matches').update(chunk); }
  await db.ref('app_settings').update({ schedule_last: today });
  console.log('auto schedule created', keys.length, 'matches for', today);
}

async function tick() {
  if (ticking) return;
  ticking = true; lastTick = Date.now();
  try {
    try { await autoGenerate(); } catch (e) { console.error('autoGenerate error', e); }
    const all = (await db.ref('matches').get()).val() || {};
    const t = Date.now();
    let maxNo = 0;
    Object.values(all).forEach(m => { maxNo = Math.max(maxNo, Number(m.match_no) || 0); });
    const up = {};
    const cats = {}; // ক্যাটাগরি অনুযায়ী: busy = যাদের জয়েন আছে (সময় বদলাবে না), free = সময় সাজানো যাবে
    for (const [k, m] of Object.entries(all)) {
      if (String(m.status || '').toLowerCase() !== 'upcoming') continue;
      const ts = Number(m.timestamp) || 0;
      const recurring = false; // আগে demo_/recurring ম্যাচের সময় জোর করে বদলাতো; এখন বন্ধ। সময় অ্যাডমিনের Auto Schedule থেকে ঠিক হবে।
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
