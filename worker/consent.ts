import {
	AuthorizationError,
	CimdFetchError,
} from "@cloudflare/workers-oauth-provider";
import { z } from "zod";
import {
	backend,
	digest,
	type Env,
	noStore,
	READ_SCOPES,
	randomHex,
	readBounded,
} from "./config";

const pendingSchema = z.object({
	handle: z.string(),
	verifier: z.string(),
	requestId: z.string(),
	clientId: z.string(),
	clientName: z.string(),
	clientDomain: z.string().optional(),
	redirectHost: z.string(),
	redirectIsLoopback: z.boolean(),
	resource: z.string(),
	scopes: z.array(z.string()),
	expiresAt: z.number(),
});
const completionSchema = z
	.object({
		requestId: z.string().regex(/^[a-f0-9]{64}$/),
		decision: z.enum(["approve", "deny"]),
		code: z
			.string()
			.regex(/^y2_[a-f0-9]{64}$/)
			.optional(),
	})
	.strict();
const exchangeSchema = z.object({
	apiKey: z.string(),
	connectionId: z.string(),
	userId: z.string(),
	workspaceName: z.string(),
	scopes: z.array(z.string()),
});
const pageHeaders = {
	...noStore,
	"Content-Type": "text/html; charset=utf-8",
	"X-Frame-Options": "DENY",
	"Content-Security-Policy":
		"default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
};
const finishHtml =
	'<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Connect Y2 Intel</title><main><h1>Connect Y2 Intel</h1><p id="status" role="status">Completing your connection…</p><a href="https://y2.dev/app/settings/connections">Manage connections</a></main><script src="/oauth/finish.js" defer></script></html>';
const finishJs = `"use strict"; (async () => { const p = new URLSearchParams(location.hash.slice(1)); history.replaceState(null, "", location.pathname); const status = document.getElementById("status"); try { const response = await fetch("/oauth/complete", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ requestId: p.get("request"), decision: p.get("decision"), ...(p.get("code") ? {code:p.get("code")} : {}) }) }); if (!response.ok) throw new Error(); const result = await response.json(); location.replace(result.redirectTo); } catch { status.textContent = "This connection could not be completed. Return to your assistant and start a new connection."; } })();`;

