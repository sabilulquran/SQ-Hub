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
  },
  security: {
    totpConfigured: true,
    recoveryCodesConfigured: true,
  },
  applications: workspaceFixture.applications,
};
