// fb.js — standalone (GitHub Pages) build.
// Provides window.claude.use('room' | 'db' | 'user') on top of Firebase (Realtime Database + anonymous sign-in),
// so game.js runs unchanged outside Claude.
import { FIREBASE_CONFIG } from './config.js';
window.STANDALONE = true;
const SDK = 'https://www.gstatic.com/firebasejs/13.3.0/';
const PEER = Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const clean = v => JSON.parse(JSON.stringify(v === undefined ? null : v));
const configured = !!(FIREBASE_CONFIG && FIREBASE_CONFIG.apiKey && FIREBASE_CONFIG.databaseURL && !/ここ/.test(FIREBASE_CONFIG.apiKey));

let fbP = null;
function fb() {
  if (!configured) return Promise.resolve(null);
  if (!fbP) fbP = (async () => {
    const [A, U, D] = await Promise.all([import(SDK + 'firebase-app.js'), import(SDK + 'firebase-auth.js'), import(SDK + 'firebase-database.js')]);
    const app = A.initializeApp(FIREBASE_CONFIG), auth = U.getAuth(app);
    const cred = await U.signInAnonymously(auth);
    return { D, db: D.getDatabase(app), uid: cred.user.uid };
  })().catch(e => { console.warn('firebase', e); fbP = null; return null; });
  return fbP;
}

function mkRoom(F, path, name) {
  const { D, db } = F, myRef = D.ref(db, path + '/' + PEER);
  let mine = {}, wrote = false, dead = false, timer = 0, last = 0, lis = null;
  const peers = new Map(), handlers = new Set(), offs = [];
  let snap = Object.freeze([]), queued = false;
  const rebuild = () => { snap = Object.freeze([...peers.entries()].map(([k, v]) => Object.freeze({ peer: k, by: null, isMe: k === PEER, sameTab: k === PEER, kind: 'viewer', guest: false, presence: Object.freeze((v && v.p) || {}), updatedAt: Date.now() }))); };
  const notify = () => { if (queued) return; queued = true; queueMicrotask(() => { queued = false; rebuild(); const ch = Object.freeze({ peers: snap, joined: [], left: [], updated: [] }); for (const h of handlers) { try { h(ch); } catch (e) { console.error(e); } } }); };
  const listen = () => { if (lis) return; lis = true; const r = D.ref(db, path);
    offs.push(D.onChildAdded(r, s => { peers.set(s.key, s.val()); notify(); }), D.onChildChanged(r, s => { peers.set(s.key, s.val()); notify(); }), D.onChildRemoved(r, s => { peers.delete(s.key); notify(); })); };
  const flush = () => { timer = 0; last = Date.now(); if (dead) return;
    if (!Object.keys(mine).length) { if (wrote) { wrote = false; D.remove(myRef).catch(() => { }); } return; }
    if (!wrote) { wrote = true; D.onDisconnect(myRef).remove().catch(() => { }); }
    D.set(myRef, { p: clean(mine), t: D.serverTimestamp() }).catch(e => console.warn(e)); };
  return {
    name,
    presence(patch) { if (dead) return Promise.reject({ code: 'invalid_argument' }); for (const k in patch) { if (patch[k] === null) delete mine[k]; else mine[k] = clean(patch[k]); }
      if (!timer) { const wait = Math.max(0, 50 - (Date.now() - last)); timer = setTimeout(flush, wait); } return Promise.resolve(); },
    onPeers(h) { handlers.add(h); listen(); notify(); return () => handlers.delete(h); },
    peers() { return snap; },
    connected() { return true; }, onConnection(h) { queueMicrotask(() => h(true)); return () => { }; },
    emit() { return Promise.resolve(); }, on() { return () => { }; },
    join(n) { return Promise.resolve(rooms[n] || (rooms[n] = mkRoom(F, 'rooms/' + n, n))); },
    leave() { if (dead) return Promise.resolve(); dead = true; clearTimeout(timer); offs.forEach(o => { try { o(); } catch (e) { } }); handlers.clear(); delete rooms[name]; return D.remove(myRef).catch(() => { }); }
  };
}
const rooms = {};
let lobby = null;

function mkDb(F) {
  const { D, db } = F;
  return { collection: name => ({
    doc: id => ({ set: v => D.set(D.ref(db, name + '/' + id), clean(v)), get: async () => { const s = await D.get(D.ref(db, name + '/' + id)); return { id, exists: s.exists(), data: () => s.val() }; } }),
    orderBy: (f, dir) => ({ limit: n => ({ get: async () => { const s = await D.get(D.query(D.ref(db, name), D.orderByChild(f), D.limitToLast(n))); const docs = []; s.forEach(c => { docs.push({ id: c.key, data: () => c.val() }); }); if (dir === 'desc') docs.reverse(); return { empty: !docs.length, docs }; } }) })
  }) };
}

window.claude = Object.freeze({ use: async name => {
  const F = await fb(); if (!F) return null;
  if (name === 'room') { if (!lobby) { lobby = mkRoom(F, 'lobby', 'lobby'); } return lobby; }
  if (name === 'db') return mkDb(F);
  if (name === 'user') return { id: async () => F.uid, canEdit: () => false };
  return null;
} });
