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

## Y2 API Usage

The default API root is `https://api.y2.dev`. The published OpenAPI document is
served from `https://y2.dev/api/openapi.yaml`.

| MCP tool | Y2 API usage | Scope |
| --- | --- | --- |
| `y2_get_openapi_operation` | Reads the public OpenAPI document by `operationId` or path | none |
| `y2_list_reports` | `GET /api/v1/reports` | `reports:read` |
| `y2_get_report` | `GET /api/v1/reports/{reportId}` | `reports:read` |
| `y2_list_news` | `GET /api/v1/news` | `news:read` |
| `y2_ask_agent` | `POST /api/v1/agent-y2/chat/stream` | `agent:y2` |

OpenAPI v1 paths are relative to `https://api.y2.dev/api/v1`, so both
`/reports` and `/api/v1/reports` work with `y2_get_openapi_operation`. Agent Y2
is opt-in because it can use entitled Y2 account actions; use a key with
`agent:y2` only when that behavior is intended.

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

The `agent` smoke path consumes Agent Y2 chat budget:

```sh
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
