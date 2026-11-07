import test from 'node:test';
import assert from 'node:assert/strict';
import {config,quantity,normalizeBlock,lowerBound,sampleHeights,summarize,compare,highlights,buildDigest,DAY} from '../src/digest.mjs';
import {DigestStore} from '../src/worker.mjs';
test('weekly schedule defaults, configurable data window, and rate caps',()=>{
 assert.equal(config().days,7);assert.equal(config().samples,8);
 assert.equal(config({DIGEST_WINDOW_DAYS:'14',DIGEST_SAMPLE_BLOCKS:'9'}).days,14);
 assert.throws(()=>config({DIGEST_WINDOW_DAYS:'0'}));
 assert.equal(quantity('0xf4240'),1000000);assert.throws(()=>quantity('2'));
});
test('normalizes actual block format and handles absent transactions honestly',()=>{
 const b=normalizeBlock({number:'0x100',timestamp:'0x200',gasUsed:'0xf4240',transactions:['0xab','0xcd']});
 assert.equal(b.number,256);assert.equal(b.transactionCount,2);assert.equal(b.gasMillion,1);
 assert.throws(()=>normalizeBlock({number:'0x1',timestamp:'0x2',gasUsed:'0x0'}));
});
test('time boundary search uses real block timestamps',async()=>{
 const got=await lowerBound(async n=>({timestamp:n*30}),{number:1000},3001);
 assert.equal(got,101);
});
test('sampling does not claim an exhaustive weekly transaction total',()=>{
 const heights=sampleHeights(1,100,8);
 assert.equal(heights.length,8);assert.ok(heights[0]>1);
 const current=summarize([{number:1,transactionCount:2,gasUsed:1000000,gasMillion:1,timestamp:100,explorer:'a'},{
  number:2,transactionCount:10,gasUsed:3000000,gasMillion:3,timestamp:200,explorer:'b'},{
  number:3,transactionCount:6,gasUsed:2000000,gasMillion:2,timestamp:300,explorer:'c'}]);
 const previous=summarize([{number:0,transactionCount:3,gasUsed:1000000,gasMillion:1}]);
 assert.equal(current.avgTransactionsPerSample,6);
 assert.equal(compare(current,previous).avgTransactionsPerSample.pct,100);
 assert.equal(highlights(current.blocks).length,3);
 assert.equal(highlights(current.blocks)[0].block,2);
});
test('end-to-end sampled digest uses only official MCP block tools',async()=>{
 const latest=100000,stamp=n=>n*30,requested=[];
 const mock=async()=>({list:async()=>[{name:'get_block'},{name:'get_chain_info'}],
  tool:async(name,args)=>{
   requested.push(name);
   if(name==='get_chain_info')return {chainId:1672,chainIdMatches:true,latestBlock:String(latest)};
   if(name==='get_block'){const n=Number(args.block);return {
    number:'0x'+n.toString(16),timestamp:'0x'+stamp(n).toString(16),
    gasUsed:'0x'+(1000000+n%1000).toString(16),
    transactions:Array.from({length:n%12+1},(_,i)=>'0x'+i)};}
  },close:async()=>{}});
 const report=await buildDigest({},mock,1700000000000);
 assert.equal(report.source.tool,'get_block');assert.equal(report.current.sampledBlocks,8);
 assert.equal(report.top3Events.length,3);assert.ok(report.top3Events.every(x=>x.url.includes('/block/')));
 assert.equal(report.settings.windowDays,7);
 assert.match(report.limitations,/NOT all transactions/);
 assert.equal(requested.filter(x=>x==='get_transaction_receipt').length,0);
});
test('Durable Object persists public digest history',async()=>{
 const map=new Map(),storage={get:async k=>map.get(k),put:async(k,v)=>map.set(k,v),delete:async k=>map.delete(k)};
 const object=new DigestStore({storage},{});
 const begin=await (await object.fetch(new Request('https://store/begin',{method:'POST',body:JSON.stringify({manual:true})}))).json();
 assert.equal(begin.granted,true);
 const report={id:'pharos-5-100',publishedAtUtc:new Date().toISOString(),top3Events:[{},{},{}]};
 const published=await (await object.fetch(new Request('https://store/publish',{method:'POST',body:JSON.stringify(report)}))).json();
 assert.equal(published.stored,true);
 const saved=await (await object.fetch(new Request('https://store/read'))).json();
 assert.equal(saved.latest.id,report.id);assert.equal(saved.history.length,1);
 const again=await (await object.fetch(new Request('https://store/begin',{method:'POST',body:JSON.stringify({manual:true})}))).json();
 assert.equal(again.granted,false);
});
