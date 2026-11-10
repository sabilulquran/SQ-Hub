import { describe, expect, it } from "vitest";

import { loadKerjaConfig } from "../src/modules/kerja/config.js";
import { sanitizeHtml, safeHref } from "../src/modules/kerja/html.js";
import { detectKind, safeFilename } from "../src/modules/kerja/lampiran.js";
import { jakartaDate, jakartaHour } from "../src/modules/kerja/ruang.js";

const PERSON = "hcis:employee:00000000-0000-4000-8000-000000000001";

describe("KERJA-IMPL-001 §10 nomor 2: pasted HTML is cleaned", () => {
  it("drops script and style with their content", () => {
    const result = sanitizeHtml("<p>Halo<script>alert(1)</script><style>p{}</style></p>");
    expect(result.html).toBe("<p>Halo</p>");
    expect(result.text).toBe("Halo");
  });

  it("drops on* attributes, style and class", () => {
    expect(sanitizeHtml(`<p onclick="x()" style="color:red" class="a">a</p><img src=x onerror=alert(1)>`).html).toBe("<p>a</p>");
  });

  it("keeps only http(s) and mailto links", () => {
    expect(sanitizeHtml(`<a href="javascript:alert(1)">x</a>`).html).toBe("x");
    expect(sanitizeHtml(`<a href="java&#x09;script:alert(1)">x</a>`).html).toBe("x");
    expect(sanitizeHtml(`<a href=" JaVaScRiPt:alert(1)">x</a>`).html).toBe("x");
    expect(sanitizeHtml(`<a href="data:text/html,hi">x</a>`).html).toBe("x");
    expect(sanitizeHtml(`<a href="https://sabilulquran.or.id/?a=1&amp;b=2">x</a>`).html)
      .toBe(`<a href="https://sabilulquran.or.id/?a=1&amp;b=2" rel="noopener noreferrer nofollow" target="_blank">x</a>`);
    expect(safeHref("mailto:hcm@sabilulquran.or.id")).toBe("mailto:hcm@sabilulquran.or.id");
  });

  it("cleans HTML pasted from Word", () => {
    const word = `<!--[if gte mso 9]><xml><w:WordDocument></w:WordDocument></xml><![endif]-->
      <p class=MsoNormal style='mso-line-height-alt:12pt'><b>Rapat</b> <span style='font-family:Calibri'>kerja</span><o:p></o:p></p>`;
    const result = sanitizeHtml(word);
    expect(result.html).toBe("\n      <p><strong>Rapat</strong> kerja</p>");
    expect(result.text).toBe("Rapat kerja");
  });

  it("escapes stray brackets and decoded entities instead of opening tags", () => {
    expect(sanitizeHtml("a < b &lt;script&gt;").html).toBe("a &lt; b &lt;script&gt;");
    expect(sanitizeHtml("<p>x").html).toBe("<p>x</p>");
    expect(sanitizeHtml("</p></ul>x<li>").html).toBe("x<li></li>");
    expect(sanitizeHtml("<scr<script>ipt>alert(1)</script>").html).not.toContain("<script");
  });

  it("keeps mentions only for people the room allows", () => {
    const html = `<span data-sebut="${PERSON}">@Fulan</span> <span data-sebut="hcis:employee:00000000-0000-4000-8000-000000000009">@Lain</span>`;
    const result = sanitizeHtml(html, (id) => id === PERSON);
    expect(result.html).toBe(`<span data-sebut="${PERSON}">@Fulan</span> @Lain`);
    expect(result.mentions).toEqual([PERSON]);
  });
});

describe("KERJA-IMPL-001 §9: attachment kinds from the first bytes", () => {
  it("recognises allowed kinds and rejects disguised executables", () => {
    expect(detectKind(Buffer.from("%PDF-1.7\n"), "a.pdf")).toBe("application/pdf");
    expect(detectKind(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "a.png")).toBe("image/png");
    expect(detectKind(Buffer.from([0x50, 0x4b, 0x03, 0x04]), "laporan.docx")).toMatch(/wordprocessingml/);
    expect(detectKind(Buffer.from("nama,nilai\nA,1\n"), "data.csv")).toBe("text/csv");
    expect(detectKind(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]), "surat.pdf")).toBeNull();
    expect(detectKind(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), "macro.exe")).toBeNull();
  });

  it("never lets a file name become a path", () => {
    expect(safeFilename("../../etc/passwd")).toBe("passwd");
    expect(safeFilename("C:\\Users\\x\\Laporan Mei.pdf")).toBe("Laporan Mei.pdf");
    expect(safeFilename("\u0000")).toBe("berkas");
  });
});

describe("KERJA-IMPL-001 §11 configuration", () => {
  it("is off by default and needs the OIDC client and media root when on", () => {
    expect(loadKerjaConfig({})).toBeNull();
    expect(() => loadKerjaConfig({ KERJA_ENABLED: "true" })).toThrow(/required/);
    const config = loadKerjaConfig({
      KERJA_ENABLED: "true", KERJA_OIDC_CLIENT_ID: "kerja-sq", KERJA_OIDC_CLIENT_SECRET: "test-secret",
      KERJA_PUBLIC_ORIGIN: "https://kerja.sabilulquran.or.id/", KERJA_MEDIA_ROOT: "/srv/sq-hub/kerja-media",
    })!;
    expect(config.publicOrigin).toBe("https://kerja.sabilulquran.or.id");
    expect(config.maxUploadBytes).toBe(25 * 1024 * 1024);
    // D-6: 1 GB per room by default.
    expect(config.roomQuotaBytes).toBe(1024 * 1024 * 1024);
    expect(config.minFreeDiskBytes).toBe(10 * 1024 * 1024 * 1024);
  });
});

describe("Asia/Jakarta dates", () => {
  it("rolls over at midnight WIB, not UTC", () => {
    expect(jakartaDate(new Date("2026-11-10T16:59:00Z"))).toBe("2026-11-10");
    expect(jakartaDate(new Date("2026-11-10T17:00:00Z"))).toBe("2026-11-11");
    expect(jakartaHour(new Date("2026-11-10T22:00:00Z"))).toBe(5);
  });
});
