import type { OrganMembershipOverview } from "@/types";

// Synthetic preview data only; no real person.
export const organOverviewFixture: OrganMembershipOverview = {
  active: [
    {
      id: "00000000-0000-4000-8000-000000000001",
      subject: "preview-subject-1",
      displayName: "Pembina Sintetis",
      username: "pembina.sintetis@example.test",
      email: "pembina.sintetis@example.test",
      enabled: true,
      organ: "pembina",
      positionLabel: "Ketua Pembina",
      termStart: "2026-01-01",
      termEnd: null,
      status: "active",
      reason: "SK sintetis",
      provisioningPath: "organ_identity",
      updatedAt: "2026-10-17T00:00:00.000Z",
      endedAt: null,
    },
    {
      id: "00000000-0000-4000-8000-000000000002",
      subject: "preview-subject-2",
      displayName: "Pengurus Sintetis",
      username: "19870021",
      email: "pengurus.sintetis@example.test",
      enabled: true,
      organ: "pengurus",
      positionLabel: "Bendahara Pengurus",
      termStart: "2025-11-01",
      termEnd: "2026-11-10",
      status: "active",
      reason: "SK sintetis",
      provisioningPath: "existing_staff",
      updatedAt: "2026-10-17T00:00:00.000Z",
      endedAt: null,
    },
  ],
  endingSoon: [],
  recentlyEnded: [],
  governanceApplications: [
    { key: "hcis", name: "HCIS" },
    { key: "aset", name: "Aset SQ" },
  ],
  capabilities: { addNewIdentity: true, endNewIdentity: true },
};
organOverviewFixture.endingSoon = [organOverviewFixture.active[1]!];
