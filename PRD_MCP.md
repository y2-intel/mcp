# PRD: Y2 MCP Server

## Summary

Ship a public Model Context Protocol server that lets Claude Code, Codex, Claude
Desktop, and other MCP-compatible agents connect directly to Y2 through the
public Y2 API.

The MCP server is a thin local stdio package. It reads credentials from
environment variables, exposes Y2 tools/resources/prompts to agent clients, and
does not embed Convex or platform internals.

## Current State

- Standalone repo exists at `https://github.com/y2-intel/mcp`.
- Repo is currently private for staging.
- Package name is `@y2-intel/mcp`.
- Package version is `0.1.0`.
- MCP server name is `io.github.y2-intel/mcp`.
- License is `Apache-2.0`, matching the existing public Y2 SDK/CLI repos.
- GitHub Actions `CI` runs `npm run release:check` on every push to `main`.
- npm package is not published yet.
- Live Y2 API smoke tests have not been run because no live `Y2_API_KEY` was
  available in the local shell.

## Product Decision

The MCP server should remain a separate repo/package, not embedded inside the
Y2 platform app.

Reasons:

- Agent users install MCP servers as packages or standalone executables.
- The server should depend only on the public Y2 API contract, not Convex app
  internals.
- A separate package is easier to publish, version, audit, and register in MCP
  ecosystems.
- Platform remains the source of truth for API behavior, OpenAPI, and docs.

## Repository Naming

Final launch shape after the GitHub repo rename:

- GitHub repo: `y2-intel/mcp`
- npm package: `@y2-intel/mcp`
- binary: `y2-mcp`

This gives a short public GitHub URL and a short install command:

```sh
npx -y @y2-intel/mcp
```

The local checkout may remain at `/Users/tobalo/Development/y2/y2-mcp`; that is
only a local folder name. Public metadata, issue links, and MCP registry
metadata should use `y2-intel/mcp`.

## Implemented Scope

### Tools

- `y2_ask_agent`
  - Calls Agent Y2 through `/api/v1/agent-y2/chat/stream`.
  - Requires the `agent:y2` API key scope.
  - Supports existing Y2 thread IDs and optional external source/thread/user
    labels.

- `y2_list_reports`
  - Lists recent Y2 reports.
  - Requires the `reports:read` API key scope.
  - Hard-caps results at the API-safe limit.

- `y2_get_report`
  - Fetches one report by ID.
  - Requires the `reports:read` API key scope.

- `y2_list_news`
  - Lists bounded Y2 News Terminal items.
  - Requires the `news:read` API key scope.

- `y2_get_openapi_operation`
  - Returns one OpenAPI operation by `operationId` or by path/method.
  - Does not require a Y2 API key.

### Resources

- `y2://docs/index`
- `y2://docs/full`
- `y2://openapi`
- `y2://quickstart`

### Prompts

- `integrate-y2-api`
- `ask-y2-brief`
- `debug-y2-api-call`

### Configuration

Required:

```sh
export Y2_API_KEY=y2_...
```

Optional:

```sh
export Y2_API_BASE_URL=https://api.y2.dev
export Y2_DOCS_BASE_URL=https://y2.dev
export Y2_MCP_TIMEOUT_MS=60000
```

Credentials must be provided through the MCP client environment, never as tool
input.

## Implemented Release Automation

### CI

Workflow: `.github/workflows/ci.yml`

Runs on push to `main` and pull requests:

```sh
npm ci
npm run release:check
```

`release:check` runs:

```sh
npm run build
npm run typecheck:extras
npm test
npm pack --dry-run
npm run inspect:all
```

### Live Smoke

Workflow: `.github/workflows/live-smoke.yml`

Manual workflow that requires repository secret `Y2_API_KEY`.

Default smoke groups:

```txt
reports,news
```

Optional group:

```txt
agent
```

The `agent` path consumes Agent Y2 chat budget.

### Publish

Workflow: `.github/workflows/publish.yml`

Manual workflow that requires repository secret `NPM_TOKEN`.

It runs:

