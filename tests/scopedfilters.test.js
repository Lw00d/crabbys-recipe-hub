// The Category and Submenu dropdowns only offer what the login can see.
//
// They used to be built from every recipe in the file, with BASE_CATEGORIES
// unioned in regardless. A Sandbar login was offered Coffee Drinks, Ice Cream,
// Smoothies and Drink Menu — all empty for it — plus BSHGRP1 submenus like
// Offshore and Shell Bar.

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

const R = (loc, cat, sub) => ({ id: loc + cat + sub, location: loc, category: cat, submenu: sub, name: 'x' });
const DATA = [
  R('CBG', 'Dinner Menu', 'Offshore'), R('CBG', 'Coffee Drinks', ''),
  R('CBG', 'Ice Cream', ''), R('CDS', 'Dinner Menu', 'Shell Bar'),
  R('Sandbar', 'Dinner Menu', 'Tacos / Bowls'), R('Sandbar', 'Dinner Prep', 'Cold Prep'),
  R('Mar Vista', 'Procedures', ''),
];

function build({ restricted, book = '', group = 'BSHGRP' }) {
  return new Function(`
    const RECIPES = ${JSON.stringify(DATA)};
    const BASE_CATEGORIES = ['Breakfast Menu','Breakfast Prep','Coffee Drinks','Dinner Menu',
                             'Dinner Prep','Drink Menu','Ice Cream','Line Prep','Smoothies'];
    const LOC_GROUP = { CBG:'BSHGRP', CDS:'BSHGRP', Palm:'BSHGRP', "Salty's Island":'BSHGRP',
                        'Mar Vista':'BSHGRP2', Sandbar:'BSHGRP2', 'Beach House':'BSHGRP2' };
    const IS_LOCATION_RESTRICTED = ${!!restricted};
    const ASSIGNED_LOCATION = ${JSON.stringify(book)};
    let activeGroup = ${JSON.stringify(group)};
    let CATS = [], SUBMENUS = {};
    const renderCatDropdown = () => {}, updateSubmenuOptions = () => {};
    ${grab('inScope')} ${grab('buildSubmenus')} ${grab('buildCategories')}
    buildCategories(); buildSubmenus();
    return { CATS, SUBMENUS: Object.fromEntries(Object.entries(SUBMENUS).map(([k,v])=>[k,[...v]])) };
  `)();
}

let pass = 0;
const t = (d, f) => {
  try { f(); console.log('  ok  ' + d); pass++; }
  catch (e) { console.log('  FAIL ' + d + '\n       ' + e.message); process.exitCode = 1; }
};

console.log('\na store login');

t('Sandbar is not offered categories it has none of', () => {
  const { CATS } = build({ restricted: true, book: 'Sandbar' });
  assert.deepStrictEqual(CATS, ['Dinner Menu', 'Dinner Prep']);
  for (const c of ['Coffee Drinks', 'Ice Cream', 'Smoothies', 'Drink Menu']) {
    assert.ok(!CATS.includes(c), c + ' should not be offered');
  }
});
t('Sandbar is not offered another book\u2019s submenus', () => {
  const { SUBMENUS } = build({ restricted: true, book: 'Sandbar' });
  assert.deepStrictEqual(SUBMENUS['Dinner Menu'], ['Tacos / Bowls']);
  assert.ok(!(SUBMENUS['Dinner Menu'] || []).includes('Offshore'));
  assert.ok(!(SUBMENUS['Dinner Menu'] || []).includes('Shell Bar'));
});
t('CBG still sees its own, including the empty-submenu categories', () => {
  const { CATS, SUBMENUS } = build({ restricted: true, book: 'CBG' });
  assert.deepStrictEqual(CATS, ['Coffee Drinks', 'Dinner Menu', 'Ice Cream']);
  assert.deepStrictEqual(SUBMENUS['Dinner Menu'], ['Offshore']);
});

console.log('\nthe all-stores admin');

t('on BSHGRP it sees BSHGRP categories only', () => {
  const { CATS } = build({ restricted: false, group: 'BSHGRP' });
  assert.ok(CATS.includes('Coffee Drinks') && CATS.includes('Dinner Menu'));
  assert.ok(!CATS.includes('Procedures'), 'Procedures is BSHGRP2 only');
});
t('switching to BSHGRP2 changes what is offered', () => {
  const { CATS, SUBMENUS } = build({ restricted: false, group: 'BSHGRP2' });
  assert.ok(CATS.includes('Procedures'));
  assert.ok(!CATS.includes('Coffee Drinks'), 'BSHGRP2 has no Coffee Drinks');
  assert.deepStrictEqual(SUBMENUS['Dinner Menu'], ['Tacos / Bowls']);
});
t('switchGroup rebuilds both lists', () => {
  const src = grab('switchGroup');
  assert.ok(/buildCategories\(\)/.test(src) && /buildSubmenus\(\)/.test(src),
    'the toggle must rebuild, or the dropdowns keep the old company\u2019s options');
});

console.log('\nedges');

t('an empty scope falls back to the full list rather than going blank', () => {
  const { CATS } = build({ restricted: true, book: 'Nowhere' });
  assert.ok(CATS.length > 5, 'dropdown should not be empty');
});
console.log(`
${pass} passed${process.exitCode ? " — WITH FAILURES" : ", 0 failed"}
`);
