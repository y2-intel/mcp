# MCP Inspector

Build first:

```sh
npm install
npm run build
```

List server capabilities:

```sh
npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list
npx @modelcontextprotocol/inspector --cli node dist/index.js --method resources/list
npx @modelcontextprotocol/inspector --cli node dist/index.js --method prompts/list
```

Agent Y2 is hidden by default. To verify the opt-in tool surface:

```sh
npx @modelcontextprotocol/inspector --cli \
  -e Y2_MCP_ENABLE_AGENT=1 \
  node dist/index.js \
  --method tools/list
```

Write tools are hidden by default. To verify profile, webhook, and delivery
mutation tools:

```sh
npx @modelcontextprotocol/inspector --cli \
  -e Y2_MCP_ENABLE_WRITE_TOOLS=1 \
  node dist/index.js \
  --method tools/list
```

Call a no-key tool:

```sh
npx @modelcontextprotocol/inspector --cli node dist/index.js \
  --method tools/call \
  --tool-name y2_get_openapi_operation \
  --tool-arg operationId=listReports
```

Read a no-key resource:

```sh
npx @modelcontextprotocol/inspector --cli node dist/index.js \
  --method resources/read \
  --uri y2://quickstart
```

Call a scoped Y2 API tool:

```sh
npx @modelcontextprotocol/inspector --cli \
  -e Y2_API_KEY=$Y2_API_KEY \
  node dist/index.js \
  --method tools/call \
  --tool-name y2_list_reports \
  --tool-arg limit=1
```
