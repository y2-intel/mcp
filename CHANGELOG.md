# Changelog

## 0.4.1

- Synchronized all 79 published operations with typed MCP tools. Added
  `y2_get_cve_disclosure_v2` for sourced CVE disclosures, and the `cve_list` and `osv`
  sources to the regional event `sourceType` filter.
- Updated Wrangler to 4.156.1 and Miniflare to 5.20261101.0-beta, which use `undici` 7.30.1.
  This fixes CVE-2026-109829, CVE-2026-109383, CVE-2026-87018, CVE-2026-109869,
  CVE-2026-109924, CVE-2026-109841, CVE-2026-109932, and CVE-2026-87029 in local development
  and Worker deployment tools. `npm audit` reports no vulnerabilities.
- Locked `@hono/node-server`, a dependency of the MCP SDK, to 2.1.6 for CVE-2026-118663. The
  stdio server does not serve static files, and new installs already resolve a fixed release.
- The minimum Node.js versions, 24.22.1 and 26.12.1, bundle a fixed `undici` for `fetch`.
- CI, release, and live smoke workflows use `actions/checkout` and `actions/setup-node` v7,
  which run on Node.js 24 instead of Node.js 20.
- Updated `@modelcontextprotocol/ext-apps` to 2.0.4, Workers types, and `@types/node`.

## 0.4.0

- Requires Node.js 24.22.1 or later, or 26.12.1 or later. Earlier releases have known
  security vulnerabilities. CI, release, and live smoke workflows run on Node.js 24.
- Moved the hosted service to `https://mcp.y2.dev/mcp` and retired the `workers.dev`
  address. Hosted connections made with 0.3.0 must be removed and added again.
- Synchronized all 78 published operations with typed MCP tools. Added
  `y2_list_disclosures_v2`, `y2_list_dns_snapshots_v2`, and the write-gated
  `y2_create_dns_lookup_v2`. A new DNS snapshot uses one monthly workspace lookup.
- Added the `temporality` filter (`current` or `forecast`) to OSINT, map, Y2, and
  regional event tools.
- Added the `since` start time to `y2_list_changes_v2` and the `adsblol` source to the
  regional event `sourceType` filter.
- The hosted consent completion page links to the configured Y2 origin.
- Updated dependencies, including `@cloudflare/workers-oauth-provider` 1.2.4, the MCP
  SDKs, Wrangler 4.152, Vite 8.3.5, Zod 4.6.7, and TypeScript 7. Cleared all npm audit
  advisories except `undici` 7.29.1, which Wrangler's pinned Miniflare uses in local
  development only.
- The npm package installs only the MCP SDK, `yaml`, and `zod`. Hosted Worker and map
  view libraries moved to development dependencies, reducing a clean install from 127
  packages to 97.

## 0.3.0

- Added the hosted read-only OAuth service, workspace consent, revocation, and replay protection.
- Added native MCP Apps profile cards, signal feeds, and regional maps with cited text fallbacks.
- Added OpenAI and Claude plugin bundles, marketplace manifests, and package validation.

- Updated npm dependencies within the supported version ranges.
- Synchronized all 65 published operations with typed MCP tools, including
  OpenAI-compatible chat completions behind the Agent Y2 opt-in.
- Added pagination, response formats, sparse fieldsets, expansions, conditional
  headers, and creation idempotency keys. Updated filter enums, list limits,
  replacement-body documentation, and knowledge/change-feed scope descriptions.
- Enforced write and Agent Y2 opt-ins in `y2_call_api`, corrected its public x402
  receipt route/auth handling, and rejected missing required parameters/bodies.
- Exposed resolved request-body schemas and scopes in OpenAPI inspection, with
  inherited parameter overrides and bounded recursive schema resolution.
- Added a live OpenAPI contract gate to release checks and CI. Preserved Markdown,
  NDJSON, and chat tool-call streams in tool responses.
- Made the Inspector missing-key check independent of the caller's API key and
  fail if the expected tool error is absent.

## 0.2.0

- Added spec-driven `y2_list_api_operations` and `y2_call_api` tools that build
  path, query, header, and body arguments from the live published Y2 OpenAPI
  document, with a shared TTL-cached spec loader.
- Expanded coverage to every Y2 OpenAPI operation family: projects, automations
  (including run with Idempotency-Key header), v2 change watermarks, and global
  knowledge retrieval.
- Aligned existing tools with the spec: report `include`/`view`/`format`, news
  `countryCode`/`format`, signals `profileId`/`reportId`, and regional event
  `datetime` filters.
- Added automatic client retries with backoff for 429/502/503/504, honoring
  Retry-After.
- `y2_get_openapi_operation` now returns resolved parameters and request-body
  details from the cached spec.

## 0.1.0

- Initial local stdio MCP server scaffold for Y2 docs, OpenAPI context, Agent Y2,
  reports, and news.
- Aligned OpenAPI lookups with Y2 API usage so `/api/v1/...` paths and full
  `https://api.y2.dev/...` URLs resolve to the published OpenAPI operations.
- Consolidated release instructions into `README.md` and kept planning
  checklists out of the package tarball.
- Hid the Agent Y2 tool behind explicit `Y2_MCP_ENABLE_AGENT=1` opt-in and
  expanded `server.json` registry metadata.
