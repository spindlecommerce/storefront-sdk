import type { TemplateKind } from "./types.ts";

/**
 * Platform webhooks: `{ id, type, occurredAt, data }`, signed with
 * `x-spindle-signature: t=<unix seconds>,v1=<hex HMAC-SHA256 of "t.body">`.
 */
export type WebhookEvent = {
  id: string;
  type: string;
  occurredAt: string;
  data: { aggregateType?: string; aggregateId?: string; type?: unknown; path?: unknown; previousPath?: unknown; templateFor?: unknown; sectionsFor?: unknown; [key: string]: unknown };
};

/** Older or newer signatures are refused, so a captured request cannot be replayed. */
export const SIGNATURE_TOLERANCE_SECONDS = 5 * 60;

const encoder = new TextEncoder();

/** Checks the signature over the exact text received. Verify before parsing. */
export const verifyWebhookSignature = async (secret: string, body: string, header: string | null, nowSeconds = Date.now() / 1000) => {
  if (!header) return false;
  const parts = new Map(
    header.split(",").map((part) => {
      const at = part.indexOf("=");
      return [part.slice(0, at).trim(), part.slice(at + 1).trim()] as const;
    }),
  );
  const timestamp = Number(parts.get("t"));
  const signature = parts.get("v1") ?? "";
  if (!Number.isInteger(timestamp) || Math.abs(nowSeconds - timestamp) > SIGNATURE_TOLERANCE_SECONDS) return false;
  if (!/^[0-9a-f]{64}$/i.test(signature)) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const bytes = Uint8Array.from(signature.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
  // Constant time, so timing does not reveal how much of a guess matched.
  return crypto.subtle.verify("HMAC", key, bytes, encoder.encode(`${timestamp}.${body}`));
};

/** A verified body as an event; null when it is not one. */
export const parseWebhookEvent = (body: string): WebhookEvent | null => {
  try {
    const event = JSON.parse(body) as WebhookEvent | null;
    return typeof event?.type === "string" && typeof event.data === "object" && event.data !== null ? event : null;
  } catch {
    return null;
  }
};

/** Content an event changed, for a storefront to expire what shows it. */
export type ContentChange =
  | { kind: "everything" }
  | { kind: "pages" }
  | { kind: "catalog" }
  | { kind: "path"; path: string }
  | { kind: "templates"; for: TemplateKind }
  | { kind: "sections"; for: TemplateKind }
  | { kind: "singleton"; type: string };

/** `immediate`: expire now (the next visit waits for fresh data) rather than serve stale while refetching. */
export type ContentChanges = { changes: ContentChange[]; immediate: boolean };

const text = (value: unknown) => (typeof value === "string" && value ? value : null);

const templateKind = (value: unknown): TemplateKind | null => (value === "product" || value === "category" ? value : null);

export const changesFor = (event: WebhookEvent): ContentChanges => {
  const { type, data } = event;
  switch (type) {
    // The component library changed: any page may render differently.
    case "component.updated":
      return { changes: [{ kind: "everything" }], immediate: true };
    case "page.published":
    case "page.unpublished": {
      const path = text(data.path);
      const previousPath = text(data.previousPath);
      const templateFor = templateKind(data.templateFor);
      const sectionsFor = templateKind(data.sectionsFor);
      const changes: ContentChange[] = [];
      if (path) changes.push({ kind: "path", path });
      if (previousPath && previousPath !== path) changes.push({ kind: "path", path: previousPath });
      // A template has no path: any product or category page may now render with it, or stop.
      if (templateFor) changes.push({ kind: "templates", for: templateFor });
      // Nor do a product's or category's own sections.
      if (sectionsFor) changes.push({ kind: "sections", for: sectionsFor });
      // Singletons (site_header, site_footer) have no path: they are named by content type.
      const pageType = text(data.type);
      if (pageType && !templateFor && !sectionsFor && !path && !previousPath) changes.push({ kind: "singleton", type: pageType });
      // A page that appeared, moved or went away changes links on other pages.
      if (type === "page.unpublished" || path !== previousPath) changes.push({ kind: "pages" });
      return { changes, immediate: true };
    }
    // A template's assignments changed: those pages may now render with another template.
    case "page.targets_updated": {
      const templateFor = templateKind(data.templateFor);
      return { changes: templateFor ? [{ kind: "templates", for: templateFor }] : [], immediate: true };
    }
    // Pages published together. The event names them only by id.
    case "release.published":
      return { changes: [{ kind: "pages" }], immediate: true };
  }
  // Prices and stock are checked again by the cart anyway: serve stale while refetching.
  if (/^(product|category|price|inventory)\./.test(type)) return { changes: [{ kind: "catalog" }], immediate: false };
  return { changes: [], immediate: false };
};
