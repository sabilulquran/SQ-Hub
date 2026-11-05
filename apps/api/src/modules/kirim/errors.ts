/** A refusal with a stable code for the consumer or admin API (KIRIM-IMPL-001 §5.3). */
export class KirimApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    /** KIRIM-IMPL-004 §9: extra fields in the error body, e.g. when a limit frees up. Never personal data. */
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "KirimApiError";
  }
}
