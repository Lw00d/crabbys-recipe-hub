// Ingredient -> prep recipe links, and the second-layer modal.
//
// The security-relevant property is that a link can never reach outside the
// reader's own recipe book: a CBG login must not be able to open a CDS recipe
// by tapping an ingredient whose name happens to match.

const fs = require('fs');
const assert = require('assert');
const { JSDOM } = require('jsdom');

const html = fs.readFileSync('index.html', 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

function grab(name) {
  const i = script.search(new RegExp(`function ${name}\\(`));
  assert.ok(i > -1, `missing ${name}`);
  let d = 0, j = script.indexOf('{', i);
  for (; j < script.length; j++) {
    if (script[j] === '{') d++;
    else if (script[j] === '}') { d--; if (!d) break; }
  }
  return script.slice(i, j + 1);
}
const CONSTS = script.match(/const PREP_CATEGORIES = \[[^\]]*\];/)[0];

const R = (id, name, loc, cat, extra = {}) =>
  ({ id, name, location: loc, category: cat, ingredients: [], steps: [], ...extra });

function env(recipes) {
  const dom = new JSDOM('<div id="prepBackdrop"></div>', { runScripts: 'outside-only' });
  const w = dom.window;
  return w.eval(`(function(){
    ${CONSTS}
    let PREP_INDEX = new Map();
    const RECIPES = ${JSON.stringify(recipes)};
    function hl(s){ return String(s==null?'':s); }
    function esc(s){ return (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
    ${grab('prepKey')}
    ${grab('buildPrepIndex')}
    ${grab('prepLinkFor')}
    ${grab('ingCell')}
    buildPrepIndex();
    return {
      link: (recipe, name) => prepLinkFor(recipe, name),
      cell: (recipe, name) => ingCell(recipe, name),
      size: () => PREP_INDEX.size,
    };
  })()`);
}

let pass = 0;
const t = (d, fn) => {
  try { fn(); console.log('  ok  ' + d); pass++; }
  catch (e) { console.log('  FAIL ' + d + '\n       ' + e.message); process.exitCode = 1; }
};

const BASE = [
  R('p1', 'Lemon Butter', 'CBG', 'Dinner Prep'),
  R('p2', 'Garlic Spread', 'CBG', 'Line Prep'),
  R('p3', 'Lemon Butter', 'CDS', 'Dinner Prep'),
  R('p4', 'Hidden Sauce', 'CBG', 'Dinner Prep', { active: false }),
  R('m1', 'Mahi Sandwich', 'CBG', 'Dinner Menu'),
  R('m2', 'Lemon Butter', 'CBG', 'Dinner Menu'),   // a MENU item with the same name
];

console.log('\nmatching');
t('an ingredient matching a prep recipe in the same book links', () => {
  const e = env(BASE);
  assert.strictEqual(e.link(BASE[4], 'Lemon Butter'), 'p1');
});
t('matching ignores case, spaces and punctuation', () => {
  const e = env(BASE);
  for (const v of ['lemon butter', 'LEMON BUTTER', 'Lemon  Butter', 'Lemon-Butter', 'lemonbutter'])
    assert.strictEqual(e.link(BASE[4], v), 'p1', v);
});
t('an ingredient with no prep recipe does not link', () => {
  const e = env(BASE);
  assert.strictEqual(e.link(BASE[4], 'Butter AA'), null);
});
t('an empty or missing name does not link', () => {
  const e = env(BASE);
  assert.strictEqual(e.link(BASE[4], ''), null);
  assert.strictEqual(e.link(BASE[4], null), null);
});

console.log('\nscoping — a link must never leave the reader\u2019s book');
t('a CBG recipe links to the CBG prep, not the CDS one', () => {
  const e = env(BASE);
  assert.strictEqual(e.link(BASE[4], 'Lemon Butter'), 'p1');
});
t('a CDS recipe links to the CDS prep', () => {
  const e = env(BASE);
  const cds = R('m3', 'Grouper', 'CDS', 'Dinner Menu');
  assert.strictEqual(e.link(cds, 'Lemon Butter'), 'p3');
});
t('no link when the prep exists only in another book', () => {
  const e = env(BASE);
  const palm = R('m4', 'Something', 'Palm', 'Dinner Menu');
  assert.strictEqual(e.link(palm, 'Lemon Butter'), null);
});

console.log('\nwhat is eligible');
t('only prep categories are linkable, not menu items', () => {
  const e = env(BASE);
  // m2 is a Dinner Menu item also called "Lemon Butter" — must resolve to p1
  assert.strictEqual(e.link(BASE[4], 'Lemon Butter'), 'p1');
});
t('an inactive prep recipe is not linked', () => {
  const e = env(BASE);
  assert.strictEqual(e.link(BASE[4], 'Hidden Sauce'), null);
});
t('a prep recipe does not link to itself', () => {
  const e = env(BASE);
  assert.strictEqual(e.link(BASE[0], 'Lemon Butter'), null);
});
t('all three prep categories are eligible', () => {
  const e = env(BASE);
  assert.strictEqual(e.link(BASE[4], 'Garlic Spread'), 'p2');  // Line Prep
});

console.log('\nrendered cell');
t('a linked ingredient renders as a tappable span with the arrow', () => {
  const e = env(BASE);
  const h = e.cell(BASE[4], 'Lemon Butter');
  assert.ok(h.includes('ing-link'), h);
  assert.ok(h.includes("openPrepLayer('p1')"), h);
  assert.ok(h.includes('\u2197'), h);
});
t('an unlinked ingredient renders as plain text', () => {
  const e = env(BASE);
  const h = e.cell(BASE[4], 'Butter AA');
  assert.ok(!h.includes('ing-link'), h);
  assert.strictEqual(h, 'Butter AA');
});

console.log('\nwired into the page');
t('both ingredient tables use ingCell', () => {
  assert.strictEqual((script.match(/ingCell\(recipe, i\.name\)/g) || []).length, 2);
});
t('the prep index is rebuilt wherever categories are', () => {
  const cats = (script.match(/buildCategories\(\);/g) || []).length;
  const preps = (script.match(/buildPrepIndex\(\);/g) || []).length;
  assert.strictEqual(preps, cats, `buildCategories x${cats} but buildPrepIndex x${preps}`);
});
t('the second-layer modal exists and closes back to the recipe', () => {
  assert.ok(html.includes('id="prepBackdrop"'));
  assert.ok(html.includes('function closePrepLayer()'));
  assert.ok(html.includes('handlePrepBackdropClick'));
});
t('closing the layer does not restore body scroll (recipe still open)', () => {
  const fn = grab('closePrepLayer');
  assert.ok(!/body\.style\.overflow\s*=\s*''/.test(fn), 'must not re-enable page scroll');
});
t('the prep layer does not link its own ingredients onward', () => {
  const fn = grab('openPrepLayer');
  assert.ok(!fn.includes('ingCell('), 'second layer should not chain further');
});

console.log(`\n${pass} passed${process.exitCode ? ' — WITH FAILURES' : ', 0 failed'}\n`);
