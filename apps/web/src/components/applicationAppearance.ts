import { Boxes, PanelsTopLeft, UsersRound, type LucideIcon } from "lucide-react";

export interface ApplicationAppearance {
  icon: LucideIcon;
  tile: string;
}

// Category colours from docs/design/sq-core-design-system-c.md: one category per application.
const appearanceByKey: Record<string, ApplicationAppearance> = {
  hcis: { icon: UsersRound, tile: "bg-cat-attendance-soft text-cat-attendance" },
  "aset-sq": { icon: Boxes, tile: "bg-cat-service-soft text-cat-service" },
};

const defaultAppearance: ApplicationAppearance = {
  icon: PanelsTopLeft,
  tile: "bg-brand-primary-pale text-brand-primary-deep",
};

export function applicationAppearance(key: string): ApplicationAppearance {
  return appearanceByKey[key] ?? defaultAppearance;
}
