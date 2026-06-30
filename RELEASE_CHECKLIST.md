# Release Checklist

## Local package

- [ ] `npm install`
- [ ] `npm run build`
- [ ] `npm test`
- [ ] `npm pack --dry-run`
- [ ] `npx @modelcontextprotocol/inspector --cli node dist/index.js --method tools/list`
- [ ] `npx @modelcontextprotocol/inspector --cli node dist/index.js --method resources/list`
- [ ] `npx @modelcontextprotocol/inspector --cli node dist/index.js --method prompts/list`

## No-key verification

- [ ] `y2_get_openapi_operation` returns `listReports`
- [ ] `y2://quickstart` reads successfully
- [ ] `y2_list_reports` without `Y2_API_KEY` returns a tool error, not a process crash

## Live Y2 key verification

- [ ] `y2_list_reports` works with `reports:read`
- [ ] `y2_list_news` works with `news:read`
- [ ] `y2_ask_agent` works with `agent:y2`
- [ ] Missing `agent:y2` returns a clear scope error
- [ ] Invalid key returns a clear auth error
- [ ] Rate-limit response preserves `Retry-After` when present

## Client verification

- [ ] Claude Code install command tested
- [ ] Codex install command or `config.toml` tested
- [ ] Claude Desktop JSON shape tested

## Publish

- [ ] Finalize license
- [ ] Push `y2-intel/y2-mcp`
- [ ] Publish `@y2-intel/mcp`
- [ ] Add MCP Registry metadata after npm package is stable
