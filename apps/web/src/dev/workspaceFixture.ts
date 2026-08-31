import type { WorkspaceSnapshot } from "@/types";

export const workspaceFixture: WorkspaceSnapshot = {
  user: {
    displayName: "SQ Hub UAT",
    initials: "SH",
    contextLabel: "Pegawai sintetis · Preview desain",
  },
  applications: [
    {
      key: "hcis",
      name: "HCIS",
      description: "Human Capital Information System untuk kebutuhan kepegawaian internal.",
      canonicalUrl: "https://hcis-staging.sabilulquran.or.id",
    },
  ],
  capabilities: {
    platformAdministration: true,
  },
};
