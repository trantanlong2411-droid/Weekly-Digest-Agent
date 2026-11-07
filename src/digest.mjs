import {connect,MCP_URL} from './mcp.mjs';
export const EXPLORER='https://pharosscan.xyz/block/';
export const DAY=86400;
export function config(env={}){
 const days=Number(env.DIGEST_WINDOW_DAYS??7),samples=Number(env.DIGEST_SAMPLE_BLOCKS??6);
 if(!Number.isInteger(days)||days<1||days>28||!Number.isInteger(samples)||samples<3||samples>12)
  throw Error('Digest configuration must be 1-28 days and 3-12 samples per period');
 return {days,samples,cron:'0 0 * * 1',network:'Pharos Mainnet',chainId:1672};
}
export function quantity(v){
 if(typeof v!=='string'||!/^0x[0-9a-f]+$/i.test(v))throw Error('Invalid blockchain hex quantity');
 const n=BigInt(v);if(n>BigInt(Number.MAX_SAFE_INTEGER))throw Error('Blockchain quantity too large');
 return Number(n);
}
export function normalizeBlock(block){
 if(!block||typeof block!=='object')throw Error('Missing Pharos block');
 const number=quantity(block.number),timestamp=quantity(block.timestamp);
 const count=Array.isArray(block.transactions)?block.transactions.length:NaN;
 const gasUsed=quantity(block.gasUsed);
 if(!Number.isFinite(count))throw Error('Block has no transaction list');
 return {number,timestamp,transactionCount:count,gasUsed,gasMillion:Number((gasUsed/1e6).toFixed(3)),
  explorer:EXPLORER+number};
}
export async function lowerBound(fetchBlock,latest,targetTime){
 // Get the earliest block with timestamp >= targetTime; only reads actual block timestamps.
 let low=1,high=latest.number;
 while(low<high){
  const middle=Math.floor((low+high)/2);
  const b=await fetchBlock(middle);
  if(b.timestamp<targetTime)low=middle+1;else high=middle;
 }
 return low;
}
export async function locateTime(fetchBlock,latest,targetTime,secondsPerBlock,maxAttempts=5){
 if(!(secondsPerBlock>0))throw Error('Unable to estimate recent block time');
 let guess=Math.max(1,Math.min(latest.number,Math.round(latest.number+(targetTime-latest.timestamp)/secondsPerBlock)));
 let last=null;
 for(let i=0;i<maxAttempts;i++){
  const block=await fetchBlock(guess);
  last=block;
  const delta=targetTime-block.timestamp;
  if(Math.abs(delta)<=180)return block.number;
  const shift=Math.round(delta/secondsPerBlock);
  if(shift===0)break;
  const next=Math.max(1,Math.min(latest.number,guess+shift));
  if(next===guess)break;
  guess=next;
 }
 if(last&&Math.abs(last.timestamp-targetTime)<=600)return last.number;
 throw Error('Could not find a block sufficiently close to the requested period boundary');
}
export function sampleHeights(start,end,count){
 if(end<start)throw Error('Invalid sample block boundaries');
 if(end===start)return [start];
 const arr=[];
 for(let i=0;i<count;i++){
  const n=Math.round(start+(end-start)*(i+0.5)/count);
  arr.push(n);
 }
 return [...new Set(arr)];
}
export function summarize(blocks){
 if(!blocks.length)throw Error('No real sampled blocks');
 const sorted=[...blocks].sort((a,b)=>b.transactionCount-a.transactionCount||b.gasUsed-a.gasUsed);
 const sum=blocks.reduce((acc,b)=>({tx:acc.tx+b.transactionCount,gas:acc.gas+b.gasUsed}),{tx:0,gas:0});
 return {sampledBlocks:blocks.length,sampledTransactions:sum.tx,
  avgTransactionsPerSample:Number((sum.tx/blocks.length).toFixed(2)),
  avgGasMillionPerSample:Number((sum.gas/blocks.length/1e6).toFixed(3)),
  busiestBlock:sorted[0].number,highestObservedTransactions:sorted[0].transactionCount,
  blocks};
}
export function compare(current,previous){
 const data={};
 for(const k of ['avgTransactionsPerSample','avgGasMillionPerSample','highestObservedTransactions']){
  const a=current[k],b=previous[k],diff=a-b;
  data[k]={current:a,previous:b,delta:Number(diff.toFixed(3)),
   pct:b===0?null:Number((diff/b*100).toFixed(2)),
   direction:diff>0?'up':diff<0?'down':'flat'};
 }
 return data;
}
export function highlights(blocks){
 return [...blocks].sort((a,b)=>b.transactionCount-a.transactionCount||b.gasUsed-a.gasUsed)
  .slice(0,3).map((block,index)=>({rank:index+1,title:(block.transactionCount>0?'Active':'Quiet')+' sampled block #'+block.number,
    detail:'Observed '+block.transactionCount+' transactions, '+block.gasMillion+' million gas used in this sampled block.',
    block: block.number,transactions:block.transactionCount,gasUsed:block.gasUsed,
    timestamp:new Date(block.timestamp*1000).toISOString(),url:block.explorer,
    evidence:'Direct Pharos Chain MCP get_block; top among sampled blocks only'}));
}
export async function buildDigest(env={},connectFn=connect,now=Date.now()){
 const settings=config(env),client=await connectFn(),cache=new Map();
 try{
  const tools=await client.list();
  if(!tools.some(t=>t.name==='get_block')||!tools.some(t=>t.name==='get_chain_info'))
   throw Error('Official Pharos Chain MCP missing block tools');
  const chain=await client.tool('get_chain_info');
  if(Number(chain.chainId)!==1672||chain.chainIdMatches===false)throw Error('Chain ID is not Pharos Mainnet 1672');
  const latestNumber=Number(chain.latestBlock);
  if(!Number.isSafeInteger(latestNumber)||latestNumber<100)throw Error('Invalid latest Pharos block');
  async function blockAt(num){
   const n=Number(num);if(cache.has(n))return cache.get(n);
   const result=normalizeBlock(await client.tool('get_block',{block:String(n),includeTransactions:false}));
   if(result.number!==n)throw Error('Chain MCP returned unexpected block '+result.number);
   cache.set(n,result);return result;
  }
  const tip=await blockAt(latestNumber);
  const t0=tip.timestamp,from=t0-settings.days*DAY,previousFrom=t0-settings.days*2*DAY;
  // A full binary search takes ~50 external requests and exceeds the
  // Cloudflare Workers Free cap. Estimate local block time from one
  // historical anchor, then make at most 5 corrective calls per boundary.
  const anchor=await blockAt(Math.max(1,latestNumber-1000000));
  const secondsPerBlock=(tip.timestamp-anchor.timestamp)/(tip.number-anchor.number);
  const currentStart=await locateTime(blockAt,tip,from,secondsPerBlock);
  const previousStart=await locateTime(blockAt,tip,previousFrom,secondsPerBlock);
  if(previousStart>=currentStart || currentStart>=latestNumber)throw Error('Periods do not have enough historical blocks');
  const nowBlocks=[];
  for(const id of sampleHeights(currentStart,latestNumber,settings.samples))nowBlocks.push(await blockAt(id));
  const priorBlocks=[];
  for(const id of sampleHeights(previousStart,currentStart-1,settings.samples))priorBlocks.push(await blockAt(id));
  const current=summarize(nowBlocks),previous=summarize(priorBlocks);
  // Comparison samples are fixed. To find meaningful events without
  // exceeding Cloudflare's 50 outbound-subrequest Free limit, query
  // event logs in four small, evenly distributed windows (<=1000 blocks).
  // Then confirm the candidate blocks through get_block.
  const candidates=[...nowBlocks],seen=new Set(nowBlocks.map(x=>x.number));
  let logWindowsChecked=0;
  if(tools.some(t=>t.name==='get_logs')){
   const buckets=new Map();
   const windows=nowBlocks.filter((_,i)=>i%2===0).slice(0,3).concat(nowBlocks.slice(-1));
   for(const b of windows){
    const fromBlock=Math.max(currentStart,b.number-400);
    const toBlock=Math.min(latestNumber,fromBlock+799);
    try{
     const logs=await client.tool('get_logs',{
      fromBlock:'0x'+fromBlock.toString(16),toBlock:'0x'+toBlock.toString(16)});
     logWindowsChecked++;
     if(!Array.isArray(logs))continue;
     for(const log of logs){
      if(typeof log?.blockNumber!=='string')continue;
      const n=quantity(log.blockNumber);
      if(n<currentStart||n>latestNumber)continue;
      buckets.set(n,(buckets.get(n)||0)+1);
     }
    }catch{
     // Some RPC providers reject broad log filters; no invented events.
    }
   }
   for(const [n] of [...buckets].sort((a,b)=>b[1]-a[1]).slice(0,10)){
    if(candidates.filter(x=>x.transactionCount>0).length>=3)break;
    if(seen.has(n))continue;seen.add(n);
    const b=await blockAt(n);
    if(b.transactionCount>0)candidates.push(b);
   }
  }
  // Fallback: inspect at most ten additional blocks if the log index
  // cannot produce three distinct active block observations.
  const anchors=nowBlocks.map(x=>x.number);
  for(let i=0;i<10 && candidates.filter(x=>x.transactionCount>0).length<3;i++){
   const n=Math.min(latestNumber,anchors[i%anchors.length]+1+Math.floor(i/anchors.length)*37);
   if(seen.has(n))continue;seen.add(n);
   const b=await blockAt(n);
   if(b.transactionCount>0)candidates.push(b);
  }
  const events=highlights(candidates);
  const created=new Date(now).toISOString();
  const report={id:'pharos-'+Math.floor(t0/(settings.days*DAY))+'-'+latestNumber,
   publishedAtUtc:created,asOfBlock:tip.number,asOfBlockTimeUtc:new Date(t0*1000).toISOString(),
   title:'Pharos Weekly Digest',chainId:1672,network:settings.network,
   source:{name:'Official Pharos Chain MCP',endpoint:MCP_URL,tool:'get_block',url:'https://github.com/PharosNetwork/pharos-mcp'},
   settings:{windowDays:settings.days,sampleBlocksPerPeriod:settings.samples,cronUtc:settings.cron,eventDiscoveryVersion:3,eventCandidatesScanned:candidates.length,logWindowsChecked},
   periods:{current:{startUtc:new Date(from*1000).toISOString(),endUtc:new Date(t0*1000).toISOString(),
     fromBlock:currentStart,toBlock:tip.number},
    previous:{startUtc:new Date(previousFrom*1000).toISOString(),endUtc:new Date(from*1000).toISOString(),
     fromBlock:previousStart,toBlock:currentStart-1}},
   current,previous,comparison:compare(current,previous),top3Events:events,
   insight:current.avgTransactionsPerSample>previous.avgTransactionsPerSample?
     'The sampled blocks had more transactions on average than the previous period.':
     current.avgTransactionsPerSample<previous.avgTransactionsPerSample?
     'The sampled blocks had fewer transactions on average than the previous period.':
     'The average transaction count per sampled block was unchanged.',
   limitations:'Sampling only: the figures are based on individual blocks spread across each period, NOT all transactions or total network throughput. Top events are the busiest blocks among a small, separately verified set of event-log candidates and block samples, not the three biggest events on the full chain. A quiet block is explicitly labeled if fewer than three active blocks were found. No wallet-level activity is analyzed.'};
  if(events.length!==3)throw Error('Could not select three verified sampled event blocks');
  return report;
 }finally{await client.close();}
}
