// ?recipe= and ?master= deep links.
//
// The property that matters most: a link must never let a store open a recipe
// from another book. ?master= is the format external systems (Prep Hub) will
// store, so the same URL must resolve differently per login and never leak.

const fs = require('fs');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('index.html', 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];
function grab(name) {
  const i = script.search(new RegExp(`function ${name}\\(`));
  assert.ok(i > -1, `missing ${name}`);
  let d = 0, j = script.indexOf('{', i);
  for (; j < script.length; j++) { if (script[j]==='{') d++; else if (script[j]==='}') { d--; if(!d) break; } }
  return script.slice(i, j + 1);
}

const R = (id, master, loc, name) => ({ id, masterId: master, location: loc, name });
// Same logical recipe in three books, plus an unrelated one and a BSHGRP2 row.
const DATA = [
  R('a1', 'm-shared', 'CBG', 'Lemon Butter'),
  R('a2', 'm-shared', 'CDS', 'Lemon Butter'),
  R('a3', 'm-shared', 'Palm', 'Lemon Butter'),
  R('b1', 'm-solo', 'Salty Crab North Beach', 'Roasted Potatoes'),
  R('c1', 'm-other', 'Mar Vista', 'Something BSHGRP2'),
];

function run(url, { restricted = null, group = 'BSHGRP' } = {}) {
  const dom = new JSDOM('', { url, runScripts: 'outside-only' });
  const w = dom.window;
  const opened = [], toasts = [];
  w.eval(`
    const RECIPES = ${JSON.stringify(DATA)};
    const LOC_GROUP = {'CBG':'BSHGRP','CDS':'BSHGRP','Palm':'BSHGRP',
      'Salty Crab North Beach':'BSHGRP',"Salty's Island":'BSHGRP',
      'Mar Vista':'BSHGRP2','Sandbar':'BSHGRP2','Beach House':'BSHGRP2'};
    const ASSIGNED_LOCATION = ${JSON.stringify(restricted || 'all')};
    const IS_LOCATION_RESTRICTED = ${restricted ? 'true' : 'false'};
    let activeGroup = ${JSON.stringify(group)};
    const __opened = [], __toasts = [];
    function openModal(id){ __opened.push(id); }
    function toast(m,t){ __toasts.push(m); }
    ${grab('openRecipeFromUrl')}
    openRecipeFromUrl();
    globalThis.__r = { opened: __opened, toasts: __toasts };
  `);
  const r = w.__r;
  return { opened: [...r.opened], toasts: [...r.toasts] };
}

let pass = 0;
const t = (d, fn) => { try { fn(); console.log('  ok  ' + d); pass++; }
  catch (e) { console.log('  FAIL ' + d + '\n       ' + e.message); process.exitCode = 1; } };

const U = 'https://recipes.jbodzak.workers.dev/';

console.log('\n?recipe= opens one exact row');
t('admin opens any row by id', () => {
  assert.deepStrictEqual(run(U + '?recipe=a2').opened, ['a2']);
});
t('a CBG login opens its own row by id', () => {
  assert.deepStrictEqual(run(U + '?recipe=a1', { restricted: 'CBG' }).opened, ['a1']);
});
t('a CBG login CANNOT open the CDS row by id', () => {
  const r = run(U + '?recipe=a2', { restricted: 'CBG' });
  assert.deepStrictEqual(r.opened, []);
  assert.ok(r.toasts[0].includes('another store'), r.toasts[0]);
});
t('an unknown id reports rather than silently doing nothing', () => {
  const r = run(U + '?recipe=nope');
  assert.deepStrictEqual(r.opened, []);
  assert.ok(r.toasts[0].includes('could not be opened'), r.toasts[0]);
});

console.log('\n?master= resolves to the viewer\u2019s own book \u2014 one URL, nine stores');
const MASTER = U + '?master=m-shared';
t('a CBG login gets the CBG row', () => {
  assert.deepStrictEqual(run(MASTER, { restricted: 'CBG' }).opened, ['a1']);
});
t('a CDS login gets the CDS row', () => {
  assert.deepStrictEqual(run(MASTER, { restricted: 'CDS' }).opened, ['a2']);
});
t('a Palm login gets the Palm row', () => {
  assert.deepStrictEqual(run(MASTER, { restricted: 'Palm' }).opened, ['a3']);
});
t('the SAME url gives each store a different row', () => {
  const got = ['CBG','CDS','Palm'].map(b => run(MASTER, { restricted: b }).opened[0]);
  assert.deepStrictEqual(got, ['a1','a2','a3']);
});
t('a store with no row in that group gets nothing, not another book\u2019s', () => {
  const r = run(MASTER, { restricted: 'Salty Crab North Beach' });
  assert.deepStrictEqual(r.opened, []);
  assert.ok(r.toasts.length === 1, r.toasts);
});
t('admin opens some row in the active group', () => {
  const r = run(MASTER);
  assert.strictEqual(r.opened.length, 1);
  assert.ok(['a1','a2','a3'].includes(r.opened[0]));
});
t('a single-book recipe resolves for that book', () => {
  assert.deepStrictEqual(
    run(U + '?master=m-solo', { restricted: 'Salty Crab North Beach' }).opened, ['b1']);
});

console.log('\ngroup isolation');
t('a BSHGRP admin cannot open a BSHGRP2 recipe', () => {
  const r = run(U + '?recipe=c1', { group: 'BSHGRP' });
  assert.deepStrictEqual(r.opened, []);
});
t('a BSHGRP2 admin can', () => {
  assert.deepStrictEqual(run(U + '?recipe=c1', { group: 'BSHGRP2' }).opened, ['c1']);
});

console.log('\nno deep link present');
t('a plain url opens nothing and says nothing', () => {
  const r = run(U);
  assert.deepStrictEqual(r.opened, []);
  assert.deepStrictEqual(r.toasts, []);
});
t('existing filter params alone do not trigger it', () => {
  const r = run(U + '?cat=Dinner%20Menu&sub=Appetizers');
  assert.deepStrictEqual(r.opened, []);
  assert.deepStrictEqual(r.toasts, []);
});
t('a deep link alongside filters still opens the recipe', () => {
  assert.deepStrictEqual(run(U + '?cat=Dinner%20Prep&recipe=b1').opened, ['b1']);
});
t('an empty value is ignored', () => {
  assert.deepStrictEqual(run(U + '?recipe=').opened, []);
  assert.deepStrictEqual(run(U + '?master=').toasts, []);
});

console.log('\nwired into startup');
t('openRecipeFromUrl runs after the data loads', () => {
  const init = script.slice(script.indexOf('async function init()'));
  const body = init.slice(0, init.indexOf('\n}'));
  assert.ok(body.indexOf('await loadRecipes') < body.indexOf('openRecipeFromUrl()'),
    'must run after loadRecipes, or RECIPES is empty');
});

console.log(`\n${pass} passed${process.exitCode ? ' — WITH FAILURES' : ', 0 failed'}\n`);
