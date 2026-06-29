// Tests for the auth primitives: signed cookies, PKCE, and the user store.
process.env.SESSION_SECRET = 'test-secret';
process.env.STORE_FILE = require('path').join(__dirname, '..', 'data', 'test-users.json');
require('fs').rmSync(process.env.STORE_FILE, { force: true });

const sess = require('../lib/session');
const oauth = require('../lib/oauth');
const store = require('../lib/store');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name); } }
function eq(name, a, b) { ok(name, JSON.stringify(a) === JSON.stringify(b)); }

// --- signed cookies ---
const tok = sess.sign({ uid: 'mock:1', t: Date.now() });
ok('valid token verifies', sess.verify(tok) && sess.verify(tok).uid === 'mock:1');
ok('tampered payload rejected', sess.verify('x' + tok) === null);
ok('tampered signature rejected', sess.verify(tok.slice(0, -2) + 'zz') === null);
ok('garbage rejected', sess.verify('not-a-token') === null);
ok('expired token rejected', sess.verify(sess.sign({ uid: 'a', t: Date.now() - 10000 }), 1) === null);
ok('fresh token within maxAge ok', sess.verify(sess.sign({ uid: 'a', t: Date.now() }), 60) !== null);

// signature is secret-dependent
process.env.SESSION_SECRET = 'different';
delete require.cache[require.resolve('../lib/session')];
const sess2 = require('../lib/session');
ok('token from other secret rejected', sess2.verify(tok) === null);
process.env.SESSION_SECRET = 'test-secret';
delete require.cache[require.resolve('../lib/session')];

// --- PKCE ---
const verifier = oauth.randomUrlSafe(32);
const challenge = oauth.pkceChallenge(verifier);
ok('pkce challenge is deterministic', oauth.pkceChallenge(verifier) === challenge);
ok('wrong verifier yields different challenge', oauth.pkceChallenge(verifier + 'x') !== challenge);
ok('challenge is url-safe', /^[A-Za-z0-9_-]+$/.test(challenge));

// --- auth request shape ---
const ar = oauth.buildAuthRequest('http://localhost:4321');
ok('auth url targets mock idp by default', ar.url.indexOf('/mockidp/authorize') >= 0);
ok('auth url carries S256 challenge', ar.url.indexOf('code_challenge_method=S256') >= 0);
ok('auth url carries state', ar.url.indexOf('state=' + ar.state) >= 0);
ok('verifier matches challenge in url', ar.url.indexOf('code_challenge=' + oauth.pkceChallenge(ar.verifier)) >= 0);

// --- cookie parsing ---
eq('parses cookies', sess.parseCookies({ headers: { cookie: 'a=1; osid=ab%20c' } }), { a: '1', osid: 'ab c' });

// --- store: upsert, purchase, reports ---
const u1 = store.upsertUser('mock', { sub: 's1', email: 'a@b.c', name: 'A' });
ok('new user starts unpaid', u1.paid === false);
const u1b = store.upsertUser('mock', { sub: 's1', email: 'a@b.c', name: 'A2' });
ok('upsert is stable by provider+sub', u1b.uid === u1.uid);
ok('upsert updates profile', u1b.name === 'A2');

const paid = store.recordPurchase(u1.uid, { orderId: 'O1', plan: 'Pro', amount: 59 });
ok('purchase sets paid flag', paid.paid === true);
ok('purchase records the order', paid.orders.length === 1 && paid.orders[0].orderId === 'O1');
ok('purchase sets plan', paid.plan === 'Pro');

store.update(u1.uid, function (u) { u.reports.push({ id: 'r1', name: 'x', at: Date.now(), summary: {}, report: {} }); });
ok('report persists', store.getUser(u1.uid).reports.length === 1);

const pub = store.publicView(store.getUser(u1.uid));
ok('public view hides raw reports array', pub.reports === undefined && pub.reportCount === 1);
ok('public view exposes paid + plan', pub.paid === true && pub.plan === 'Pro');

require('fs').rmSync(process.env.STORE_FILE, { force: true });
console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
