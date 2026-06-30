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
