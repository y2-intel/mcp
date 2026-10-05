import {
	OAuthError,
	type TokenExchangeCallbackOptions,
} from "@cloudflare/workers-oauth-provider";
import { z } from "zod";
import {
	backend,
	digest,
	type Env,
	noStore,
	propsSchema,
	readBounded,
} from "./config";

type Redemption = {
	credentialHash: string;
	grantId: string;
	clientId: string;
	resource: string;
	kind: "authorization_code" | "refresh_token";
	attemptId: string;
};
type Replay = Pick<
	Redemption,
	"credentialHash" | "clientId" | "resource" | "kind"
>;
const claimSchema = z.object({ status: z.literal("claimed") });
const spentSchema = z.object({ status: z.literal("spent") });
const replaySchema = z.object({ replayed: z.boolean() });

function tokenError(error: string, status: number): Response {
	return Response.json({ error }, { status, headers: noStore });
}

// This only extracts identity. The provider authenticates it before finish() can
// use it, including registered method, secret, malformed Basic, and mixed methods.
function presentedClientId(
	request: Request,
	form: URLSearchParams,
): string | undefined {
	const authorization = request.headers.get("Authorization");
	if (!authorization) return form.get("client_id") ?? undefined;
	const schemeEnd = authorization.search(/[ \t]/);
	const scheme =
		schemeEnd === -1 ? authorization : authorization.slice(0, schemeEnd);
	if (scheme.toLowerCase() !== "basic")
		return form.get("client_id") ?? undefined;
	if (schemeEnd === -1 || form.has("client_id") || form.has("client_secret"))
		return undefined;
	const encoded = authorization.slice(schemeEnd).trim();
	if (!encoded || /[ \t]/.test(encoded)) return undefined;
	try {
		const credentials = atob(encoded);
		const separator = credentials.indexOf(":");
		return separator === -1
			? undefined
			: decodeURIComponent(credentials.slice(0, separator).replace(/\+/g, " "));
	} catch {
		return undefined;
	}
}

export async function prepareTokenRequest(request: Request, env: Env) {
	let providerRequest = request;
	let credentialHash: string | undefined;
	let kind: Redemption["kind"] | undefined;
	let claimed: { payload: Redemption; apiKey: string } | undefined;
	let replay: Replay | undefined;
	if (
		new URL(request.url).pathname === "/oauth/token" &&
		request.method === "POST" &&
		request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ===
			"application/x-www-form-urlencoded"
	) {
		let text: string;
		try {
			text = await readBounded(request.body, 16_384);
			// Consume the bounded body once. A cloned stream can retain an unread
			// tee branch and block cancellation of an oversized network request.
			providerRequest = new Request(request, { body: text });
		} catch {
			return { preflight: tokenError("invalid_request", 400) };
		}
		const form = new URLSearchParams(text);
		for (const name of new Set(form.keys())) {
			if (name !== "resource" && form.getAll(name).length !== 1)
				return { preflight: tokenError("invalid_request", 400) };
		}
		const grantType = form.get("grant_type");
		if (grantType === "authorization_code" || grantType === "refresh_token") {
			if (
				grantType === "authorization_code" &&
				!/^[A-Za-z0-9._~-]{43,128}$/.test(form.get("code_verifier") ?? "")
			)
				return { preflight: tokenError("invalid_request", 400) };
			kind = grantType;
			const credential = form.get(
				kind === "refresh_token" ? "refresh_token" : "code",
			);
			if (credential) credentialHash = await digest(credential);
			const clientId = presentedClientId(request, form);
			const resources = form.getAll("resource");
			if (
				resources.length > 1 ||
				(resources.length === 1 && resources[0] !== `${env.MCP_ORIGIN}/mcp`)
			)
				return { preflight: tokenError("invalid_target", 400) };
			if (credentialHash && clientId && resources.length <= 1) {
				replay = {
					credentialHash,
					clientId,
					resource: resources[0] ?? `${env.MCP_ORIGIN}/mcp`,
					kind,
				};
			}
		}
	}
	return {
		request: providerRequest,
		callback: async (options: TokenExchangeCallbackOptions<Env>) => {
			if (!credentialHash || !kind || options.grantType !== kind)
				throw new OAuthError("invalid_grant", {
					description: "Start a new connection.",
				});
			const props = propsSchema.parse(options.props);
			const payload: Redemption = {
				credentialHash,
				grantId: options.grantId,
				clientId: options.clientId,
				resource: options.resource,
				kind,
				attemptId: crypto.randomUUID(),
			};
			const response = await backend(
				env,
				"/mcp/connection/redeem",
				{ ...payload, scopes: options.requestedScope },
				props.apiKey,
			);
			if (
				response.status === 409 ||
				response.status >= 500 ||
				response.status === 429
			)
				throw new OAuthError("temporarily_unavailable", {
					description: "A token exchange is in progress. Retry shortly.",
					statusCode: 503,
				});
			if (!response.ok)
				throw new OAuthError("invalid_grant", {
					description: "Reconnect your Y2 workspace.",
				});
			claimSchema.parse(JSON.parse(await readBounded(response.body, 1024)));
			claimed = { payload, apiKey: props.apiKey };
		},
		finish: async (response: Response): Promise<Response> => {
			if (!claimed) {
				// Spent codes and old refresh tokens can fail before the callback. An invalid_grant
				// response proves client authentication passed; invalid_client must never
				// let an attacker revoke a confidential client's connection.
				if (replay && response.status === 400) {
					const body = await readBounded(response.body, 4096);
					const error = z
						.object({ error: z.string() })
						.safeParse(JSON.parse(body));
					if (error.success && error.data.error === "invalid_grant") {
						const rejected = await backend(
							env,
							"/mcp/connection/replay",
							replay,
						);
						if (!rejected.ok) return tokenError("temporarily_unavailable", 503);
						replaySchema.parse(
							JSON.parse(await readBounded(rejected.body, 1024)),
						);
					}
					return new Response(body, {
						status: response.status,
						headers: response.headers,
					});
				}
				return response;
			}
			if (!response.ok) {
				// A concrete provider rejection emitted no tokens. Only this attempt may release.
				await backend(
					env,
					"/mcp/connection/release",
					claimed.payload,
					claimed.apiKey,
				);
				return response;
			}
			// No token bytes may reach the client before the atomic ledger is committed.
			const body = await readBounded(response.body, 16_384);
			const finalized = await backend(
				env,
				"/mcp/connection/finalize",
				claimed.payload,
				claimed.apiKey,
			);
			if (!finalized.ok)
				return tokenError(
					finalized.status >= 500 ? "temporarily_unavailable" : "invalid_grant",
					finalized.status >= 500 ? 503 : 400,
				);
			spentSchema.parse(JSON.parse(await readBounded(finalized.body, 1024)));
			return new Response(body, {
				status: response.status,
				headers: response.headers,
			});
		},
	};
}
