/** Cookies the preview route sets next to Next.js's own draft mode cookie. */
export const PREVIEW_COOKIE = {
  token: "spindle_preview_token",
  /** The channel being previewed. The language is the path's prefix. */
  channel: "spindle_preview_channel",
  /** The admin origin the visual editing bridge may talk to. */
  adminOrigin: "spindle_preview_admin",
} as const;

/** Next.js's draft mode cookie, set by draftMode().enable(). */
export const BYPASS_COOKIE = "__prerender_bypass";

type CookieOptions = { httpOnly: boolean; path: string; secure?: boolean; sameSite: "lax" | "none"; partitioned?: boolean; expires?: Date };

/**
 * Over HTTPS, SameSite=None and Partitioned (CHIPS) so the cookies work when an admin on another
 * site frames the storefront. Over HTTP (local development, all on localhost), SameSite=Lax.
 */
export const previewCookieOptions = (secure: boolean, expires?: Date): CookieOptions => ({
  httpOnly: true,
  path: "/",
  ...(secure ? { secure: true, sameSite: "none" as const, partitioned: true } : { sameSite: "lax" as const }),
  ...(expires ? { expires } : {}),
});

export const isSecureRequest = (request: Request) => new URL(request.url).protocol === "https:" || request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() === "https";
