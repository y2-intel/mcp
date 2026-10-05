import { z } from "zod";
import {
	backend,
	type ConnectionProps,
	type Env,
	noStore,
	propsSchema,
	READ_SCOPES,
	readBounded,
} from "./config";

interface LiveConnection {
	connectionId: string;
	workspaceName: string;
	resource: string;
	scopes: (typeof READ_SCOPES)[number][];
}

export async function resolveConnection(
	env: Env,
	propsValue: unknown,
	tokenScopes: string[],
): Promise<
	Response | { props: ConnectionProps; live: LiveConnection; scopes: string[] }
> {
	const invalidToken = () =>
		Response.json(
			{ error: "invalid_token" },
			{
				status: 401,
				headers: {
					...noStore,
					"WWW-Authenticate": `Bearer resource_metadata="${env.MCP_ORIGIN}/.well-known/oauth-protected-resource/mcp", error="invalid_token"`,
				},
			},
		);
	const parsed = propsSchema.safeParse(propsValue);
	if (!parsed.success) return invalidToken();
	const props = parsed.data;
	let live: LiveConnection;
	try {
		// Recheck connection revocation, membership and entitlements on every request.
		const connection = await backend(
			env,
			"/mcp/connection",
			undefined,
			props.apiKey,
		);
		if (connection.status === 429)
			return Response.json(
				{ error: "rate_limited" },
				{
					status: 429,
					headers: {
						...noStore,
						"Retry-After": (
							connection.headers.get("Retry-After") ?? "60"
						).slice(0, 128),
					},
				},
			);
		if (!connection.ok)
			return Response.json(
				{
					error:
						connection.status >= 500
							? "temporarily_unavailable"
							: "invalid_token",
				},
				{
					status: connection.status >= 500 ? 503 : 401,
					headers: {
						...noStore,
						...(connection.status < 500
							? {
									"WWW-Authenticate": `Bearer resource_metadata="${env.MCP_ORIGIN}/.well-known/oauth-protected-resource/mcp"`,
								}
							: {}),
					},
				},
			);
		const result = z
			.object({
				connectionId: z.string().max(100),
				workspaceName: z.string().max(200),
				resource: z.literal(`${env.MCP_ORIGIN}/mcp`),
				scopes: z.array(z.enum(READ_SCOPES)).max(6),
			})
			.safeParse(JSON.parse(await readBounded(connection.body, 8192)));
		if (!result.success || result.data.connectionId !== props.connectionId)
			return invalidToken();
		live = result.data;
	} catch {
		return Response.json(
			{ error: "temporarily_unavailable" },
			{ status: 503, headers: noStore },
		);
	}
	const scopes = [
		...new Set(
			tokenScopes.filter((scope) =>
				live.scopes.includes(scope as (typeof READ_SCOPES)[number]),
			),
		),
	];
	if (!scopes.length) return invalidToken();
	return { props, live, scopes };
}
