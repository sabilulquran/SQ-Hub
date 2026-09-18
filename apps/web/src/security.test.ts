import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const sourceRoot = fileURLToPath(new URL(".", import.meta.url));

async function collectRuntimeSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectRuntimeSourceFiles(path)));
      continue;
    }

    if (!entry.isFile()) continue;
    if (![".ts", ".tsx"].includes(extname(entry.name))) continue;
    if (/\.(?:test|spec)\.[^.]+$/.test(entry.name)) continue;

    files.push(path);
  }

  return files;
}

describe("browser authentication storage guardrail", () => {
  it("does not implement OIDC token, code, or transaction persistence anywhere in runtime web source", async () => {
    const sourceFiles = await collectRuntimeSourceFiles(sourceRoot);
    expect(sourceFiles.length).toBeGreaterThan(0);

    for (const file of sourceFiles) {
      const source = await readFile(file, "utf8");
      expect(source).not.toContain("localStorage");
      expect(source).not.toContain("sessionStorage");
      expect(source).not.toMatch(/access[_-]?token/i);
      expect(source).not.toMatch(/refresh[_-]?token/i);
      expect(source).not.toMatch(/id[_-]?token/i);
      expect(source).not.toMatch(/authorization[_-]?code/i);
      expect(source).not.toMatch(/pkce[_-]?(?:verifier|code[_-]?verifier)/i);
    }
  });
});
