import {buildDigest,config} from './digest.mjs';
import {PAGE} from './page.mjs';
const json=(data,status=200)=>Response.json(data,{status,headers:{'cache-control':'no-store','x-content-type-options':'nosniff'}});
export const VERSION='weekly-digest-pharos-2026-11-07-v1';
export class DigestStore {
 constructor(ctx,env){this.ctx=ctx;this.env=env;}
 async fetch(request){
  const path=new URL(request.url).pathname,storage=this.ctx.storage;
  if(path==='/read')return json({latest:await storage.get('latest')||null,history:await storage.get('history')||[]});
  if(path==='/begin'){
   const {manual}=await request.json(),now=Date.now();
   const lock=await storage.get('lock'),current=await storage.get('latest');
   if(lock && now-lock.at<240000)return json({granted:false,reason:'A digest is already being generated'});
   if(manual && current && current.settings?.eventDiscoveryVersion>=2 && now-Date.parse(current.publishedAtUtc)<21600000)
    return json({granted:false,reason:'Published digest is less than 6 hours old',latest:current.id});
   await storage.put('lock',{at:now});
   return json({granted:true});
  }
  if(path==='/publish'){
   const report=await request.json();
   if(!report?.id||!report.top3Events||report.top3Events.length!==3)return json({error:'Invalid digest'},400);
   const history=await storage.get('history')||[];
   const dedup=[report,...history.filter(x=>x.id!==report.id)].slice(0,12);
   await storage.put('history',dedup);
   await storage.put('latest',report);
   await storage.delete('lock');
   return json({stored:true,id:report.id});
  }
  if(path==='/release'){
   await storage.delete('lock');
   return json({released:true});
  }
  return json({error:'Store route not found'},404);
 }
}
function state(env){
 if(!env?.DIGESTS)throw Error('DIGESTS Durable Object binding is not configured');
 const id=env.DIGESTS.idFromName('pharos-chain-weekly');
 return env.DIGESTS.get(id);
}
async function readStore(stub){return (await stub.fetch('https://store/read')).json();}
export async function publishDigest(env,manual=false,create=buildDigest){
 const stub=state(env);
 const granted=await (await stub.fetch('https://store/begin',{method:'POST',headers:{'content-type':'application/json'},
  body:JSON.stringify({manual})})).json();
 if(!granted.granted)return {ok:false,skipped:true,reason:granted.reason,latestId:granted.latest||null};
 try{
  const report=await create(env);
  const answer=await stub.fetch('https://store/publish',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(report)});
  if(!answer.ok)throw Error('Durable Object declined to persist digest');
  return {ok:true,report};
 }catch(err){
  await stub.fetch('https://store/release',{method:'POST'}).catch(()=>{});
  throw err;
 }
}
const recent=new Map();
function limited(req){
 const ip=(req.headers.get('cf-connecting-ip')||'unknown').slice(0,90);
 const time=Date.now(),entry=recent.get(ip);
 if(!entry || time-entry.at>60000){recent.set(ip,{at:time,count:1});return false;}
 entry.count++;return entry.count>4;
}
export default {
 async fetch(req,env,ctx){
  const url=new URL(req.url),path=url.pathname;
  if(req.method==='GET' && (path==='/'||/^\/reports\/pharos-[0-9-]+$/.test(path)))
   return new Response(PAGE,{headers:{'content-type':'text/html;charset=utf-8','cache-control':'no-store',
    'x-content-type-options':'nosniff',
    'content-security-policy':"default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"}});
  if(req.method==='GET'&&path==='/api/health')return json({ok:true,version:VERSION,
   schedule:'0 0 * * 1 (Monday 00:00 UTC)',timezone:'UTC',config:config(env),
   persistence:'Cloudflare SQLite-backed Durable Object',distribution:'Public published reports page',
   analysisScope:'Pharos protocol network sampled blocks',readOnly:true});
  if(req.method==='GET'&&['/api/latest','/api/history'].includes(path)){
   try{
    const saved=await readStore(state(env));
    return path==='/api/latest'?json({ok:true,report:saved.latest}):json({ok:true,history:saved.history.map(({id,publishedAtUtc,asOfBlock,insight})=>({id,publishedAtUtc,asOfBlock,insight}))});
   }catch(e){return json({ok:false,error:String(e.message||e).slice(0,160)},503);}
  }
  if(req.method==='GET'&&path.startsWith('/api/reports/')){
   const id=decodeURIComponent(path.slice('/api/reports/'.length));
   if(!/^pharos-[0-9-]+$/.test(id))return json({ok:false,error:'Invalid report ID'},400);
   try{
    const saved=await readStore(state(env));
    const report=saved.history.find(x=>x.id===id);
    return report?json({ok:true,report}):json({ok:false,error:'Digest not found'},404);
   }catch(e){return json({ok:false,error:String(e.message||e).slice(0,160)},503);}
  }
  if(req.method==='POST'&&path==='/api/generate'){
   if(limited(req))return json({ok:false,error:'Rate limit: try again in 60 seconds'},429);
   try{
    const result=await publishDigest(env,true);
    return result.ok?json({ok:true,published:result.report.id,report:result.report}):
     json({ok:false,skipped:true,reason:result.reason,latestId:result.latestId},409);
   }catch(e){return json({ok:false,error:'Live digest generation failed: '+String(e.message||e).slice(0,240),
    note:'No synthetic report was published. Check Pharos Chain MCP and retry.'},503);}
  }
  return json({ok:false,error:'Not found'},404);
 },
 async scheduled(event,env,ctx){
  const outcome=await publishDigest(env,false);
  if(outcome.ok)console.log('WEEKLY_DIGEST_CRON_PUBLISHED',JSON.stringify({id:outcome.report.id,
   events:outcome.report.top3Events.length,observedAt:outcome.report.asOfBlockTimeUtc}));
  else console.log('WEEKLY_DIGEST_CRON_SKIPPED',JSON.stringify(outcome));
 }
};
