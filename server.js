// Onceover server.
//   • Serves the static, offline-capable CSV profiler (unchanged, ungated).
//   • Adds OAuth login (Authorization Code + PKCE), accounts, a paid flag,
//     and account-bound saved reports.
// Zero dependencies — Node stdlib only.
const http = require('http');
const fs = require('fs');
const path = require('path');

const sess = require('./lib/session');
const oauth = require('./lib/oauth');
const store = require('./lib/store');
const mockidp = require('./lib/mockidp');
const stripe = require('./lib/stripe');

const PORT = process.env.PORT || 4321;
const ROOT = path.join(__dirname, 'public');
const FREE_REPORT_LIMIT = 1; // logged-in but unpaid: keep up to 1 report

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon'
};

// ---------- helpers ----------
function baseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  return proto + '://' + (req.headers.host || ('localhost:' + PORT));
}
function readBody(req) {
  return new Promise(function (resolve) {
    let data = '';
    req.on('data', function (c) { data += c; if (data.length > 5e6) req.destroy(); });
    req.on('end', function () { resolve(data); });
  });
}
function json(res, status, obj, extraHeaders) {
  const h = Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {});
  res.writeHead(status, h);
  res.end(JSON.stringify(obj));
}
function redirect(res, location, setCookie) {
  const h = { Location: location };
  if (setCookie) h['Set-Cookie'] = setCookie;
  res.writeHead(302, h);
  res.end();
}
function currentUser(req) {
  const cookies = sess.parseCookies(req);
  const s = sess.verify(cookies.osid, 60 * 60 * 24 * 30); // 30-day session
  if (!s || !s.uid) return null;
  return store.getUser(s.uid);
}

// ---------- auth routes ----------
function startLogin(req, res) {
  const r = oauth.buildAuthRequest(baseUrl(req));
  // remember state + PKCE verifier in a short-lived signed cookie
  const conf = sess.sign({ state: r.state, verifier: r.verifier, t: Date.now() });
  redirect(res, r.url, sess.cookie('oconf', conf, { maxAge: 600 }));
}

async function finishLogin(req, res, url) {
  const cookies = sess.parseCookies(req);
  const conf = sess.verify(cookies.oconf, 600);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!conf) return json(res, 400, { error: 'login session expired — try again' });
  if (!code || state !== conf.state) return json(res, 400, { error: 'state mismatch — possible CSRF, aborted' });
  try {
    const token = await oauth.exchangeCode(baseUrl(req), code, conf.verifier, baseUrl(req) + '/auth/callback');
    const profile = await oauth.fetchProfile(baseUrl(req), token);
    const user = store.upsertUser(oauth.activeProviderName(), profile);
    const session = sess.sign({ uid: user.uid, t: Date.now() });
    // set session, clear the transaction cookie, land on the app
    res.writeHead(302, {
      Location: '/?signedin=1',
      'Set-Cookie': [sess.cookie('osid', session, { maxAge: 60 * 60 * 24 * 30 }), sess.clearCookie('oconf')]
    });
    res.end();
  } catch (e) {
    json(res, 502, { error: 'oauth failed', detail: String(e.message || e) });
  }
}

function logout(res) {
  redirect(res, '/', sess.clearCookie('osid'));
}

// ---------- account API ----------
function apiMe(req, res) {
  const u = currentUser(req);
  json(res, 200, {
    provider: oauth.activeProviderName(),
    user: store.publicView(u),
    freeLimit: FREE_REPORT_LIMIT,
    stripe: stripe.enabled() // tells the UI to use real checkout vs. simulate
  });
}

// Real Stripe Checkout: create a hosted session and hand back its URL. The
// account is NOT marked paid here — that happens in the webhook after Stripe
// confirms the payment (the secure pattern).
async function checkout(req, res) {
  const u = currentUser(req);
  if (!u) return json(res, 401, { error: 'sign in first' });
  if (!stripe.enabled()) return json(res, 400, { error: 'stripe not configured' });
  const plan = (new URL(req.url, 'http://x').searchParams.get('plan')) || 'Pro';
  try {
    const session = await stripe.createCheckoutSession({
      uid: u.uid, email: u.email, plan: plan, baseUrl: baseUrl(req)
    });
    json(res, 200, { url: session.url, id: session.id });
  } catch (e) {
    json(res, 502, { error: 'checkout failed', detail: String(e.message || e) });
  }
}

// Stripe webhook: verify signature, then fulfil on checkout.session.completed.
async function stripeWebhook(req, res) {
  const raw = await readBody(req);
  const v = stripe.verifyWebhook(raw, req.headers['stripe-signature'], process.env.STRIPE_WEBHOOK_SECRET);
  if (!v.ok) return json(res, 400, { error: 'webhook: ' + v.error });
  const event = v.event;
  if (event.type === 'checkout.session.completed') {
    const s = event.data.object || {};
    const uid = s.client_reference_id || (s.metadata && s.metadata.uid);
    const plan = (s.metadata && s.metadata.plan) || 'Pro';
    if (uid && store.getUser(uid)) {
      store.recordPurchase(uid, {
        orderId: s.id || (s.payment_intent) || ('cs-' + Date.now()),
        plan: plan,
        amount: (s.amount_total != null ? s.amount_total / 100 : stripe.amountFor(plan) / 100),
        source: 'stripe'
      });
    }
  }
  // 2xx tells Stripe we received it; unknown event types are fine to ack.
  json(res, 200, { received: true });
}

