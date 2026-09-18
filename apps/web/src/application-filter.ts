import type { WorkspaceApplication } from "@/types";

export function filterApplications(
  applications: WorkspaceApplication[],
  query: string,
): WorkspaceApplication[] {
  const normalized = query.trim().toLocaleLowerCase("id-ID");
  if (!normalized) return applications;
  return applications.filter((application) =>
    [application.name, application.description ?? ""]
      .join(" ")
      .toLocaleLowerCase("id-ID")
      .includes(normalized),
  );
}
