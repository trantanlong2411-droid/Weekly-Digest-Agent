import {buildDigest} from '../src/digest.mjs';
import {mkdir,writeFile} from 'node:fs/promises';
const checkedAt=new Date().toISOString(),report=await buildDigest();
const proof={schema:'pharos-weekly-digest-chain-mcp-v1',checkedAtUtc:checkedAt,
 source:report.source,asOfBlock:report.asOfBlock,periods:report.periods,
 current:{sampledBlocks:report.current.sampledBlocks,
  avgTransactionsPerSample:report.current.avgTransactionsPerSample,
  avgGasMillionPerSample:report.current.avgGasMillionPerSample},
 previous:{sampledBlocks:report.previous.sampledBlocks,
  avgTransactionsPerSample:report.previous.avgTransactionsPerSample,
  avgGasMillionPerSample:report.previous.avgGasMillionPerSample},
 top3Events:report.top3Events,
 note:'Real read-only MCP block samples; NOT complete transaction totals. This stand-alone smoke test does not publish a Worker report.'};
if(report.top3Events.length!==3)throw Error('Missing actual notable events');
await mkdir('proof',{recursive:true});
await writeFile('proof/live-chain-smoke.json',JSON.stringify(proof,null,2)+'\n');
console.log('WEEKLY_DIGEST_LIVE_CHAIN_MCP_SUCCESS',JSON.stringify(proof));
