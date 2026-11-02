import { changesFor, parseWebhookEvent, safeLocalPath, verifyWebhookSignature } from "@spindlecommerce/storefront-client";
import { revalidateTag } from "next/cache";
import { cookies, draftMode } from "next/headers";
import { BYPASS_COOKIE, isSecureRequest, PREVIEW_COOKIE, previewCookieOptions } from "./preview.ts";
import type { NextStorefront } from "./storefront.ts";
import { tagsFor } from "./tags.ts";

const NO_STORE = { "cache-control": "no-store" };

const reject = (status: number, message: string) => new Response(`${message}\n`, { status, headers: { "content-type": "text/plain; charset=utf-8", ...NO_STORE } });

const json = (status: number, body: Record<string, unknown>) => Response.json(body, { status, headers: NO_STORE });

const LOCALE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const CHANNEL_CODE = /^[A-Za-z0-9_-]{1,64}$/;

const originOf = (value: string | null) => {
  if (!value) return null;
  try {
    const url = new URL(value);
    return /^https?:$/.test(url.protocol) ? url.origin : null;
  } catch {
    return null;
  }
};

export type DraftRouteOptions = {
  /** The channel to preview when the admin names none. */
  channel: string;
  /** Where the preview opens; by default `path`. Add the preview's language here if the storefront shows it in the URL. */
  location?: (path: string, preview: { locale: string | null; channel: string | null }) => string;
};

/**
 * The preview route the admin frames: ?token=…&path=/summer-sale[&locale=de-DE][&channel=eu].
 * Checks the token with the API, turns on draft mode and keeps the token in an httpOnly cookie.
 */
export const createDraftRoute = (storefront: Pick<NextStorefront, "previewSession">, options: DraftRouteOptions) =>
  async function GET(request: Request) {
    const params = new URL(request.url).searchParams;
    const token = params.get("token");
    const path = safeLocalPath(params.get("path") || "/");
    const locale = params.get("locale")?.trim() || null;
    const channel = params.get("channel")?.trim() || null;

    if (!token) return reject(401, "Missing preview token.");
    if (!path) return reject(400, "path must be a path on this storefront, e.g. /summer-sale.");
    if (locale && !LOCALE.test(locale)) return reject(400, "Invalid locale.");
    if (channel && !CHANNEL_CODE.test(channel)) return reject(400, "Invalid channel.");

    let session: Awaited<ReturnType<NextStorefront["previewSession"]>>;
    try {
      session = await storefront.previewSession(token, { channel: channel ?? options.channel, locale });
    } catch (error) {
      console.error("Preview session check failed", error);
      return reject(401, "The preview could not be checked with the SpindleCommerce API. Try again from the admin.");
    }
    if (!session) return reject(401, "The preview link is invalid or has expired. Open the preview again from the admin.");

    (await draftMode()).enable();

    const jar = await cookies();
    const secure = isSecureRequest(request);
    const expires = new Date(session.expiresAt);
    const cookie = previewCookieOptions(secure, Number.isNaN(expires.getTime()) ? undefined : expires);
    const keep = (name: string, value: string | null) => (value ? jar.set(name, value, cookie) : jar.delete({ name, path: cookie.path, ...(secure ? { secure: true, sameSite: "none", partitioned: true } : {}) }));
    keep(PREVIEW_COOKIE.token, token);
    keep(PREVIEW_COOKIE.channel, channel);
    keep(PREVIEW_COOKIE.adminOrigin, originOf(session.adminOrigin));
    if (secure) {
      // Next.js does not partition its draft mode cookie. Partition it so it survives in browsers
      // that block third-party cookies when the admin frames us.
      const bypass = jar.get(BYPASS_COOKIE);
      if (bypass?.value) jar.set(BYPASS_COOKIE, bypass.value, previewCookieOptions(true));
    }

    // A relative Location keeps the frame on this origin, whatever host the request came in on.
    const location = options.location ? options.location(path, { locale, channel }) : path;
    return new Response(null, { status: 307, headers: { location, ...NO_STORE } });
  };

/** Leaves draft mode: GET ?path=/summer-sale, or a form POST with a `path` field. */
export const createDraftDisableRoute = () => {
  const exit = async (request: Request, path: string | null, status: 303 | 307) => {
    (await draftMode()).disable();
    const jar = await cookies();
    const secure = isSecureRequest(request);
    const attributes = secure ? { secure: true, sameSite: "none" as const, partitioned: true } : {};
    for (const name of Object.values(PREVIEW_COOKIE)) jar.delete({ name, path: "/", ...attributes });
    // The partitioned draft mode cookie needs a partitioned deletion (see createDraftRoute).
    if (secure) jar.set(BYPASS_COOKIE, "", { ...previewCookieOptions(true), expires: new Date(0) });
    return new Response(null, { status, headers: { location: safeLocalPath(path) ?? "/", ...NO_STORE } });
  };
  return {
    GET: (request: Request) => exit(request, new URL(request.url).searchParams.get("path"), 307),
    /** 303, so the browser follows with a GET. */
    POST: async (request: Request) => {
      const form = await request.formData().catch(() => null);
      const path = form?.get("path");
      return exit(request, typeof path === "string" ? path : null, 303);
    },
  };
};

const MAX_BODY_BYTES = 1024 * 1024;

/** Content-Length is only a hint; enforce the limit against the bytes actually received. */
const readWebhookBody = async (request: Request): Promise<string | null> => {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return body + decoder.decode();
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        // A remote peer must not be able to hold the response open through cancellation.
        void reader.cancel().catch(() => {});
        return null;
      }
      body += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
};

/** The revalidate route: platform webhooks expire the cached reads they affect. `secret` defaults to SPINDLE_REVALIDATE_SECRET. */
export const createRevalidateRoute = (options: { secret?: string | null } = {}) =>
  async function POST(request: Request) {
    const secret = options.secret ?? process.env.SPINDLE_REVALIDATE_SECRET;
    if (!secret) return json(503, { revalidated: false, error: "Revalidation is off: set SPINDLE_REVALIDATE_SECRET to the signing secret the admin showed for this storefront." });
    if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) return json(413, { revalidated: false, error: "Body too large" });

    // Decode only a bounded body, preserving UTF-8 characters split across chunks.
    const body = await readWebhookBody(request);
    if (body === null) return json(413, { revalidated: false, error: "Body too large" });
    if (!(await verifyWebhookSignature(secret, body, request.headers.get("x-spindle-signature")))) return json(401, { revalidated: false, error: "Invalid or expired signature" });
    const event = parseWebhookEvent(body);
    if (!event) return json(400, { revalidated: false, error: "Expected an event: { id, type, occurredAt, data }" });

    // The type is read from the signed body; the x-spindle-event header is not signed.
    const { changes, immediate } = changesFor(event);
    const tags = tagsFor(changes);
    for (const tag of tags) revalidateTag(tag, immediate ? { expire: 0 } : "max");
    return json(200, { revalidated: tags.length > 0, event: event.type, id: event.id ?? null, tags, immediate, now: Date.now() });
  };
