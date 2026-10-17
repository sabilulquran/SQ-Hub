import type { Organ } from "@/types";

const ORGAN_LABELS: Record<Organ, string> = {
  pembina: "Pembina",
  pengurus: "Pengurus",
  pengawas: "Pengawas",
};

export function organLabel(organ: Organ): string {
  return ORGAN_LABELS[organ];
}

/** Badge text such as "Pengurus Yayasan" (HUB-IMPL-021 §5). */
export function organBadge(organ: Organ): string {
  return `${ORGAN_LABELS[organ]} Yayasan`;
}
