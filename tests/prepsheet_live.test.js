// Prep Sheet reading live from the Prep Hub through our proxy.
const fs=require('fs'), assert=require('assert'); const {JSDOM}=require('jsdom');
const html=fs.readFileSync('index.html','utf8');
const script=html.match(/<script>([\s\S]*)<\/script>/)[1];
function grab(n){ const i=script.search(new RegExp(`(async )?function ${n}\\(`));
  assert.ok(i>-1,'missing '+n); let st=i;
  if(script.slice(Math.max(0,i-6),i)==='async ') st=i-6;
  let d=0,j=script.indexOf('{',i);
  for(;j<script.length;j++){ if(script[j]==='{')d++; else if(script[j]==='}'){d--; if(!d)break;} }
  return script.slice(st,j+1); }
const CONST=script.match(/const SHEET_STORES = \[[\s\S]*?\];/)[0];
const PHASE=script.match(/const PHASE_LABEL = \{[^}]*\};/)[0];
// a trimmed slice of the real API response
const LIVE=[
 {id:'csc-stcloud-recipe-avocado-mix-prep-23846252',station:'Veggie',name:'Avocado Mix',unit:'LB',
  parLevel:1,recipeYieldNote:'3 avocados per  batch',recipeText:null,shelfLifeDays:2,
  needsPullThaw:false,pullThawNote:null,parMode:null,date:'2026-09-17',onHandQty:null},
 {id:'csc-stcloud-thaw-beef-ny-strip-prep-10036854',station:'Thaw',name:'Beef NY Strip',unit:'Each',
  parLevel:3,recipeYieldNote:'Case is 14 steaks',recipeText:null,shelfLifeDays:3,
  needsPullThaw:true,pullThawNote:null,parMode:null,date:'2026-09-17',onHandQty:4},
 {id:'csc-stcloud-recipe-flounder-stuffing-prep-600140796',station:'None',name:'Flounder Stuffing',
  unit:'LB',parLevel:1,recipeYieldNote:null,recipeText:'Store in covered cambro',shelfLifeDays:3,
  needsPullThaw:false,pullThawNote:null,parMode:null,date:'2026-09-17',onHandQty:null},
];
const LINKS={'csc-stcloud-recipe-avocado-mix-prep-23846252':'dp-cbg-48',
             'csc-stcloud-recipe-flounder-stuffing-prep-600140796':'dp-cbg-44'};
function env(code,{fail=null}={}){
  const dom=new JSDOM(`<div id="sheetBackdrop"></div><div id="sheetHeader"></div><div id="sheetTitle"></div>
    <div id="sheetMeta"></div><div id="sheetBody"></div><div id="sheetFooter"></div>`,{runScripts:'outside-only'});
  const w=dom.window; const calls=[];
  w.fetch=async(u,o)=>{ calls.push(String(u));
    if(String(u).includes('prep-links')) return {ok:true,json:async()=>({links:LINKS})};
    if(String(u).includes('/status')) return {ok:true,json:async()=>({date:'2026-09-17',
      status:'in_progress',startedBy:'Tim',activeMinutes:12,countingComplete:false})};
    if(fail) return {ok:false,status:fail.status,json:async()=>({error:fail.error})};
    return {ok:true,json:async()=>LIVE}; };
  w.document.body.style={};
  return {w,doc:w.document,calls,run:async()=>{ await w.eval(`(async()=>{
    ${CONST}
    const ASSIGNED_STORE_CODE=${JSON.stringify(code||'')};
    let PREP_LINKS=null, PREP_ITEMS=null, PREP_DAY=null, sheetStore=null;
    ${PHASE}
    function toast(){}
    const PREP_LINKS_URL='https://api.github.com/x/prep-links.json';
    function esc(s){return (s==null?'':String(s)).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');}
    function openPrepLayer(){}
    ${grab('updateCountProgress')}
    ${grab('pnum')}
    ${grab('ptxt')}
    ${grab('prepQS')}
    ${grab('fetchPrepDay')}
    ${grab('prepPhase')}
    ${grab('loadPrepSheet')}
    ${grab('renderPrepSheet')}
    sheetStore = ASSIGNED_STORE_CODE || SHEET_STORES[0][0];
    await loadPrepSheet();
  })()`); }};
}
let pass=0; const t=async(d,fn)=>{ try{ await fn(); console.log('  ok  '+d); pass++; }
  catch(e){ console.log('  FAIL '+d+'\n       '+e.message); process.exitCode=1; } };
(async()=>{
console.log('\nreads live, not a snapshot');
await t('calls the proxy, not a static file', async()=>{
  const e=env('csc-stcloud'); await e.run();
  assert.ok(e.calls.some(c=>c.includes('/prep/prep-items')),e.calls.join());
  assert.ok(!e.calls.some(c=>c.includes('data/prep.json')),'still reading the old snapshot');
});
await t('a store login sends no store param \u2014 the Worker pins it', async()=>{
  const e=env('cbg-nsb'); await e.run();
  const c=e.calls.find(x=>x.includes('/prep/prep-items'));
  assert.ok(!c.includes('?store='),c);
});
await t('admin sends the chosen store', async()=>{
  const e=env(''); await e.run();
  const c=e.calls.find(x=>x.includes('/prep/prep-items'));
  assert.ok(c.includes('store=csc-stcloud'),c);
});
console.log('\nrendering the live shape');
await t('items group by station, "None" becomes Unassigned', async()=>{
  const e=env('csc-stcloud'); await e.run();
  const h=[...e.doc.querySelectorAll('.sheet-station')].map(x=>x.textContent);
  assert.deepStrictEqual(h,['Veggie','Thaw','Unassigned']);
});
await t('par and on-hand both render, nulls as dashes', async()=>{
  const e=env('csc-stcloud'); await e.run();
  const txt=e.doc.getElementById('sheetBody').textContent;
  assert.ok(!txt.includes('null'),'null leaked');
  assert.ok(!txt.includes('undefined'),'undefined leaked');
});
await t('today\u2019s date and counted tally appear', async()=>{
  const e=env('csc-stcloud'); await e.run();
  const m=e.doc.getElementById('sheetMeta').textContent;
  assert.ok(m.includes('2026-09-17'),m);
  assert.ok(m.includes('1 counted'),m);
});
await t('pull/thaw badge shows only where flagged', async()=>{
  const e=env('csc-stcloud'); await e.run();
  assert.strictEqual(e.doc.querySelectorAll('.sheet-thaw').length,1);
});
await t('linked items are tappable, unlinked are not', async()=>{
  const e=env('csc-stcloud'); await e.run();
  assert.strictEqual(e.doc.querySelectorAll('.sheet-table .ing-link').length,2);
});
console.log('\nfailure handling');
await t('an API error is shown, not a blank sheet', async()=>{
  const e=env('csc-stcloud',{fail:{status:403,error:'Unknown or inactive store'}}); await e.run();
  const txt=e.doc.getElementById('sheetBody').textContent;
  assert.ok(txt.includes('could not be loaded'),txt);
  assert.ok(txt.includes('Unknown or inactive store'),txt);
});
console.log('\nthe stale snapshot is gone');
await t('no reference to data/prep.json remains', ()=>{
  assert.ok(!html.includes('data/prep.json'),'old snapshot still referenced');
});
await t('the sheet no longer claims an import date', ()=>{
  assert.ok(!html.includes('Imported from the Prep Hub on'),'stale wording left');
  assert.ok(html.includes('Live from the Prep Hub'));
});
console.log(`\n${pass} passed${process.exitCode?' — WITH FAILURES':', 0 failed'}\n`);
})();
