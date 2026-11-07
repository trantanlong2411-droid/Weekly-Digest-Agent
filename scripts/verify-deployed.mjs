import assert from 'node:assert/strict';
const base=(process.env.WORKER_URL||'https://weekly-digest-agent.trantanlong2411.workers.dev').replace(/\/$/,'');
const version='weekly-digest-pharos-2026-11-07-v1';
async function call(path,method='GET'){
 const r=await fetch(base+path,{method,signal:AbortSignal.timeout(180000),cache:'no-store',
  redirect:'manual'});const raw=await r.text();
 let data;try{data=JSON.parse(raw);}catch{data={error:raw.slice(0,200)};}
 return {status:r.status,data};
}
let health;
for(let i=0;i<22;i++){
 try{health=await call('/api/health');if(health.status===200&&health.data.version===version)break;
  console.log('WAIT_FOR_WORKER_DEPLOY',i,health.status,health.data.version||health.data.error||'unknown');
 }catch(e){console.log('WAIT_FOR_WORKER_DEPLOY',i,String(e.message||e));}
 await new Promise(done=>setTimeout(done,5000));
}
assert.equal(health?.status,200,'Worker not deployed');
assert.equal(health.data.version,version,'Worker version does not match latest repository');
assert.equal(health.data.config.days,7);
assert.match(health.data.schedule,/Monday/);
let latest=await call('/api/latest');
assert.equal(latest.status,200);
if(!latest.data.report){
 console.log('FIRST_PUBLISH: creating initial report via live Chain MCP');
 const generate=await call('/api/generate','POST');
 if(generate.status===409 && generate.data.reason?.includes('already being generated')){
  console.log('ANOTHER_BUILD_IS_GENERATING: checking persistent report until it is available');
  for(let attempt=0;attempt<36;attempt++){
   await new Promise(done=>setTimeout(done,5000));
   latest=await call('/api/latest');
   if(latest.data.report)break;
  }
 }else{
  assert.equal(generate.status,200,'Initial generation failed: '+JSON.stringify(generate.data).slice(0,400));
  assert.equal(generate.data.ok,true);
  latest=await call('/api/latest');
 }
 assert.ok(latest.data.report,'No published report appeared after waiting for the active digest build');
}
assert.equal(latest.status,200);const digest=latest.data.report;
assert.ok(digest?.id);assert.equal(digest.chainId,1672);
assert.equal(digest.current.sampledBlocks,8);assert.equal(digest.previous.sampledBlocks,8);
assert.equal(digest.top3Events.length,3);
assert.ok(digest.top3Events.every(e=>e.url.includes('/block/')&&Number.isInteger(e.transactions)));
assert.match(digest.limitations,/NOT all transactions/);
const stored=await call('/api/reports/'+digest.id);
assert.equal(stored.status,200);assert.equal(stored.data.report.id,digest.id);
const history=await call('/api/history');assert.equal(history.status,200);
assert.ok(history.data.history.some(x=>x.id===digest.id));
const publicPage=await fetch(base+'/reports/'+digest.id,{signal:AbortSignal.timeout(15000)});
assert.equal(publicPage.status,200);assert.match(await publicPage.text(),/Weekly Digest Agent/);
console.log('WEEKLY_DIGEST_DEPLOYED_PUBLIC_PROOF',JSON.stringify({
 publishedUrl:base+'/reports/'+digest.id,asOfBlock:digest.asOfBlock,
 currentAvg:digest.current.avgTransactionsPerSample,previousAvg:digest.previous.avgTransactionsPerSample,
 events:digest.top3Events.map(x=>({block:x.block,transactions:x.transactions})),
 scheduleConfigured:health.data.schedule,persistentHistory:true}));
