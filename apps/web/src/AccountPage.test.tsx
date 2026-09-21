import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AccountPage } from "@/AccountPage";
import { accountFixture, workspaceFixture } from "@/dev/workspaceFixture";

describe("native Akun SQ account route", () => {
  it("renders the complete account navigation without provider branding", () => {
    const html = renderToStaticMarkup(
      <AccountPage workspace={workspaceFixture} previewAccount={accountFixture} />,
    );

    for (const label of [
      "Profil Saya",
      "Keamanan",
      "Sesi &amp; Perangkat",
      "Aplikasi",
      "Akun Terhubung",
      "Keanggotaan",
    ]) {
      expect(html).toContain(label);
    }
    expect(html).toContain("NIP / ID masuk");
    expect(html).toContain("Simpan perubahan");
    expect(html).not.toContain("Keycloak");
    expect(html).not.toContain("/realms/");
    expect(html).not.toContain("subject");
    expect(html).not.toContain("issuer");
    expect(html).not.toContain("access_token");
    expect(html).not.toContain("refresh_token");
  });

  it("renders credential management from provider metadata", () => {
    const html = renderToStaticMarkup(
      <AccountPage
        workspace={workspaceFixture}
        previewAccount={accountFixture}
        previewSection="security"
      />,
    );

    expect(html).toContain("Kata sandi");
    expect(html).toContain("Verifikasi dua langkah");
    expect(html).toContain("Kode pemulihan");
    expect(html).toContain("Kelola");
    expect(html).toContain("Hapus");
    expect(html).not.toContain("kc_action=");
  });

  it("renders real device sessions and never offers single-session logout for current session", () => {
    const html = renderToStaticMarkup(
      <AccountPage
        workspace={workspaceFixture}
        previewAccount={accountFixture}
        previewSection="sessions"
      />,
    );

    expect(html).toContain("Perangkat saat ini");
    expect(html).toContain("Windows");
    expect(html).toContain("Android");
    expect(html).toContain("Keluar dari semua sesi lain");
    expect(html).toContain("Digunakan oleh: SQ Hub, HCIS");
    expect(html).toContain("Digunakan oleh: HCIS");
    expect((html.match(/>Keluar<\/button>/g) ?? []).length).toBe(1);
  });

  it("separates SQ application access from identity-connected applications and consent", () => {
    const html = renderToStaticMarkup(
      <AccountPage
        workspace={workspaceFixture}
        previewAccount={accountFixture}
        previewSection="applications"
      />,
    );

    expect(html).toContain("Aplikasi SQ yang dapat Anda buka");
    expect(html).toContain("Aplikasi yang terhubung ke Akun SQ");
    expect(html).toContain("HCIS");
    expect(html).toContain("Aplikasi Mitra");
    expect(html).toContain("Cabut akses");
    expect(html).toContain("Profil dasar");
  });

  it("renders linked identities without exposing provider implementation details", () => {
    const html = renderToStaticMarkup(
      <AccountPage
        workspace={workspaceFixture}
        previewAccount={accountFixture}
        previewSection="linked"
      />,
    );

    expect(html).toContain("Akun Terhubung");
    expect(html).toContain("Google");
    expect(html).toContain("Putuskan");
    expect(html).not.toContain("Keycloak");
  });

  it("renders group membership only when the capability has data", () => {
    const withGroups = renderToStaticMarkup(
      <AccountPage workspace={workspaceFixture} previewAccount={accountFixture} />,
    );
    const withoutGroups = renderToStaticMarkup(
      <AccountPage
        workspace={workspaceFixture}
        previewAccount={{
          ...accountFixture,
          management: { ...accountFixture.management, groups: [] },
        }}
      />,
    );

    expect(withGroups).toContain("Keanggotaan");
    expect(withoutGroups).not.toContain("Keanggotaan");
  });

  it("keeps the account shell usable and requests reauthentication for an older session", () => {
    const html = renderToStaticMarkup(
      <AccountPage
        workspace={workspaceFixture}
        previewAccount={{
          ...accountFixture,
          profile: {
            displayName: "Ahmad Fikri",
            username: null,
            email: null,
            emailVerified: null,
            fields: [],
          },
          security: {
            totpConfigured: null,
            recoveryCodesConfigured: null,
          },
          management: {
            available: false,
            reauthRequired: true,
            credentials: [],
            devices: [],
            applications: [],
            linkedAccounts: [],
            availableAccountLinks: [],
            groups: [],
          },
        }}
        previewSection="security"
      />,
    );

    expect(html).toContain("Profil Saya");
    expect(html).toContain("Keamanan");
    expect(html).toContain("Sesi &amp; Perangkat");
    expect(html).toContain("Masuk ulang untuk kelola akun");
    expect(html).toContain("/api/auth/oidc/start?returnTo=account");
    expect(html).toContain("/api/auth/oidc/action/password");
  });

  it("marks Akun as the active global mobile destination", () => {
    const html = renderToStaticMarkup(
      <AccountPage workspace={workspaceFixture} previewAccount={accountFixture} />,
    );

    expect(html).toContain('href="/account"');
    expect(html).toContain('aria-current="page"');
  });
});
