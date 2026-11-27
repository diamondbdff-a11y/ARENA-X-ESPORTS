// ARENA X ESPORTS - নিরাপদ সার্ভার (জয়েন + উইথড্র)
const express = require('express');
const cors = require('cors');
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

app.get('/health', (req, res) => res.send('ok'));

async function auth(req, res, next) {
  try {
    const h = req.headers.authorization || '';
    if (!h.startsWith('Bearer ')) throw new Error('no token');
    req.user = await admin.auth().verifyIdToken(h.slice(7));
    next();
  } catch (e) { res.status(401).json({ error: 'লগইন করুন' }); }
}

const TYPE_COUNT = { solo: 1, duo: 2, squad: 4 };
const now = () => new Date().toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' });

// ---------- ম্যাচে জয়েন ----------
app.post('/join', auth, async (req, res) => {
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
    if (need && names.length !== need) return res.status(400).json({ error: 'প্লেয়ার সংখ্যা ঠিক নেই' });

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
app.post('/withdraw', auth, async (req, res) => {
  const uid = req.user.uid;
  const amount = Math.floor(Number(req.body.amount));
  const method = String(req.body.method || '');
  const number = String(req.body.number || '').trim();
  if (!Number.isFinite(amount) || amount < 100) return res.status(400).json({ error: 'সর্বনিম্ন উইথড্র ১০০ টাকা' });
  if (!['bKash', 'Nagad', 'Rocket'].includes(method)) return res.status(400).json({ error: 'ভুল মেথড' });
  if (!/^01\d{9}$/.test(number)) return res.status(400).json({ error: 'সঠিক মোবাইল নম্বর দিন (১১ ডিজিট)' });

  try {
    const r = await db.ref('users/' + uid + '/winning').transaction(w => {
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

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('server on', port));
