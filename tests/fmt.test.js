// Step and ingredient text is TEXT, with one piece of markup: __emphasis__.
//
// It used to be interpolated into innerHTML unescaped, so six recipes had
// steps that vanished on the card — the browser read '<----- Place in serving
// bowl' as a broken tag and swallowed it.

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
const fmt = new Function(`${grab('esc')} ${grab('fmt')} return fmt;`)();

let pass = 0;
const t = (d, f) => {
  try { f(); console.log('  ok  ' + d); pass++; }
  catch (e) { console.log('  FAIL ' + d + '\n       ' + e.message); process.exitCode = 1; }
};

console.log('\ntext stays text');

t('the six broken steps now render visibly', () => {
  assert.strictEqual(fmt('<----- Place in serving bowl'), '&lt;----- Place in serving bowl');
  assert.strictEqual(fmt('<<zucc cut in half.jpg>>'), '&lt;&lt;zucc cut in half.jpg&gt;&gt;');
});
t('angle brackets and quotes are escaped', () => {
  assert.strictEqual(fmt('Cook <b>now</b>'), 'Cook &lt;b&gt;now&lt;/b&gt;');
  assert.strictEqual(fmt('2" pan'), '2&quot; pan');
  assert.strictEqual(fmt('Salt & pepper'), 'Salt &amp; pepper');
});
t('a script tag cannot execute', () => {
  assert.ok(!fmt('<script>x</script>').includes('<script'));
});
t('null and undefined do not throw', () => {
  assert.strictEqual(fmt(null), '');
  assert.strictEqual(fmt(undefined), '');
});

console.log('\n__emphasis__ mid-sentence');

t('a word inside a sentence goes bold', () => {
  assert.strictEqual(fmt('Cook to __165°F__ before plating'),
                     'Cook to <strong>165°F</strong> before plating');
});
t('several in one line all work', () => {
  assert.strictEqual(fmt('__Rare__ 120, __Medium__ 140'),
                     '<strong>Rare</strong> 120, <strong>Medium</strong> 140');
});
t('an unclosed marker is left alone', () => {
  assert.strictEqual(fmt('Cook to __165'), 'Cook to __165');
});

console.log('\nit does not disturb what is already there');

t('** still marks a whole line, and is not turned into bold', () => {
  // 408 steps start with ** and rely on isHighlight. fmt must not touch them.
  const out = fmt("**If using Natalie's lemon juice, it is 4oz per pound**");
  assert.ok(out.startsWith('**'), out);
  assert.ok(!out.includes('<strong>'), 'the whole-line marker must survive');
});
t('the **** emphasis in New Orleans Oysters survives', () => {
  assert.ok(!fmt('Very important **** keep the tag').includes('<strong>'));
});
t('plain text is unchanged', () => {
  assert.strictEqual(fmt('Place on a dinner plate'), 'Place on a dinner plate');
});

console.log('\nevery render path uses it');

t('both step renderers and the ingredient cell', () => {
  // 1 definition + 2 main-view step branches + 2 prep-overlay branches
  // + 2 ingredient branches
  assert.strictEqual((script.match(/fmt\(/g) || []).length, 7);
});
t('no render path still interpolates raw text', () => {
  for (const bad of ['${hl(s)}', '${hl(name)}', '${esc(x)}</div></div>`;']) {
    assert.ok(!script.includes(bad), 'unescaped path still present: ' + bad);
  }
});
console.log(`
${pass} passed${process.exitCode ? " — WITH FAILURES" : ", 0 failed"}
`);
