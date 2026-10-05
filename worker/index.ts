import OAuthProvider, {
	type OAuthResourceContext,
} from "@cloudflare/workers-oauth-provider";
import { type Env, noStore, READ_SCOPES, readBounded } from "./config";
import { consentRoutes } from "./consent";
import { prepareTokenRequest } from "./tokens";
import { nativeMcp } from "./tools";

export default {
	async fetch(
		request: Request,
		env: Env,
		ctx: ExecutionContext,
	): Promise<Response> {
		const url = new URL(request.url);
		if (url.origin !== env.MCP_ORIGIN)
			return new Response("Unknown origin", { status: 421, headers: noStore });
		if (url.pathname === "/health" && request.method === "GET")
			return Response.json(
				{ service: "Y2 Intel", version: "0.3.0", status: "ok" },
				{ headers: noStore },
			);
		if (
			url.pathname.startsWith("/assets/") ||
			url.pathname === "/world.geojson" ||
			url.pathname === "/logo.svg" ||
			url.pathname === "/logo.png"
		) {
			const response = await env.ASSETS.fetch(request);
			const headers = new Headers(response.headers);
			headers.set("Access-Control-Allow-Origin", "*");
			headers.set("X-Content-Type-Options", "nosniff");
			return new Response(response.body, { status: response.status, headers });
		}
		try {
			if (
				env.REQUEST_LIMITER &&
				(url.pathname === "/authorize" || url.pathname.startsWith("/oauth/"))
			) {
				const allowed = await env.REQUEST_LIMITER.limit({
					key: request.headers.get("CF-Connecting-IP") ?? "unknown",
				});
				if (!allowed.success)
					return Response.json(
						{ error: "rate_limited" },
						{ status: 429, headers: { ...noStore, "Retry-After": "60" } },
					);
			}
			if (url.pathname === "/oauth/register" && request.method === "POST") {
				let body: string;
				try {
					body = await readBounded(request.body, 16_384);
				} catch {
					return Response.json(
						{ error: "invalid_client_metadata" },
						{ status: 400, headers: noStore },
					);
				}
				request = new Request(request.url, {
					method: request.method,
					headers: request.headers,
					body,
				});
			}
			const token = await prepareTokenRequest(request, env);
			if (token.preflight) return token.preflight;
			const provider = new OAuthProvider<Env>({
				apiRoute: "/mcp",
				apiHandler: {
					fetch: (req, bindings, context) =>
						nativeMcp(
							req,
							bindings,
							context.props,
							(context as OAuthResourceContext<unknown>).auth.scope,
						),
				},
				defaultHandler: { fetch: consentRoutes },
				authorizeEndpoint: "/authorize",
				tokenEndpoint: "/oauth/token",
				clientRegistrationEndpoint: "/oauth/register",
				clientIdMetadataDocumentEnabled: true,
				scopesSupported: [...READ_SCOPES, "offline_access"],
				resourceMetadata: {
					resource: `${env.MCP_ORIGIN}/mcp`,
					authorization_servers: [env.MCP_ORIGIN],
					resource_name: "Y2 Intel",
					scopes_supported: [...READ_SCOPES],
				},
				accessTokenTTL: 900,
				refreshTokenTTL: 2_592_000,
				allowTokenExchangeGrant: false,
				tokenExchangeCallback: token.callback,
			});
			const response = await provider.fetch(token.request, env, ctx);
			return token.finish ? await token.finish(response) : response;
		} catch {
			return Response.json(
				{ error: "temporarily_unavailable" },
				{ status: 503, headers: noStore },
			);
		}
	},
} satisfies ExportedHandler<Env>;
