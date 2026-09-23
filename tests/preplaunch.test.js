// Launching the Prep Sheet.
//
// Recipe Hub no longer renders the sheet. It asks the Worker to mint a
// one-time link and navigates to it. The properties that matter:
//
//   - the mint goes through /prep, so the store comes from the LOGIN
//   - it is a full top-level navigation, never an iframe (Safari clears a
//     third-party iframe's storage on iPad and kills the 24-hour session)
//   - it mints at the moment of the click, never in advance — the link is
//     single-use and expires in two minutes
//   - a failure says so rather than navigating nowhere

const fs = require('fs');
const assert = require('assert');
const html = fs.readFileSync('index.html', 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

function grab(n) {
  const i = script.search(new RegExp(`(async )?function ${n}\\(`));
  assert.ok(i > -1, 'missing ' + n);
  let d = 0, j = script.indexOf('{', i);
  for (; j < script.length; j++) {
    if (script[j] === '{') d++;
    else if (script[j] === '}') { d--; if (!d) break; }
  }
  return script.slice(i, j + 1);
}

// A tiny DOM: just the button the launcher disables while it works.
function env({ code = 'sb-seafood', store = 'Sandbar', reply, status = 200 } = {}) {
  const calls = [];
  const btn = { textContent: '📋 Prep Sheet', disabled: false };
  const ctx = {
    ASSIGNED_STORE_CODE: code, ASSIGNED_STORE: store, PREP_ACTOR: null,
    nav: [], toasts: [], calls,
  };
  const src = `
    const ASSIGNED_STORE_CODE = ${JSON.stringify(code)};
    const ASSIGNED_STORE = ${JSON.stringify(store)};
    let PREP_ACTOR = null;
    const document = { getElementById: () => btn };
    const toast = (m, t) => toasts.push([m, t]);
    const window = { location: { assign: u => nav.push(u), search: '' } };
    const fetch = async (u, init) => { calls.push({ u, init });
      return { ok: ${status} >= 200 && ${status} < 300, status: ${status},
               json: async () => (${JSON.stringify(reply)}) }; };
    ${grab('launchPrepSheet')}
    return launchPrepSheet;
  `;
  const fn = new Function('btn', 'toasts', 'nav', 'calls', src)(btn, ctx.toasts, ctx.nav, calls);
  return { fn, ...ctx, btn };
}

let pass = 0;
const t = async (d, f) => {
  try { await f(); console.log('  ok  ' + d); pass++; }
  catch (e) { console.log('  FAIL ' + d + '\n       ' + e.message); process.exitCode = 1; }
};

const URL_OK = { token: '4dc4', url: 'https://bshg-prep-hub.bshgrp.workers.dev/?embed=4dc4' };

(async () => {
  console.log('\nminting');

  await t('posts to the proxy, not to the Prep Hub directly', async () => {
    const e = env({ reply: URL_OK });
    await e.fn('sb-seafood');
    assert.strictEqual(e.calls.length, 1);
    assert.ok(e.calls[0].u.startsWith('/prep/embed/mint'), e.calls[0].u);
    assert.ok(!/bshg-prep-hub/.test(e.calls[0].u), 'must not call the Prep Hub from the browser');
  });
  await t('a store login sends no store param — the login decides', async () => {
    const e = env({ reply: URL_OK });
    await e.fn('sb-seafood');
    assert.strictEqual(e.calls[0].u, '/prep/embed/mint');
  });
  await t('the all-stores admin names a store', async () => {
    const e = env({ code: '', store: 'All Stores', reply: URL_OK });
    await e.fn('csc-stcloud');
    assert.strictEqual(e.calls[0].u, '/prep/embed/mint?store=csc-stcloud');
  });
  await t('it is a POST carrying actor_name', async () => {
    const e = env({ reply: URL_OK });
    await e.fn('sb-seafood');
    assert.strictEqual(e.calls[0].init.method, 'POST');
    assert.strictEqual(JSON.parse(e.calls[0].init.body).actor_name, 'Sandbar');
  });
  await t('the response is never cached — a reused token is a dead token', async () => {
    const e = env({ reply: URL_OK });
    await e.fn('sb-seafood');
    assert.strictEqual(e.calls[0].init.cache, 'no-store');
  });

  console.log('\nnavigating');

  await t('navigates to the URL that came back', async () => {
    const e = env({ reply: URL_OK });
    await e.fn('sb-seafood');
    assert.deepStrictEqual(e.nav, [URL_OK.url]);
  });
  await t('top-level navigation, no iframe anywhere in the launcher', async () => {
    const src = grab('launchPrepSheet');
    assert.ok(/location\.assign/.test(src), 'not a top-level navigation');
    assert.ok(!/iframe|srcdoc/i.test(src), 'an iframe would break the session on iPad');
  });

  console.log('\nwhen it fails, it says so');

  await t('an error response toasts and does not navigate', async () => {
    const e = env({ status: 403, reply: { error: 'Unknown or inactive store' } });
    await e.fn('sb-seafood');
    assert.deepStrictEqual(e.nav, []);
    assert.strictEqual(e.toasts[0][0], 'Unknown or inactive store');
    assert.strictEqual(e.toasts[0][1], 'err');
  });
  await t('a 200 with no url is still a failure', async () => {
    const e = env({ reply: {} });
    await e.fn('sb-seafood');
    assert.deepStrictEqual(e.nav, []);
    assert.strictEqual(e.toasts.length, 1);
  });
  await t('the button is restored after a failure', async () => {
    const e = env({ status: 500, reply: { error: 'boom' } });
    await e.fn('sb-seafood');
    assert.strictEqual(e.btn.disabled, false);
    assert.strictEqual(e.btn.textContent, '📋 Prep Sheet');
  });

  console.log('\nthe bookmarkable route');

  await t('?prep=1 launches, so a saved link re-mints', () => {
    const src = grab('openPrepFromUrl');
    assert.ok(/prep'\)\s*===\s*'1'/.test(src) && /openPrepSheet\(\)/.test(src));
  });
  await t('a store login skips the picker entirely', () => {
    const src = grab('openPrepSheet');
    assert.ok(/ASSIGNED_STORE_CODE\) return launchPrepSheet/.test(src));
  });
  await t('all twelve stores are offered to the admin', () => {
    const m = script.match(/const SHEET_STORES = \[([\s\S]*?)\];/)[1];
    for (const c of ['mv-dockside', 'sb-seafood', 'bh-waterfront', 'csc-stcloud']) {
      assert.ok(m.includes(c), 'missing ' + c);
    }
    assert.strictEqual((m.match(/\['/g) || []).length, 12);
  });

  console.log(`\n${pass} passed${process.exitCode ? ' — WITH FAILURES' : ', 0 failed'}\n`);
})();
