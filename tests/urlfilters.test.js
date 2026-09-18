// applyFiltersFromUrl() is a security boundary, not just convenience.
//
// A store login is pinned to one book. init() puts that book into activeLocs,
// and getFiltered() reads the set as "show any of these" — while skipping the
// group check entirely when IS_LOCATION_RESTRICTED. So a second book arriving
// from the URL does not replace the first, it joins it, and the login sees
// both. For a BSHGRP login and ?loc=Mar Vista that crosses between companies.

const fs = require('fs');
const assert = require('assert');
const html = fs.readFileSync('index.html', 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

function grab(n) {
  const i = script.search(new RegExp(`function ${n}\\(`));
  assert.ok(i > -1, 'missing ' + n);
  let d = 0, j = script.indexOf('{', i);
  for (; j < script.length; j++) {
    if (script[j] === '{') d++;
    else if (script[j] === '}') { d--; if (!d) break; }
  }
  return script.slice(i, j + 1);
}

// Run applyFiltersFromUrl() against a query string, as a given login.
function run(search, { restricted, book = 'CBG' } = {}) {
  const src = `
    const IS_LOCATION_RESTRICTED = ${!!restricted};
    const ASSIGNED_LOCATION = ${JSON.stringify(book)};
    const window = { location: { search: ${JSON.stringify(search)} } };
    let activeLocs = new Set(), activeCats = new Set(), activeSubs = new Set();
    let activeGroup = 'BSHGRP';
    if (IS_LOCATION_RESTRICTED) activeLocs.add(ASSIGNED_LOCATION);   // what init() does
    ${grab('applyFiltersFromUrl')}
    const applied = applyFiltersFromUrl();
    return { locs: [...activeLocs], cats: [...activeCats], subs: [...activeSubs],
             group: activeGroup, applied };
  `;
  return new Function('URLSearchParams', src)(URLSearchParams);
}

let pass = 0;
const t = (d, fn) => {
  try { fn(); console.log('  ok  ' + d); pass++; }
  catch (e) { console.log('  FAIL ' + d + '\n       ' + e.message); process.exitCode = 1; }
};

console.log('\na store login cannot widen its own scope');

t('?loc= from another company is ignored', () => {
  const r = run('?loc=Mar Vista', { restricted: true, book: 'CBG' });
  assert.deepStrictEqual(r.locs, ['CBG'], 'a second book got into activeLocs');
});
t('?loc= from the same company is ignored too', () => {
  // Still a widening: CBG would gain CDS, another store's book.
  const r = run('?loc=CDS', { restricted: true, book: 'CBG' });
  assert.deepStrictEqual(r.locs, ['CBG']);
});
t('a comma-separated list cannot sneak one in', () => {
  const r = run('?loc=CBG,Mar Vista,Sandbar', { restricted: true, book: 'CBG' });
  assert.deepStrictEqual(r.locs, ['CBG']);
});
t('?group= cannot flip a store login to the other company', () => {
  const r = run('?group=BSHGRP2', { restricted: true, book: 'CBG' });
  assert.strictEqual(r.group, 'BSHGRP');
});
t('loc and group together still change nothing', () => {
  const r = run('?loc=Beach House&group=BSHGRP2', { restricted: true, book: 'CBG' });
  assert.deepStrictEqual(r.locs, ['CBG']);
  assert.strictEqual(r.group, 'BSHGRP');
});
t('a BSHGRP2 login is pinned just the same', () => {
  const r = run('?loc=CBG&group=BSHGRP', { restricted: true, book: 'Sandbar' });
  assert.deepStrictEqual(r.locs, ['Sandbar']);
  assert.strictEqual(r.group, 'BSHGRP');
});

console.log('\nfilters that only narrow are still honoured');

t('?cat= and ?sub= work for a store login', () => {
  const r = run('?cat=Dinner Menu&sub=Appetizers', { restricted: true, book: 'CBG' });
  assert.deepStrictEqual(r.cats, ['Dinner Menu']);
  assert.deepStrictEqual(r.subs, ['Appetizers']);
  assert.deepStrictEqual(r.locs, ['CBG'], 'narrowing must not disturb the book');
  assert.strictEqual(r.applied, true);
});
t('a deep link with every param still only narrows', () => {
  const r = run('?cat=Dinner Prep&sub=Cold Prep&loc=Mar Vista&group=BSHGRP2',
                { restricted: true, book: 'Sandbar' });
  assert.deepStrictEqual(r.locs, ['Sandbar']);
  assert.deepStrictEqual(r.cats, ['Dinner Prep']);
  assert.strictEqual(r.group, 'BSHGRP');
});

console.log('\nthe all-stores admin keeps every filter');

t('admin may set loc=', () => {
  const r = run('?loc=Mar Vista', { restricted: false });
  assert.deepStrictEqual(r.locs, ['Mar Vista']);
});
t('admin may switch group', () => {
  const r = run('?group=BSHGRP2', { restricted: false });
  assert.strictEqual(r.group, 'BSHGRP2');
});
t('admin may combine several books', () => {
  const r = run('?loc=CBG,CDS', { restricted: false });
  assert.deepStrictEqual(r.locs, ['CBG', 'CDS']);
});
t('an unknown group value is ignored, not applied', () => {
  const r = run('?group=EVERYTHING', { restricted: false });
  assert.strictEqual(r.group, 'BSHGRP');
});

console.log('\nnothing in the URL means nothing applied');

t('an empty query string applies no filters', () => {
  const r = run('', { restricted: false });
  assert.strictEqual(r.applied, false);
  assert.deepStrictEqual(r.locs, []);
});
t('a store login with no params keeps just its own book', () => {
  const r = run('', { restricted: true, book: 'Beach House' });
  assert.strictEqual(r.applied, false);
  assert.deepStrictEqual(r.locs, ['Beach House']);
});

console.log(`\n${pass} passed${process.exitCode ? ' — WITH FAILURES' : ', 0 failed'}\n`);
