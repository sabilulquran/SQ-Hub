import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DetailDialog } from "@/components/DetailDialog";
import { DIALOG_PARAM_EVENT, useDialogParam } from "@/components/useDialogParam";

describe("DetailDialog (sq-core-app-shell.md: Detail views open as a pop-up)", () => {
  it("is a labelled modal dialog with its own header and close button when it has a title", () => {
    const html = renderToStaticMarkup(<DetailDialog title="Ubah aplikasi" description="hcis" onClose={() => undefined}><p>Isi</p></DetailDialog>);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-label="Ubah aplikasi"');
    expect(html).toContain("<h2");
    expect(html).toContain("hcis");
    // Backdrop and header button both close it.
    expect(html.match(/aria-label="Tutup"/g)).toHaveLength(2);
  });

  it("is a full-screen sheet below 768 px and a centred dialog of 720 px, or 960 px when wide, from 768 px", () => {
    const narrow = renderToStaticMarkup(<DetailDialog title="A" onClose={() => undefined}>x</DetailDialog>);
    expect(narrow).toContain("h-full w-full");
    expect(narrow).toContain("md:max-w-[720px]");
    expect(narrow).toContain("md:max-h-[90vh]");
    expect(narrow).not.toMatch(/\bsm:/);
    const wide = renderToStaticMarkup(<DetailDialog title="A" wide onClose={() => undefined}>x</DetailDialog>);
    expect(wide).toContain("md:max-w-[960px]");
  });

  it("keeps Kerja's usage: a label and no built-in header when the content brings its own", () => {
    const html = renderToStaticMarkup(<DetailDialog label="Kartu" onClose={() => undefined}><button type="button">Tutup kartu</button></DetailDialog>);
    expect(html).toContain('aria-label="Kartu"');
    expect(html).not.toContain("<h2");
    expect(html.match(/aria-label="Tutup"/g)).toHaveLength(1);
    expect(html).toContain("Tutup kartu");
  });
});

describe("useDialogParam", () => {
  afterEach(() => vi.unstubAllGlobals());

  function stubWindow(href: string, state: unknown = null) {
    const history = { state, pushState: vi.fn(), replaceState: vi.fn(), back: vi.fn() };
    const dispatchEvent = vi.fn();
    const url = new URL(href);
    vi.stubGlobal("window", { location: { href, search: url.search, pathname: url.pathname }, history, dispatchEvent });
    return { history, dispatchEvent };
  }

  function capture(name: string) {
    let result: ReturnType<typeof useDialogParam> | null = null;
    function Probe() {
      result = useDialogParam(name);
      return <span>{result[0] ?? "kosong"}</span>;
    }
    const html = renderToStaticMarkup(<Probe />);
    return { html, result: result! as ReturnType<typeof useDialogParam> };
  }

  it("reads the open item from the URL, so a link opens the same pop-up", () => {
    stubWindow("https://hub.example/admin?aplikasi=hcis");
    expect(capture("aplikasi").html).toContain("hcis");
    stubWindow("https://hub.example/admin");
    expect(capture("aplikasi").html).toContain("kosong");
  });

  it("opens with a new history entry, so the browser's Back closes it", () => {
    const { history, dispatchEvent } = stubWindow("https://hub.example/admin/organ?tab=1", { other: true });
    const [, open] = capture("anggota").result;
    open("m-1");
    expect(history.pushState).toHaveBeenCalledTimes(1);
    const [state, , url] = history.pushState.mock.calls[0]!;
    expect(state).toEqual({ other: true, dialog: "anggota" });
    expect(String(url)).toBe("https://hub.example/admin/organ?tab=1&anggota=m-1");
    expect((dispatchEvent.mock.calls[0]![0] as Event).type).toBe(DIALOG_PARAM_EVENT);
  });

  it("closes by going Back when it was opened on this page", () => {
    const { history } = stubWindow("https://hub.example/admin/access?orang=1987", { dialog: "orang" });
    const [, , close] = capture("orang").result;
    close();
    expect(history.back).toHaveBeenCalledTimes(1);
    expect(history.replaceState).not.toHaveBeenCalled();
  });

  it("closes a pop-up reached by a link by removing the parameter in place", () => {
    const { history } = stubWindow("https://hub.example/admin/access?orang=1987&x=1", null);
    const [, , close] = capture("orang").result;
    close();
    expect(history.back).not.toHaveBeenCalled();
    expect(String(history.replaceState.mock.calls[0]![2])).toBe("https://hub.example/admin/access?x=1");
  });
});
