# Claude Code

Install the Y2 MCP server as a local stdio server:

```sh
export Y2_API_KEY=y2_...

claude mcp add --env Y2_API_KEY=$Y2_API_KEY --transport stdio y2 \
  -- npx -y @y2-intel/mcp
```

Use a dedicated Y2 API key for Claude Code. Add only the scopes needed by the
tools you expect to use:

- `reports:read` for report tools
- `reports:audio` for report audio metadata
- `news:read` for News Terminal tools
- `osint:read` for OSINT, country, military, cyber-threat, prediction-market,
  and FinInt indicator tools
- `intel:explorer`, `intel:finint`, or `intel:cyber` for Intel v2 tools
- `webhooks:manage` for webhook listing

Agent Y2 is disabled by default. To expose `y2_ask_agent`, use a key with
`agent:y2` and add `--env Y2_MCP_ENABLE_AGENT=1` to the `claude mcp add`
command.

Write tools are disabled by default. To expose profile, webhook, and delivery
mutation tools, use a key with the matching write/manage scopes and add
`--env Y2_MCP_ENABLE_WRITE_TOOLS=1`.

Do not paste `Y2_API_KEY` into prompts.
