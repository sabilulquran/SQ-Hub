import { useEffect } from "react";

import { kerjaFetch, type KartuDetail } from "@/kerja/api";
import { navigate } from "@/kerja/routes";
import { StateCard, useLoad } from "@/kerja/ui";

/** `/kartu/<id>` (links in notifications) opens the card as a pop-up over its own board. */
export function KartuRedirect({ kartuId }: { kartuId: string }) {
  const { state } = useLoad<KartuDetail>(() => kerjaFetch<KartuDetail>(`/kartu/${kartuId}`), kartuId);
  useEffect(() => {
    if (state.status === "ready") navigate(`/papan/${state.data.papan.id}?kartu=${kartuId}`, true);
  }, [state, kartuId]);
  if (state.status === "error") {
    return <StateCard kind="error" title={state.code === "tidak_ditemukan" ? "Kartu tidak ditemukan" : "Kartu belum dapat dimuat"} body={state.code === "tidak_ditemukan" ? "Kartu ini tidak ada atau berada di ruang yang tidak Anda ikuti." : state.message} />;
  }
  return <StateCard kind="loading" title="Membuka kartu" />;
}
