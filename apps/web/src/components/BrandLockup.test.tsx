import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BrandLockup } from "@/components/BrandLockup";

describe("BrandLockup responsive sizes", () => {
  it("keeps the compact masthead mark and labels legible", () => {
    const html = renderToStaticMarkup(<BrandLockup compact />);

    expect(html).toContain('h-10 w-10');
    expect(html).toContain('text-xs font-bold');
    expect(html).toContain('text-[10px] font-semibold');
    expect(html).toContain('Yayasan Sabilul Qur');
  });

  it("keeps the desktop lockup aligned to the larger shell proportion", () => {
    const html = renderToStaticMarkup(<BrandLockup />);

    expect(html).toContain('h-12 w-12');
    expect(html).toContain('text-base font-bold');
    expect(html).toContain('text-[11px] font-semibold');
  });
});
