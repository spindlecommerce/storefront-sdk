/** The API's path rules: lowercase, single slashes, no trailing slash ("/" for the home page). */
export const normalizePath = (input: string) => {
  const trimmed = input.trim().toLowerCase().replace(/\/{2,}/g, "/");
  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : withSlash;
};

/** The API builds content links the same way. */
export const productPath = (slug: string) => `/products/${slug}`;
export const categoryPath = (path: string) => `/categories/${path}`;

/**
 * A same-origin path to redirect to, or null for anything that could leave the site: absolute
 * URLs, "//host" and backslash tricks.
 */
export const safeLocalPath = (value: string | null | undefined): string | null => {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\") || value.length > 2000) return null;
  try {
    const base = "http://storefront.invalid";
    const url = new URL(value, base);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : null;
  } catch {
    return null;
  }
};
