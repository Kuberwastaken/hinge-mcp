import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import type { HingeStorage } from "hinge-ts";

/**
 * File-backed HingeStorage for Node. Keys are treated as paths: absolute keys
 * are used as-is, relative keys resolve inside `baseDir`.
 */
export class FileStorage implements HingeStorage {
  constructor(private readonly baseDir: string) {}

  resolvePath(key: string): string {
    return isAbsolute(key) ? key : resolve(this.baseDir, key);
  }

  async exists(key: string): Promise<boolean> {
    try {
      await stat(this.resolvePath(key));
      return true;
    } catch {
      return false;
    }
  }

  async readText(key: string): Promise<string | undefined> {
    try {
      return await readFile(this.resolvePath(key), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return undefined;
      }
      throw error;
    }
  }

  async writeText(key: string, value: string): Promise<void> {
    const path = this.resolvePath(key);
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, value, { encoding: "utf8", mode: 0o600 });
  }

  async remove(key: string): Promise<void> {
    await rm(this.resolvePath(key), { force: true });
  }
}