// Dev-only simulate. Disabled once real Stripe is configured so there is no
// free-unlock bypass in production.
function buy(req, res) {
  const u = currentUser(req);
  if (!u) return json(res, 401, { error: 'sign in first' });
  if (stripe.enabled()) return json(res, 403, { error: 'use /api/checkout — stripe is live' });
  const plan = (new URL(req.url, 'http://x').searchParams.get('plan')) || 'Pro';
  const updated = store.recordPurchase(u.uid, {
    orderId: 'OO-' + Date.now().toString(36).toUpperCase(),
    plan: plan,
    amount: stripe.amountFor(plan) / 100,
    source: 'simulated'
  });
  json(res, 200, { ok: true, user: store.publicView(updated) });
}

function listReports(req, res) {
  const u = currentUser(req);
  if (!u) return json(res, 401, { error: 'sign in first' });
  const reports = (u.reports || []).map(function (r) {
    return { id: r.id, name: r.name, at: r.at, rows: r.summary.rows, cols: r.summary.cols, quality: r.summary.quality, issues: r.summary.issues };
  });
  json(res, 200, { reports: reports });
}

async function saveReport(req, res) {
  const u = currentUser(req);
  if (!u) return json(res, 401, { error: 'sign in first' });
  const count = (u.reports || []).length;
  if (!u.paid && count >= FREE_REPORT_LIMIT) {
    return json(res, 402, { error: 'limit', message: 'Free accounts keep ' + FREE_REPORT_LIMIT + ' saved report. Upgrade to keep unlimited.' });
  }
  let payload;
  try { payload = JSON.parse(await readBody(req)); } catch (e) { return json(res, 400, { error: 'bad json' }); }
  const rep = payload.report || {};
  const id = 'r-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const saved = {
    id: id,
    name: String(payload.name || 'Untitled').slice(0, 80),
    at: Date.now(),
    summary: { rows: rep.rows || 0, cols: rep.cols || 0, quality: rep.quality || 0, issues: (rep.issues || []).length },
    report: rep
  };
  store.update(u.uid, function (user) { user.reports = user.reports || []; user.reports.push(saved); });
  json(res, 200, { ok: true, id: id });
}

function getReport(req, res, id) {
  const u = currentUser(req);
  if (!u) return json(res, 401, { error: 'sign in first' });
  const r = (u.reports || []).find(function (x) { return x.id === id; });
  if (!r) return json(res, 404, { error: 'not found' });
  json(res, 200, { report: r.report, name: r.name, at: r.at });
}

function deleteReport(req, res, id) {
  const u = currentUser(req);
  if (!u) return json(res, 401, { error: 'sign in first' });
  store.update(u.uid, function (user) {
    user.reports = (user.reports || []).filter(function (x) { return x.id !== id; });
  });
  json(res, 200, { ok: true });
}

// ---------- static ----------
function serveStatic(req, res, pathname) {
  let url = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(ROOT, path.normalize(url).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, function (err, data) {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('404 Not Found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(data);
  });
}

// ---------- router ----------
const server = http.createServer(async function (req, res) {
  const url = new URL(req.url, baseUrl(req));
  const p = url.pathname;
  try {
    // auth
    if (p === '/auth/login') return startLogin(req, res);
    if (p === '/auth/callback') return finishLogin(req, res, url);
    if (p === '/auth/logout') return logout(res);

    // mock identity provider (local only)
    if (p === '/mockidp/authorize') return mockidp.authorize(req, res, url);
    if (p === '/mockidp/approve' && req.method === 'POST') return mockidp.approve(req, res, await readBody(req));
    if (p === '/mockidp/token' && req.method === 'POST') return mockidp.token(req, res, await readBody(req));
    if (p === '/mockidp/userinfo') return mockidp.userinfo(req, res);

    // payments
    if (p === '/api/checkout' && req.method === 'POST') return checkout(req, res);
    if (p === '/webhooks/stripe' && req.method === 'POST') return stripeWebhook(req, res);

    // account API
    if (p === '/api/me') return apiMe(req, res);
    if (p === '/api/buy' && req.method === 'POST') return buy(req, res);
    if (p === '/api/reports' && req.method === 'GET') return listReports(req, res);
    if (p === '/api/reports' && req.method === 'POST') return saveReport(req, res);
    if (p.startsWith('/api/reports/') && req.method === 'GET') return getReport(req, res, p.slice('/api/reports/'.length));
    if (p.startsWith('/api/reports/') && req.method === 'DELETE') return deleteReport(req, res, p.slice('/api/reports/'.length));

    // everything else: static files
    return serveStatic(req, res, p);
  } catch (e) {
    json(res, 500, { error: 'server error', detail: String(e.message || e) });
  }
});

server.listen(PORT, function () {
  const prov = oauth.activeProviderName();
  console.log('');
  console.log('  Onceover is running.');
  console.log('  Open  →  http://localhost:' + PORT);
  console.log('');
  console.log('  Profiler: free, offline, no login. Drop any CSV.');
  console.log('  Accounts: "Sign in" uses the ' + prov + ' provider' +
    (prov === 'mock' ? ' (built-in test IdP — no setup needed).' : '.'));
  console.log('  Payments: ' + (stripe.enabled()
    ? 'Stripe Checkout (live)' + (stripe.webhookConfigured() ? ' + webhook verified.' : ' — set STRIPE_WEBHOOK_SECRET!')
    : 'simulated (set STRIPE_SECRET_KEY to enable real checkout).'));
  console.log('');
});
