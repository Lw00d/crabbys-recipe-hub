// Prep Hub proxy. The property that matters: the store scope comes from the
// LOGIN, never from the request, so a store login cannot reach another store.
import assert from 'assert';
const worker=(await import('../worker.js?v=2')).default;

// A FIXTURE, not the real user table. This used to read users_full.min.json —
// the live USERS_JSON, complete with real passwords — which meant the suite
// could only run on a machine that happened to have that file sitting in the
// working directory, and crashed on a clean checkout. Nothing here is a
// credential; what is under test is that the store code comes from the login
// and never from the request, and that holds whatever the passwords are.
// The nine codes must stay in step with PREP_STORE_CODES in worker.js.
const STORES=[
  ['stcloud',      'CBG',                    'csc-stcloud',     "Crabby's on the Lakefront — St. Cloud"],
  ['newsmyrna',    'CBG',                    'cbg-nsb',         "Crabby's Bar & Grill — New Smyrna Beach"],
  ['staugustine',  'CBG',                    'cbp-staugustine', "Crabby's Beachside — Saint Augustine"],
  ['beachwalk',    'CBG',                    'cbg-beachwalk',   "Crabby's Bar & Grill — Clearwater Beach"],
  ['dockside',     'CDS',                    'cds-dockside',    "Crabby's Dockside — Clearwater"],
  ['oceanside',    'CDS',                    'cds-oceanside',   "Crabby's Oceanside — Daytona Beach"],
  ['saltysisland', "Salty's Island",         'si-island',       "Salty's Island"],
  ['northbeach',   'Salty Crab North Beach', 'nb-crab',         'Salty Crab North Beach'],
  ['pavilion',     'Palm',                   'cbp-pavilion',    "Crabby's Beachside at the Pavilion"],
];
const USERS=JSON.stringify(Object.fromEntries([
  ...STORES.map(([u,book,code,store])=>[u,{password:'pw-'+u,location:book,code,store}]),
  ['admin',{password:'pw-admin',location:'all',store:'All Stores'}],
]));
const ENV={USERS_JSON:USERS,EDIT_PASSWORDS:'{"admin":"x"}',PREP_HUB_KEY:'SEKRIT'};
let seen=null;
globalThis.fetch=async(u,init)=>{ seen={url:String(u),init};
  return {ok:true,status:200,text:async()=>JSON.stringify({ok:true})}; };
const auth=u=>'Basic '+Buffer.from(u+':'+JSON.parse(USERS)[u].password).toString('base64');
const call=(path,user,opts={})=>worker.fetch(new Request('https://w.dev'+path,
  {method:opts.method||'GET',headers:user?{Authorization:auth(user)}:{},body:opts.body}),opts.env||ENV);
let pass=0; const t=async(d,fn)=>{ try{ await fn(); console.log('  ok  '+d); pass++; }
  catch(e){ console.log('  FAIL '+d+'\n       '+e.message); process.exitCode=1; } };

console.log('\nscoping');
await t('a store login is scoped to its own store', async()=>{
  await call('/prep/prep-items','beachwalk');
  assert.ok(seen.url.includes('/api/stores/cbg-beachwalk/prep-items'),seen.url);
  assert.strictEqual(seen.init.headers['X-BSHG-Store'],'cbg-beachwalk');
});
await t('a store login CANNOT override the store via query', async()=>{
  await call('/prep/prep-items?store=cds-dockside','beachwalk');
  assert.ok(seen.url.includes('/api/stores/cbg-beachwalk/'),seen.url);
  assert.ok(!seen.url.includes('cds-dockside'),'other store leaked into the url');
});
await t('admin must name a store', async()=>{
  const r=await call('/prep/prep-items','admin');
  assert.strictEqual(r.status,403);
});
await t('admin may name one of the nine', async()=>{
  const r=await call('/prep/prep-items?store=si-island','admin');
  assert.strictEqual(r.status,200);
  assert.ok(seen.url.includes('/api/stores/si-island/'));
});
await t('admin cannot name a deferred or unknown store', async()=>{
  for(const s of ['mv-dockside','bh-waterfront','../../evil','all']){
    const r=await call('/prep/prep-items?store='+encodeURIComponent(s),'admin');
    assert.strictEqual(r.status,403,s);
  }
});

