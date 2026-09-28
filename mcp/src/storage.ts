import { mkdir, open, readFile, rename, rm, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { randomUUID } from "node:crypto";
import type { HingeStorage } from "hinge-ts";

/** Private, atomic files, confined to the configured account directory. */
export class FileStorage implements HingeStorage {
  constructor(private readonly baseDir: string) {}
  resolvePath(key: string): string {
    const path = resolve(this.baseDir, key);
    const rel = relative(resolve(this.baseDir), path);
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`))
      throw new Error("Storage path escapes the account directory");
    return path;
  }
  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolvePath(key));
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }
  async readText(key: string): Promise<string | undefined> {
    try {
      return await readFile(this.resolvePath(key), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }
  async writeText(key: string, value: string): Promise<void> {
    const path = this.resolvePath(key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    const temp = `${path}.${randomUUID()}.tmp`;
    try {
      const file = await open(temp, "wx", 0o600);
      try {
        await file.writeFile(value, "utf8");
        await file.sync();
      } finally {
        await file.close();
      }
      await rename(temp, path);
    } finally {
      await rm(temp, { force: true });
    }
  }
  async remove(key: string): Promise<void> {
    await rm(this.resolvePath(key), { force: true });
  }
}
