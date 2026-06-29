// Optional account layer. Talks to the server's /api/* routes.
// If there is no server (e.g. the offline single-file build opened from
// file://), every call fails quietly and the page stays a pure local tool.
(function () {
  'use strict';
  var state = { me: null, freeLimit: 1, available: false, stripe: false };

  function el(id) { return document.getElementById(id); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function initials(name) { return (name || '?').split(/\s+/).map(function (w) { return w[0]; }).slice(0, 2).join('').toUpperCase(); }

  function api(path, opts) {
    return fetch(path, Object.assign({ headers: { 'Content-Type': 'application/json' } }, opts || {}))
      .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, status: r.status, body: j }; }); });
  }

  function loadMe() {
    return api('/api/me').then(function (r) {
      state.available = true;
      state.me = r.body.user;
      state.freeLimit = r.body.freeLimit;
      state.stripe = !!r.body.stripe;
      renderAuth();
      if (state.me) loadReports();
      handleReturn();
    }).catch(function () {
      // no server — hide all account UI, leave the profiler fully working
      state.available = false;
      var slot = el('authslot'); if (slot) slot.style.display = 'none';
    });
  }

  function renderAuth() {
    var slot = el('authslot');
    if (!slot) return;
    if (!state.me) {
      slot.innerHTML = '<a class="signin" href="/auth/login">Sign in</a>';
      return;
    }
    var u = state.me;
    var planChip = u.paid
      ? '<span class="plan">' + esc(u.plan || 'Pro') + '</span>'
      : '<span class="plan free">Free</span>';
    slot.innerHTML =
      '<div class="menu" id="usermenu">' +
        '<div class="chip" style="cursor:pointer">' +
          '<span class="av">' + esc(initials(u.name)) + '</span>' +
          '<span class="nm">' + esc(u.name || u.email || 'You') + '</span>' + planChip +
        '</div>' +
        '<div class="pop">' +
          '<button data-act="reports">My reports (' + u.reportCount + ')</button>' +
          (u.paid ? '' : '<button data-act="buy">Upgrade — unlock unlimited</button>') +
          '<button data-act="logout">Sign out</button>' +
        '</div>' +
      '</div>';
    var menu = el('usermenu');
    menu.querySelector('.chip').addEventListener('click', function () { menu.classList.toggle('open'); });
    menu.querySelectorAll('.pop button').forEach(function (b) {
      b.addEventListener('click', function () {
        menu.classList.remove('open');
        var act = b.getAttribute('data-act');
        if (act === 'logout') location.href = '/auth/logout';
        else if (act === 'buy') doUpgrade();
        else if (act === 'reports') { loadReports(true); el('account').scrollIntoView({ behavior: 'smooth' }); }
      });
    });
  }

  function doUpgrade() {
    if (state.stripe) {
      // real Stripe Checkout — paid flips via the webhook after payment
      api('/api/checkout?plan=Pro', { method: 'POST' }).then(function (r) {
        if (r.ok && r.body.url) location.href = r.body.url;
        else alert((r.body && r.body.detail) || 'Could not start checkout.');
      });
      return;
    }
    // dev fallback: no Stripe key set, simulate a completed order
    if (!confirm('Simulate a one-time Pro purchase ($59) for this account?\n\n(Set STRIPE_SECRET_KEY to use real Stripe Checkout instead.)')) return;
    api('/api/buy?plan=Pro', { method: 'POST' }).then(function (r) {
      if (r.ok) { state.me = r.body.user; renderAuth(); flashAccount('Purchase recorded against your account. Unlimited saves unlocked.'); }
    });
  }

  // After returning from Stripe Checkout (?purchased=1), the webhook may land a
  // moment later — poll /api/me briefly until paid flips, then celebrate.
  function handleReturn() {
    var q = new URLSearchParams(location.search);
    if (q.get('canceled')) { history.replaceState({}, '', location.pathname); return; }
    if (!q.get('purchased')) return;
    history.replaceState({}, '', location.pathname);
    var tries = 0;
    (function poll() {
      api('/api/me').then(function (r) {
        state.me = r.body.user;
        if (state.me && state.me.paid) { renderAuth(); loadReports(true); flashAccount('Payment confirmed — ' + (state.me.plan || 'Pro') + ' unlocked. Unlimited saved reports.'); }
        else if (tries++ < 6) setTimeout(poll, 1000);
        else flashAccount('Thanks! Your payment is processing — refresh in a moment.');
      });
    })();
  }

  // ---- saved reports ----
  function loadReports(forceShow) {
    if (!state.me) return;
    api('/api/reports').then(function (r) {
      if (!r.ok) return;
      var box = el('account');
      var reports = r.body.reports || [];
      if (!reports.length && !forceShow) { box.style.display = 'none'; return; }
      var rows = reports.map(function (rep) {
        return '<div class="rep-row" data-id="' + esc(rep.id) + '">' +
          '<span class="nm">' + esc(rep.name) + '</span>' +
          '<span class="meta">' + rep.rows + '×' + rep.cols + ' · Q' + rep.quality + ' · ' + rep.issues + ' issue' + (rep.issues === 1 ? '' : 's') + ' · ' + new Date(rep.at).toLocaleDateString() + '</span>' +
          '<button data-open="' + esc(rep.id) + '">Open</button>' +
          '<button class="danger" data-del="' + esc(rep.id) + '">Delete</button>' +
        '</div>';
      }).join('');
      box.innerHTML = '<div class="panel"><div class="head">🗂️ Saved to your account ' +
        '<span class="badge">' + reports.length + (state.me.paid ? '' : ' / ' + state.freeLimit + ' free') + '</span></div>' +
        (reports.length ? rows : '<div style="padding:14px 16px;color:#6b7280">No saved reports yet. Profile a CSV, then click “Save to my account.”</div>') +
        '</div>';
      box.style.display = 'block';
      box.querySelectorAll('[data-open]').forEach(function (b) {
        b.addEventListener('click', function () { openReport(b.getAttribute('data-open')); });
      });
      box.querySelectorAll('[data-del]').forEach(function (b) {
        b.addEventListener('click', function () { delReport(b.getAttribute('data-del')); });
      });
    });
  }

  function openReport(id) {
    api('/api/reports/' + id).then(function (r) {
      if (r.ok && window.OnceoverRender) window.OnceoverRender(r.body.report);
    });
  }
  function delReport(id) {
    api('/api/reports/' + id, { method: 'DELETE' }).then(function () {
      state.me.reportCount = Math.max(0, state.me.reportCount - 1);
      renderAuth(); loadReports(true);
    });
  }

  function flashAccount(msg) {
    var box = el('account');
    box.style.display = 'block';
    box.insertAdjacentHTML('afterbegin', '<div class="panel"><div class="head" style="color:var(--accent)">✓ ' + esc(msg) + '</div></div>');
    setTimeout(loadReports, 1200);
  }

  // ---- "Save to my account" button injected into results after each profile ----
  document.addEventListener('onceover:rendered', function () {
    if (!state.available) return;
    var tools = document.querySelector('#results .tools');
    if (!tools || tools.querySelector('.savebtn')) return;
    var btn = document.createElement('button');
    btn.className = 'savebtn';
    btn.type = 'button';
    btn.textContent = state.me ? 'Save to my account' : 'Sign in to save';
    btn.addEventListener('click', function () {
      if (!state.me) { location.href = '/auth/login'; return; }
      var name = prompt('Name this report:', 'CSV profile ' + new Date().toLocaleDateString());
      if (name === null) return;
      api('/api/reports', { method: 'POST', body: JSON.stringify({ name: name, report: window.__lastReport }) })
        .then(function (r) {
          if (r.ok) { btn.textContent = 'Saved ✓'; btn.disabled = true; state.me.reportCount++; renderAuth(); loadReports(true); }
          else if (r.status === 402) { alert(r.body.message); doUpgrade(); }
        });
    });
    tools.appendChild(btn);
  });

  // Only attempt accounts when served by the server. Opened as a plain file
  // (the offline bundle), stay a pure local tool with no network calls.
  if (location.protocol === 'http:' || location.protocol === 'https:') {
    loadMe();
  } else {
    var slot = el('authslot'); if (slot) slot.style.display = 'none';
  }
})();
