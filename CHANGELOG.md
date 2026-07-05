# Changelog

## 0.1.0

- Initial local stdio MCP server scaffold for Y2 docs, OpenAPI context, Agent Y2,
  reports, and news.
- Aligned OpenAPI lookups with Y2 API usage so `/api/v1/...` paths and full
  `https://api.y2.dev/...` URLs resolve to the published OpenAPI operations.
- Consolidated release instructions into `README.md` and kept planning
  checklists out of the package tarball.
- Hid the Agent Y2 tool behind explicit `Y2_MCP_ENABLE_AGENT=1` opt-in and
  expanded `server.json` registry metadata.
