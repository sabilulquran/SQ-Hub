import type { AccountSnapshot, WorkspaceSnapshot } from "@/types";

export const workspaceFixture: WorkspaceSnapshot = {
  user: {
    displayName: "Ahmad Fikri",
    initials: "AF",
    contextLabel: "UAT-HCIS-001 · Pegawai sintetis",
  },
  applications: [
    {
      key: "hcis",
      name: "HCIS",
      description: "Human Capital Information System untuk kebutuhan kepegawaian internal.",
      canonicalUrl: "https://hcis.example",
    },
    {
      key: "portal-contoh",
      name: "Portal Contoh",
      description: "Aplikasi sintetis untuk verifikasi tata letak SQ Hub.",
      canonicalUrl: "https://portal.example",
    },
  ],
  capabilities: {
    platformAdministration: true,
  },
};

export const ordinaryWorkspaceFixture: WorkspaceSnapshot = {
  ...workspaceFixture,
  capabilities: { platformAdministration: false },
};

export const emptyWorkspaceFixture: WorkspaceSnapshot = {
  ...ordinaryWorkspaceFixture,
  applications: [],
};


export const accountFixture: AccountSnapshot = {
  profile: {
    displayName: "Ahmad Fikri",
    username: "19870001",
    email: "ahmad.fikri@example.test",
    emailVerified: true,
    fields: [
      {
        name: "locale",
        label: "locale",
        required: false,
        readOnly: false,
        multivalued: false,
        values: ["id"],
        requiredAction: null,
      },
      {
        name: "username",
        label: "username",
        required: true,
        readOnly: true,
        multivalued: false,
        values: ["19870001"],
        requiredAction: null,
      },
      {
        name: "firstName",
        label: "firstName",
        required: true,
        readOnly: false,
        multivalued: false,
        values: ["Ahmad"],
        requiredAction: null,
      },
      {
        name: "lastName",
        label: "lastName",
        required: true,
        readOnly: false,
        multivalued: false,
        values: ["Fikri"],
        requiredAction: null,
      },
      {
        name: "email",
        label: "email",
        required: true,
        readOnly: false,
        multivalued: false,
        values: ["ahmad.fikri@example.test"],
        requiredAction: "UPDATE_EMAIL",
      },
    ],
    supportedLocales: ["id"],
  },
  security: {
    totpConfigured: true,
    recoveryCodesConfigured: true,
  },
  applications: workspaceFixture.applications,
  management: {
    available: true,
    reauthRequired: false,
    credentials: [
      {
        type: "password",
        category: "basic-authentication",
        label: "password-display-name",
        helpText: "Gunakan kata sandi yang kuat untuk Akun SQ.",
        canCreate: false,
        canUpdate: true,
        removeable: false,
        credentials: [
          {
            id: "credential-password-preview",
            label: null,
            createdAt: 1789000000000,
          },
        ],
      },
      {
        type: "otp",
        category: "two-factor",
        label: "otp-display-name",
        helpText: "Authenticator melindungi akun dengan verifikasi tambahan.",
        canCreate: true,
        canUpdate: false,
        removeable: true,
        credentials: [
          {
            id: "credential-otp-preview",
            label: "Ponsel utama",
            createdAt: 1789000000000,
          },
        ],
      },
      {
        type: "recovery-authn-code",
        category: "two-factor",
        label: "recovery-authn-codes-display-name",
        helpText: "Kode pemulihan digunakan bila authenticator tidak tersedia.",
        canCreate: true,
        canUpdate: true,
        removeable: false,
        credentials: [
          {
            id: "credential-recovery-preview",
            label: null,
            createdAt: 1789000000000,
          },
        ],
      },
    ],
    devices: [
      {
        id: "device-current-preview",
        device: "Desktop",
        os: "Windows",
        osVersion: "11",
        browser: "Edge",
        ipAddress: "192.0.2.10",
        lastAccessAt: 1790000000000,
        current: true,
        mobile: false,
        sessions: [
          {
            id: "session-current-preview",
            ipAddress: "192.0.2.10",
            browser: "Edge",
            startedAt: 1789990000000,
            lastAccessAt: 1790000000000,
            expiresAt: 1790040000000,
            current: true,
            clients: ["SQ Hub", "HCIS"],
          },
        ],
      },
      {
        id: "device-mobile-preview",
        device: "Ponsel",
        os: "Android",
        osVersion: "16",
        browser: "Chrome",
        ipAddress: "192.0.2.11",
        lastAccessAt: 1789900000000,
        current: false,
        mobile: true,
        sessions: [
          {
            id: "session-mobile-preview",
            ipAddress: "192.0.2.11",
            browser: "Chrome",
            startedAt: 1789800000000,
            lastAccessAt: 1789900000000,
            expiresAt: 1790030000000,
            current: false,
            clients: ["HCIS"],
          },
        ],
      },
    ],
    applications: [
      {
        clientId: "sq-hub",
        name: "SQ Hub",
        description: "Pusat aplikasi dan layanan internal.",
        effectiveUrl: "https://hub.example.test",
        inUse: true,
        userConsentRequired: false,
        offlineAccess: false,
        consent: null,
      },
      {
        clientId: "external-preview",
        name: "Aplikasi Mitra",
        description: "Aplikasi sintetis untuk preview persetujuan.",
        effectiveUrl: "https://partner.example.test",
        inUse: false,
        userConsentRequired: true,
        offlineAccess: false,
        consent: {
          createdAt: 1789000000000,
          lastUpdatedAt: 1789000000000,
          scopes: [
            { id: "profile", name: "profile", label: "Profil dasar" },
            { id: "email", name: "email", label: "Email" },
          ],
        },
      },
    ],
    linkedAccounts: [
      {
        connected: true,
        providerAlias: "google",
        providerName: "google",
        displayName: "Google",
        linkedUsername: "ahmad.fikri@example.test",
        social: true,
      },
    ],
    availableAccountLinks: [],
    groups: [
      {
        name: "Human Capital",
        path: "/Yayasan/Human Capital",
      },
    ],
  },
};
