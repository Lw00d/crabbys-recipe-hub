// The `portions` and `portionSize` fields.
//
// Yield says how much a batch makes ("3.1 LB"); portions says how many servings
// that is. 87 of the BSHGRP2 source sheets carry both, and BSHGRP1 recipes can
// use it too. Free text, like yield, because the sheets write "1", "12" and
// "12 each" interchangeably.
//
// The field is optional and absent from all 1,688 existing recipes, so the
// thing most worth proving is that nothing breaks when it isn't there.

const fs = require('fs');
const assert = require('assert');
const html = fs.readFileSync('index.html', 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

let pass = 0;
const t = (d, fn) => {
  try { fn(); console.log('  ok  ' + d); pass++; }
  catch (e) { console.log('  FAIL ' + d); console.log('       ' + e.message); process.exitCode = 1; }
};

console.log('\nthe field is wired up everywhere yield is');

t('the detail view renders both pills', () => {
  assert.ok(/recipe\.portions.*# of Portions:/.test(script), 'no count pill in the recipe detail view');
  assert.ok(/recipe\.portionSize.*Portion:/.test(script), 'no portion-size pill in the recipe detail view');
});
t('the prep layer renders both too', () => {
  assert.ok(/r\.portions.*# of Portions:/.test(script), 'no count pill in the prep layer');
  assert.ok(/r\.portionSize.*Portion:/.test(script), 'no portion-size pill in the prep layer');
});
t('the editor has both inputs bound to uF', () => {
  assert.ok(/uF\('portions',this\.value\)/.test(script), 'no editable count field');
  assert.ok(/uF\('portionSize',this\.value\)/.test(script), 'no editable portion-size field');
});
t('a brand-new recipe starts with both empty', () => {
  const flat = script.replace(/\s/g, '');
  assert.ok(/portions:''/.test(flat) && /portionSize:''/.test(flat), 'new recipes omit one of them');
});
t('the two are independent — a count without a size is fine, and vice versa', () => {
  // They come from separate rows in the source sheets and one is often blank.
  assert.ok(!/portions\s*&&\s*r?e?c?i?p?e?\.?portionSize/.test(script), 'the pills are coupled');
});

console.log('\nabsent is not broken');

t('esc() turns a missing portions into an empty string, not "undefined"', () => {
  const esc = eval('(' + script.match(/function esc\(s\)\{[^}]*\}/)[0].replace(/^function esc/, 'function') + ')');
  assert.strictEqual(esc(undefined), '');
  assert.strictEqual(esc(null), '');
});
t('the pill is conditional, so recipes without portions show nothing', () => {
  // Both renderers must guard on the value rather than printing an empty pill.
  const guards = script.match(/if\((?:recipe|r)\.portions\)/g) || [];
  const sizeGuards = script.match(/if\((?:recipe|r)\.portionSize\)/g) || [];
  assert.strictEqual(guards.length, 2, `expected 2 guarded count pills, found ${guards.length}`);
  assert.strictEqual(sizeGuards.length, 2, `expected 2 guarded size pills, found ${sizeGuards.length}`);
});
t('portions is not tied to dualBatch, unlike yield2', () => {
  // yield2 is deleted when dual-batch is switched off; portions must survive.
  assert.ok(!/delete r\.portions/.test(script), 'portions gets deleted somewhere');
  assert.ok(!/delete r\.portionSize/.test(script), 'portionSize gets deleted somewhere');
});

console.log('\nit is a content field, so it travels with the recipe');

t('shareContentFields does not exclude portions', () => {
  const fn = script.match(/function shareContentFields\([\s\S]*?\n\}/)[0];
  assert.ok(!/portions|portionSize/.test(fn),
    'portions is named in shareContentFields — it should fall through with the rest of the content');
});

console.log(`\n${pass} passed${process.exitCode ? ' — WITH FAILURES' : ', 0 failed'}\n`);
