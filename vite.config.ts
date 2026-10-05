import { defineConfig } from "vite";

export default defineConfig(({ command }) => {
	const origin = new URL(
		process.env.MCP_UI_ORIGIN ??
			"https://y2-intel-mcp.managed-services.workers.dev",
	);
	if (
		origin.protocol !== "https:" ||
		origin.pathname !== "/" ||
		origin.search ||
		origin.hash ||
		origin.username ||
		origin.password
	)
		throw new Error("MCP_UI_ORIGIN must be a canonical HTTPS origin");
	return {
		root: "ui",
		base: command === "serve" ? "/" : `${origin.origin}/`,
		publicDir: "public",
		worker: { format: "es" },
		build: { outDir: "../dist-ui", emptyOutDir: true, sourcemap: false },
	};
});