```sh
npm ci
npm run release:check
npm publish --access public --provenance
```

### Dependabot

Workflow config: `.github/dependabot.yml`

Dependabot is enabled for npm dependencies and GitHub Actions. It may open
dependency update PRs immediately after launch. Those are not release blockers
unless they change the package lockfile or workflow behavior needed for v0.1.0.

## Live Test Plan

### 1. Local Package Verification

From the MCP repo:

```sh
cd /Users/tobalo/Development/y2/y2-mcp
npm install
npm run release:check
```

Expected result:

- TypeScript build passes.
- Extra script/test typecheck passes.
- Unit tests pass.
- `npm pack --dry-run` includes `LICENSE`, `README.md`,
  `RELEASE_CHECKLIST.md`, `SECURITY.md`, `server.json`, examples, and `dist`.
- MCP inspector lists tools, resources, and prompts.
- Calling an authenticated tool without `Y2_API_KEY` returns a tool error, not
  a process crash.

### 2. Live API Key Verification

Create a least-privilege Y2 API key with only the scopes needed for the smoke
path being tested.

Reports:

```sh
export Y2_API_KEY=y2_...
Y2_MCP_SMOKE_TOOLS=reports npm run smoke:live
```

News:

```sh
export Y2_API_KEY=y2_...
Y2_MCP_SMOKE_TOOLS=news npm run smoke:live
```

Read-only combined smoke:

```sh
export Y2_API_KEY=y2_...
Y2_MCP_SMOKE_TOOLS=reports,news npm run smoke:live
```

Agent Y2 smoke:

```sh
export Y2_API_KEY=y2_...
Y2_MCP_SMOKE_TOOLS=agent npm run smoke:live
```

Expected result:

- `reports` succeeds with `reports:read`.
- `news` succeeds with `news:read`.
- `agent` succeeds with `agent:y2`.
- Missing scope returns a clear scope/auth error.
- Invalid key returns a clear auth error.
- Rate-limit responses preserve `Retry-After` when present.

### 3. GitHub Live Smoke

Add repository secret:

```txt
Y2_API_KEY
```

Run GitHub Actions workflow:

```txt
Live smoke
```

Recommended first input:

```txt
reports,news
```

Run `agent` separately if chat budget is acceptable.

### 4. Claude Code Local Connection Test

Build the local package:

```sh
cd /Users/tobalo/Development/y2/y2-mcp
npm run build
export Y2_API_KEY=y2_...
```

Add the local MCP server:

```sh
claude mcp add y2 -e Y2_API_KEY="$Y2_API_KEY" -- node /Users/tobalo/Development/y2/y2-mcp/dist/index.js
```

Verify:

```sh
claude mcp list
claude mcp get y2
```

Suggested Claude prompt:

```txt
Use the Y2 MCP server to list the available Y2 resources and then inspect the OpenAPI operation for listReports.
```

If the API key has `reports:read`, test:

```txt
Use the Y2 MCP server to list my latest reports.
```

### 5. Codex Local Connection Test

Build the local package:

```sh
cd /Users/tobalo/Development/y2/y2-mcp
npm run build
export Y2_API_KEY=y2_...
```

Add the local MCP server:

```sh
codex mcp add y2 --env Y2_API_KEY="$Y2_API_KEY" -- node /Users/tobalo/Development/y2/y2-mcp/dist/index.js
```

Verify:

```sh
codex mcp list
codex mcp get y2
```

Suggested Codex prompt:

```txt
Use the Y2 MCP server to read y2://quickstart and summarize the integration steps.
```

If the API key has `news:read`, test:

```txt
Use the Y2 MCP server to list recent Y2 news.
```

### 6. Claude Desktop Local Connection Test

Use the JSON shape in:

```txt
examples/claude-desktop.json
```

For local unpublished testing, point the command to Node and the built package:

```json
{
  "mcpServers": {
    "y2": {
      "command": "node",
      "args": ["/Users/tobalo/Development/y2/y2-mcp/dist/index.js"],
      "env": {
        "Y2_API_KEY": "y2_..."
      }
    }
  }
}
```

