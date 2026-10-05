import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

await import("./check-plugins.mjs");
const root = process.cwd();
const { version } = JSON.parse(await readFile("package.json", "utf8"));
const output = path.join(root, "dist-plugins");
await mkdir(output, { recursive: true });
const checksums = [];
for (const target of ["openai", "claude"]) {
	const source = path.join(root, "plugins", target);
	const name = `y2-intel-${target}-${version}.zip`;
	const archive = path.join(output, name);
	await rm(archive, { force: true });
	execFileSync("zip", ["-X", "-q", "-r", archive, ...(await readdir(source)).sort()], {
		cwd: source,
		stdio: "inherit",
	});
	const bytes = await readFile(archive);
	checksums.push(`${createHash("sha256").update(bytes).digest("hex")}  ${name}`);
	console.log(`${name}: ${bytes.length} bytes`);
}
await writeFile(path.join(output, "SHA256SUMS"), `${checksums.join("\n")}\n`);
