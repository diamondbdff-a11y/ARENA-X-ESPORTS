// ===== আসল Firebase ডাটাবেজ (ARENA X ESPORTS) =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref, set, onValue, push, update, get, remove, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";
import { getAuth, GoogleAuthProvider, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, updatePassword, reauthenticateWithCredential, EmailAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyATF2hIKBzORr3VPc5wAsAoWihqZTodVw4",
  authDomain: "arena-x-esports-b4b37.firebaseapp.com",
  databaseURL: "https://arena-x-esports-b4b37-default-rtdb.europe-west1.firebasedatabase.app",
  projectId: "arena-x-esports-b4b37",
  storageBucket: "arena-x-esports-b4b37.firebasestorage.app",
  messagingSenderId: "190419573410",
  appId: "1:190419573410:web:1944533080f25bc2c9d5fb"
};

const _app = initializeApp(firebaseConfig);
const _db = getDatabase(_app);
const _auth = getAuth(_app);
const wrapDb = () => _db;
const wrapAuth = () => _auth;

export const fallbackImg = (t) => 'data:image/svg+xml;utf8,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="400" height="220"><rect width="400" height="220" fill="#37474f"/><text x="200" y="118" font-family="Arial" font-weight="900" font-size="28" fill="#fff" text-anchor="middle">${t||'IMAGE'}</text></svg>`);

export { initializeApp, wrapDb as getDatabase, ref, set, onValue, push, update, get, remove, serverTimestamp, wrapAuth as getAuth, GoogleAuthProvider, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, updateProfile, updatePassword, reauthenticateWithCredential, EmailAuthProvider };
