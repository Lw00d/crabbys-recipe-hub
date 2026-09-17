// Store / recipe-book split.
//
// Nine physical stores share five recipe books. The login carries both: the
// BOOK drives filtering, the STORE is what the person sees. This exercises the
// Worker's substitution and the page's badge for every one of the nine, with
// particular attention to apostrophes — an unescaped one in "Salty's Island"
// took the whole app down once before.

import fs from 'fs';
import assert from 'assert';
import { JSDOM } from 'jsdom';

const workerSrc = fs.readFileSync('worker.js', 'utf8');
const html = fs.readFileSync('index.html', 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

const STORES = [
  ['stcloud',         "Crabby's on the Lakefront \u2014 St. Cloud",   'CBG'],
  ['newsmyrna',       "Crabby's Bar & Grill \u2014 New Smyrna Beach", 'CBG'],
  ['staugustine',     "Crabby's Beachside \u2014 Saint Augustine",    'CBG'],
  ['beachwalk',       "Crabby's Bar & Grill \u2014 Clearwater Beach", 'CBG'],
  ['dockside',        "Crabby's Dockside \u2014 Clearwater",          'CDS'],
  ['oceanside',       "Crabby's Oceanside \u2014 Daytona Beach",      'CDS'],
  ['saltysisland',    "Salty's Island",                              "Salty's Island"],
  ['northbeach',      'Salty Crab North Beach',                      'Salty Crab North Beach'],
  ['pavilion',        "Crabby's Beachside at the Pavilion",          'Palm'],
];

let pass = 0;
const t = async (d, fn) => {
  try { await fn(); console.log('  ok  ' + d); pass++; }
  catch (e) { console.log('  FAIL ' + d + '\n       ' + e.message); process.exitCode = 1; }
};

// ── Worker: substitute into a stand-in page, then check the result parses ──
const worker = (await import('../worker.js')).default;
const PAGE = `<script>
const ASSIGNED_LOCATION = 'ASSIGNED_LOCATION_PLACEHOLDER';
const ASSIGNED_STORE = 'ASSIGNED_STORE_PLACEHOLDER';
</script>`;

function usersJson() {
  const o = {};
  for (const [u, store, book] of STORES) o[u] = { password: 'pw', location: book, store };
  o.admin = { password: 'pw', location: 'all' };
  o.legacy = { password: 'pw', location: 'CBG' };   // no "store" field
  return JSON.stringify(o);
}
const ENV = { USERS_JSON: usersJson(), EDIT_PASSWORDS: '{"admin":"x"}' };

async function serve(user) {
  globalThis.fetch = async () => ({ ok: true, status: 200, headers: new Map(),
    text: async () => PAGE });
  const auth = 'Basic ' + Buffer.from(user + ':pw').toString('base64');
  const res = await worker.fetch(new Request('https://w.dev/', { headers: { Authorization: auth } }), ENV);
  return await res.text();
}

console.log('\nWorker substitutes both book and store');
for (const [user, store, book] of STORES) {
  await t(`${user} \u2192 ${book}`, async () => {
    const out = await serve(user);
    assert.ok(!out.includes('ASSIGNED_LOCATION_PLACEHOLDER'), 'location not substituted');
    assert.ok(!out.includes('ASSIGNED_STORE_PLACEHOLDER'), 'store not substituted');
    // The substituted page must still be valid JavaScript. This is the check
    // that would have caught the original Salty's Island outage.
    const js = out.match(/<script>([\s\S]*)<\/script>/)[1];
    let loc, st;
    new Function(js + '; return [ASSIGNED_LOCATION, ASSIGNED_STORE];');
    [loc, st] = new Function(js + '; return [ASSIGNED_LOCATION, ASSIGNED_STORE];')();
    assert.strictEqual(loc, book, 'book wrong');
    assert.strictEqual(st, store, 'store wrong');
  });
}

console.log('\nfallbacks');
await t('a login with no "store" field falls back to the book name', async () => {
  const js = (await serve('legacy')).match(/<script>([\s\S]*)<\/script>/)[1];
  const [loc, st] = new Function(js + '; return [ASSIGNED_LOCATION, ASSIGNED_STORE];')();
  assert.strictEqual(loc, 'CBG');
  assert.strictEqual(st, 'CBG');
});
await t('the all-stores admin is unrestricted', async () => {
  const js = (await serve('admin')).match(/<script>([\s\S]*)<\/script>/)[1];
  const [loc] = new Function(js + '; return [ASSIGNED_LOCATION, ASSIGNED_STORE];')();
  assert.strictEqual(loc, 'all');
});

console.log('\nstores sharing a book resolve to the same book');
await t('all four CBG stores map to CBG', async () => {
  const books = [];
  for (const u of ['stcloud','newsmyrna','staugustine','beachwalk']) {
    const js = (await serve(u)).match(/<script>([\s\S]*)<\/script>/)[1];
    books.push(new Function(js + '; return ASSIGNED_LOCATION;')());
  }
  assert.deepStrictEqual(books, ['CBG','CBG','CBG','CBG']);
});
await t('both CDS stores map to CDS', async () => {
  const books = [];
  for (const u of ['dockside','oceanside']) {
    const js = (await serve(u)).match(/<script>([\s\S]*)<\/script>/)[1];
    books.push(new Function(js + '; return ASSIGNED_LOCATION;')());
  }
  assert.deepStrictEqual(books, ['CDS','CDS']);
});

// ── Page: the badge shows the store, and the book when they differ ────────
function grab(name) {
  const i = script.search(new RegExp(`function ${name}\\(`));
  let depth = 0, j = script.indexOf('{', i);
  for (; j < script.length; j++) {
    if (script[j] === '{') depth++;
    else if (script[j] === '}') { depth--; if (depth === 0) break; }
  }
  return script.slice(i, j + 1);
}
const LOC_SHORT_SRC = script.match(/const LOC_SHORT = \{[^}]*\};/)[0];

