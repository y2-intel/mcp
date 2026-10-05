import { z } from "zod";
import { digest, type Env } from "./config";
import {
	MAX_CURSOR_LENGTH,
	NativeDataError,
	type NativeKind,
	pageIdentity,
	present,
	readPage,
} from "./presentation";

// Some API filters read an oversized source window. Retain its offset rather than
// skipping rows when emitting a smaller native page. No result data is stored.
const nativeCursorSchema = z
	.object({
		v: z.literal(1),
		shape: z.string().max(2048),
		sourceCursor: z.string().max(8192).startsWith("y2p1_").nullable(),
		sourceLimit: z.number().int().min(1).max(50),
		offset: z.number().int().min(1).max(511),
		pageKey: z.string().regex(/^[a-f0-9]{64}$/),
	})
	.strict();
const CURSOR_PREFIX = "y2m1_";
function queryShape(path: string, args: Record<string, unknown>): string {
	const params = new URLSearchParams();
	for (const [key, value] of Object.entries(args)) {
		if (key !== "cursor" && key !== "limit" && value !== undefined) params.set(key, String(value));
	}
	params.sort();
	return `${path}?${params}`;
}
function nativeCursor(value: z.infer<typeof nativeCursorSchema>): string {
	const bytes = new TextEncoder().encode(JSON.stringify(value));
	const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
	const token =
		CURSOR_PREFIX + btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
	if (token.length > MAX_CURSOR_LENGTH) throw new NativeDataError("too_large");
	return token;
}
export function requestPage(path: string, args: Record<string, unknown>, kind: NativeKind) {
	const shape = queryShape(path, args);
	const requestedLimit = typeof args.limit === "number" ? args.limit : 1;
	const supplied = typeof args.cursor === "string" ? args.cursor : null;
	if (!supplied?.startsWith(CURSOR_PREFIX)) {
		if (supplied && (!supplied.startsWith("y2p1_") || supplied.length > 8192))
			throw new NativeDataError("invalid_cursor");
		return {
			shape,
			requestedLimit,
			sourceLimit: requestedLimit,
			sourceCursor: supplied,
			offset: 0,
			pageKey: null as string | null,
		};
	}
	try {
		const encoded = supplied.slice(CURSOR_PREFIX.length).replaceAll("-", "+").replaceAll("_", "/");
		const binary = atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, "="));
		const parsed = nativeCursorSchema.parse(
			JSON.parse(
				new TextDecoder().decode(Uint8Array.from(binary, (character) => character.charCodeAt(0))),
			),
		);
		if (parsed.shape !== shape || parsed.sourceLimit > (kind === "report" ? 5 : 50))
			throw new Error("Wrong cursor shape");
		return { ...parsed, requestedLimit };
	} catch {
		throw new NativeDataError("invalid_cursor");
	}
}
export async function presentPage(
	value: unknown,
	kind: NativeKind,
	env: Env,
	workspaceName: string,
	paging: ReturnType<typeof requestPage>,
) {
	const source = readPage(value, kind, env.API_ORIGIN);
	const pageKey = await digest(pageIdentity(source.rows, kind));
	if (paging.pageKey && (pageKey !== paging.pageKey || paging.offset >= source.rows.length)) {
		throw new NativeDataError("changed");
	}
	let count = Math.min(paging.requestedLimit, source.rows.length - paging.offset);
	for (;;) {
		const offset = paging.offset + count;
		const overflow = offset < source.rows.length;
		const nextCursor = overflow
			? nativeCursor({
					v: 1,
					shape: paging.shape,
					sourceCursor: paging.sourceCursor,
					sourceLimit: paging.sourceLimit,
					offset,
					pageKey,
				})
			: source.nextCursor;
		try {
			return present(
				{
					data: source.rows.slice(paging.offset, offset),
					meta: {
						nextCursor,
						hasMore: overflow || source.hasMore,
					},
				},
				kind,
				env.API_ORIGIN,
				workspaceName,
				env.Y2_ORIGIN,
			);
		} catch (error) {
			if (!(error instanceof NativeDataError) || error.reason !== "too_large" || count <= 1)
				throw error;
			count = Math.max(1, Math.floor(count / 2));
		}
	}
}
