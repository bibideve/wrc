// Tests for the Stripe layer: webhook signature verification + checkout params.
// No network and no real keys — we sign payloads locally the way Stripe does.
const stripe = require('../lib/stripe');

let pass = 0, fail = 0;
function ok(name, cond) { if (cond) { pass++; console.log('  ok   ' + name); } else { fail++; console.log('  FAIL ' + name); } }

const secret = 'whsec_test_123';
const body = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: { client_reference_id: 'mock:s1', amount_total: 5900, metadata: { plan: 'Pro' } } } });

// --- valid signature ---
const goodSig = stripe.signPayload(body, secret);
const v = stripe.verifyWebhook(body, goodSig, secret);
ok('valid signature verifies', v.ok === true);
ok('parsed event exposed', v.event && v.event.type === 'checkout.session.completed');
ok('event carries the uid', v.event.data.object.client_reference_id === 'mock:s1');

// --- tampered body ---
const tampered = stripe.verifyWebhook(body + ' ', goodSig, secret);
ok('tampered body rejected', tampered.ok === false && /mismatch/.test(tampered.error));

// --- wrong secret ---
const wrongSecret = stripe.verifyWebhook(body, goodSig, 'whsec_other');
ok('wrong secret rejected', wrongSecret.ok === false);

// --- replay / stale timestamp ---
const oldT = Math.floor(Date.now() / 1000) - 10000;
const staleSig = stripe.signPayload(body, secret, oldT);
const stale = stripe.verifyWebhook(body, staleSig, secret, 300);
ok('stale timestamp rejected (tolerance)', stale.ok === false && /tolerance/.test(stale.error));
ok('stale timestamp accepted when tolerance disabled', stripe.verifyWebhook(body, staleSig, secret, 0).ok === true);

// --- malformed / missing headers ---
ok('missing header rejected', stripe.verifyWebhook(body, '', secret).ok === false);
ok('malformed header rejected', stripe.verifyWebhook(body, 't=123', secret).ok === false);
ok('no secret configured rejected', stripe.verifyWebhook(body, goodSig, '').ok === false);

// --- checkout params ---
const p = stripe.buildCheckoutParams({ uid: 'mock:s1', email: 'a@b.c', plan: 'Pro', baseUrl: 'http://localhost:4321' });
ok('mode is payment (one-time, not subscription)', p.get('mode') === 'payment');
ok('Pro amount is 5900 cents', p.get('line_items[0][price_data][unit_amount]') === '5900');
ok('account tied via client_reference_id', p.get('client_reference_id') === 'mock:s1');
ok('plan stored in metadata', p.get('metadata[plan]') === 'Pro');
ok('success url set', /purchased=1/.test(p.get('success_url')));
ok('customer email prefilled', p.get('customer_email') === 'a@b.c');

// unknown plan falls back to Pro pricing
const pUnknown = stripe.buildCheckoutParams({ uid: 'x', plan: 'Bogus', baseUrl: 'http://x' });
ok('unknown plan falls back to Pro 5900', pUnknown.get('line_items[0][price_data][unit_amount]') === '5900');
ok('Team is 14900', stripe.buildCheckoutParams({ uid: 'x', plan: 'Team', baseUrl: 'http://x' }).get('line_items[0][price_data][unit_amount]') === '14900');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
