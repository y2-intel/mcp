# y2-mcp

MCP server for connecting Claude, Codex, and other MCP-compatible agents to Y2.

This package is intentionally thin: it runs locally over stdio, reads credentials
from environment variables, and calls the public Y2 API. It does not import
Convex app internals.

## Install

```sh
npx -y @y2-intel/mcp
```

Required:

```sh
export Y2_API_KEY=y2_...
```

Optional:

```sh
export Y2_API_BASE_URL=https://api.y2.dev
export Y2_DOCS_BASE_URL=https://y2.dev
export Y2_MCP_TIMEOUT_MS=60000
```

## Claude Code

```sh
claude mcp add --env Y2_API_KEY=$Y2_API_KEY --transport stdio y2 \
  -- npx -y @y2-intel/mcp
```

## Codex

```sh
codex mcp add y2 --env Y2_API_KEY=$Y2_API_KEY -- npx -y @y2-intel/mcp
```

Equivalent `config.toml`:

```toml
[mcp_servers.y2]
command = "npx"
args = ["-y", "@y2-intel/mcp"]
env_vars = ["Y2_API_KEY"]
startup_timeout_sec = 20
tool_timeout_sec = 120
default_tools_approval_mode = "prompt"
```

## Claude Desktop

Use the JSON shape in
[`examples/claude-desktop.json`](examples/claude-desktop.json).

## Tools

- `y2_ask_agent` - asks Agent Y2 through `/api/v1/agent-y2/chat/stream`.
- `y2_list_reports` - lists recent Y2 reports.
- `y2_get_report` - fetches one report by ID.
- `y2_list_news` - lists bounded Y2 News Terminal items.
- `y2_get_openapi_operation` - returns one OpenAPI operation by operation ID or
  path/method.

## Resources

- `y2://docs/index`
- `y2://docs/full`
- `y2://openapi`
- `y2://quickstart`

## Development

```sh
npm install
npm run build
npm test
npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list
```

Credentials must never be provided as tool input. Use a least-privilege Y2 API
key for each MCP client.

See [`RELEASE_CHECKLIST.md`](RELEASE_CHECKLIST.md) before publishing.
