import "server-only";
import {
  allNodes,
  categoryPath,
  createCartSession,
  createStorefrontClient,
  isPreviewExpired,
  normalizePath,
  PreviewExpiredError,
  productPath,
  type CartStore,
  type CategoryTreeNode,
  type ContentNode,
  type ProductSort,
  type RouteResult,
  type StorefrontClient,
  type TemplateKind,
} from "@spindlecommerce/storefront-client";
import { cookies, draftMode } from "next/headers";
import { unstable_rethrow } from "next/navigation";
import { cache } from "react";
import { CART_COOKIE, CART_COUNT_COOKIE } from "./cookies.ts";
import { PREVIEW_COOKIE } from "./preview.ts";
import { TAG } from "./tags.ts";

/** The channel, language and currency a request shows. */
export type Market = { channel: string; locale: string | null; currency: string | null };

/** The request's market, as draft mode and the preview cookies change it. */
export type Scope = Market & { draft: boolean; previewToken: string | null };

export type NextStorefrontOptions = {
  /** The platform's URL. */
  url: string;
  /** The request's market, e.g. from the URL. Called once per request. */
  market: () => Market | Promise<Market>;
  /** Seconds a cached read lasts. Publishing expires reads sooner, through the revalidate route. */
  revalidate?: number;
  /** The content types of the header and footer pages. */
  site?: { header?: string; footer?: string };
  /** Whether a stored cart is still this storefront's, e.g. in one of its currencies. By default, while it is open. */
  isUsableCart?: (cart: { isOpen: boolean; currencyCode: string | null }) => boolean;
};

type Root = { id: string; component: string };

/** Only /products/… and /categories/… render a template; other URLs for them redirect. */
const templateKindOf = (path: string): TemplateKind | null => {
  const normalized = normalizePath(path);
  if (normalized.startsWith(productPath(""))) return "product";
  if (normalized.startsWith(categoryPath(""))) return "category";
  return null;
};

/** The cart's id in an httpOnly cookie, its item count in a readable one for the header. */
const cookieCartStore: CartStore = {
  get: async () => (await cookies()).get(CART_COOKIE)?.value ?? null,
  set: async (cart) => {
    const jar = await cookies();
    const secure = process.env.NODE_ENV === "production";
    const maxAge = 60 * 60 * 24 * 30;
    jar.set(CART_COOKIE, cart.id, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge });
    jar.set(CART_COUNT_COOKIE, String(cart.totalQuantity), { httpOnly: false, sameSite: "lax", secure, path: "/", maxAge });
  },
  clear: async () => {
    const jar = await cookies();
    jar.delete(CART_COOKIE);
    jar.delete(CART_COUNT_COOKIE);
  },
};

