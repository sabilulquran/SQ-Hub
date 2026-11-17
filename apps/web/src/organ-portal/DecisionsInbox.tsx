import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

/**
 * ORGAN-IMPL-001 §4.2 (R2) — deciding inside the portal.
 *
 * The portal shows what the owning application sent and sends back one decision. It evaluates no
 * rule of its own: every refusal on screen is the application's own answer. A decision carries a
 * `requestId` made once per action, so pressing again after a lost answer asks the application to
 * repeat its first decision rather than take a second one.
 */

export interface DecisionItem {
  stepId: string;
  requestId: string;
  kind: string;
  requester: { name: string; positionLabel: string | null; unitName: string | null };
  period: { startOn: string; endOn: string; workingDays: number };
  reason: string | null;
  submittedAt: string;
  history: Array<{ order: number; status: string; decidedAt: string | null; approverRole: string | null }>;
}

export interface DecisionCard {
  applicationKey: string;
  name: string;
  state: "ready" | "failed";
  items: DecisionItem[];
}

type InboxState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; cards: DecisionCard[] };

const KIND_LABELS: Record<string, string> = {
  annual: "Cuti tahunan",
  planned: "Cuti terencana",
};

function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Jakarta" }).format(date);
}

function formatPeriod(period: DecisionItem["period"]): string {
  const days = `${period.workingDays} hari kerja`;
  return period.startOn === period.endOn
    ? `${formatDate(period.startOn)} · ${days}`
    : `${formatDate(period.startOn)} – ${formatDate(period.endOn)} · ${days}`;
}

/** A stale step-up is not an error the member can act on; the realm asks for TOTP again. */
function goStepUp(stepUpPath: string | undefined) {
  window.location.assign(stepUpPath ?? "/api/auth/oidc/start?stepUp=1");
}

export function DecisionsInbox() {
  const [state, setState] = useState<InboxState>({ status: "loading" });
  const [open, setOpen] = useState<{ card: DecisionCard; item: DecisionItem } | null>(null);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const response = await fetch("/api/organ/decisions", { credentials: "same-origin", headers: { Accept: "application/json" } });
      if (response.status === 401) {
        window.location.assign("/api/auth/oidc/start");
        return;
      }
      if (response.status === 403) {
        const body = (await response.json().catch(() => ({}))) as { error?: string; stepUpPath?: string };
        if (body.error === "step_up_required") {
          goStepUp(body.stepUpPath);
          return;
        }
        setState({ status: "error" });
        return;
      }
      if (!response.ok) throw new Error(String(response.status));
      const body = (await response.json()) as { cards: DecisionCard[] };
      setState({ status: "ready", cards: body.cards });
    } catch {
      setState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state.status === "loading") {
    return (
      <p className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="h-4 w-4 animate-spin" strokeWidth={1.5} aria-hidden="true" />
        Memuat pengajuan…
      </p>
    );
  }

  if (state.status === "error") {
    return (
      <section className="mt-8 rounded-xl border border-border bg-surface-raised px-5 py-6">
        <p className="text-sm text-muted-foreground">Daftar keputusan belum dapat dimuat.</p>
        <button type="button" onClick={() => void load()} className="mt-3 rounded-lg border border-border px-3 py-1.5 text-sm font-medium text-brand-heading transition-colors hover:bg-muted/50">
          Coba lagi
        </button>
      </section>
    );
  }

  const total = state.cards.reduce((sum, card) => sum + card.items.length, 0);
  const failed = state.cards.filter((card) => card.state === "failed");

  return (
    <>
      {failed.length > 0 ? (
        <ul className="mt-6 space-y-2">
          {failed.map((card) => (
            <li key={card.applicationKey} className="rounded-lg border border-border bg-surface-raised px-4 py-3 text-sm text-muted-foreground">
              {card.name} belum dapat dimuat.
            </li>
          ))}
        </ul>
      ) : null}

      <section aria-label="Menunggu keputusan Anda" className="mt-8 rounded-xl border border-border bg-surface-raised">
        <h2 className="border-b border-border px-5 py-3 text-sm font-medium text-brand-heading">Menunggu keputusan Anda</h2>
        {total === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">Tidak ada pengajuan yang menunggu keputusan Anda.</p>
        ) : (
          <ul className="divide-y divide-border">
            {state.cards.flatMap((card) =>
              card.items.map((item) => (
                <li key={`${card.applicationKey}-${item.stepId}`}>
                  <button
                    type="button"
                    onClick={() => setOpen({ card, item })}
                    className="flex min-h-14 w-full items-center justify-between gap-4 px-5 py-3 text-left text-sm transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <span className="min-w-0">
                      <span className="block font-medium text-brand-heading">{kindLabel(item.kind)} · {item.requester.name}</span>
                      <span className="mt-0.5 block text-[13px] text-muted-foreground">
                        {formatPeriod(item.period)}
                      </span>
                    </span>
                    <span className="shrink-0 text-[13px] text-muted-foreground">{card.name}</span>
                  </button>
                </li>
              )),
            )}
          </ul>
        )}
      </section>

      {open ? (
        <DecisionDialog
          card={open.card}
          item={open.item}
          onClose={() => setOpen(null)}
          onDecided={() => {
            setOpen(null);
            void load();
          }}
        />
      ) : null}
    </>
  );
}

