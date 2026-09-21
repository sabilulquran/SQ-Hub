import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AccountPage } from "@/AccountPage";
import { accountFixture, workspaceFixture } from "@/dev/workspaceFixture";

describe("native Akun SQ account route", () => {
  it("renders account information without exposing provider UI or technical identity fields", () => {
    const html = renderToStaticMarkup(
      <AccountPage workspace={workspaceFixture} previewAccount={accountFixture} />,
    );

    expect(html).toContain("Profil Saya");
    expect(html).toContain("Keamanan");
    expect(html).toContain("Aplikasi Saya");
    expect(html).toContain("NIP / ID masuk");
    expect(html).not.toContain("Keycloak");
    expect(html).not.toContain("/realms/");
    expect(html).not.toContain("subject");
    expect(html).not.toContain("issuer");
  });

  it("uses only fixed same-origin account security actions", () => {
    const html = renderToStaticMarkup(
      <AccountPage
        workspace={workspaceFixture}
        previewAccount={{
          ...accountFixture,
          security: { totpConfigured: false, recoveryCodesConfigured: false },
        }}
      />,
    );

    expect(html).toContain('href="/api/auth/oidc/action/password"');
    expect(html).toContain('href="/api/auth/oidc/action/totp"');
    expect(html).toContain('href="/api/auth/oidc/action/recovery-codes"');
    expect(html).not.toContain("redirect=");
    expect(html).not.toContain("kc_action=");
  });

  it("renders the account shell and security actions when profile enrichment is unavailable", () => {
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
          },
          security: {
            totpConfigured: null,
            recoveryCodesConfigured: null,
          },
        }}
      />,
    );

    expect(html).toContain("Profil Saya");
    expect(html).toContain("Keamanan");
    expect(html).toContain("Aplikasi Saya");
    expect(html).toContain("Belum tersedia");
    expect(html).toContain("Detail status keamanan belum dapat diverifikasi");
    expect(html).toContain('href="/api/auth/oidc/action/password"');
  });

  it("marks Akun as the active mobile destination", () => {
    const html = renderToStaticMarkup(
      <AccountPage workspace={workspaceFixture} previewAccount={accountFixture} />,
    );

    expect(html).toContain('href="/account"');
    expect(html).toContain('aria-current="page"');
  });
});
