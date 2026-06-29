// Stateless signed cookies (HMAC-SHA256). No dependencies, no session store.
// Used for both the short-lived OAuth transaction cookie and the login session.
const crypto = require('crypto');

const SECRET = process.env.SESSION_SECRET ||
  'dev-only-insecure-secret-change-me-in-production';

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}
function hmac(data) {
  return b64url(crypto.createHmac('sha256', SECRET).update(data).digest());
}

// sign({uid:..., t:...}) -> "<payload>.<sig>"
function sign(obj) {
  const payload = b64url(JSON.stringify(obj));
  return payload + '.' + hmac(payload);
}

// verify with optional max age (seconds). Returns the object or null.
function verify(token, maxAgeSec) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const i = token.lastIndexOf('.');
  const payload = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = hmac(payload);
  // constant-time compare
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let obj;
  try { obj = JSON.parse(unb64url(payload).toString('utf8')); } catch (e) { return null; }
  if (maxAgeSec && obj.t && (Date.now() - obj.t) > maxAgeSec * 1000) return null;
  return obj;
}

// ---- cookie header helpers ----
function parseCookies(req) {
  const out = {};
  const raw = req.headers.cookie;
  if (!raw) return out;
  raw.split(';').forEach(function (p) {
    const idx = p.indexOf('=');
    if (idx < 0) return;
    out[p.slice(0, idx).trim()] = decodeURIComponent(p.slice(idx + 1).trim());
  });
  return out;
}
function cookie(name, value, opts) {
  opts = opts || {};
  let s = name + '=' + encodeURIComponent(value);
  s += '; Path=' + (opts.path || '/');
  s += '; HttpOnly';
  s += '; SameSite=Lax';
  if (opts.maxAge != null) s += '; Max-Age=' + opts.maxAge;
  if (process.env.COOKIE_SECURE === '1') s += '; Secure';
  return s;
}
function clearCookie(name) {
  return name + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0';
}

module.exports = { sign, verify, parseCookies, cookie, clearCookie, b64url, unb64url };
