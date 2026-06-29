// Stripe wiring with NO stripe SDK — just the REST API over fetch and HMAC
// webhook verification via node:crypto. Keeps the project zero-dependency.
//
// One-time payment via Stripe Checkout (mode=payment). Fulfillment ("paid")
// happens in the webhook, not on redirect, which is the correct/secure pattern.
const crypto = require('crypto');

const PRICES = { Solo: 2900, Pro: 5900, Team: 14900 }; // cents

function secretKey() { return process.env.STRIPE_SECRET_KEY || ''; }
function webhookSecret() { return process.env.STRIPE_WEBHOOK_SECRET || ''; }
function enabled() { return !!secretKey(); }
function webhookConfigured() { return !!webhookSecret(); }
function amountFor(plan) { return PRICES[plan] || PRICES.Pro; }

// Build the Checkout Session form params. Split out so it's unit-testable
// without touching the network. Inline price_data => no pre-made Price objects.
function buildCheckoutParams(opts) {
  const plan = PRICES[opts.plan] ? opts.plan : 'Pro';
  const p = new URLSearchParams();
  p.set('mode', 'payment');
  p.set('success_url', opts.baseUrl + '/?purchased=1');
  p.set('cancel_url', opts.baseUrl + '/?canceled=1');
  // how we tie an anonymous card payment back to the OAuth account:
  p.set('client_reference_id', opts.uid);
  p.set('metadata[uid]', opts.uid);
  p.set('metadata[plan]', plan);
  if (opts.email) p.set('customer_email', opts.email);
  p.set('line_items[0][quantity]', '1');
  p.set('line_items[0][price_data][currency]', opts.currency || 'usd');
  p.set('line_items[0][price_data][unit_amount]', String(amountFor(plan)));
  p.set('line_items[0][price_data][product_data][name]', 'Onceover ' + plan + ' — one-time license');
  return p;
}

async function createCheckoutSession(opts) {
  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + secretKey(),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': 'co-' + opts.uid + '-' + opts.plan + '-' + Math.floor(Date.now() / 1000)
    },
    body: buildCheckoutParams(opts).toString()
  });
  const json = await res.json();
  if (!res.ok) throw new Error('stripe checkout failed: ' + ((json.error && json.error.message) || res.status));
  return json; // includes { id, url }
}

// Verify a Stripe webhook signature header: "t=<ts>,v1=<hex>[,v1=<hex>]".
// signedPayload = `${t}.${rawBody}`, HMAC-SHA256 keyed by the signing secret.
function verifyWebhook(rawBody, sigHeader, secret, toleranceSec) {
  if (toleranceSec == null) toleranceSec = 300;
  if (!secret) return { ok: false, error: 'no webhook secret configured' };
  if (!sigHeader) return { ok: false, error: 'missing signature header' };
  const parts = {};
  sigHeader.split(',').forEach(function (kv) {
    const i = kv.indexOf('=');
    if (i > 0) { const k = kv.slice(0, i).trim(); (parts[k] = parts[k] || []).push(kv.slice(i + 1).trim()); }
  });
  const t = parts.t && parts.t[0];
  const sigs = parts.v1 || [];
  if (!t || !sigs.length) return { ok: false, error: 'malformed signature header' };
  const expected = crypto.createHmac('sha256', secret).update(t + '.' + rawBody).digest('hex');
  const expBuf = Buffer.from(expected);
  const match = sigs.some(function (s) {
    return s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), expBuf);
  });
  if (!match) return { ok: false, error: 'signature mismatch' };
  if (toleranceSec && Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) {
    return { ok: false, error: 'timestamp outside tolerance' };
  }
  let event;
  try { event = JSON.parse(rawBody); } catch (e) { return { ok: false, error: 'invalid json' }; }
  return { ok: true, event: event };
}

// Helper for tests / `stripe trigger`-style local signing.
function signPayload(rawBody, secret, t) {
  t = t || Math.floor(Date.now() / 1000);
  const sig = crypto.createHmac('sha256', secret).update(t + '.' + rawBody).digest('hex');
  return 't=' + t + ',v1=' + sig;
}

module.exports = {
  PRICES, enabled, webhookConfigured, amountFor,
  buildCheckoutParams, createCheckoutSession, verifyWebhook, signPayload
};
