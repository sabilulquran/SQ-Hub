// Regenerate a synthetic golden fixture using the actual pinned HCIS producer.
// Requires authenticated gh and installed workspace dependencies. No live API/data.
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import ts from "typescript";

const head = "f66fe8597b16c36af98cc1bf56230cbe5bef221e";
function source(path) {
  return execFileSync("gh", ["api", "-H", "Accept: application/vnd.github.raw+json",
    `repos/sabilulquran/hcisysq/contents/${path}?ref=${head}`], { encoding: "utf8" });
}
function withoutImports(text) {
  const ast = ts.createSourceFile("fixture.ts", text, ts.ScriptTarget.Latest, true);
  return ast.statements.filter((s) => !ts.isImportDeclaration(s)).map((s) => s.getText(ast)).join("\n");
}
const contract = source("apps/api/src/modules/organization-directory/contract.ts");
const producer = source("apps/api/src/modules/organization-directory/producer.ts");
const tests = source("apps/api/test/organization-directory-producer.test.ts");
const code = [
  `import { z } from ${JSON.stringify(import.meta.resolve("zod"))};`,
  'import { createHash } from "node:crypto";',
  'function jakartaBusinessDate(d) { return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jakarta", year: "numeric", month: "2-digit", day: "2-digit" }).format(d); }',
  withoutImports(contract),
  withoutImports(producer.slice(0, producer.indexOf("export async function loadOrganizationDirectorySnapshot"))),
  withoutImports(tests.slice(0, tests.indexOf('describe("ORG-006'))),
  `export const fixture = buildOrganizationDirectorySnapshot({
    snapshot: sourceSnapshot(), employees: employees(),
    identities: [{ employeeId: ids.employeeOne, issuer: "https://identity.example.test/realms/demo", subject: "opaque-demo-subject" }],
    asOf: "2026-09-24", generatedAt: "2026-09-24T01:30:00.000Z"
  });`,
].join("\n");
const js = ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const { fixture } = await import(`data:text/javascript;base64,${Buffer.from(js).toString("base64")}`);
const dir = new URL("../apps/api/test/fixtures/", import.meta.url);
await mkdir(dir, { recursive: true });
await writeFile(new URL("hcis-organization-directory-v1.json", dir), JSON.stringify(fixture, null, 2) + "\n");
console.log(JSON.stringify({ producerHead: head, version: fixture.version, counts: fixture.counts }));
