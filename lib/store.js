// Dead-simple JSON user store. One row per OAuth identity.
// This is where "who paid" lives: each account carries a `paid` record.
const fs = require('fs');
const path = require('path');

const FILE = process.env.STORE_FILE || path.join(__dirname, '..', 'data', 'users.json');

function load() {
  try { return JSON.parse(fs.readFileSync(FILE, 'utf8')); }
  catch (e) { return { users: {} }; }
}
function save(db) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  // write-then-rename for a crash-safe-ish swap
  const tmp = FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, FILE);
}

// Stable account id from provider + provider's subject id.
function uidFor(provider, sub) { return provider + ':' + sub; }

// Create on first login, update profile on each login.
function upsertUser(provider, profile) {
  const db = load();
  const uid = uidFor(provider, profile.sub);
  const now = Date.now();
  const existing = db.users[uid];
  const user = existing || {
    uid: uid,
    provider: provider,
    sub: profile.sub,
    createdAt: now,
    paid: false,
    plan: null,
    orders: [],
    reports: []
  };
  user.email = profile.email || user.email || null;
  user.name = profile.name || user.name || null;
  user.avatar = profile.avatar || user.avatar || null;
  user.lastLogin = now;
  db.users[uid] = user;
  save(db);
  return user;
}

function getUser(uid) {
  const db = load();
  return db.users[uid] || null;
}

function update(uid, fn) {
  const db = load();
  const u = db.users[uid];
  if (!u) return null;
  fn(u);
  db.users[uid] = u;
  save(db);
  return u;
}

// Record a paid order against the account. Real life: called from a Stripe /
// Lemon Squeezy webhook that matched the buyer's email to this OAuth identity.
function recordPurchase(uid, order) {
  return update(uid, function (u) {
    // idempotent: a webhook may be delivered more than once for one order
    const dupe = order.orderId && (u.orders || []).some(function (o) { return o.orderId === order.orderId; });
    u.paid = true;
    u.plan = order.plan || u.plan;
    if (!dupe) {
      u.orders.push({
        orderId: order.orderId,
        plan: order.plan,
        amount: order.amount,
        source: order.source || 'manual',
        at: Date.now()
      });
    }
  });
}

// Public-safe view (never leak internal fields wholesale to the client).
function publicView(u) {
  if (!u) return null;
  return {
    uid: u.uid,
    provider: u.provider,
    name: u.name,
    email: u.email,
    avatar: u.avatar,
    paid: !!u.paid,
    plan: u.plan,
    reportCount: (u.reports || []).length
  };
}

module.exports = {
  upsertUser, getUser, update, recordPurchase, publicView, uidFor, load, save
};
