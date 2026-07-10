// ===== auth.js — OneLogin OIDC Authorization Code + PKCE =====
// ไม่มี client_secret ในไฟล์นี้เลย เพราะเป็น static site (public client)
// PKCE (code_verifier / code_challenge) ทำหน้าที่แทน client_secret

const AUTH_CONFIG = {
  subdomain: 'egat',
  clientId: '494c3e70-5b0d-013f-4c34-5fd6f85dccc838751',
  redirectUri: 'https://nutdaarm.github.io/gopd-smart-calculator/',
  scope: 'openid profile email',
};

const AUTH_BASE = `https://${AUTH_CONFIG.subdomain}.onelogin.com/oidc/2`;
const SS_VERIFIER_KEY = 'gopd_pkce_verifier';
const SS_STATE_KEY = 'gopd_oauth_state';
const SS_SESSION_KEY = 'gopd_auth_session';

// ---------- PKCE helpers ----------
function randomString(len = 64) {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => ('0' + b.toString(16)).slice(-2)).join('').slice(0, len);
}

function base64UrlEncode(buffer) {
  let str = '';
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < bytes.byteLength; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function sha256(plain) {
  const data = new TextEncoder().encode(plain);
  return crypto.subtle.digest('SHA-256', data);
}

async function createPkcePair() {
  const verifier = randomString(64);
  const challenge = base64UrlEncode(await sha256(verifier));
  return { verifier, challenge };
}

function decodeJwt(token) {
  try {
    const payload = token.split('.')[1];
    const json = decodeURIComponent(
      atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(json);
  } catch (e) {
    return null;
  }
}

// ---------- Session storage ----------
function saveSession(tokens, profile) {
  sessionStorage.setItem(
    SS_SESSION_KEY,
    JSON.stringify({ ...tokens, profile, savedAt: Date.now() })
  );
}

function getSession() {
  try {
    const raw = sessionStorage.getItem(SS_SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    const expiresMs = (session.expires_in || 0) * 1000;
    if (Date.now() - session.savedAt > expiresMs) return null; // token หมดอายุ
    return session;
  } catch (e) {
    return null;
  }
}

function clearSession() {
  sessionStorage.removeItem(SS_SESSION_KEY);
  sessionStorage.removeItem(SS_VERIFIER_KEY);
  sessionStorage.removeItem(SS_STATE_KEY);
}

// ---------- Auth flow ----------
async function login() {
  const { verifier, challenge } = await createPkcePair();
  const state = randomString(24);
  sessionStorage.setItem(SS_VERIFIER_KEY, verifier);
  sessionStorage.setItem(SS_STATE_KEY, state);

  const params = new URLSearchParams({
    client_id: AUTH_CONFIG.clientId,
    redirect_uri: AUTH_CONFIG.redirectUri,
    response_type: 'code',
    scope: AUTH_CONFIG.scope,
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
  });

  window.location.href = `${AUTH_BASE}/auth?${params.toString()}`;
}

async function exchangeCodeForToken(code) {
  const verifier = sessionStorage.getItem(SS_VERIFIER_KEY);
  if (!verifier) throw new Error('missing_code_verifier');

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: AUTH_CONFIG.redirectUri,
    client_id: AUTH_CONFIG.clientId,
    code_verifier: verifier,
  });

  const res = await fetch(`${AUTH_BASE}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`token_exchange_failed: ${res.status} ${text}`);
  }
  return res.json();
}

function logout() {
  clearSession();
  window.location.href = window.location.pathname; // กลับหน้า login สะอาดๆ
}

// ---------- UI wiring ----------
function showLoginScreen(errorMsg) {
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('app-root').style.display = 'none';
  const errBox = document.getElementById('login-error');
  if (errorMsg) {
    errBox.textContent = errorMsg;
    errBox.style.display = 'block';
  } else {
    errBox.style.display = 'none';
  }
}

function showApp(profile) {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-root').style.display = '';
  const nameEl = document.getElementById('auth-user-name');
  if (nameEl && profile) {
    nameEl.textContent = profile.name || profile.email || 'ผู้ใช้งาน';
  }
}

async function initAuth() {
  // 1) มี session ที่ยังไม่หมดอายุอยู่แล้ว
  const existing = getSession();
  if (existing) {
    showApp(existing.profile);
    return;
  }

  // 2) เพิ่งถูก redirect กลับมาจาก OneLogin พร้อม ?code=...
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  const returnedState = urlParams.get('state');
  const oauthError = urlParams.get('error');

  if (oauthError) {
    showLoginScreen(`OneLogin แจ้งข้อผิดพลาด: ${oauthError}`);
    return;
  }

  if (code) {
    const savedState = sessionStorage.getItem(SS_STATE_KEY);
    if (savedState && returnedState !== savedState) {
      showLoginScreen('state ไม่ตรงกัน กรุณาเข้าสู่ระบบใหม่อีกครั้ง');
      clearSession();
      return;
    }
    try {
      const tokens = await exchangeCodeForToken(code);
      const profile = tokens.id_token ? decodeJwt(tokens.id_token) : null;
      saveSession(tokens, profile);
      // ล้าง ?code=&state= ออกจาก URL ไม่ให้ค้างอยู่ในแถบที่อยู่
      window.history.replaceState({}, document.title, AUTH_CONFIG.redirectUri);
      showApp(profile);
    } catch (e) {
      console.error('[auth] token exchange failed', e);
      showLoginScreen('เข้าสู่ระบบไม่สำเร็จ (แลก token ไม่ผ่าน) กรุณาลองใหม่');
      clearSession();
    }
    return;
  }

  // 3) ยังไม่ได้ login เลย
  showLoginScreen();
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('login-btn');
  if (btn) btn.addEventListener('click', login);
  const logoutBtn = document.getElementById('logout-btn');
  if (logoutBtn) logoutBtn.addEventListener('click', logout);
  initAuth();
});
