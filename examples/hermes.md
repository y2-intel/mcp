# Hermes

This note is for testing the published Y2 MCP package from a Hermes agent or a
Hermes MCP bridge.

## Published package check

Run this outside the `@y2-intel/mcp` repository so `npx` resolves the published
package instead of the local checkout:

```sh
tmpdir=$(mktemp -d)
cd "$tmpdir"

npx @modelcontextprotocol/inspector --cli \
  npx -y @y2-intel/mcp \
  --method tools/list
```

Expected default tools:

- `y2_list_reports`
- `y2_get_report`
- `y2_list_news`
- `y2_get_openapi_operation`

Agent Y2 is intentionally hidden unless `Y2_MCP_ENABLE_AGENT=1` is set.

## Public no-key smoke

This does not require a Y2 API key:

```sh
npx @modelcontextprotocol/inspector --cli \
  npx -y @y2-intel/mcp \
  --method tools/call \
  --tool-name y2_get_openapi_operation \
  --tool-arg operationId=listReports
```

## Scoped Y2 API smoke

Use a least-privilege Y2 API key with `reports:read` and/or `news:read`.

```sh
export Y2_API_KEY=y2_...

npx @modelcontextprotocol/inspector --cli \
  -e Y2_API_KEY=$Y2_API_KEY \
  npx -y @y2-intel/mcp \
  --method tools/call \
  --tool-name y2_list_reports \
  --tool-arg limit=1
```

## Hermes MCP server entry

If the Hermes build supports native MCP server configuration, add a stdio server
equivalent to:

```yaml
mcp_servers:
  y2:
    command: npx
    args:
      - -y
      - @y2-intel/mcp
    env:
      Y2_API_KEY: ${Y2_API_KEY}
      Y2_MCP_ENABLE_AGENT: "0"
```

If the Hermes build is plugin-only, the bridge/plugin should spawn the same
stdio command:

```sh
npx -y @y2-intel/mcp
```

The bridge should pass credentials through environment variables, not tool
arguments or prompts.

## Agent Y2 opt-in

Only enable Agent Y2 when the Hermes agent should be allowed to use Agent Y2
account actions and the key has `agent:y2`.

```yaml
mcp_servers:
  y2:
    command: npx
    args:
      - -y
      - @y2-intel/mcp
    env:
      Y2_API_KEY: ${Y2_API_KEY}
      Y2_MCP_ENABLE_AGENT: "1"
```

With Agent Y2 enabled, `tools/list` should also include `y2_ask_agent`.

## Hermes agent test prompt

Use a prompt like this after the MCP server is connected:

```text
List the Y2 MCP tools you can see. Then call y2_get_openapi_operation for
operationId=listReports and summarize the endpoint, required scopes, and
parameters. Do not call reports, news, or Agent Y2 tools unless a Y2 API key was
provided through the MCP server environment.
```

For a live-key test:

```text
Use the Y2 MCP server to call y2_list_reports with limit=1. Confirm whether the
call succeeded or report the structured error. Do not expose the API key.
```

## Pass criteria

- Hermes can start the Y2 MCP server with `npx -y @y2-intel/mcp`.
- `tools/list` shows the four default tools.
- `y2_get_openapi_operation` works without `Y2_API_KEY`.
- Scoped tools fail cleanly without `Y2_API_KEY`.
- Scoped tools work with a least-privilege Y2 API key.
- `y2_ask_agent` appears only when `Y2_MCP_ENABLE_AGENT=1`.
