import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const sourceFiles = [
  new URL("./WorkspaceApp.tsx", import.meta.url),
  new URL("./WorkspaceShell.tsx", import.meta.url),
  new URL("./main.tsx", import.meta.url),
  new URL("./components/AccountMenu.tsx", import.meta.url),
];

describe("browser authentication storage guardrail", () => {
  it("does not implement OIDC token or code persistence in browser storage", async () => {
    for (const file of sourceFiles) {
      const source = await readFile(fileURLToPath(file), "utf8");
      expect(source).not.toContain("localStorage");
      expect(source).not.toContain("sessionStorage");
      expect(source).not.toMatch(/access[_-]?token/i);
      expect(source).not.toMatch(/refresh[_-]?token/i);
      expect(source).not.toMatch(/id[_-]?token/i);
    }
  });
});