type Sending = { decision: "approve" | "reject" } | null;

/**
 * The detail is a pop-up, not a side panel (SQ Core design rule, 2026-11-13), so the list behind
 * it does not move while a decision is being read.
 */
function DecisionDialog({
  card,
  item,
  onClose,
  onDecided,
}: {
  card: DecisionCard;
  item: DecisionItem;
  onClose: () => void;
  onDecided: () => void;
}) {
  const [note, setNote] = useState("");
  const [sending, setSending] = useState<Sending>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // One id per action, kept across retries of the same action so a resend cannot decide twice.
  const [requestId] = useState(() => crypto.randomUUID());

  const decide = useCallback(async (decision: "approve" | "reject") => {
    setSending({ decision });
    setProblem(null);
    try {
      const response = await fetch(`/api/organ/decisions/${encodeURIComponent(card.applicationKey)}/${encodeURIComponent(item.stepId)}`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ decision, requestId, ...(note.trim() ? { note: note.trim() } : {}) }),
      });
      if (response.ok) {
        onDecided();
        return;
      }
      const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string; stepUpPath?: string };
      if (response.status === 403 && body.error === "step_up_required") {
        goStepUp(body.stepUpPath);
        return;
      }
      if (response.status === 503) {
        // §4.2 step 5: the result is not certain. Never resend by itself.
        setProblem("Hasil belum pasti. Muat ulang daftar untuk melihat keadaan terakhir sebelum mencoba lagi.");
        return;
      }
      setProblem(body.message ?? "Keputusan tidak dapat diproses.");
    } catch {
      setProblem("Hasil belum pasti. Muat ulang daftar untuk melihat keadaan terakhir sebelum mencoba lagi.");
    } finally {
      setSending(null);
    }
  }, [card.applicationKey, item.stepId, note, onDecided, requestId]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-6" role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${kindLabel(item.kind)} ${item.requester.name}`}
        className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-border bg-surface-raised p-5 shadow-xl sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-brand-heading">{kindLabel(item.kind)}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{card.name}</p>

        <dl className="mt-4 space-y-3 text-sm">
          <div>
            <dt className="text-muted-foreground">Pemohon</dt>
            <dd className="font-medium text-brand-heading">
              {item.requester.name}
              {item.requester.positionLabel ? ` · ${item.requester.positionLabel}` : ""}
              {item.requester.unitName ? ` · ${item.requester.unitName}` : ""}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Periode</dt>
            <dd className="font-medium text-brand-heading">{formatPeriod(item.period)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Diajukan</dt>
            <dd className="font-medium text-brand-heading">{formatDate(item.submittedAt)}</dd>
          </div>
          {item.reason ? (
            <div>
              <dt className="text-muted-foreground">Alasan</dt>
              <dd className="whitespace-pre-line text-brand-heading">{item.reason}</dd>
            </div>
          ) : null}
        </dl>

        {item.history.length > 0 ? (
          <section className="mt-5">
            <h3 className="text-sm font-medium text-brand-heading">Riwayat</h3>
            <ul className="mt-2 space-y-1 text-[13px] text-muted-foreground">
              {item.history.map((step) => (
                <li key={step.order}>
                  {step.approverRole ?? `Langkah ${step.order}`} · {step.status}
                  {step.decidedAt ? ` · ${formatDate(step.decidedAt)}` : ""}
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <label className="mt-5 block text-sm">
          <span className="text-muted-foreground">Catatan (opsional)</span>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={1000}
            rows={3}
            className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-brand-heading focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </label>

        {problem ? <p className="mt-3 text-sm text-destructive">{problem}</p> : null}

        <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-brand-heading transition-colors hover:bg-muted/50">
            Tutup
          </button>
          <button
            type="button"
            disabled={sending !== null}
            onClick={() => void decide("reject")}
            className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-brand-heading transition-colors hover:bg-muted/50 disabled:opacity-60"
          >
            {sending?.decision === "reject" ? "Mengirim…" : "Tolak"}
          </button>
          <button
            type="button"
            disabled={sending !== null}
            onClick={() => void decide("approve")}
            className="rounded-lg bg-brand px-3 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand/90 disabled:opacity-60"
          >
            {sending?.decision === "approve" ? "Mengirim…" : "Setujui"}
          </button>
        </div>
      </div>
    </div>
  );
}
