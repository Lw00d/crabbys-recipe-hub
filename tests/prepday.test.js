// Day phase model and controls.
const fs=require('fs'), assert=require('assert');
const html=fs.readFileSync('index.html','utf8');
const script=html.match(/<script>([\s\S]*)<\/script>/)[1];
function grab(n){ const i=script.search(new RegExp(`(async )?function ${n}\\(`));
  assert.ok(i>-1,'missing '+n); let st=i;
  if(script.slice(Math.max(0,i-6),i)==='async ') st=i-6;
  let d=0,j=script.indexOf('{',i);
  for(;j<script.length;j++){ if(script[j]==='{')d++; else if(script[j]==='}'){d--; if(!d)break;} }
  return script.slice(st,j+1); }
const LBL=script.match(/const PHASE_LABEL = \{[^}]*\};/)[0];

function phaseOf(day){
  return new Function('PREP_DAY', `${grab('prepPhase')}; return prepPhase();`)(day);
}
let pass=0; const t=(d,fn)=>{ try{ fn(); console.log('  ok  '+d); pass++; }
  catch(e){ console.log('  FAIL '+d+'\n       '+e.message); process.exitCode=1; } };

console.log('\nphase derives from status + countingComplete');
t('the real not_started payload maps to not_started', ()=>{
  assert.strictEqual(phaseOf({date:'2026-09-17',status:'not_started',startedBy:null,
    activeMinutes:0,openSinceMinutes:null,countingComplete:false}),'not_started');
});
t('started but counting unfinished is the counting phase', ()=>{
  assert.strictEqual(phaseOf({status:'in_progress',countingComplete:false}),'counting');
});
t('counting complete unlocks the prepping phase', ()=>{
  assert.strictEqual(phaseOf({status:'in_progress',countingComplete:true}),'prepping');
});
t('finished wins over countingComplete', ()=>{
  assert.strictEqual(phaseOf({status:'finished',countingComplete:true}),'finished');
  assert.strictEqual(phaseOf({status:'finished',countingComplete:false}),'finished');
});
t('an unreachable status is treated as not_started, not a crash', ()=>{
  assert.strictEqual(phaseOf(null),'not_started');
});
t('an unknown status with counting done still reads as prepping', ()=>{
  assert.strictEqual(phaseOf({status:'open',countingComplete:true}),'prepping');
});
t('every phase has a label', ()=>{
  const labels=new Function(`${LBL}; return PHASE_LABEL;`)();
  for(const p of ['not_started','counting','prepping','finished'])
    assert.ok(labels[p],'missing label for '+p);
});

console.log('\nactor names');
t('start, finish and reopen each send their own actor field', ()=>{
  const fn=grab('prepDayAction');
  assert.ok(fn.includes('started_by'),'started_by missing');
  assert.ok(fn.includes('completed_by'),'completed_by missing');
  assert.ok(fn.includes('reopened_by'),'reopened_by missing');
});
t('an empty name aborts before any request', ()=>{
  const fn=grab('prepDayAction');
  const i=fn.indexOf('if(!who) return;'), j=fn.indexOf('fetch(');
  assert.ok(i>-1 && i<j,'must return before fetching');
});
t('a 409 is toasted as a phase message, not an error', ()=>{
  const fn=grab('prepDayAction');
  assert.ok(/409/.test(fn),'409 not handled distinctly');
});
t('every action re-reads the day afterwards', ()=>{
  const fn=grab('prepDayAction');
  assert.ok(fn.trimEnd().endsWith('await loadPrepSheet();\n}'),'must refresh after acting');
});

console.log('\nstore scoping on day calls');
t('a store login sends no store param', ()=>{
  const fn=grab('prepQS');
  assert.ok(fn.includes('if(!ASSIGNED_STORE_CODE)'),'admin-only guard missing');
});
t('the day status call is scoped through prepQS', ()=>{
  assert.ok(grab('fetchPrepDay').includes('prepQS()'));
  assert.ok(grab('prepDayAction').includes('prepQS()'));
});
// ── regressions from the first live run ───────────────────────────────────
console.log('\nregressions');
t('the store-code placeholder appears exactly once', ()=>{
  // The Worker replaces only the FIRST occurrence. A second literal meant the
  // constant was left holding the placeholder text.
  assert.strictEqual((html.match(/ASSIGNED_STORE_CODE_PLACEHOLDER/g)||[]).length, 1);
});
t('an unsubstituted placeholder resolves to empty, not to itself', ()=>{
  const src = script.match(/const ASSIGNED_STORE_CODE_RAW[\s\S]*?_PLACEHOLDER'\) > -1 \? '' : ASSIGNED_STORE_CODE_RAW;/)[0];
  const unsub = new Function(src + '; return ASSIGNED_STORE_CODE;')();
  assert.strictEqual(unsub, '', 'unsubstituted placeholder leaked into the UI');
  const sub = new Function(src.replace('ASSIGNED_STORE_CODE_PLACEHOLDER','csc-stcloud')
    + '; return ASSIGNED_STORE_CODE;')();
  assert.strictEqual(sub, 'csc-stcloud');
});
t('numbers from the API render without throwing', ()=>{
  // esc() is (s||'').replace(...) and dies on a number; the API sends real
  // numbers for parLevel, shelfLifeDays and onHandQty.
  const esc = s => (s||'').replace(/&/g,'&amp;');
  const fns = new Function('esc', grab('pnum') + grab('ptxt') + '; return {pnum, ptxt};')(esc);
  assert.strictEqual(fns.pnum(1), '1');
  assert.strictEqual(fns.pnum(0), '0', 'zero is a real count, not blank');
  assert.strictEqual(fns.pnum(null), '\u2014');
  assert.strictEqual(fns.pnum(undefined), '\u2014');
  assert.strictEqual(fns.ptxt(12), '12');
  assert.strictEqual(fns.ptxt(null), '');
});
t('no API value is passed to bare esc() in the sheet', ()=>{
  const fn = grab('renderPrepSheet');
  assert.ok(!/esc\(i\.(parLevel|shelfLifeDays|onHandQty|unit|name|recipeText)/.test(fn),
    'a raw API field still goes through esc()');
});
console.log(`\n${pass} passed${process.exitCode?' — WITH FAILURES':', 0 failed'}\n`);
