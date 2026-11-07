# Weekly Digest Agent — Pharos Agent Arena

**Challenge:** Medium · Support / Reporting · 100 points (+50 optional video).

**Live demo (linked Worker, to verify):** https://weekly-digest-agent.trantanlong2411.workers.dev/
**GitHub:** https://github.com/trantanlong2411-droid/Weekly-Digest-Agent
**Chain MCP:** https://github.com/PharosNetwork/pharos-mcp

An automated, public, read-only **Pharos Mainnet protocol-network digest** published by a scheduled Cloudflare Worker.

## What it does
1. **Runs on a schedule:** Cloudflare Cron Trigger `0 0 * * 1` runs **every Monday at 00:00 UTC**. To change frequency, edit `wrangler.jsonc > triggers.crons`; change the analysis window with `DIGEST_WINDOW_DAYS` (1–28), and block samples with `DIGEST_SAMPLE_BLOCKS` (3–12).
2. **Compares current and previous periods:** Real read-only official Pharos Chain MCP calls find the timestamp-aligned block boundaries for each `N`-day period, fetch `6` evenly distributed blocks in each, and compare per-sampled-block average transaction count, average gas used, and peak transaction count.
3. **Three notable events:** Top **three highest transaction-count blocks among the sampled current-period blocks**, each with block number, gas used, UTC timestamp and explorer link. These are **observed activity hotspots**, **not** the top events across every block of the week.
4. **Delivered to a real channel:** Every successful scheduled run is saved in **Cloudflare SQLite-backed Durable Objects** and displayed on the public published page with permanent URLs `/reports/<id>`, historical list and JSON evidence. No API keys or admin password are required for reviewers to read digests.

### Important sampling limitations

The hosted [Pharos Chain MCP](https://github.com/PharosNetwork/pharos-mcp) supports `get_chain_info` and `get_block` but does **not** provide historical per-wallet transaction indexing. Since the owner did not specify a wallet address, this agent monitors **Pharos protocol network-level activity** by sampling six blocks per period. It does **not** claim full-chain weekly transaction totals, actual wallet balances or full transaction histories. All metrics are explicitly labeled sampled. Values and rankings can differ from complete-chain analytics.

This is a real live integration — no fabricated numbers, no fake published digests. If Chain MCP fails, no digest is written.

## Live reviewer instructions
1. Open the [public Worker](https://weekly-digest-agent.trantanlong2411.workers.dev/). If no digest has yet been published by the Monday cron, press **Generate initial report** (one-off bootstrap). This calls official Chain MCP and persists the report.
2. Check **3 numeric comparisons** against the previous equal-length window, and **top 3 evidence-backed block events** with explorer links.
3. Open the permanent report URL and **View proof JSON**.
4. Refresh the browser to verify that the report and history persist in Durable Object storage, not browser memory.
5. See the schedule, window and sampling configuration in `GET /api/health` and Wrangler config.
6. GitHub Actions validates calculation, Worker deployment readiness and the live MCP sampling independently. The first real Cron Trigger itself fires on the next configured Monday; avoid claiming it has already run before the logs confirm it.

## Endpoints
| Method | Endpoint | Role |
|---|---|---|
| GET | `/` | Public dashboard, latest digest |
| GET | `/api/health` | Actual source, persistence and schedule settings |
| GET | `/api/latest` | Latest persisted real report or null |
| GET | `/api/history` | Persistent published report list |
| GET | `/api/reports/:id` | Historical report JSON |
| GET | `/reports/:id` | Public permanent report URL |
| POST | `/api/generate` | Generate the first digest, with six-hour cooldown and rate limit |

## Local and production checks
```sh
npm install
npm test
npm run build   # Wrangler dry-run ONLY
npm run smoke   # live mainnet MCP; does NOT publish
npx wrangler deploy
```

Cloudflare: Workers & Pages → Weekly Digest Agent → Settings → Builds → repo `trantanlong2411-droid/Weekly-Digest-Agent`, branch `main`, deploy command `npx wrangler deploy`. There is no manual database provisioning: the Wrangler `exports` declaration provisions the SQLite-backed Durable Object namespace.

## Proof and reviewer scoring

See `proof/README.md` and the GitHub Actions [CI run history](https://github.com/trantanlong2411-droid/Weekly-Digest-Agent/actions). A passed build is not proof of cron execution. The real proof for delivery is a persisted public report and production test that reopens its URL.

## Official sources
- [Pharos hosted Chain MCP and tool set](https://github.com/PharosNetwork/pharos-mcp)
- [Cloudflare Scheduled Handler](https://developers.cloudflare.com/workers/runtime-apis/handlers/scheduled/)
- [Cloudflare Durable Object SQLite storage](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
- [Cloudflare Declarative Durable Object exports](https://developers.cloudflare.com/durable-objects/reference/durable-objects-migrations/)

**Cloudflare Free limits:** The Worker uses a local block-time estimate plus bounded timestamp refinement, six metrics samples per period, and at most four event-log windows with ten bounded fallback probes to stay below the Free plan's external subrequest allowance. Period boundaries are approximate (within a few minutes), not exhaustive network indexes.
