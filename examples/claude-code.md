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
- `news:read` for News Terminal tools

Agent Y2 is disabled by default. To expose `y2_ask_agent`, use a key with
`agent:y2` and add `--env Y2_MCP_ENABLE_AGENT=1` to the `claude mcp add`
command.

Do not paste `Y2_API_KEY` into prompts.
