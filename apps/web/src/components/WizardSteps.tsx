import { Check, CheckCircle2 } from "lucide-react";
import type { ReactNode } from "react";

/**
 * UX-FLOW-001 rule 3 (docs/design/sq-step-flow.md): numbered step marker above the current step.
 * On a narrow screen only the active step's label is written; finished steps show a check.
 * Behaviour ported from HCIS `components/wizard/WizardSteps.tsx`.
 */
export function WizardSteps({ steps, current, label = "Langkah" }: { steps: readonly string[]; current: number; label?: string }) {
  return (
    <ol aria-label={label} className="mt-3 flex items-center gap-2 rounded-2xl border border-border/70 bg-surface-raised px-3 py-3">
      {steps.map((name, index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={name} aria-current={active ? "step" : undefined} className="flex min-w-0 flex-1 items-center gap-2">
            <span
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
                active ? "bg-brand-primary text-brand-foreground" : done ? "bg-brand-primary-pale text-brand-primary-deep" : "bg-muted text-muted-foreground"
              }`}
            >
              {done ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : index + 1}
            </span>
            <span className={`truncate text-[11px] font-semibold sm:text-xs ${active ? "text-brand-heading" : "hidden text-muted-foreground sm:inline"}`}>{name}</span>
          </li>
        );
      })}
    </ol>
  );
}

/** UX-FLOW-001 rule 6: the done screen that replaces the review step once the action is sent. */
export function WizardDone({ title, message, children }: { title: string; message?: ReactNode; children?: ReactNode }) {
  return (
    <div className="mt-4 rounded-2xl border border-border/70 bg-surface-raised p-5 text-center sm:p-6">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-success-soft text-success-ink">
        <CheckCircle2 className="h-6 w-6" aria-hidden="true" />
      </span>
      <h3 className="mt-3 text-base font-bold text-brand-heading">{title}</h3>
      {message ? <div className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted-foreground">{message}</div> : null}
      {children ? <div className="mt-5 flex flex-col items-stretch justify-center gap-2 sm:flex-row sm:items-center">{children}</div> : null}
    </div>
  );
}
