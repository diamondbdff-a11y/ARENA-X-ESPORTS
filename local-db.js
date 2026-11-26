import { IMG, BAN, LOGO } from './images.js';
// ===== LOCAL MODE: এখানে কোনো অনলাইন ডাটাবেজ নেই। সব ডাটা এই ব্রাউজারে সেভ হয়। =====
// পরে নিজের ডাটাবেজ লাগালে শুধু এই ফাইলটা বদলাবে, index.html আর admin.html একই থাকবে।
    const LS = { get(k,d){ try{ const v=localStorage.getItem(k); return v?JSON.parse(v):d; }catch(e){ return d; } }, set(k,v){ try{ localStorage.setItem(k, JSON.stringify(v)); }catch(e){} } };
    const store = LS.get('x_db2', {});
    const listeners = [];
    const getPath = (p) => p.split('/').filter(Boolean).reduce((o,k)=> (o && o[k]!==undefined) ? o[k] : undefined, store);
    const snap = (p) => { const v = getPath(p); return { val: () => v===undefined ? null : JSON.parse(JSON.stringify(v)), exists: () => v!==undefined }; };
    const persist = () => { LS.set('x_db2', store); };
    const notify = () => listeners.forEach(l => l.cb(snap(l.path)));
    const setPath = (p, v) => { const ks = p.split('/').filter(Boolean); let o = store; ks.slice(0,-1).forEach(k => { if(typeof o[k] !== 'object' || o[k]===null) o[k] = {}; o = o[k]; }); o[ks[ks.length-1]] = v; };
    const ref = (db, path) => ({ path: path || '', key: (path||'').split('/').pop() });
    const onValue = (r, cb) => { listeners.push({path:r.path, cb}); setTimeout(()=>cb(snap(r.path)), 0); };
    const get = async (r) => snap(r.path);
    const set = async (r, v) => { setPath(r.path, v); persist(); notify(); };
    const update = async (r, v) => { Object.entries(v).forEach(([k,x]) => setPath(r.path+'/'+k, x)); persist(); notify(); };
    const push = (r, v) => { const id = 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2,6); const nr = ref(null, r.path+'/'+id); if(v !== undefined) setPath(nr.path, v), persist(), notify(); return nr; };
    const serverTimestamp = () => Date.now();
    const remove = async (r) => { const ks = r.path.split('/').filter(Boolean); let o = store; for(const k of ks.slice(0,-1)){ if(!o[k]) return; o = o[k]; } delete o[ks[ks.length-1]]; persist(); notify(); };
    const getDatabase = () => ({}); const initializeApp = () => ({});

    // ---- লোকাল লগইন (ডেমো) ----
    const authObj = { currentUser: null };
    const authCbs = [];
    const getAuth = () => authObj;
    const userObj = (u) => u ? { uid:u.uid, email:u.email, displayName:u.displayName||'', photoURL:u.photoURL||'' } : null;
    const emit = () => { authObj.currentUser = userObj(LS.get('x_session', null)); authCbs.forEach(cb => cb(authObj.currentUser)); };
    const onAuthStateChanged = (a, cb) => { authCbs.push(cb); setTimeout(()=>cb(authObj.currentUser = userObj(LS.get('x_session', null))), 0); };
    const signInWithEmailAndPassword = async (a, e, p) => { const u = LS.get('x_users', {})[e.toLowerCase()]; if(!u || u.password !== p) throw new Error('ইমেইল বা পাসওয়ার্ড ভুল'); LS.set('x_session', u); emit(); return {user:userObj(u)}; };
    const createUserWithEmailAndPassword = async (a, e, p) => { const us = LS.get('x_users', {}); e = e.toLowerCase(); if(us[e]) throw new Error('এই ইমেইল আগে থেকেই আছে'); if(p.length < 6) throw new Error('পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের দিন'); const u = {uid:'u'+Date.now().toString(36), email:e, password:p, displayName:''}; us[e] = u; LS.set('x_users', us); LS.set('x_session', u); setTimeout(emit, 0); return {user:userObj(u)}; };
    const updateProfile = async (u, d) => { const us = LS.get('x_users', {}); const x = us[u.email]; if(x){ Object.assign(x, d); LS.set('x_users', us); LS.set('x_session', x); } emit(); };
    const updatePassword = async (u, p) => { const us = LS.get('x_users', {}); if(us[u.email]){ us[u.email].password = p; LS.set('x_users', us); } };
    const reauthenticateWithCredential = async (u, c) => { const x = LS.get('x_users', {})[u.email]; if(!x || x.password !== c.p) throw new Error('বর্তমান পাসওয়ার্ড ভুল'); };
    const EmailAuthProvider = { credential: (e, p) => ({e, p}) };
    const GoogleAuthProvider = function(){};
    const signOut = async () => { LS.set('x_session', null); emit(); };


