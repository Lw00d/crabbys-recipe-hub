// The linked badge counts stores, and says how many are live.
//
// It used to count every sibling regardless of active state, so a group with
// one store switched off read "3 stores" while only two cards rendered. That
// is precisely how a deactivated recipe looked like a deleted one.

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

const R = (id, loc, master, active) => {
  const r = { id, location: loc, masterId: master, name: 'X' };
  if (active !== undefined) r.active = active;
  return r;
};

function badge(recipes, which) {
  return new Function(`
    const RECIPES = ${JSON.stringify(recipes)};
    const LOC_GROUP = { CBG:'BSHGRP', CDS:'BSHGRP', Palm:'BSHGRP', "Salty's Island":'BSHGRP',
                        'Mar Vista':'BSHGRP2', Sandbar:'BSHGRP2', 'Beach House':'BSHGRP2' };
    ${grab('getLinkedCount')} ${grab('linkedBadge')}
    return linkedBadge(RECIPES.find(r => r.id === ${JSON.stringify(which)}));
  `)();
}

let pass = 0;
const t = (d, f) => {
  try { f(); console.log('  ok  ' + d); pass++; }
  catch (e) { console.log('  FAIL ' + d + '\n       ' + e.message); process.exitCode = 1; }
};

const THREE = [R('a','CBG','m'), R('b','CDS','m'), R("c","Salty's Island",'m')];

console.log('\nall live');

t('three live stores read "3 stores"', () => {
  assert.ok(badge(THREE, 'a').includes('3 stores'));
  assert.ok(!badge(THREE, 'a').includes(' of '));
});
t('an unlinked recipe gets no badge at all', () => {
  assert.strictEqual(badge([R('a','CBG','solo')], 'a'), '');
});

console.log('\none switched off');

t('the French Toast case reads "2 of 3 stores"', () => {
  const g = [R('a','CBG','m'), R('b','CDS','m'), R("c","Salty's Island",'m', false)];
  assert.ok(badge(g, 'a').includes('2 of 3 stores'), badge(g, 'a'));
});
t('the inactive row itself shows the same count', () => {
  const g = [R('a','CBG','m'), R('b','CDS','m'), R("c","Salty's Island",'m', false)];
  assert.ok(badge(g, 'c').includes('2 of 3 stores'));
});
t('two off out of three reads "1 of 3 stores"', () => {
  const g = [R('a','CBG','m'), R('b','CDS','m', false), R("c","Salty's Island",'m', false)];
  assert.ok(badge(g, 'a').includes('1 of 3 stores'));
});

console.log('\nedges');

t('a whole group switched off falls back to the plain count', () => {
  // Browsing the inactive view, every row is off; "0 of 3" would be noise.
  const g = [R('a','CBG','m', false), R('b','CDS','m', false)];
  assert.ok(badge(g, 'a').includes('2 stores'));
  assert.ok(!badge(g, 'a').includes(' of '));
});
t('active: true counts as live, same as no flag', () => {
  const g = [R('a','CBG','m', true), R('b','CDS','m', true)];
  assert.ok(badge(g, 'a').includes('2 stores'));
});
t('it still does not count across companies', () => {
  const g = [R('a','CBG','m'), R('b','Mar Vista','m')];
  assert.strictEqual(badge(g, 'a'), '', 'a cross-company sibling is not a sibling');
});
console.log(`
${pass} passed${process.exitCode ? " — WITH FAILURES" : ", 0 failed"}
`);