/** The Storefront API for a Next.js App Router storefront. Server-side only. */
export const createNextStorefront = (options: NextStorefrontOptions) => {
  const revalidate = options.revalidate ?? 300;
  const headerType = options.site?.header ?? "site_header";
  const footerType = options.site?.footer ?? "site_footer";

  /**
   * Cookies are read only in draft mode, so published pages stay cacheable. Previewing another
   * channel uses that channel's default language and currency.
   */
  const getScope = cache(async (): Promise<Scope> => {
    const market = await options.market();
    const { isEnabled } = await draftMode();
    if (!isEnabled) return { ...market, draft: false, previewToken: null };
    const jar = await cookies();
    const channel = jar.get(PREVIEW_COOKIE.channel)?.value || market.channel;
    const own = channel === market.channel;
    return { draft: true, previewToken: jar.get(PREVIEW_COOKIE.token)?.value || null, channel, locale: own ? market.locale : null, currency: own ? market.currency : null };
  });

  /**
   * A client for reads, cached under `tags` outside draft mode and fetched fresh with the preview
   * token in it. `language` replaces the market's, e.g. for hreflang alternates.
   */
  const reader = async (tags: string[] = [], language?: string): Promise<StorefrontClient> => {
    const scope = await getScope();
    const base = { url: options.url, channel: scope.channel, locale: language ?? scope.locale, currency: scope.currency };
    if (!scope.draft) return createStorefrontClient({ ...base, init: { next: { tags: [TAG.all, ...tags], revalidate } } });
    if (!scope.previewToken) throw new PreviewExpiredError();
    return createStorefrontClient({ ...base, previewToken: scope.previewToken, init: { cache: "no-store" } });
  };

  /** A client for carts, checkout and other private data: never cached, never with the preview token. */
  const privateClient = async () => {
    const scope = await getScope();
    return createStorefrontClient({ url: options.url, channel: scope.channel, locale: scope.locale, currency: scope.currency, init: { cache: "no-store" } });
  };

  /** Content a product or category page can do without: visitors get the page without it, editors the error. */
  const optional = async <T>(load: () => Promise<T>, what: string): Promise<T | null> => {
    try {
      return await load();
    } catch (error) {
      unstable_rethrow(error);
      if (isPreviewExpired(error) || (await getScope()).draft) throw error;
      console.error(`Could not load ${what}`, error);
      return null;
    }
  };

  /** A storefront URL. Products and categories come with their template and own sections. */
  const getRoute = cache(async (path: string): Promise<RouteResult | null> => {
    const kind = templateKindOf(path);
    const [route, template, sections] = await Promise.all([
      reader([TAG.pages, TAG.catalog, TAG.path(path)]).then((client) => client.route(path)),
      // Tagged with the catalog too, since a product's categories pick its template.
      kind ? optional(async () => (await reader([TAG.templates(kind), TAG.pages, TAG.catalog])).routeTemplate(path), `the template for ${path}`) : null,
      kind ? optional(async () => (await reader([TAG.sections(kind), TAG.pages, TAG.catalog])).routeSections(path), `the sections for ${path}`) : null,
    ]);
    return route?.__typename === "Product" || route?.__typename === "Category" ? { ...route, template, sections } : route;
  });

  /** The header and footer, and the language and currency the API answers in. */
  const getSite = cache(async <Header extends Root = ContentNode, Footer extends Root = ContentNode>() =>
    (await reader([TAG.pages, TAG.catalog, TAG.singleton(headerType), TAG.singleton(footerType)])).site<Header, Footer>({ header: headerType, footer: footerType }),
  );

  const getNewestProducts = cache(async (first: number) => (await reader([TAG.catalog])).newestProducts(first));

  /** A page of a category's products, its subcategories' included. */
  const getCategoryProducts = cache(async (id: string, first: number, after: string | null = null, sort: ProductSort | null = null) =>
    (await reader([TAG.catalog])).categoryProducts(id, { first, after, sort }),
  );

  /** A product's slug or category's path in another of the market's languages, for hreflang. */
  const getLocalizedPath = async (id: string, language: string) => (await reader([TAG.catalog], language)).localizedPath(id);

  /** Published pages of one content type, and every product and category. */
  const getSitemap = async (type: string) => {
    const flatten = (nodes: CategoryTreeNode[]): string[] => nodes.flatMap((c) => [c.path, ...flatten(c.children ?? [])]);
    const [pages, products, tree] = await Promise.all([
      reader([TAG.pages]).then((client) => allNodes((after) => client.pages({ type, first: 100, after }))),
      reader([TAG.catalog]).then((client) => allNodes((after) => client.productSlugs(after), 20)),
      reader([TAG.catalog]).then((client) => client.categoryTree()),
    ]);
    return { pages, productSlugs: products.map((p) => p.slug), categoryPaths: flatten(tree) };
  };

  /** Checks a preview token before draft mode is turned on; null when the API refuses it. */
  const previewSession = (token: string, scope: { channel: string; locale: string | null }) =>
    createStorefrontClient({ url: options.url, ...scope, previewToken: token, init: { cache: "no-store" } }).previewSession();

  /** The shopper's cart and checkout, kept in cookies. Changes set cookies: make them in Server Actions or Route Handlers. */
  const cart = async () => createCartSession(await privateClient(), cookieCartStore, { isUsable: options.isUsableCart });

  return { url: options.url, getScope, reader, privateClient, getRoute, getSite, getNewestProducts, getCategoryProducts, getLocalizedPath, getSitemap, previewSession, cart };
};

export type NextStorefront = ReturnType<typeof createNextStorefront>;
