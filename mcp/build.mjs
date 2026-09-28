import { build } from "esbuild";

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
