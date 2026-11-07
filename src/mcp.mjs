// Official hosted Pharos Chain MCP. All calls are read-only.
export const MCP_URL='https://mcp.pharos.xyz/mcp';
export const VERSION='2025-03-26';
function parseSse(raw,id){
 const records=raw.replace(/\r\n/g,'\n').split(/\n\n+/);
 for(const record of records){
  const json=record.split('\n').filter(x=>x.startsWith('data:')).map(x=>x.slice(5).trim()).join('\n');
  if(!json)continue;
  try{const item=JSON.parse(json);if(item.id===id)return item;}catch{}
 }
 throw Error('Missing MCP SSE response for request '+id);
}
export async function connect(fetcher=fetch){
 let session='',version=VERSION,sequence=0;
 async function command(method,params={},notify=false){
  const id=notify?null:++sequence;
  const body={jsonrpc:'2.0',...(!notify?{id}:{}),method,...(!notify?{params}:{})};
  const r=await fetcher(MCP_URL,{method:'POST',headers:{
   'content-type':'application/json','accept':'application/json, text/event-stream','mcp-protocol-version':version,
   ...(session?{'mcp-session-id':session}:{})},
   body:JSON.stringify(body),signal:AbortSignal.timeout(22000)});
  if(!r.ok)throw Error('Pharos Chain MCP HTTP '+r.status+': '+(await r.text()).slice(0,180));
  session=r.headers.get('mcp-session-id')||session;
  if(notify){await r.text();return null;}
  const raw=await r.text();
  if(raw.length>1000000)throw Error('Chain MCP response too large');
  const obj=(r.headers.get('content-type')||'').includes('event-stream')?parseSse(raw,id):JSON.parse(raw);
  if(obj.id!==id)throw Error('MCP response ID mismatch');
  if(obj.error)throw Error('Chain MCP '+String(obj.error.message||'protocol error'));
  return obj.result;
 }
 const init=await command('initialize',{protocolVersion:VERSION,capabilities:{},clientInfo:{name:'weekly-digest-agent',version:'1.0.0'}});
 version=init.protocolVersion||version;
 await command('notifications/initialized',{},true);
 return {
  list:async()=>{const x=await command('tools/list');return x.tools||[];},
  tool:async(name,args={})=>unwrap(await command('tools/call',{name,arguments:args}),name),
  close:async()=>{if(!session)return;try{await fetcher(MCP_URL,{method:'DELETE',headers:{'mcp-session-id':session,'mcp-protocol-version':version},signal:AbortSignal.timeout(2500)});}catch{}}
 };
}
export function unwrap(result,name){
 if(!result||result.isError)throw Error(name+' returned MCP error '+JSON.stringify(result?.content||[]).slice(0,220));
 const v=result.structuredContent&&typeof result.structuredContent==='object'?result.structuredContent:null;
 // get_block returns raw JSON as a text tool result on the official endpoint.
 if(v && (v.chainId!==undefined||v.number!==undefined||v.blockNumber!==undefined))return v;
 const raw=result.content?.find(x=>x.type==='text')?.text;
 if(typeof raw!=='string')throw Error(name+' returned no tool text');
 const parsed=JSON.parse(raw);
 if(!parsed||parsed.error||parsed.mcpError)throw Error(name+' RPC error: '+String(parsed?.error?.message||parsed?.mcpError?.message||'Unknown'));
 return parsed;
}
