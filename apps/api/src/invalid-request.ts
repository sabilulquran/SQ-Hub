import type { z } from "zod";

/**
 * Turns a Zod failure into the field paths a caller needs to fix, and nothing else.
 *
 * A 400 from an internal endpoint used to say only `INVALID_REQUEST`, which left callers
 * guessing which field the schema rejected. The paths below are safe to hand back and to
 * log; the submitted values are not, because an internal body can carry personal data, so
 * they never leave the parser. Key names come from the caller too, so each segment is
 * truncated and reduced to the characters a field name may contain.
 */

const MAX_FIELDS = 20;
const MAX_SEGMENT_LENGTH = 64;

export type InvalidRequestIssue = { path: string; code: string };

function segment(value: PropertyKey): string {
  const text = String(value).slice(0, MAX_SEGMENT_LENGTH);
  return text.replace(/[^A-Za-z0-9_-]/g, "?");
}

/** An issue on the body as a whole (a cross-field rule) has no path of its own. */
function join(path: readonly PropertyKey[]): string {
  return path.length === 0 ? "(body)" : path.map(segment).join(".");
}

/** Field paths and Zod issue codes for a failed parse, deduplicated and capped. */
export function invalidRequestIssues(error: z.ZodError): InvalidRequestIssue[] {
  const issues = new Map<string, InvalidRequestIssue>();
  for (const issue of error.issues) {
    const paths =
      issue.code === "unrecognized_keys"
        ? issue.keys.map((key) => join([...issue.path, key]))
        : [join(issue.path)];
    for (const path of paths) {
      const entry = { path, code: String(issue.code) };
      const key = `${entry.path}\u0000${entry.code}`;
      if (!issues.has(key)) issues.set(key, entry);
    }
  }
  return [...issues.values()].slice(0, MAX_FIELDS);
}

/** Just the field paths, in the order they were reported. */
export function invalidRequestFields(error: z.ZodError): string[] {
  const fields: string[] = [];
  for (const issue of invalidRequestIssues(error)) {
    if (!fields.includes(issue.path)) fields.push(issue.path);
  }
  return fields;
}
