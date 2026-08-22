# Codex

Install the Y2 MCP server with the Codex CLI:

```sh
export Y2_API_KEY=y2_...

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

Use the default prompt approval mode until you are comfortable with which Y2
tools are enabled for the API key.

Default tools cover read-only Y2 reports, news, OSINT, Intel v2, webhook
listing, OpenAPI lookup, and x402 receipt lookup. Use least-privilege Y2 API
keys with only the scopes needed by the enabled workflows.

Agent Y2 is disabled by default. To expose `y2_ask_agent`, export
`Y2_MCP_ENABLE_AGENT=1` and add it to `env_vars` alongside `Y2_API_KEY`. Use a
Y2 API key with `agent:y2` only when Agent Y2 account actions are intended.

Write tools are disabled by default. To expose profile, webhook, and delivery
mutation tools, export `Y2_MCP_ENABLE_WRITE_TOOLS=1` and add it to `env_vars`
alongside a key with the matching write/manage scopes.
