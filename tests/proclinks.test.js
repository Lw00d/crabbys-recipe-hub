// Procedure links in steps.
//
// BSHGRP2 keeps one copy of each cooking procedure per book and links to it,
// rather than pasting it into every recipe the way BSHGRP1 does with the
// grilling SOP. A step whose whole text is a Procedures recipe's name renders
// as a tappable line that opens it over the top of the current recipe.
//
// The properties that matter: it never crosses a book, it never fires on a
// step that merely mentions the procedure, and it stays completely separate
// from the ingredient-level prep links.

const fs = require('fs');
const assert = require('assert');
const script = fs.readFileSync('index.html', 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];

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

const PROC = (id, loc, name, active = true) =>
  ({ id, masterId: 'pr-x-m', location: loc, name, category: 'Procedures', active, steps: [], ingredients: [] });

function env(recipes) {
  const src = `
    const RECIPES = ${JSON.stringify(recipes)};
    const PROC_CATEGORY = 'Procedures';
    let PROC_INDEX = new Map();
    ${grab('prepKey')} ${grab('buildProcIndex')} ${grab('procLinkFor')}
    buildProcIndex();
    return { procLinkFor, size: PROC_INDEX.size };
  `;
  return new Function(src)();
}

let pass = 0;
const t = (d, f) => {
  try { f(); console.log('  ok  ' + d); pass++; }
  catch (e) { console.log('  FAIL ' + d + '\n       ' + e.message); process.exitCode = 1; }
};

const BLACK_MV = PROC('pr-mv-1', 'Mar Vista', 'Blackening Procedure');
const BLACK_SB = PROC('pr-sb-1', 'Sandbar', 'Blackening Procedure');
const USER = { id: 'dm-mv-9', location: 'Mar Vista', name: 'Blackened Grouper' };

console.log('\nmatching');

t('a step that is exactly the procedure name links', () => {
  const e = env([BLACK_MV, USER]);
  assert.strictEqual(e.procLinkFor(USER, 'Blackening Procedure'), 'pr-mv-1');
});
t('case and punctuation do not matter', () => {
  const e = env([BLACK_MV]);
  for (const s of ['blackening procedure', 'BLACKENING PROCEDURE', 'Blackening Procedure.', 'Blackening  Procedure']) {
    assert.strictEqual(e.procLinkFor(USER, s), 'pr-mv-1', s);
  }
});
t('a trailing colon still matches — the header case', () => {
  const e = env([BLACK_MV]);
  assert.strictEqual(e.procLinkFor(USER, 'Blackening Procedure:'), 'pr-mv-1');
});
t('a step that merely MENTIONS the procedure does not link', () => {
  const e = env([BLACK_MV]);
  for (const s of ['Follow the Blackening Procedure for the grouper',
                   'See Blackening Procedure', 'Blackening Procedure applies here']) {
    assert.strictEqual(e.procLinkFor(USER, s), null, s);
  }
});
t('an unrelated step does not link', () => {
  const e = env([BLACK_MV]);
  assert.strictEqual(e.procLinkFor(USER, 'Season heavily and sear two minutes'), null);
});

console.log('\nscope');

t('it never crosses a book', () => {
  const e = env([BLACK_SB]);   // only Sandbar has the procedure
  assert.strictEqual(e.procLinkFor(USER, 'Blackening Procedure'), null);
});
t('each book resolves to its own copy', () => {
  const e = env([BLACK_MV, BLACK_SB]);
  assert.strictEqual(e.procLinkFor({ location: 'Mar Vista' }, 'Blackening Procedure'), 'pr-mv-1');
  assert.strictEqual(e.procLinkFor({ location: 'Sandbar' }, 'Blackening Procedure'), 'pr-sb-1');
});
t('a procedure does not link to itself', () => {
  const e = env([BLACK_MV]);
  assert.strictEqual(e.procLinkFor(BLACK_MV, 'Blackening Procedure'), null);
});
t('an inactive procedure is not linkable', () => {
  const e = env([PROC('pr-mv-1', 'Mar Vista', 'Blackening Procedure', false)]);
  assert.strictEqual(e.procLinkFor(USER, 'Blackening Procedure'), null);
});

console.log('\nseparate from the ingredient prep links');

t('Procedures is not in PREP_CATEGORIES', () => {
  const m = script.match(/const PREP_CATEGORIES = \[(.*?)\]/)[1];
  assert.ok(!/Procedures/.test(m),
    'a procedure would show on prep sheets and steal ingredient links');
});
t('a Dinner Prep recipe is not in the procedure index', () => {
  const e = env([{ id: 'dp-mv-1', location: 'Mar Vista', name: 'Blackening Procedure',
                   category: 'Dinner Prep', active: true }]);
  assert.strictEqual(e.size, 0);
});
t('the two indexes are built together on every load', () => {
  const n = (script.match(/buildPrepIndex\(\); buildProcIndex\(\)/g) || []).length;
  assert.strictEqual(n, 5, `expected both built at all 5 load points, found ${n}`);
});

console.log('\nrendering');

t('both step renderers check for a procedure link', () => {
  assert.strictEqual((script.match(/procCell\(/g) || []).length, 3, 'renderer, prep layer, and the definition');
});
t('the link opens over the recipe, not away from it', () => {
  assert.ok(/openPrepLayer/.test(grab('procCell')), 'should use the overlay so the cook keeps their place');
});
t('a non-matching step falls through to normal rendering', () => {
  const src = grab('procCell');
  assert.ok(/if\(!id\) return null;/.test(src), 'must return null so the caller renders normally');
});

console.log(`\n${pass} passed${process.exitCode ? ' — WITH FAILURES' : ', 0 failed'}\n`);
