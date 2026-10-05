# Native integration release operations

Display name: **Y2 Intel**. Package identifier: `y2-intel`. Hosted version: `0.3.0`.

## Service and ownership

- Worker and OAuth issuer: `https://y2-intel-mcp.managed-services.workers.dev`.
- Streamable HTTP endpoint and OAuth resource: `/mcp` on that origin.
- UI: same dedicated integration origin, with self-hosted scripts and Natural Earth geometry.
- Account/consent UI: `https://y2.dev/app/settings/connections`.
- Backend: existing Y2 API at `https://api.y2.dev`.

The Worker runs in Y2's existing Cloudflare Shared Services account. The selected account
cannot manage the `y2.dev` DNS zone, so this release uses its stable `workers.dev` hostname.
A future hostname migration changes the OAuth issuer/resource and requires fresh connections.
Do not silently redirect bearer tokens or keep two interchangeable authorization audiences.

## Security and data handling

The maintained Cloudflare OAuth provider stores encrypted grant properties in KV. A
connection-specific, read-only Y2 key is stored there and never returned to the assistant.
Convex binds that key to the user, workspace, connection, client, scopes, and expiry.
Every MCP request rechecks the backend connection. Existing API rate limits and plan checks
also apply; OAuth endpoints have a separate IP rate limit of 120 requests per minute.

PKCE S256, exact redirects, browser-bound consent, one-use authorization tickets, resource
binding, and a transactional redemption ledger protect authorization and refresh. A token
response is released only after the backend has finalized redemption. Ambiguous completion
fails closed. A shared gateway secret authenticates replay-revocation requests; it cannot read
workspace data by itself. Never add this secret or a user's credential to plugin files.

Access tokens last 15 minutes. Connections and refresh grants expire after 30 days; reconnect
to renew. Backend connection records are cleaned 30 days after expiry. Short-lived pending
consent and ticket records expire within minutes; replay tombstones remain through the grant
lifetime. Cleanup is bounded and scheduled. Disconnect immediately disables the backend key;
it does not remove content already in an assistant conversation.

The UI requests data through the host bridge. It has no bearer token, analytics, device GPS,
or external tile provider. Server-rendered intelligence remains untrusted text. Public country
codes describe queried areas; coordinates returned by the API describe public events.

## Validation and deployment

1. Platform: `bun run verify`, affected backend/frontend tests, and `bun run build`.
2. MCP: `npm ci`, `npm run release:check`, `npm run pack:plugins`, and
   `claude plugin validate ./plugins/claude`.
3. Configure the same random `MCP_GATEWAY_SECRET` (at least 32 characters) as a Convex
   production environment variable and Worker secret. Use protected files/stdin, never command
   arguments or checked-in configuration. Replay revocation fails closed without it; other
   lifecycle endpoints require the one-use ticket/verifier or connection-specific credential.
4. Deploy the platform backend and build the web app with the production Convex URL. Deploy
   that web artifact to the existing `y2-platform` Netlify site. Preserve generated sitemap output.
5. Run `npm run deploy:native`. Record the Worker version, KV namespace ID, both repository
   SHAs, Convex target, and Netlify deploy ID in the platform release evidence.
6. Check `/health`, both OAuth discovery documents, unauthenticated `401` with resource
   metadata, and the full production consent → tool → refresh → revoke flow.
7. Verify native views in actual Claude and ChatGPT. Local bridge fixtures prove browser
   rendering only; they do not prove host CSP, OAuth interoperability, or directory acceptance.

If auth/data isolation fails, disable the connector and revoke affected connections before
restoring service. Roll back to a previously recorded Worker version with `wrangler rollback`
and the corresponding backend/web release. Avoid rolling the backend behind the lifecycle
contract while a newer Worker remains active. Retain schema tables until stored grants expire;
do not delete authentication state as a rollback shortcut.

Inspect Cloudflare request/error metrics and Convex errors after deployment. Do not log tokens,
authorization codes, consent URLs, raw prompts, report bodies, or precise user locations.
Availability, latency, successful connections, and tool failure rates require measured
production windows; passing a smoke test does not establish the PRD's monthly targets.

## Reviewer setup

An internal platform action `mcp/review:provision` accepts a six-digit code and provisions only
`connector-review@y2.dev` in one isolated Elite review workspace. It creates two paused
profiles, two reports, and four synthetic signals labeled **REVIEW FIXTURE**. Sources are
Y2-owned documentation. It creates no subscriptions with a payment provider and runs no
intelligence generation. Existing mobile review credentials are unchanged.

Save the returned public IDs, timestamps, and private code in the release operator's secure
handoff. Reviewers sign in through Y2's normal email/code interface. Share the code only in
the providers' private reviewer fields. Do not commit it, include it in ZIPs, or publish it in
listing copy. Re-provisioning with the same code is idempotent; explicit `mcp/review:setCode`
rotates only this identity and invalidates its sessions.

Review scenarios are in the OpenAI manifest and platform PRD. Search profiles for “supply
chains”, inspect a report and its citations, render signals for the returned profile ID,
render the US public-event map, and explore an existing public entity. Map/entity coverage
varies with production feeds; an honest empty result is not a synthetic event. Verify denied
consent, missing permissions, revocation, inaccessible IDs, and the absence of write/GPS tools.

## Packages and provider publication

`npm run pack:plugins` produces two validated ZIPs and `dist-plugins/SHA256SUMS`.
The OpenAI ZIP has `plugin.json` and `mcp.json` at its root. The Claude bundle has
`.claude-plugin/plugin.json` and `.mcp.json`. Both contain the same owned logo, license,
README, and workflow skill. The repository also contains both marketplace manifests.

- Claude: `https://claude.ai/directory/manage`. Connect the live server, complete tools,
  listing, use cases, company, authentication, data handling, tests, and compliance steps.
  Submit the MCP connector and the public GitHub `plugins/claude` bundle; link the records.
- OpenAI: `https://platform.openai.com/plugins`. Use the verified Y2 publisher organization,
  upload the OpenAI ZIP, complete domain verification, private reviewer access, test cases,
  and a recording of the actual connection/native workflows. The recording is a separate
  required artifact; it is not simulated by the automated test fixture.
- npm: the existing manual Publish workflow runs the release gate and publishes with
  provenance. Verify the registry version after completion.

Required attestations are made by the owner on the concrete provider forms. A submitted
version is not an approval. An approval is not a public listing until the provider's publish
step succeeds. Record directory URLs and verify fresh-account installation before claiming
the PRD distribution gate complete. Use exact **Y2 Intel** display metadata everywhere.

Licensing: see [third-party notices](../THIRD_PARTY_NOTICES.md). Y2 branding and review
fixtures are owned by Y2; Natural Earth geometry is public domain. Production source excerpts
retain their original citations and are subject to the existing feed permissions. Do not
represent public availability alone as permission to redistribute source material.
