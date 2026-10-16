import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrandLockup } from "@/components/BrandLockup";

describe("BrandLockup", () => {
  it("shows the star mark, the app name without SQ and the gold foundation wordmark in the masthead", () => {
    const html = renderToStaticMarkup(<BrandLockup compact />);

    expect(html).toContain("h-9 w-9");
    expect(html).toContain(">Hub</p>");
    expect(html).toContain('aria-label="SQ Hub · Yayasan Sabilul Qur&#x27;an"');
    expect(html).toContain("sq-wordmark-gold");
    expect(html).toContain('alt="Yayasan Sabilul Qur&#x27;an"');
  });

  it("uses the larger proportion outside the masthead", () => {
    const html = renderToStaticMarkup(<BrandLockup />);

    expect(html).toContain("h-11 w-11");
    expect(html).toContain("text-base font-extrabold");
    expect(html).toContain("h-4 w-auto");
  });
});
