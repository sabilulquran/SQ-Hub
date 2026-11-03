/** A refusal with a stable code for the consumer or admin API (KIRIM-IMPL-001 §5.3). */
export class KirimApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "KirimApiError";
  }
}
