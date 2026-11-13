import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { findStaffByUsername } from "@/admin-staff-dialog";
import { AdminCenterPage } from "@/AdminCenterPageView";
import { organOverviewFixture } from "@/dev/organFixture";
import { workspaceFixture } from "@/dev/workspaceFixture";
import { HcisRolesPage } from "@/HcisRolesPage";
import { OrganMembershipPage } from "@/OrganMembershipPage";
import { PlatformAdministratorsPage } from "@/PlatformAdministratorsPage";
import { StaffLifecyclePage } from "@/StaffLifecyclePage";
import type { AdminApplication, AdminStaff } from "@/types";

// sq-core-app-shell.md "Detail views open as a pop-up": on each admin screen the list keeps the
// full width, and the item's detail or form exists only while its URL parameter is set.

const applications: AdminApplication[] = [
  { key: "hcis", name: "HCIS", canonicalUrl: "https://hcis.example", status: "active", governanceSummaryPath: null, governanceAudience: null, governanceOrder: 0 },
];

function at(href: string) {
  const url = new URL(href, "https://hub.example");
  vi.stubGlobal("window", {
    location: { href: url.href, pathname: url.pathname, search: url.search, hostname: url.hostname, protocol: url.protocol },
    history: { state: null, pushState: vi.fn(), replaceState: vi.fn(), back: vi.fn() },
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("Registry aplikasi /admin", () => {
  it("shows the cards across the full width and no form until an application is opened", () => {
    at("/admin");
    const html = renderToStaticMarkup(<AdminCenterPage workspace={workspaceFixture} previewApplications={applications} />);
    expect(html).toContain("Aplikasi platform");
    expect(html).toContain("Baru");
    expect(html).not.toContain("xl:grid-cols-[minmax(0,1.25fr)");
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain("Simpan registry");
  });

  it("opens Ubah aplikasi for ?aplikasi=<key> with the application's values", () => {
    at("/admin?aplikasi=hcis");
    const html = renderToStaticMarkup(<AdminCenterPage workspace={workspaceFixture} previewApplications={applications} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="Ubah aplikasi"');
    expect(html).toContain('value="https://hcis.example"');
    expect(html).toContain("Simpan registry");
  });

  it("opens Daftarkan aplikasi for ?aplikasi=baru and says so for an unknown key", () => {
    at("/admin?aplikasi=baru");
    expect(renderToStaticMarkup(<AdminCenterPage workspace={workspaceFixture} previewApplications={applications} />)).toContain('aria-label="Daftarkan aplikasi"');
    at("/admin?aplikasi=tidak-ada");
    expect(renderToStaticMarkup(<AdminCenterPage workspace={workspaceFixture} previewApplications={applications} />)).toContain("Aplikasi tidak ditemukan pada registry.");
  });
});

describe("Akses aplikasi /admin/access", () => {
  it("shows no access panel until a person is opened, then a pop-up for ?orang=<username>", () => {
    at("/admin/access");
    const closed = renderToStaticMarkup(<AdminCenterPage workspace={workspaceFixture} previewApplications={applications} />);
    expect(closed).toContain("Cari Staff");
    expect(closed).not.toContain('role="dialog"');
    expect(closed).not.toContain("Alasan perubahan akses");

    at("/admin/access?orang=19870001");
    const open = renderToStaticMarkup(<AdminCenterPage workspace={workspaceFixture} previewApplications={applications} />);
    expect(open).toContain('role="dialog"');
    expect(open).toContain("Mencari orang di Akun SQ...");
  });
});

describe("Peran HCIS /admin/hcis-roles", () => {
  it("opens no person while the HCIS role catalog is not loaded, even with ?orang=", () => {
    at("/admin/hcis-roles?orang=19870001");
    const html = renderToStaticMarkup(<HcisRolesPage workspace={workspaceFixture} />);
    expect(html).toContain("Memuat katalog peran dari HCIS");
    expect(html).not.toContain('role="dialog"');
  });
});

describe("Pegawai masuk & keluar /admin/lifecycle", () => {
  it("keeps the status and offboarding actions in a pop-up for ?orang=<username>", () => {
    at("/admin/lifecycle");
    const closed = renderToStaticMarkup(<StaffLifecyclePage workspace={workspaceFixture} />);
    expect(closed).toContain("Status &amp; Offboarding");
    expect(closed).not.toContain('role="dialog"');
    expect(closed).not.toContain("Jalankan atau ulangi offboarding");

    at("/admin/lifecycle?orang=19870001");
    const open = renderToStaticMarkup(<StaffLifecyclePage workspace={workspaceFixture} />);
    expect(open).toContain('aria-label="Status dan offboarding"');
    expect(open).toContain("Mencari orang di Akun SQ...");
  });
});

describe("Organ Yayasan /admin/organ", () => {
  it("lists members without a detail panel and opens a member as a pop-up for ?anggota=<id>", () => {
    at("/admin/organ");
    const closed = renderToStaticMarkup(<OrganMembershipPage workspace={workspaceFixture} previewOverview={organOverviewFixture} />);
    expect(closed).toContain("Anggota aktif");
    expect(closed).toContain("Kelola");
    expect(closed).not.toContain('role="dialog"');

    at("/admin/organ?anggota=00000000-0000-4000-8000-000000000001");
    const open = renderToStaticMarkup(<OrganMembershipPage workspace={workspaceFixture} previewOverview={organOverviewFixture} />);
    expect(open).toContain('role="dialog"');
    expect(open).toContain("md:max-w-[960px]");
    expect(open).toContain("Memuat keanggotaan...");
    // The add-member column stays on the page (out of scope for this change).
    expect(open).toContain("Tambah anggota");
  });
});

describe("Admin Platform /admin/platform-administrators", () => {
  it("asks for the proposal reason in a small pop-up for ?orang=<username>", () => {
    at("/admin/platform-administrators");
    expect(renderToStaticMarkup(<PlatformAdministratorsPage workspace={workspaceFixture} />)).not.toContain('role="dialog"');
    at("/admin/platform-administrators?orang=19870001");
    const open = renderToStaticMarkup(<PlatformAdministratorsPage workspace={workspaceFixture} />);
    expect(open).toContain('aria-label="Usulkan Admin Platform"');
  });
});

describe("findStaffByUsername", () => {
  const person = (username: string, subject: string): AdminStaff => ({
    subject, username, email: null, emailVerified: false, displayName: username, enabled: true,
    security: { totpConfigured: false, recoveryCodesConfigured: false },
  });

  it("takes the person from the results on screen without a request", async () => {
    const fetchJson = vi.fn();
    expect(await findStaffByUsername(fetchJson, "19870001", [person("19870001", "s-1")])).toMatchObject({ subject: "s-1" });
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("otherwise asks the existing directory search and keeps only an exact username match", async () => {
    const fetchJson = vi.fn().mockResolvedValue({ staff: [person("198700011", "s-2"), person("19870001", "s-3")] });
    expect(await findStaffByUsername(fetchJson, "19870001", [])).toMatchObject({ subject: "s-3" });
    expect(fetchJson).toHaveBeenCalledWith("/api/admin/staff?q=19870001");
    const none = vi.fn().mockResolvedValue({ staff: [person("198700011", "s-2")] });
    expect(await findStaffByUsername(none, "19870001", [])).toBeNull();
  });
});
