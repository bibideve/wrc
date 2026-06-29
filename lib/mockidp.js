// A minimal but REAL OAuth2 authorization server for local development.
// Implements /authorize (with PKCE), /token (verifies the code_verifier),
// and /userinfo. Swap OAUTH_PROVIDER=google|github to use a real one instead.
const crypto = require('crypto');
const { pkceChallenge, randomUrlSafe } = require('./oauth');

// Two fake people you can "sign in" as.
const TEST_USERS = {
  ada: { sub: 'mock-ada-1815', email: 'ada@analytica.dev', name: 'Ada Lovelace', picture: null },
  linus: { sub: 'mock-linus-1969', email: 'linus@kernel.dev', name: 'Linus T.', picture: null }
};

const codes = new Map();   // code  -> { challenge, redirectUri, user, exp }
const tokens = new Map();  // token -> { user, exp }

function gc(map) {
  const now = Date.now();
  for (const [k, v] of map) if (v.exp < now) map.delete(k);
}

function send(res, status, headers, body) {
  res.writeHead(status, headers);
  res.end(body);
}

// GET /mockidp/authorize -> a tiny account chooser
function authorize(req, res, url) {
  const q = url.searchParams;
  const redirectUri = q.get('redirect_uri');
  const state = q.get('state') || '';
  const challenge = q.get('code_challenge') || '';
  if (!redirectUri || q.get('code_challenge_method') !== 'S256') {
    return send(res, 400, { 'Content-Type': 'text/plain' }, 'invalid authorization request');
  }
  const buttons = Object.keys(TEST_USERS).map(function (k) {
    const u = TEST_USERS[k];
    return '<form method="POST" action="/mockidp/approve">' +
      '<input type="hidden" name="who" value="' + k + '">' +
      '<input type="hidden" name="redirect_uri" value="' + escapeAttr(redirectUri) + '">' +
      '<input type="hidden" name="state" value="' + escapeAttr(state) + '">' +
      '<input type="hidden" name="code_challenge" value="' + escapeAttr(challenge) + '">' +
      '<button type="submit">Continue as <b>' + u.name + '</b><span>' + u.email + '</span></button></form>';
  }).join('');
  const html = '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Sign in — Onceover (test IdP)</title>' +
    '<style>body{font:16px -apple-system,Segoe UI,Roboto,Arial,sans-serif;background:#f7f7fb;color:#111;' +
    'display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}' +
    '.box{background:#fff;border:1px solid #ececf0;border-radius:18px;padding:28px;max-width:380px;width:92%}' +
    'h1{font-size:19px;margin:0 0 4px}.muted{color:#6b7280;font-size:14px;margin:0 0 18px}' +
    'button{width:100%;text-align:left;padding:14px 16px;border:1px solid #ececf0;border-radius:12px;background:#fff;' +
    'cursor:pointer;font-size:16px;margin-bottom:10px;display:flex;flex-direction:column}' +
    'button:hover{border-color:#4f46e5}button span{color:#6b7280;font-size:13px;margin-top:2px}' +
    '.tag{display:inline-block;background:#eef0ff;color:#4f46e5;font-size:11px;font-weight:800;padding:3px 8px;border-radius:999px;letter-spacing:.04em}</style>' +
    '<div class="box"><span class="tag">LOCAL TEST IDENTITY PROVIDER</span>' +
    '<h1>Choose a test account</h1>' +
    '<p class="muted">Stand-in for Google / GitHub so the OAuth flow runs with no setup. Real providers enforce their own 2FA here.</p>' +
    buttons + '</div>';
  send(res, 200, { 'Content-Type': 'text/html; charset=utf-8' }, html);
}

// POST /mockidp/approve -> issue an auth code, redirect back to the app
function approve(req, res, body) {
  const p = new URLSearchParams(body);
  const who = p.get('who');
  const user = TEST_USERS[who];
  const redirectUri = p.get('redirect_uri');
  const state = p.get('state') || '';
  const challenge = p.get('code_challenge') || '';
  if (!user || !redirectUri) return send(res, 400, { 'Content-Type': 'text/plain' }, 'invalid approval');
  gc(codes);
  const code = randomUrlSafe(24);
  codes.set(code, { challenge: challenge, redirectUri: redirectUri, user: user, exp: Date.now() + 60000 });
  const sep = redirectUri.indexOf('?') < 0 ? '?' : '&';
  const loc = redirectUri + sep + 'code=' + encodeURIComponent(code) + '&state=' + encodeURIComponent(state);
  send(res, 302, { Location: loc }, '');
}

// POST /mockidp/token -> verify code + PKCE verifier, return an access token
function token(req, res, body) {
  gc(codes); gc(tokens);
  const p = new URLSearchParams(body);
  const code = p.get('code');
  const verifier = p.get('code_verifier') || '';
  const rec = code && codes.get(code);
  if (!rec) return send(res, 400, json(), JSON.stringify({ error: 'invalid_grant' }));
  codes.delete(code); // one-time use
  // PKCE: the verifier must hash to the challenge we stored at /authorize
  if (rec.challenge && pkceChallenge(verifier) !== rec.challenge) {
    return send(res, 400, json(), JSON.stringify({ error: 'invalid_grant', detail: 'pkce mismatch' }));
  }
  if (rec.redirectUri !== p.get('redirect_uri')) {
    return send(res, 400, json(), JSON.stringify({ error: 'invalid_grant', detail: 'redirect mismatch' }));
  }
  const access = randomUrlSafe(32);
  tokens.set(access, { user: rec.user, exp: Date.now() + 600000 });
  send(res, 200, json(), JSON.stringify({ access_token: access, token_type: 'Bearer', expires_in: 600 }));
}

// GET /mockidp/userinfo (Bearer token) -> the profile
function userinfo(req, res) {
  gc(tokens);
  const auth = req.headers.authorization || '';
  const tok = auth.replace(/^Bearer\s+/i, '');
  const rec = tokens.get(tok);
  if (!rec) return send(res, 401, json(), JSON.stringify({ error: 'invalid_token' }));
  send(res, 200, json(), JSON.stringify(rec.user));
}

function json() { return { 'Content-Type': 'application/json' }; }
function escapeAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

module.exports = { authorize, approve, token, userinfo, TEST_USERS };