export async function consentRoutes(
	request: Request,
	env: Env,
): Promise<Response> {
	const url = new URL(request.url);
	const cors: Record<string, string> =
		request.headers.get("Origin") === env.Y2_ORIGIN
			? { "Access-Control-Allow-Origin": env.Y2_ORIGIN, Vary: "Origin" }
			: {};
	if (url.pathname === "/authorize" && request.method === "GET") {
		try {
			const auth = await env.OAUTH_PROVIDER.parseAuthRequest(request);
			// The provider makes PKCE optional for confidential clients. Native Y2
			// connections require OAuth 2.1 S256 protection for every client.
			if (
				auth.codeChallengeMethod !== "S256" ||
				!auth.codeChallenge ||
				!/^[A-Za-z0-9_-]{43}$/.test(auth.codeChallenge)
			)
				return Response.json(
					{
						error: "invalid_request",
						error_description: "PKCE S256 is required.",
					},
					{ status: 400, headers: noStore },
				);
			// OAuth permits clients to omit scope. The consent page still requires
			// explicit workspace and permission approval, limited by entitlements.
			if (!url.searchParams.has("scope")) auth.scope = [...READ_SCOPES];
			const details = await env.OAUTH_PROVIDER.describeConsent(auth);
			if (
				auth.resource !== `${env.MCP_ORIGIN}/mcp` ||
				!details.scope.some((scope) => READ_SCOPES.some((s) => s === scope)) ||
				details.scope.some(
					(scope) =>
						scope !== "offline_access" && !READ_SCOPES.some((s) => s === scope),
				)
			)
				return Response.json(
					{ error: "invalid_scope" },
					{ status: 400, headers: noStore },
				);
			const consent = await env.OAUTH_PROVIDER.beginConsent(auth);
			const requestId = randomHex();
			await env.OAUTH_KV.put(
				`y2:pending:${requestId}`,
				JSON.stringify({
					handle: consent.handle,
					verifier: randomHex(),
					requestId,
					clientId: details.clientId,
					clientName: details.clientName.slice(0, 200),
					clientDomain: details.clientDomain,
					redirectHost: details.redirectHost,
					redirectIsLoopback: details.redirectIsLoopback,
					resource: auth.resource,
					scopes: details.scope,
					expiresAt: Date.now() + 600_000,
				}),
				{ expirationTtl: 600 },
			);
			consent.headers.set(
				"Location",
				`${env.Y2_ORIGIN}/app/settings/connections?request=${requestId}`,
			);
			return new Response(null, { status: 302, headers: consent.headers });
		} catch (error) {
			if (error instanceof AuthorizationError && error.redirectTo)
				return Response.redirect(error.redirectTo, 302);
			if (
				error instanceof AuthorizationError ||
				error instanceof CimdFetchError
			)
				return Response.json(
					{ error: "invalid_request" },
					{ status: 400, headers: noStore },
				);
			throw error;
		}
	}
	if (url.pathname.startsWith("/oauth/request/") && request.method === "GET") {
		const requestId = url.pathname.slice("/oauth/request/".length);
		if (!/^[a-f0-9]{64}$/.test(requestId))
			return new Response(null, { status: 404, headers: noStore });
		const pending = pendingSchema.safeParse(
			await env.OAUTH_KV.get(`y2:pending:${requestId}`, "json"),
		);
		if (!pending.success || pending.data.expiresAt <= Date.now())
			return new Response(null, {
				status: 404,
				headers: { ...noStore, ...cors },
			});
		const { handle: _handle, verifier, ...details } = pending.data;
		return Response.json(
			{ ...details, challenge: await digest(verifier) },
			{ headers: { ...noStore, ...cors } },
		);
	}
	if (url.pathname === "/oauth/finish" && request.method === "GET")
		return new Response(finishHtml, { headers: pageHeaders });
	if (url.pathname === "/oauth/finish.js" && request.method === "GET")
		return new Response(finishJs, {
			headers: { ...noStore, "Content-Type": "text/javascript; charset=utf-8" },
		});
	if (url.pathname === "/oauth/complete" && request.method === "POST") {
		if (
			request.headers.get("Origin") !== env.MCP_ORIGIN ||
			request.headers.get("content-type")?.split(";")[0] !== "application/json"
		)
			return new Response(null, { status: 403, headers: noStore });
		try {
			const input = completionSchema.parse(
				JSON.parse(await readBounded(request.body, 2048)),
			);
			const pending = pendingSchema.parse(
				await env.OAUTH_KV.get(`y2:pending:${input.requestId}`, "json"),
			);
			if (pending.expiresAt <= Date.now()) throw new Error("Expired");
			if (input.decision === "deny") {
				const denied = await env.OAUTH_PROVIDER.denyConsent(
					request,
					pending.handle,
				);
				await env.OAUTH_KV.delete(`y2:pending:${input.requestId}`);
				const redirectTo = denied.headers.get("Location");
				if (!redirectTo) throw new Error("Missing redirect");
				denied.headers.delete("Location");
				denied.headers.set("Content-Type", "application/json");
				return new Response(JSON.stringify({ redirectTo }), {
					headers: denied.headers,
				});
			}
			// Authenticate the original browser before consuming the one-use Y2 ticket.
			const approved = await env.OAUTH_PROVIDER.approveConsent(
				request,
				pending.handle,
			);
			const response = await backend(env, "/mcp/connection/exchange", {
				requestId: input.requestId,
				code: input.code,
				verifier: pending.verifier,
			});
			if (!response.ok) throw new Error("Approval rejected");
			const connection = exchangeSchema.parse(
				JSON.parse(await readBounded(response.body, 8192)),
			);
			if (
				connection.scopes.length === 0 ||
				connection.scopes.some(
					(s) =>
						!pending.scopes.includes(s) || !READ_SCOPES.some((r) => r === s),
				)
			)
				throw new Error("Invalid granted scope");
			const scope = [
				...connection.scopes,
				...(pending.scopes.includes("offline_access")
					? ["offline_access"]
					: []),
			];
			const { redirectTo } = await env.OAUTH_PROVIDER.completeAuthorization({
				request: approved.request,
				userId: connection.userId,
				metadata: { connectionId: connection.connectionId },
				scope,
				props: {
					apiKey: connection.apiKey,
					connectionId: connection.connectionId,
					workspaceName: connection.workspaceName,
				},
				revokeExistingGrants: false,
			});
			await env.OAUTH_KV.delete(`y2:pending:${input.requestId}`);
			approved.headers.set("Content-Type", "application/json");
			return new Response(JSON.stringify({ redirectTo }), {
				headers: approved.headers,
			});
		} catch {
			return Response.json(
				{ error: "invalid_grant" },
				{ status: 400, headers: noStore },
			);
		}
	}
	return new Response("Not found", { status: 404, headers: noStore });
}
