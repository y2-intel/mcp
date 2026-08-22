# y2-mcp

MCP server for connecting Claude, Codex, and other MCP-compatible agents to Y2.

The package is intentionally thin: it runs locally over stdio, reads credentials
from environment variables, and calls the public Y2 API. It does not import
Convex app internals.

## Install

```sh
npx -y @y2-intel/mcp
```

Required for scoped Y2 API tools:

```sh
export Y2_API_KEY=y2_...
```

Optional:

```sh
export Y2_API_BASE_URL=https://api.y2.dev
export Y2_DOCS_BASE_URL=https://y2.dev
export Y2_MCP_TIMEOUT_MS=60000
export Y2_MCP_MAX_RESPONSE_CHARS=40000
```

Agent Y2 is disabled by default. Enable it only for keys that intentionally have
the `agent:y2` scope:

```sh
export Y2_MCP_ENABLE_AGENT=1
```

Write tools are also disabled by default. Enable them only for clients and keys
that should mutate Y2 profiles, projects, automations, webhooks, or subscription
delivery:

```sh
export Y2_MCP_ENABLE_WRITE_TOOLS=1
```

## Tools

- `y2_list_api_operations` — enumerate every operation in the published Y2
  OpenAPI document (operationId, method, path). No API key required.
- `y2_call_api` — call any operation by `operationId` (or path + method); path,
  query, and header parameters and JSON bodies are built from the live spec.
- `y2_get_openapi_operation` — inspect one resolved OpenAPI operation.
- Typed tools for reports (`y2_list_reports`, `y2_get_report`, signals, graph,
  audio), projects, automations, webhooks, news, recaps, feeds, OSINT (events,
  map, CII, country briefs, aircraft, vessels, GPS jamming, cyber threats,
  prediction markets), intel v2 (incidents, entities, graphs, markets, FinInt,
  signals, CVEs, threat actors, change watermarks, knowledge retrieval), and the
  public x402 receipt lookup.
- Optional `y2_ask_agent` for Agent Y2 when enabled.

## Clients

Claude Code:

```sh
claude mcp add --env Y2_API_KEY=$Y2_API_KEY --transport stdio y2 \
  -- npx -y @y2-intel/mcp
```

Codex:

```sh
codex mcp add y2 --env Y2_API_KEY=$Y2_API_KEY -- npx -y @y2-intel/mcp
```

Codex `config.toml`:

```toml
[mcp_servers.y2]
command = "npx"
args = ["-y", "@y2-intel/mcp"]
env_vars = ["Y2_API_KEY"]
startup_timeout_sec = 20
tool_timeout_sec = 120
default_tools_approval_mode = "prompt"
```

Claude Desktop JSON is in
[`examples/claude-desktop.json`](examples/claude-desktop.json).
Hermes install/integration test notes are in
[`examples/hermes.md`](examples/hermes.md).

## Y2 API Usage

The default API root is `https://api.y2.dev`. The published OpenAPI document is
served from `https://y2.dev/api/openapi.yaml`.

| MCP tool | Y2 API usage | Scope |
| --- | --- | --- |
| `y2_get_openapi_operation` | Reads the public OpenAPI document by `operationId` or path | none |
| `y2_list_reports`, `y2_get_report`, `y2_get_report_signals`, `y2_get_report_graph`, `y2_get_report_text`, `y2_get_report_audio_text` | Report listing, detail, graph, signals, and text endpoints | `reports:read` |
| `y2_get_report_audio` | Report audio metadata | `reports:audio` |
| `y2_list_profiles` | `GET /api/v1/profiles` | `profiles:read` |
| `y2_list_news`, `y2_list_recaps`, `y2_list_feeds` | News Terminal items, AI recaps, and feed metadata | `news:read` |
| `y2_list_osint_*`, `y2_get_country_*`, `y2_list_aircraft`, `y2_list_vessels`, `y2_list_finint_indicators` | Situation Room OSINT, country, military, cyber-threat, market, and FinInt read endpoints | `osint:read` |
| `y2_list_incidents_v2`, `y2_get_incident_v2`, `y2_list_entities_v2`, `y2_get_entity_v2`, `y2_get_entity_graph_v2`, `y2_list_markets_v2`, `y2_list_finint_intel_v2`, `y2_list_signals_v2`, `y2_get_cyber_graph_v2`, `y2_list_cves_v2`, `y2_list_threat_actors_v2` | Intel v2 explorer, market, FinInt, signal, and cyber endpoints | `intel:explorer`, `intel:finint`, or `intel:cyber` depending on endpoint |
| `y2_list_webhooks` | List webhook configurations | `webhooks:manage` |
| `y2_get_x402_receipt` | Public x402 receipt lookup | none |
| `y2_create_profile`, `y2_update_profile`, `y2_patch_profile`, `y2_delete_profile`, `y2_create_webhook`, `y2_update_webhook`, `y2_delete_webhook`, `y2_test_webhook`, `y2_update_delivery` | Profile, webhook, and delivery mutation endpoints | required write/manage scope plus `Y2_MCP_ENABLE_WRITE_TOOLS=1` |
| `y2_ask_agent` | `POST /api/v1/agent-y2/chat/stream` | `agent:y2` plus `Y2_MCP_ENABLE_AGENT=1` |

OpenAPI v1 paths are relative to `https://api.y2.dev/api/v1`, so both
`/reports` and `/api/v1/reports` work with `y2_get_openapi_operation`. Agent Y2
is disabled by default because it can use entitled Y2 account actions. Write
tools are disabled by default because they mutate Y2 account configuration. Set
the opt-in flags only when that behavior is intended.

Credentials must never be passed as tool arguments or pasted into prompts. Give
each MCP client a least-privilege Y2 API key through its environment.

## Resources

- `y2://docs/index`
- `y2://docs/full`
- `y2://openapi`
- `y2://quickstart`

## Development

```sh
npm ci
npm run release:check
```

`release:check` builds the package, typechecks scripts and tests, runs unit
tests, performs `npm pack --dry-run`, and exercises tools/resources/prompts
through MCP Inspector.

Run live API smoke tests after exporting a scoped key:

```sh
export Y2_API_KEY=y2_...
Y2_MCP_SMOKE_TOOLS=reports,news npm run smoke:live
```

The `agent` smoke path consumes Agent Y2 chat budget and should be run only with
an API key that has `agent:y2`:

```sh
export Y2_MCP_ENABLE_AGENT=1
Y2_MCP_SMOKE_TOOLS=agent npm run smoke:live
```

## Release

Before publishing v0.1.0:

1. Run `npm ci && npm run release:check`.
2. Confirm GitHub Actions `CI` passes on `main`.
3. Add `Y2_API_KEY` as a repository secret and run the `Live smoke` workflow
   with `reports,news`.
4. Add `NPM_TOKEN` as a repository secret.
5. Run the `Publish` workflow or publish locally with
   `npm publish --access public --provenance`.
6. Verify `npm view @y2-intel/mcp version`.
7. Test Claude Code, Codex, and Claude Desktop from the npm package.

The npm tarball intentionally contains only runtime output, package docs,
examples, registry metadata, license, and security policy.