export const fallbackImg = (t) => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="220"><rect width="400" height="220" fill="#37474f"/><text x="200" y="118" font-family="Arial" font-weight="900" font-size="28" fill="#fff" text-anchor="middle">${t||'IMAGE'}</text></svg>`);
const CATS = [
  ['br','BR MATCH',15,'Solo,Duo,Squad','Bermuda',405,5,10,48],
  ['brs','BR SURVIVAL',0,'Solo','Bermuda',300,5,10,48],
  ['cs','Clash Squad',14,'Squad','Bermuda',100,0,10,8],
  ['cs2','CS 2 VS 2',5,'Duo','Bermuda',60,0,10,4],
  ['lw2','Lone Wolf 2v2',14,'Duo','Lone Wolf',60,0,10,4],
  ['lw1','Lone Wolf 1 Vs 1',12,'Solo','Lone Wolf',30,0,5,2]
];
(function seed(){
  if(!store.__seeded){
    store.categories = {}; CATS.forEach(c => { store.categories[c[0]] = { name:c[1], img: IMG[c[0]] }; });
    store.app_settings = { app_name:'ARENA X ESPORTS', app_logo: LOGO, bkash_number:'01923493618', nagad_number:'', rocket_number:'', notice:'কম দামে ডায়মন্ড টপ আপ করতে নিচে Shop বাটনে ক্লিক করুন।',
      banners:{ b1:{img:BAN[0],link:''}, b2:{img:BAN[1],link:''}, b3:{img:BAN[2],link:''} },
      apk_url:'', apk_version:'1.0', apk_title:'অ্যাপ ডাউনলোড করুন', apk_text:'আরও সহজে খেলতে আমাদের অ্যাপ ডাউনলোড করুন!', apk_show:true,
      support_link:'', shop_link:'', show_popup:false };
    store.__seeded = 1;
  }
  if(store.app_settings && !store.app_settings.bkash_number) store.app_settings.bkash_number = '01923493618';
  const today = new Date().toDateString();
  if(store.__day !== today){
    store.matches = store.matches || {};
    Object.keys(store.matches).forEach(k => { if(store.matches[k].demo){ delete store.matches[k]; if(store.match_participants) delete store.match_participants[k]; } });
    const step = 20*60000; const base = Math.ceil((Date.now() + 5*60000) / step) * step; let n = 164554; const p2 = x => String(x).padStart(2,'0');
    CATS.forEach(([id,name,count,types,map,prize,kill,fee,total]) => {
      const tp = types.split(',');
      for(let i=0;i<count;i++){
        const ts = base + i*step; const d = new Date(ts); let h = d.getHours(); const ap = h>=12?'PM':'AM'; h = h%12 || 12; const type = tp[i % tp.length];
        store.matches[id+'_'+i] = { demo:true, categoryId:id, title:(id==='br' ? type+' Time' : name), type, entry:fee, total, joined:0, total_prize:prize, per_kill:kill, map,
          timestamp:ts, status:'Upcoming', match_no:n++, time:`${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())} at ${p2(h)}:${p2(d.getMinutes())} ${ap}`,
          room_id:'', room_pass:'', prizes: id==='br' ? [50,40,30,20,10] : null };
      }
    });
    store.__day = today;
  }
  persist();
})();
export { initializeApp, getDatabase, ref, set, onValue, push, update, get, remove, serverTimestamp, getAuth, GoogleAuthProvider, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, updatePassword, reauthenticateWithCredential, EmailAuthProvider };
