# Release Checklist

## Local package

- [ ] `npm install`
- [ ] `npm run release:check`

## No-key verification

- [ ] `y2_get_openapi_operation` returns `listReports`
- [ ] `y2://quickstart` reads successfully
- [ ] `y2_list_reports` without `Y2_API_KEY` returns a tool error, not a process crash

## Live Y2 key verification

- [ ] `Y2_MCP_SMOKE_TOOLS=reports npm run smoke:live` works with `reports:read`
- [ ] `Y2_MCP_SMOKE_TOOLS=news npm run smoke:live` works with `news:read`
- [ ] `Y2_MCP_SMOKE_TOOLS=agent npm run smoke:live` works with `agent:y2`
- [ ] Missing `agent:y2` returns a clear scope error
- [ ] Invalid key returns a clear auth error
- [ ] Rate-limit response preserves `Retry-After` when present

## Client verification

- [ ] Claude Code install command tested
- [ ] Codex install command or `config.toml` tested
- [ ] Claude Desktop JSON shape tested

## Publish

- [ ] Confirm GitHub/npm package metadata detects Apache-2.0
- [ ] Push `y2-intel/y2-mcp`
- [ ] Publish `@y2-intel/mcp`
- [ ] Add MCP Registry metadata after npm package is stable