Restart Claude Desktop after updating the config.

## Publish Plan

### 1. Confirm npm Auth

Local check:

```sh
npm whoami
```

If not authenticated:

```sh
npm login
```

For GitHub Actions publishing, add repository secret:

```txt
NPM_TOKEN
```

The token needs permission to publish `@y2-intel/mcp`.

### 2. Publish

Preferred path:

- Confirm local `npm run release:check` passes.
- Confirm GitHub Actions `CI` passes on `main`.
- Confirm `Live smoke` passes with `reports,news`.
- Run GitHub Actions `Publish`.

Local fallback:

```sh
cd /Users/tobalo/Development/y2/y2-mcp
npm run release:check
npm publish --access public --provenance
```

### 3. Verify npm Package

```sh
npm view @y2-intel/mcp version
npx -y @y2-intel/mcp --help
```

If the package does not expose a useful `--help` response, verify through MCP
inspector instead:

```sh
npx @modelcontextprotocol/inspector --cli npx -y @y2-intel/mcp --method tools/list
```

### 4. Post-Publish Claude/Codex Install Commands

Claude Code:

```sh
claude mcp add y2 -e Y2_API_KEY="$Y2_API_KEY" -- npx -y @y2-intel/mcp
```

Codex:

```sh
codex mcp add y2 --env Y2_API_KEY="$Y2_API_KEY" -- npx -y @y2-intel/mcp
```

Codex `config.toml` equivalent:

```toml
[mcp_servers.y2]
command = "npx"
args = ["-y", "@y2-intel/mcp"]
env_vars = ["Y2_API_KEY"]
startup_timeout_sec = 20
tool_timeout_sec = 120
default_tools_approval_mode = "prompt"
```

## Public Launch Checklist

- [x] Rename GitHub repo to `y2-intel/mcp`.
- [ ] Add GitHub secret `Y2_API_KEY`.
- [ ] Run GitHub Actions `Live smoke` with `reports,news`.
- [ ] Run local or GitHub live smoke for `agent` if launch copy mentions Agent
      Y2 tool usage.
- [ ] Add GitHub secret `NPM_TOKEN`.
- [ ] Publish `@y2-intel/mcp@0.1.0`.
- [ ] Verify `npm view @y2-intel/mcp version`.
- [ ] Test Claude Code install from npm.
- [ ] Test Codex install from npm.
- [ ] Test Claude Desktop config from npm.
- [ ] Make GitHub repo public.
- [ ] Confirm README renders correctly on public GitHub.
- [ ] Update platform docs if the repo URL changed.
- [ ] Add MCP Registry metadata after npm package stability is confirmed.
- [ ] Close or update release issue `https://github.com/y2-intel/mcp/issues/1`.

## Acceptance Criteria

The v0.1.0 MCP release is ready when:

- `@y2-intel/mcp` is published publicly on npm.
- The GitHub repo is public.
- Claude Code can install and connect using the npm command.
- Codex can install and connect using the npm command.
- Claude Desktop can connect using the documented JSON config.
- At least one live read-only smoke run passes with `reports,news`.
- Agent Y2 smoke is either verified or explicitly documented as requiring
  `agent:y2` and chat budget.
- No credential is accepted through MCP tool input.
- API errors are surfaced as structured MCP tool errors rather than server
  process crashes.

## Non-Goals For v0.1.0

- Hosted remote MCP server.
- OAuth-based per-user hosted MCP auth.
- Write/admin tools beyond what Agent Y2 can already do through scoped API
  behavior.
- Direct Convex access.
- Bundling private platform code into the MCP package.

## Future Work

- Hosted Streamable HTTP MCP server with OAuth.
- Per-user attribution for hosted agent sessions.
- MCP Registry submission after npm/public repo validation.
- Additional read-only tools for profiles, subscriptions, and usage if the API
  scopes and customer workflows justify them.
- More granular smoke fixtures for scope-denied, invalid-key, and rate-limit
  scenarios.
