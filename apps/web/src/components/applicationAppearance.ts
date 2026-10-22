import {
  Boxes,
  BriefcaseBusiness,
  GraduationCap,
  MessageCircle,
  PanelsTopLeft,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

export interface ApplicationAppearance {
  icon: LucideIcon;
  tile: string;
}

// Category colours from docs/design/sq-core-design-system-c.md: one category per application.
// HUB-IMPL-022 §6 lists this table so every app's launcher copies the same keys, icons and colours.
const appearanceByKey: Record<string, ApplicationAppearance> = {
  hcis: { icon: UsersRound, tile: "bg-cat-attendance-soft text-cat-attendance" },
  "aset-sq": { icon: Boxes, tile: "bg-cat-service-soft text-cat-service" },
  "karir-sq": { icon: BriefcaseBusiness, tile: "bg-cat-task-soft text-cat-task" },
  "spmb-sq": { icon: GraduationCap, tile: "bg-cat-leave-soft text-cat-leave" },
  "kirim-sq": { icon: MessageCircle, tile: "bg-cat-pay-soft text-cat-pay" },
};

const defaultAppearance: ApplicationAppearance = {
  icon: PanelsTopLeft,
  tile: "bg-brand-primary-pale text-brand-primary-deep",
};

export function applicationAppearance(key: string): ApplicationAppearance {
  return appearanceByKey[key] ?? defaultAppearance;
}
