// The stale-copy correction, and how loudly it announces itself.
//
// raw.githubusercontent.com caches for five minutes while recipes.json changes
// all day, so loading the page seconds after a save shows a slightly old copy.
// The app detects that, swaps in the authoritative data, and says so.
//
// It used to say so in red, with a warning triangle, reading "Showed a cached
// copy". That looks like a fault — people went hunting for a problem that had
// already fixed itself. It is now informational, and silent for the small
// routine differences.

const fs = require('fs');
const assert = require('assert');
const script = fs.readFileSync('index.html', 'utf8').match(/<script>([\s\S]*)<\/script>/)[1];
const html = fs.readFileSync('index.html', 'utf8');

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
const diff = new Function(`${grab('summarizeRecipeDiff')} return summarizeRecipeDiff;`)();
const R = (id, name) => ({ id, name, steps: [], ingredients: [] });

let pass = 0;
const t = (d, f) => {
  try { f(); console.log('  ok  ' + d); pass++; }
  catch (e) { console.log('  FAIL ' + d + '\n       ' + e.message); process.exitCode = 1; }
};

console.log('\ncounting the difference');

t('identical data reports nothing', () => {
  assert.strictEqual(diff([R('a','A')], [R('a','A')]), null);
});
t('a removed recipe counts once', () => {
  const d = diff([R('a','A'), R('b','B')], [R('a','A')]);
  assert.strictEqual(d.total, 1);
  assert.ok(d.text.includes('1 recipe removed'));
});
t('added, removed and edited all add up', () => {
  const before = [R('a','A'), R('b','B'), R('c','C')];
  const after  = [R('a','A'), { ...R('b','B'), name: 'B2' }, R('d','D')];
  const d = diff(before, after);
  assert.strictEqual(d.total, 3, d.text);   // c removed, d added, b edited
  assert.ok(d.text.includes('added') && d.text.includes('removed') && d.text.includes('edited'));
});
t('singular and plural are both handled', () => {
  assert.ok(diff([R('a','A')], []).text.includes('1 recipe removed'));
  assert.ok(diff([R('a','A'), R('b','B')], []).text.includes('2 recipes removed'));
});

console.log('\nhow loudly it announces');

t('the threshold exists and is small', () => {
  const m = /const QUIET_CORRECTION_MAX = (\d+);/.exec(script);
  assert.ok(m, 'no threshold defined');
  assert.ok(+m[1] >= 1 && +m[1] <= 20, 'threshold should be a handful, got ' + m[1]);
});
t('the toast fires only above the threshold', () => {
  assert.ok(/summary\.total > QUIET_CORRECTION_MAX/.test(script),
    'the correction must be silent for small routine differences');
});
// Comments in index.html quote the old wording to explain why it changed, so
// check the executable text rather than the whole file.
const code = script.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');

t('it is no longer styled as an error', () => {
  assert.ok(!/Showed a cached copy/.test(code), 'the alarming wording still reaches a toast');
  assert.ok(!/\u26a0/.test(code.slice(code.indexOf('Updated to the latest version') - 200,
                                      code.indexOf('Updated to the latest version') + 200)),
    'no warning triangle on an informational notice');
  assert.ok(/Updated to the latest version/.test(script), 'informational wording missing');
  const call = script.slice(script.indexOf('Updated to the latest version'));
  assert.ok(/'info'/.test(call.slice(0, 220)), "should use the 'info' style, not 'err'");
});
t('an info toast style is defined', () => {
  assert.ok(/\.toast\.info\s*\{/.test(html), 'no .toast.info rule');
});

console.log('\nthe correction itself still happens');

t('data is swapped in regardless of whether anything is announced', () => {
  const fn = grab('checkForStaleData');
  const swap = fn.indexOf('RECIPES = authoritativeData');
  const gate = fn.indexOf('QUIET_CORRECTION_MAX');
  assert.ok(swap > -1 && gate > -1 && swap < gate,
    'the swap must happen before the notification decision, never because of it');
});
t('the status line always records it', () => {
  const fn = grab('checkForStaleData');
  assert.ok(/setStatus\('online', `Corrected/.test(fn),
    'a silent correction must still be visible somewhere');
  const gate = fn.indexOf('if (summary && summary.total');
  assert.ok(fn.indexOf('setStatus') > gate, 'setStatus must sit outside the toast condition');
});
console.log(`
${pass} passed${process.exitCode ? " — WITH FAILURES" : ", 0 failed"}
`);