function badge(book, store) {
  const dom = new JSDOM('<div id="locationFilters"></div>', { runScripts: 'outside-only' });
  const w = dom.window;
  w.eval(`
    ${LOC_SHORT_SRC}
    const ASSIGNED_LOCATION = ${JSON.stringify(book)};
    const ASSIGNED_STORE = ${JSON.stringify(store)};
    const STORE_LABEL = (ASSIGNED_STORE && ASSIGNED_STORE !== 'ASSIGNED_STORE_PLACEHOLDER')
      ? ASSIGNED_STORE : (LOC_SHORT[ASSIGNED_LOCATION] || ASSIGNED_LOCATION);
    ${grab('esc')}
    ${grab('applyLocationRestrictionUI')}
    applyLocationRestrictionUI();
  `);
  return w.document.body.textContent.trim();
}

console.log('\nheader badge');
await t('a shared-book store shows both store and book', () => {
  const b = badge('CBG', "Crabby's on the Lakefront \u2014 St. Cloud");
  assert.ok(b.includes('St. Cloud'), b);
  assert.ok(b.includes('CBG'), b);
});
await t('a store whose name matches its book shows it once', () => {
  const b = badge('Salty Crab North Beach', 'Salty Crab North Beach');
  assert.strictEqual((b.match(/North Beach/g) || []).length, 1, b);
});
await t('an apostrophe in the store name renders, not escaped-looking', () => {
  const b = badge("Salty's Island", "Salty's Island");
  assert.ok(b.includes("Salty's Island"), b);
  assert.ok(!b.includes('\\'), 'backslash leaked into the display');
});
await t('an ampersand in the store name is not double-escaped', () => {
  const b = badge('CBG', "Crabby's Bar & Grill \u2014 New Smyrna Beach");
  assert.ok(b.includes('&'), b);
  assert.ok(!b.includes('&amp;'), 'double-escaped');
});
await t('a legacy login with no store still shows the book', () => {
  const b = badge('CBG', 'ASSIGNED_STORE_PLACEHOLDER');
  assert.ok(b.includes('CBG'), b);
  assert.ok(!b.includes('PLACEHOLDER'), b);
});

console.log(`\n${pass} passed${process.exitCode ? ' — WITH FAILURES' : ', 0 failed'}\n`);
