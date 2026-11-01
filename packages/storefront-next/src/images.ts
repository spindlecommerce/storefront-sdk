/** next/image settings for the platform's media. No Next.js imports: next.config.ts loads this. */

export type ImagePattern = { protocol: "http" | "https"; hostname: string; port?: string; pathname?: string };

/**
 * Remote patterns for the platform's media: uploads it stores itself, a Vercel Blob store, and
 * `mediaHosts`. Those are URLs or bare hostnames, comma or space separated; a path limits a host
 * to that prefix, and `*.` matches one subdomain level.
 */
export const imagePatterns = ({ apiUrl, mediaHosts = "" }: { apiUrl: string; mediaHosts?: string }): ImagePattern[] => {
  const api = new URL(apiUrl);
  const hosts = mediaHosts
    .split(/[\s,]+/)
    .filter(Boolean)
    .flatMap((entry): ImagePattern[] => {
      try {
        const url = new URL(/^https?:\/\//.test(entry) ? entry : `https://${entry}`);
        const path = url.pathname.replace(/\/+$/, "");
        return [{ protocol: url.protocol === "http:" ? "http" : "https", hostname: url.hostname, port: url.port, ...(path ? { pathname: `${path}/**` } : {}) }];
      } catch {
        return [];
      }
    });
  return [
    { protocol: api.protocol === "https:" ? "https" : "http", hostname: api.hostname, port: api.port, pathname: `${api.pathname.replace(/\/+$/, "")}/media/**` },
    { protocol: "https", hostname: "*.public.blob.vercel-storage.com" },
    ...hosts,
  ];
};

/** The optimizer refuses local addresses (SSRF protection), so those are served as is. */
const isLocalHost = (host: string) =>
  host === "localhost" || host.endsWith(".localhost") || host === "[::1]" || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host);

/** Next.js host matching: `*.` is one subdomain level, `**.` any number. */
const hostMatches = (host: string, pattern: string) => {
  if (pattern.startsWith("**.")) return host.endsWith(pattern.slice(2));
  if (pattern.startsWith("*.")) return host.endsWith(pattern.slice(1)) && !host.slice(0, -(pattern.length - 1)).includes(".");
  return host === pattern;
};

const matches = (url: URL, pattern: ImagePattern) =>
  url.protocol === `${pattern.protocol}:` &&
  hostMatches(url.hostname, pattern.hostname) &&
  (!pattern.port || url.port === pattern.port) &&
  (!pattern.pathname || url.pathname.startsWith(pattern.pathname.replace(/\*\*$/, "")));

/** Whether next/image may optimize this absolute URL with these patterns. */
export const isOptimizable = (src: string, patterns: ImagePattern[]) => {
  try {
    const url = new URL(src);
    return !isLocalHost(url.hostname) && patterns.some((p) => matches(url, p));
  } catch {
    return false;
  }
};
