import { build } from "esbuild";
import { readdir, readFile, writeFile, mkdir, copyFile } from "node:fs/promises";

// Include the local SDK in published artifacts: no file: dependency escapes.
await build({
  entryPoints: ["src/cli.ts", "src/index.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  sourcemap: true,
  packages: "external",
  alias: { "hinge-ts": "../sdk/dist/index.js" }
});

await mkdir("dist/sdk", { recursive: true });
for (const name of await readdir("../sdk/dist")) {
  if (name.endsWith(".d.ts")) await copyFile(`../sdk/dist/${name}`, `dist/sdk/${name}`);
}
for (const name of await readdir("dist")) {
  if (name.endsWith(".d.ts")) {
    const path = `dist/${name}`;
    await writeFile(path, (await readFile(path, "utf8")).replaceAll('"hinge-ts"', '"./sdk/index.js"'));
  }
}
await copyFile("../LICENSE-MIT", "LICENSE-MIT");
