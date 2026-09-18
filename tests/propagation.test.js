// Propagation must not collapse cross-listed recipes.
//
// A masterId group can hold more than one row in the SAME book when a recipe is
// deliberately listed under several submenus (SI's Grouper is under Handhelds,
// Tacos / Bowls and Offshore). Propagating `submenu` would set them all to the
// edited row's submenu and the recipe would disappear from the other menus.

const fs = require('fs');
const assert = require('assert');
const html = fs.readFileSync('index.html', 'utf8');
const script = html.match(/<script>([\s\S]*)<\/script>/)[1];

function grab(name) {
  const i = script.search(new RegExp(`function ${name}\\(`));
  assert.ok(i > -1, `missing ${name}`);
  let d = 0, j = script.indexOf('{', i);
  for (; j < script.length; j++) { if (script[j]==='{') d++; else if (script[j]==='}') { d--; if(!d) break; } }
  return script.slice(i, j + 1);
}

function env(recipes) {
  const ctx = {};
  const src = `
    const LOC_GROUP = {'CBG':'BSHGRP','CDS':'BSHGRP','Palm':'BSHGRP',
      'Salty Crab North Beach':'BSHGRP',"Salty's Island":'BSHGRP','Mar Vista':'BSHGRP2'};
    const RECIPES = ${JSON.stringify(recipes)};
    ${grab('getLinkedSiblings')}
    ${grab('shareContentFields')}
    ${grab('propagateToLinked')}
    return { RECIPES, propagateToLinked, getLinkedSiblings };
  `;
  return new Function(src)();
}

const R = (id, master, loc, sub, name, steps) =>
  ({ id, masterId: master, location: loc, submenu: sub, name,
     steps: steps || ['a'], ingredients: [{ name: 'x', qty: '1', unit: 'ea' }] });

let pass = 0;
const t = (d, fn) => { try { fn(); console.log('  ok  ' + d); pass++; }
  catch (e) { console.log('  FAIL ' + d + '\n       ' + e.message); process.exitCode = 1; } };

console.log('\ncross-listing inside one book');
t('a 3-way cross-listing keeps all three submenus', () => {
  const e = env([
    R('dm-si-15', 'dm-grouper-m', "Salty's Island", 'Handhelds', 'Grouper'),
    R('dm-si-16', 'dm-grouper-m', "Salty's Island", 'Tacos / Bowls', 'Grouper'),
    R('dm-si-17', 'dm-grouper-m', "Salty's Island", 'Offshore', 'Grouper'),
  ]);
  const src = e.RECIPES[0];
  src.steps = ['NEW STEP'];
  e.propagateToLinked(src);
  assert.deepStrictEqual(e.RECIPES.map(r => r.submenu),
    ['Handhelds', 'Tacos / Bowls', 'Offshore'], 'submenus must be untouched');
  assert.deepStrictEqual(e.RECIPES.map(r => r.steps[0]),
    ['NEW STEP', 'NEW STEP', 'NEW STEP'], 'content must still propagate');
});
t('a 2-way cross-listing (Breakfast Entrees / Kid\u2019s Meals) survives', () => {
  const e = env([
    R('bm-nb-2', 'bm-french-toast-m', 'Salty Crab North Beach', 'Breakfast Entrees', 'French Toast'),
    R('bm-nb-3', 'bm-french-toast-m', 'Salty Crab North Beach', "Kid's Meals", 'French Toast'),
  ]);
  e.RECIPES[1].steps = ['EDITED FROM THE KIDS ROW'];
  e.propagateToLinked(e.RECIPES[1]);
  assert.deepStrictEqual(e.RECIPES.map(r => r.submenu), ['Breakfast Entrees', "Kid's Meals"]);
  assert.strictEqual(e.RECIPES[0].steps[0], 'EDITED FROM THE KIDS ROW');
});

console.log('\nnormal cross-book propagation still works');
t('ingredients and steps propagate across books', () => {
  const e = env([
    R('a', 'm-1', 'CBG', 'Sides', 'Slaw'),
    R('b', 'm-1', 'CDS', 'Sides', 'Slaw'),
    R('c', 'm-1', 'Palm', 'Sides', 'Slaw'),
  ]);
  e.RECIPES[0].steps = ['S1', 'S2'];
  e.RECIPES[0].ingredients = [{ name: 'cabbage', qty: '2', unit: 'lb' }];
  const n = e.propagateToLinked(e.RECIPES[0]);
  assert.strictEqual(n, 2);
  assert.deepStrictEqual(e.RECIPES[2].steps, ['S1', 'S2']);
  assert.strictEqual(e.RECIPES[1].ingredients[0].name, 'cabbage');
});
t('name propagates but submenu does not', () => {
  const e = env([
    R('a', 'm-1', 'CBG', 'Sides', 'Old Name'),
    R('b', 'm-1', 'CDS', 'Appetizers', 'Old Name'),
  ]);
  e.RECIPES[0].name = 'New Name';
  e.propagateToLinked(e.RECIPES[0]);
  assert.strictEqual(e.RECIPES[1].name, 'New Name');
  assert.strictEqual(e.RECIPES[1].submenu, 'Appetizers', 'submenu must be preserved');
});
t('siblings are marked modified so they get saved', () => {
  const e = env([R('a','m-1','CBG','Sides','X'), R('b','m-1','CDS','Sides','X')]);
  e.propagateToLinked(e.RECIPES[0]);
  assert.strictEqual(e.RECIPES[1]._modified, true);
});

console.log('\nthe array-sharing fix is still in place');
t('siblings do not share array references with the source', () => {
  const e = env([R('a','m-1','CBG','Sides','X'), R('b','m-1','CDS','Sides','X')]);
  e.propagateToLinked(e.RECIPES[0]);
  e.RECIPES[0].steps.push('ONLY ON SOURCE');
  assert.strictEqual(e.RECIPES[1].steps.length, 1, 'sibling mutated with the source');
});
t('two siblings do not share arrays with each other', () => {
  const e = env([R('a','m-1','CBG','S','X'), R('b','m-1','CDS','S','X'), R('c','m-1','Palm','S','X')]);
  e.propagateToLinked(e.RECIPES[0]);
  e.RECIPES[1].steps.push('ONLY ON B');
  assert.strictEqual(e.RECIPES[2].steps.length, 1);
});

console.log('\nportions');
t('portions propagates to linked siblings like any other content field', () => {
  const a = R('a','m-1','CBG','Sides','X'), b = R('b','m-1','CDS','Sides','X');
  a.portions = '12'; b.portions = '';
  const e = env([a, b]);
  e.propagateToLinked(e.RECIPES[0]);
  assert.strictEqual(e.RECIPES[1].portions, '12');
});
t('portions is not carried across books', () => {
  const a = R('a','m-1','CBG','S','X'), z = R('z','m-1','Mar Vista','S','X');
  a.portions = '12'; z.portions = '';
  const e = env([a, z]);
  e.propagateToLinked(e.RECIPES[0]);
  assert.strictEqual(e.RECIPES[1].portions, '');
});

console.log('\ngroup isolation');
t('propagation never crosses BSHGRP / BSHGRP2', () => {
  const e = env([R('a','m-1','CBG','S','X'), R('z','m-1','Mar Vista','S','X')]);
  assert.strictEqual(e.propagateToLinked(e.RECIPES[0]), 0);
});

console.log(`\n${pass} passed${process.exitCode ? ' — WITH FAILURES' : ', 0 failed'}\n`);