console.log('\nauth');
await t('no credentials is 401', async()=>{
  const r=await call('/prep/prep-items',null);
  assert.strictEqual(r.status,401);
});
await t('a wrong password is 401', async()=>{
  const r=await worker.fetch(new Request('https://w.dev/prep/prep-items',
    {headers:{Authorization:'Basic '+Buffer.from('beachwalk:wrong').toString('base64')}}),ENV);
  assert.strictEqual(r.status,401);
});
await t('the service key is sent but never returned to the browser', async()=>{
  const r=await call('/prep/prep-items','beachwalk');
  assert.strictEqual(seen.init.headers['X-BSHG-Key'],'SEKRIT');
  assert.ok(!(await r.text()).includes('SEKRIT'));
});
await t('a missing key config fails closed', async()=>{
  const r=await call('/prep/prep-items','beachwalk',{env:{...ENV,PREP_HUB_KEY:undefined}});
  assert.strictEqual(r.status,503);
});
await t('every login is sent as manager', async()=>{
  await call('/prep/prep-items','northbeach');
  assert.strictEqual(seen.init.headers['X-BSHG-Role'],'manager');
});

console.log('\npath allowlist');
await t('the documented endpoints are allowed', async()=>{
  for(const p of ['prep-items','prep-days/2026-09-16/status','prep-days/2026-09-16/start',
                  'prep-days/2026-09-16/count','prep-days/2026-09-16/count/complete',
                  'yield-items','yield-items/abc-123/tests']){
    const r=await call('/prep/'+p,'beachwalk');
    assert.strictEqual(r.status,200,p);
  }
});
await t('anything else is 404, not proxied', async()=>{
  for(const p of ['','admin','prep-days/notadate/status','prep-items/extra',
                  'prep-days/2026-09-16/delete','yield-items/x/tests/y']){
    const r=await call('/prep/'+p,'beachwalk');
    assert.strictEqual(r.status,404,p||'(empty)');
  }
});
await t('traversal is normalised away before it reaches the proxy', async()=>{
  // new URL() collapses "..", so /prep/../../secrets becomes /secrets and never
  // enters the proxy branch at all. Assert nothing was forwarded.
  for(const p of ['/prep/../../secrets','/prep/prep-items/../../x']){
    seen = null;
    await call(p,'beachwalk').catch(()=>{});
    // The page route may fetch the origin; what must never happen is a call to
    // the Prep Hub or a service key being attached.
    const hitPrepHub = seen && String(seen.url).includes('bshg-prep-hub');
    assert.ok(!hitPrepHub, p+' reached the Prep Hub');
    assert.ok(!(seen && seen.init && seen.init.headers && seen.init.headers['X-BSHG-Key']),
      p+' leaked the service key');
  }
});

console.log('\npassthrough');
await t('a 409 phase gate reaches the page intact', async()=>{
  globalThis.fetch=async()=>({ok:false,status:409,
    text:async()=>JSON.stringify({error:'Start this day before entering counts.'})});
  const r=await call('/prep/prep-days/2026-09-16/count','beachwalk',{method:'PUT',body:'{}'});
  assert.strictEqual(r.status,409);
  assert.ok((await r.json()).error.includes('Start this day'));
  globalThis.fetch=async(u,init)=>{ seen={url:String(u),init};
    return {ok:true,status:200,text:async()=>JSON.stringify({ok:true})}; };
});
await t('a PUT body is forwarded unchanged', async()=>{
  await call('/prep/prep-days/2026-09-16/start','beachwalk',{method:'PUT',body:'{"started_by":"Tim"}'});
  assert.strictEqual(seen.init.body,'{"started_by":"Tim"}');
  assert.strictEqual(seen.init.method,'PUT');
});
await t('an unreachable Prep Hub is 502, not a crash', async()=>{
  globalThis.fetch=async()=>{ throw new Error('boom'); };
  const r=await call('/prep/prep-items','beachwalk');
  assert.strictEqual(r.status,502);
});
console.log(`\n${pass} passed${process.exitCode?' — WITH FAILURES':', 0 failed'}\n`);
