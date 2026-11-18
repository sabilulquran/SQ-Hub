import { z } from "zod";

/**
 * ORGAN-IMPL-001 §4.2, decision contract v1. The portal shows what the owning application sends
 * and nothing else: it never reads a domain rule, never computes a figure, and never stores any of
 * this. An application that answers with anything outside this shape has its section dropped, the
 * same way an invalid governance summary is dropped rather than half-rendered.
 */
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const decisionItemSchema = z
  .object({
    stepId: z.string().min(1).max(255),
    requestId: z.string().min(1).max(255),
    kind: z.string().min(1).max(64),
    requester: z
      .object({
        name: z.string().min(1).max(200),
        positionLabel: z.string().max(200).nullable(),
        unitName: z.string().max(200).nullable(),
      })
      .strict(),
    period: z
      .object({
        startOn: isoDate,
        endOn: isoDate,
        workingDays: z.number().int().min(0).max(400),
      })
      .strict(),
    reason: z.string().max(2000).nullable(),
    submittedAt: z.string().datetime(),
    history: z
      .array(
        z
          .object({
            order: z.number().int().min(0).max(100),
            status: z.string().min(1).max(32),
            decidedAt: z.string().datetime().nullable(),
            approverRole: z.string().max(100).nullable(),
          })
          .strict(),
      )
      .max(20),
  })
  .strict();

export const decisionListSchema = z.object({ items: z.array(decisionItemSchema).max(100) }).strict();

export type DecisionItem = z.infer<typeof decisionItemSchema>;
export type DecisionList = z.infer<typeof decisionListSchema>;

/**
 * What the portal sends. `requestId` is made once per action in the browser and reused on a
 * resend, so a decision that was already taken is answered rather than taken again.
 */
export const decisionCommandSchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    note: z.string().trim().max(1000).optional(),
    requestId: z.string().uuid(),
  })
  .strict();

export type DecisionCommand = z.infer<typeof decisionCommandSchema>;

/**
 * What the portal passes back to the browser after forwarding a decision. The application owns
 * the outcome, so this is read loosely — unknown fields are dropped rather than relayed, and a
 * body that does not match at all becomes an empty object rather than an error, because by then
 * the decision has already been taken and saying otherwise would be false.
 */
export const decisionResultSchema = z
  .object({
    requestId: z.string().max(255).optional(),
    requestStatus: z.string().max(64).optional(),
    stepStatus: z.string().max(64).optional(),
    nextPendingStepId: z.string().max(255).nullable().optional(),
    hcHandling: z.string().max(64).optional(),
    hcTaskStatus: z.string().max(64).nullable().optional(),
    criticalReviewStatus: z.string().max(64).nullable().optional(),
  })
  .strip();

export type DecisionResult = z.infer<typeof decisionResultSchema>;
