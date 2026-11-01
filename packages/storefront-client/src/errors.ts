/** The API answered with GraphQL errors or an unexpected status. Status 0: it could not be reached. */
export class StorefrontApiError extends Error {
  readonly status: number;
  readonly codes: string[];
  constructor(message: string, status: number, codes: string[] = [], options?: ErrorOptions) {
    super(message, options);
    this.name = "StorefrontApiError";
    this.status = status;
    this.codes = codes;
  }
}

/** A request with a preview token the API no longer accepts. */
export class PreviewExpiredError extends Error {
  constructor() {
    super("The preview has expired; open it again from the admin");
    this.name = "PreviewExpiredError";
  }
}

/** Checked by name as well, since server bundles may hold more than one copy of this module. */
export const isPreviewExpired = (error: unknown): error is PreviewExpiredError =>
  error instanceof PreviewExpiredError || (error instanceof Error && error.name === "PreviewExpiredError");
