# Changelog

## Unreleased

- Updated npm dependencies within the supported version ranges.
- Synchronized all 65 published operations with typed MCP tools, including
  OpenAI-compatible chat completions behind the Agent Y2 opt-in.
- Added pagination, response formats, sparse fieldsets, expansions, conditional
  headers, and creation idempotency keys. Updated filter enums, list limits,
  replacement-body documentation, and knowledge/change-feed scope descriptions.
- Enforced write and Agent Y2 opt-ins in `y2_call_api`, corrected its public x402
  receipt route/auth handling, and rejected missing required parameters/bodies.
- Exposed resolved request-body schemas and scopes in OpenAPI inspection, with
  inherited parameter overrides and bounded recursive schema resolution.
- Added a live OpenAPI contract gate to release checks and CI. Preserved Markdown,
  NDJSON, and chat tool-call streams in tool responses.
- Made the Inspector missing-key check independent of the caller's API key and
  fail if the expected tool error is absent.

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
