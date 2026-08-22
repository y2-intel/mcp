# Changelog

## 0.2.0

- Added spec-driven `y2_list_api_operations` and `y2_call_api` tools that build
  path, query, header, and body arguments from the live published Y2 OpenAPI
  document, with a shared TTL-cached spec loader.
- Expanded coverage to every Y2 OpenAPI operation family: projects, automations
  (including run with Idempotency-Key header), v2 change watermarks, and global
  knowledge retrieval.
- Aligned existing tools with the spec: report `include`/`view`/`format`, news
  `countryCode`/`format`, signals `profileId`/`reportId`, and regional event
  `datetime` filters.
- Added automatic client retries with backoff for 429/502/503/504, honoring
  Retry-After.
- `y2_get_openapi_operation` now returns resolved parameters and request-body
  details from the cached spec.

## 0.1.0

- Initial local stdio MCP server scaffold for Y2 docs, OpenAPI context, Agent Y2,
  reports, and news.
- Aligned OpenAPI lookups with Y2 API usage so `/api/v1/...` paths and full
  `https://api.y2.dev/...` URLs resolve to the published OpenAPI operations.
- Consolidated release instructions into `README.md` and kept planning
  checklists out of the package tarball.
- Hid the Agent Y2 tool behind explicit `Y2_MCP_ENABLE_AGENT=1` opt-in and
  expanded `server.json` registry metadata.
