# Weekly Digest Agent — Reviewer evidence

The task is 100 points +50 optional video. Score only supported claims.

| Requirement | Code and proof |
|---|---|
| Periodic schedule (weekly default, configurable) | `wrangler.jsonc` Cron Trigger `0 0 * * 1` UTC; `src/worker.mjs` `scheduled()`. Edit cron and `DIGEST_WINDOW_DAYS` to configure; verify live future runs in Cloudflare Cron Events logs. |
| Key metrics vs previous period | `src/digest.mjs` independently samples and summarizes two approximately time-aligned windows via actual Chain MCP `get_block`. On-screen relative deltas for 3 metrics. |
| Three notable events | Top 3 busiest **sampled** current-period blocks; sourced to actual block explorer URLs and timestamps, no inflated full-network claim. |
| Delivery to real channel | Public `/reports/<digest-id>` via persistent SQLite-backed Durable Object and `/api/history`. Reload to confirm not just browser cache. |

**Proof hierarchy:** CI unit + bundle alone are NOT live proof. `npm run smoke` proves actual Pharos Chain MCP block data, but not deployment or persistence. `scripts/verify-deployed.mjs` proves the deployed public report persists and can be re-opened. `scheduled()` is present with a configured Cron Trigger; it will execute on the next Monday 00:00 UTC. Only Cloudflare Cron Events logs after that time prove an automated scheduled run actually occurred.

**Method disclaimer:** sample blocks, not complete 7-day transaction data; no address-level analysis because no wallet was provided. This is a protocol network digest, not a per-wallet history indexer. Do not present estimates as complete counts.

No wallet keys or telegram tokens used, no transaction broadcast.
