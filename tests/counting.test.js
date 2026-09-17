// Counting and prep logging against the real Prep Hub routes.
const fs=require('fs'), assert=require('assert');
const html=fs.readFileSync('index.html','utf8');
const script=html.match(/<script>([\s\S]*)<\/script>/)[1];
function grab(n){ const i=script.search(new RegExp(`(async )?function ${n}\\(`));
  assert.ok(i>-1,'missing '+n); let st=i;
  if(script.slice(Math.max(0,i-6),i)==='async ') st=i-6;
  let d=0,j=script.indexOf('{',i);
  for(;j<script.length;j++){ if(script[j]==='{')d++; else if(script[j]==='}'){d--; if(!d)break;} }
  return script.slice(st,j+1); }

function sandbox({status=200,error=null}={}){
  const sent=[],toasts=[];
  const api=new Function('sent','toasts','opts',`
    let PREP_ITEMS=[{id:'a',date:'2026-09-17',onHandQty:null,preppedQty:null,parMode:null},
                    {id:'b',date:'2026-09-17',onHandQty:2,preppedQty:null,parMode:'daily'}];
    let PREP_ACTOR='Tim';
    const ASSIGNED_STORE_CODE='csc-stcloud';
    let sheetStore='csc-stcloud';
    function toast(m,t){ toasts.push({m,t}); }
    async function loadPrepSheet(){}
    const document={getElementById:()=>null};
    async function fetch(u,o){ sent.push({url:String(u),body:JSON.parse(o.body),method:o.method});
      return {ok:opts.status<400,status:opts.status,json:async()=>({error:opts.error})}; }
    ${grab('prepQS')} ${grab('prepDate')} ${grab('prepActor')} ${grab('itemMode')}
    ${grab('updateCountProgress')} ${grab('savePrepCount')} ${grab('savePrepMode')} ${grab('completeCounting')}
    return {savePrepCount,savePrepMode,completeCounting,items:()=>PREP_ITEMS};
  `)(sent,toasts,{status,error});
  return {api,sent,toasts};
}
const el=()=>({value:'',classList:{add(){},remove(){}}});
let pass=0; const t=async(d,fn)=>{ try{ await fn(); console.log('  ok  '+d); pass++; }
  catch(e){ console.log('  FAIL '+d+'\n       '+e.message); process.exitCode=1; } };
(async()=>{
console.log('\non-hand count');
await t('PUTs to /prep-items/{id}/count', async()=>{
  const s=sandbox(); await s.api.savePrepCount('a','on_hand_qty','5',el());
  assert.ok(s.sent[0].url.endsWith('/prep/prep-items/a/count'), s.sent[0].url);
  assert.strictEqual(s.sent[0].method,'PUT');
});
await t('body carries date, on_hand_qty, usage_qty, counted_by and par_mode', async()=>{
  const s=sandbox(); await s.api.savePrepCount('a','on_hand_qty','5',el());
  assert.deepStrictEqual(Object.keys(s.sent[0].body).sort(),
    ['counted_by','date','on_hand_qty','par_mode','usage_qty']);
  assert.strictEqual(s.sent[0].body.date,'2026-09-17');
  assert.strictEqual(s.sent[0].body.on_hand_qty,5);
});
await t('the id is never a body field', async()=>{
  const s=sandbox(); await s.api.savePrepCount('a','on_hand_qty','5',el());
  assert.ok(!('prep_item_id' in s.sent[0].body));
  assert.ok(!('itemId' in s.sent[0].body));
});
await t('zero is a real count, blank is null', async()=>{
  let s=sandbox(); await s.api.savePrepCount('a','on_hand_qty','0',el());
  assert.strictEqual(s.sent[0].body.on_hand_qty,0);
  s=sandbox(); await s.api.savePrepCount('a','on_hand_qty','',el());
  assert.strictEqual(s.sent[0].body.on_hand_qty,null);
});
console.log('\nprepped amount');
await t('PUTs to /prep-items/{id}/count/complete', async()=>{
  const s=sandbox(); await s.api.savePrepCount('a','prepped_qty','3',el());
  assert.ok(s.sent[0].url.endsWith('/prep/prep-items/a/count/complete'), s.sent[0].url);
});
await t('body carries date, prepped_qty and completed_by', async()=>{
  const s=sandbox(); await s.api.savePrepCount('a','prepped_qty','3',el());
  assert.deepStrictEqual(Object.keys(s.sent[0].body).sort(),['completed_by','date','prepped_qty']);
});
console.log('\npar basis');
await t('changing the basis alone does not post and blank the count', async()=>{
  const s=sandbox(); await s.api.savePrepMode('a','daily',el());
  assert.strictEqual(s.sent.length,0,'posted with no count');
  assert.strictEqual(s.api.items()[0].parMode,'daily','not remembered');
});
await t('the remembered basis rides along on the next count', async()=>{
  const s=sandbox(); await s.api.savePrepMode('a','shelf_life',el());
  await s.api.savePrepCount('a','on_hand_qty','4',el());
  assert.strictEqual(s.sent[0].body.par_mode,'shelf_life');
});
await t('changing the basis on an already-counted item re-sends the count', async()=>{
  const s=sandbox(); await s.api.savePrepMode('b','no_prep',el());
  assert.strictEqual(s.sent.length,1);
  assert.strictEqual(s.sent[0].body.par_mode,'no_prep');
  assert.strictEqual(s.sent[0].body.on_hand_qty,2,'must preserve the existing count');
});
console.log('\nphase completion');
await t('there is no phase-completion endpoint call', ()=>{
  const fn=grab('completeCounting');
  assert.ok(!fn.includes('fetch('),'still posting to a route that does not exist');
});
console.log('\nerrors');
await t('a failed save leaves local state untouched', async()=>{
  const s=sandbox({status:409,error:'Start this day before entering counts.'});
  await s.api.savePrepCount('a','on_hand_qty','7',el());
  assert.strictEqual(s.api.items()[0].onHandQty,null);
});
await t('409 is a phase message, 403 is an error', async()=>{
  let s=sandbox({status:409,error:'x'}); await s.api.savePrepCount('a','on_hand_qty','1',el());
  assert.notStrictEqual(s.toasts[0].t,'err');
  s=sandbox({status:403,error:'y'}); await s.api.savePrepCount('a','on_hand_qty','1',el());
  assert.strictEqual(s.toasts[0].t,'err');
});
await t('ids with awkward characters are encoded', async()=>{
  const s=sandbox(); await s.api.savePrepCount('x/y','on_hand_qty','1',el());
  assert.ok(s.sent[0].url.includes('x%2Fy'), s.sent[0].url);
});
console.log(`\n${pass} passed${process.exitCode?' — WITH FAILURES':', 0 failed'}\n`);
})();
