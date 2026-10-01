// Ingredient links and the trailing parenthetical.
//
// An ingredient usually carries a note its prep recipe's name does not —
// "Clam Chowder Add (Prep)", "Shrimp Pieces (Pull Thaw)", "Lettuce Romaine
// (Pre-cut)". The note is useful to the cook, so it stays; it should not stop
// the link resolving. 182 links across the file depend on this.
//
// Exact match still wins, so a prep recipe genuinely named "Calamari (Prep)"
// is not shadowed by one named "Calamari".

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

const R = (id, loc, name, cat = 'Dinner Prep', active = true) =>
  ({ id, location: loc, name, category: cat, active, masterId: id + '-m', ingredients: [], steps: [] });

function env(recipes) {
  return new Function(`
    const RECIPES = ${JSON.stringify(recipes)};
    const PREP_CATEGORIES = ['Dinner Prep','Breakfast Prep','Line Prep'];
    let PREP_INDEX = new Map();
    ${grab('prepKey')} ${grab('buildPrepIndex')} ${grab('prepLinkFor')}
    buildPrepIndex();
    return prepLinkFor;
  `)();
}

let pass = 0;
const t = (d, f) => {
  try { f(); console.log('  ok  ' + d); pass++; }
  catch (e) { console.log('  FAIL ' + d + '\n       ' + e.message); process.exitCode = 1; }
};

const CBG = { id: 'dp-cbg-99', location: 'CBG' };

console.log('\nthe case this was built for');

t('"Clam Chowder Add (Prep)" links to "Clam Chowder Add"', () => {
  const f = env([R('dp-cbg-6', 'CBG', 'Clam Chowder Add')]);
  assert.strictEqual(f(CBG, 'Clam Chowder Add (Prep)'), 'dp-cbg-6');
});
t('"Soup Clam Chowder (Prep)" links to "Soup Clam Chowder"', () => {
  const f = env([R('dp-si-38', 'CBG', 'Soup Clam Chowder')]);
  assert.strictEqual(f(CBG, 'Soup Clam Chowder (Prep)'), 'dp-si-38');
});

console.log('\nthe other notes it unblocks');

t('state, portion and source notes all fall away', () => {
  const f = env([R('a', 'CBG', 'Shrimp Pieces'), R('b', 'CBG', 'Lettuce Romaine'),
                 R('c', 'CBG', 'Corn Stock'), R('d', 'CBG', 'Quinoa'),
                 R('e', 'CBG', 'Steak Seasoning'), R('g', 'CBG', 'Onion Straws')]);
  assert.strictEqual(f(CBG, 'Shrimp Pieces (Pull Thaw)'), 'a');
  assert.strictEqual(f(CBG, 'Lettuce Romaine (Pre-cut)'), 'b');
  assert.strictEqual(f(CBG, 'Corn Stock ( in house )'), 'c');
  assert.strictEqual(f(CBG, 'Quinoa (6.5oz/cup)'), 'd');
  assert.strictEqual(f(CBG, 'Steak Seasoning (SI)'), 'e');
  assert.strictEqual(f(CBG, 'Onion Straws (Cooked Yield)'), 'g');
});
t('case and spacing in the note do not matter', () => {
  const f = env([R('a', 'CBG', 'Calamari')]);
  for (const n of ['Calamari (Prep)', 'Calamari (prep)', 'Calamari(prep)', 'Calamari  ( PREP ) ']) {
    assert.strictEqual(f(CBG, n), 'a', n);
  }
});

console.log('\nwhat it must NOT do');

t('an exact match still wins over the stem', () => {
  // A prep recipe really named "Calamari (Prep)" must not be shadowed.
  const f = env([R('exact', 'CBG', 'Calamari (Prep)'), R('stem', 'CBG', 'Calamari')]);
  assert.strictEqual(f(CBG, 'Calamari (Prep)'), 'exact');
  assert.strictEqual(f(CBG, 'Calamari'), 'stem');
});
t('only a TRAILING parenthetical is ignored', () => {
  const f = env([R('a', 'CBG', 'Sauce')]);
  assert.strictEqual(f(CBG, '(Prep) Sauce'), null, 'a leading note is not a match');
  assert.strictEqual(f(CBG, 'Sauce (Prep) extra'), null, 'mid-string is not a match');
});
t('it does not cross a book', () => {
  const f = env([R('a', 'CDS', 'Clam Chowder Add')]);
  assert.strictEqual(f(CBG, 'Clam Chowder Add (Prep)'), null);
});
t('it does not link a recipe to itself', () => {
  const self = { id: 'a', location: 'CBG' };
  const f = env([R('a', 'CBG', 'Grits')]);
  assert.strictEqual(f(self, 'Grits (prep)'), null);
});
t('an inactive prep recipe is still not linkable', () => {
  const f = env([R('a', 'CBG', 'Grits', 'Dinner Prep', false)]);
  assert.strictEqual(f(CBG, 'Grits (prep)'), null);
});
t('stripping the note down to nothing links nothing', () => {
  const f = env([R('a', 'CBG', 'Grits')]);
  assert.strictEqual(f(CBG, '(Prep)'), null);
});
t('a note with no matching recipe still links nothing', () => {
  const f = env([R('a', 'CBG', 'Grits')]);
  assert.strictEqual(f(CBG, 'Butter (Prep)'), null);
});

console.log(`\n${pass} passed${process.exitCode ? ' — WITH FAILURES' : ', 0 failed'}\n`);
