import { spawnSync } from "node:child_process";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const dir = await mkdtemp(join(tmpdir(), "hinge-package-"));
function run(args, cwd = root, env = process.env) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    env,
    encoding: "utf8",
    timeout: 120_000,
    windowsHide: true,
  });
  if (result.status !== 0)
    throw new Error(result.error?.message ?? result.stdout + result.stderr);
  return result.stdout;
}
try {
  if (!process.env.npm_execpath)
    throw new Error("Run via npm run test:package");
  const packed = JSON.parse(
    run([
      process.env.npm_execpath,
      "pack",
      "--workspace",
      "mcp",
      "--pack-destination",
      dir,
      "--json",
      "--ignore-scripts",
    ]),
  );
  const files = packed[0].files.map((f) => f.path);
  for (const required of ["README.md", "AGENTS.md", "assets/hero.png"])
    if (!files.includes(required))
      throw new Error(`Missing packaged documentation asset: ${required}`);
  if (files.some((f) => /session\.json|^test\/|^src\/|\.env$/.test(f)))
    throw new Error("Unexpected private/development files in package");
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: "hinge-package-smoke",
      private: true,
      type: "module",
    }),
  );
  run(
    [
      process.env.npm_execpath,
      "install",
      "--omit=dev",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      join(dir, packed[0].filename),
    ],
    dir,
  );
  run(
    [
      "--input-type=module",
      "-e",
      'const m=await import("hinge-mcp"); if(m.SERVER_VERSION!=="0.2.0") throw Error("bad version");',
    ],
    dir,
  );
  const cli = join(dir, "node_modules", "hinge-mcp", "dist", "cli.js");
  if (run([cli, "--version"], dir).trim() !== "0.2.0")
    throw new Error("Installed binary version mismatch");
  process.stdout.write(
    run(["--test", join(root, "mcp", "test", "e2e.test.mjs")], dir, {
      ...process.env,
      HINGE_MCP_TEST_CLI: cli,
    }),
  );
  process.stdout.write(
    `Standalone tarball verified (${files.length} files; ${packed[0].size} bytes).\n`,
  );
} finally {
  await rm(dir, { recursive: true, force: true });
}
