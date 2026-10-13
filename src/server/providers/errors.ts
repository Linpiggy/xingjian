export type ProviderStatus = "not_configured" | "permission_denied" | "unavailable";
export class ProviderError extends Error {
  constructor(
    public readonly status: ProviderStatus,
    message: string,
    public readonly code: string = status,
  ) {
    super(message);
  }
}
