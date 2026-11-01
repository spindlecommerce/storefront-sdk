import {
  CATEGORY_PRODUCTS,
  CATEGORY_TREE,
  COUNTRIES,
  GUEST_ORDER,
  LOCALIZED_PATH,
  NEWEST_PRODUCTS,
  PAGES,
  PREVIEW_SESSION,
  PRODUCT_SLUGS,
  ROUTE,
  SECTIONS,
  SITE,
  TEMPLATE,
} from "./documents.ts";
import { isPreviewExpired, PreviewExpiredError, StorefrontApiError } from "./errors.ts";
import { mediaUrl } from "./media.ts";
import type {
  BuilderPage,
  CategoryTreeNode,
  Connection,
  ContentNode,
  Country,
  PageEntry,
  PlacedOrder,
  PreviewSession,
  ProductConnection,
  ProductSort,
  ProductSummary,
  RouteData,
  SiteData,
  TemplatePage,
} from "./types.ts";

export type StorefrontScope = {
  /** The channel's code, sent as x-channel. */
  channel: string;
  /** One of the channel's languages; null for its default. */
  locale?: string | null;
  /** One of the channel's currencies; null for its default. */
  currency?: string | null;
};

export type StorefrontClientOptions = StorefrontScope & {
  /** The platform's URL. It serves GraphQL at /graphql. */
  url: string;
  /** Sent as x-preview-token, so reads return draft content. */
  previewToken?: string | null;
  /** Fetch options for every request, other than method, headers and body. */
  init?: RequestInit;
  fetch?: (input: string, init: RequestInit) => Promise<Response>;
};

/** Fetch options for one request, such as Next.js's `next: { tags }`. */
export type RequestOptions = { init?: RequestInit };

type GraphQLError = { message: string; extensions?: { code?: string } };
type GraphQLResponse<T> = { data?: T | null; errors?: GraphQLError[] };

const nodesOf = <N>(connection: { edges: { node: N | null }[] } | null | undefined) => (connection?.edges ?? []).flatMap((e) => (e.node ? [e.node] : []));

/** Every node of a connection, up to `limit` pages. */
export const allNodes = async <N>(load: (after: string | null) => Promise<Connection<N> | null>, limit = 50) => {
  const items: N[] = [];
  let after: string | null = null;
  for (let i = 0; i < limit; i++) {
    const connection: Connection<N> | null = await load(after);
    items.push(...nodesOf(connection));
    if (!connection?.pageInfo.hasNextPage || !connection.pageInfo.endCursor) break;
    after = connection.pageInfo.endCursor;
  }
  return items;
};

type Root = { id: string; component: string };

export type StorefrontClient = ReturnType<typeof createStorefrontClient>;

/** The Storefront API for one channel, language and currency. Failed requests throw StorefrontApiError. */
export const createStorefrontClient = (options: StorefrontClientOptions) => {
  const url = options.url.replace(/\/+$/, "");
  const scope = { channel: options.channel, locale: options.locale ?? null, currency: options.currency ?? null };
  const previewToken = options.previewToken ?? null;
  // Looked up per request: frameworks such as Next.js replace the global fetch.
  const send = options.fetch ?? ((input: string, init: RequestInit) => fetch(input, init));

  const query = async <T>(document: string, variables: Record<string, unknown> = {}, request: RequestOptions = {}): Promise<T> => {
    const headers: Record<string, string> = { "content-type": "application/json", accept: "application/json", "x-channel": scope.channel };
    if (scope.locale) headers["x-locale"] = scope.locale;
    if (scope.currency) headers["x-currency"] = scope.currency;
    if (previewToken) headers["x-preview-token"] = previewToken;
    let response: Response;
    try {
      response = await send(`${url}/graphql`, { ...options.init, ...request.init, method: "POST", headers, body: JSON.stringify({ query: document, variables }) });
    } catch (cause) {
      throw new StorefrontApiError(`The Storefront API at ${url} could not be reached`, 0, [], { cause });
    }
    const body = (await response.json().catch(() => null)) as GraphQLResponse<T> | null;
    const codes = (body?.errors ?? []).map((e) => e.extensions?.code ?? "UNKNOWN");
    // An invalid preview token fails the whole request with 401 UNAUTHENTICATED.
    if (previewToken && (response.status === 401 || codes.includes("UNAUTHENTICATED"))) throw new PreviewExpiredError();
    if (body?.errors?.length) throw new StorefrontApiError(body.errors.map((e) => e.message).join("; "), response.status, codes);
    if (!response.ok || !body?.data) throw new StorefrontApiError(`The Storefront API answered HTTP ${response.status}`, response.status, codes);
    return body.data;
  };

  return {
    url,
    scope,
    previewToken,
    /** The same client with another scope, preview token or fetch options. */
    with: (changes: Partial<StorefrontClientOptions>) => createStorefrontClient({ ...options, ...changes }),
    query,
    /** A path on the API host, such as /media/…, as an absolute URL. */
    mediaUrl: (src: string) => mediaUrl(url, src),

    /** A storefront URL path as a page, product, category or redirect; null when nothing is there. */
    route: async (path: string, request?: RequestOptions) => (await query<{ route: RouteData | null }>(ROUTE, { path }, request)).route,
    /** The template a product or category page renders with; null for the storefront's own layout. */
    routeTemplate: async (path: string, request?: RequestOptions) =>
      (await query<{ route: { template?: TemplatePage | null } | null }>(TEMPLATE, { path }, request)).route?.template ?? null,
    /** A product's or category's own sections, which its template places. */
    routeSections: async (path: string, request?: RequestOptions) =>
      (await query<{ route: { sections?: BuilderPage | null } | null }>(SECTIONS, { path }, request)).route?.sections ?? null,
    /** The header and footer (singleton pages of these content types), and the request's language and currency. */
    site: <Header extends Root = ContentNode, Footer extends Root = ContentNode>(types: { header?: string; footer?: string } = {}, request?: RequestOptions) =>
      query<SiteData<Header, Footer>>(SITE, { header: types.header ?? "site_header", footer: types.footer ?? "site_footer" }, request),
    newestProducts: async (first: number, request?: RequestOptions): Promise<ProductSummary[]> =>
      nodesOf((await query<{ products: ProductConnection | null }>(NEWEST_PRODUCTS, { first }, request)).products),
    /** A page of a category's products, its subcategories' included. `endCursor` is null on the last page. */
    categoryProducts: async (id: string, page: { first: number; after?: string | null; sort?: ProductSort | null }, request?: RequestOptions) => {
      const data = await query<{ category: { products: ProductConnection | null } | null }>(CATEGORY_PRODUCTS, { id, first: page.first, after: page.after ?? null, sort: page.sort ?? null }, request);
      const connection = data.category?.products;
      return { products: nodesOf(connection), totalCount: connection?.totalCount ?? 0, endCursor: connection?.pageInfo.hasNextPage ? connection.pageInfo.endCursor : null };
    },
    /** A page of published pages, of one content type or all of them. */
    pages: async (page: { type?: string | null; first: number; after?: string | null }, request?: RequestOptions) =>
      (await query<{ pages: Connection<PageEntry> | null }>(PAGES, { type: page.type ?? null, first: page.first, after: page.after ?? null }, request)).pages,
    /** A page of product slugs, 100 at a time. */
    productSlugs: async (after: string | null, request?: RequestOptions) => (await query<{ products: Connection<{ slug: string }> | null }>(PRODUCT_SLUGS, { after }, request)).products,
    /** Category paths, four levels deep. */
    categoryTree: async (request?: RequestOptions): Promise<CategoryTreeNode[]> => (await query<{ categoryTree: CategoryTreeNode[] | null }>(CATEGORY_TREE, {}, request)).categoryTree ?? [],
    /** A product's slug or a category's path in the client's language, for hreflang links. */
    localizedPath: async (id: string, request?: RequestOptions) => {
      const data = await query<{ node: { slug?: string | null; path?: string | null } | null }>(LOCALIZED_PATH, { id }, request);
      return data.node?.slug ?? data.node?.path ?? null;
    },
    /** The session of the client's preview token; null when the API refuses the token. */
    previewSession: async (request?: RequestOptions): Promise<PreviewSession | null> => {
      try {
        return (await query<{ previewSession: PreviewSession | null }>(PREVIEW_SESSION, {}, request)).previewSession;
      } catch (error) {
        if (isPreviewExpired(error)) return null;
        throw error;
      }
    },
    /** The countries the channel ships to, named in the client's language. */
    countries: async (request?: RequestOptions) => {
      const data = await query<{ localization: { locale: string | null; channel: { countries: Country[] | null } | null } | null }>(COUNTRIES, {}, request);
      return { locale: data.localization?.locale ?? null, countries: (data.localization?.channel?.countries ?? []).filter((c) => c.code) };
    },
    /** An order looked up as its guest shopper would, with the payment method of the cart it came from. */
    guestOrder: async (lookup: { email: string; number: string; postalCode: string; cartId: string }, request?: RequestOptions) => {
      type Method = { code: string; name: string | null; instructions: string | null };
      const data = await query<{ order: PlacedOrder | null; cart: { selectedPaymentMethod: Method | null } | null }>(GUEST_ORDER, lookup, request);
      return data.order ? { order: data.order, paymentMethod: data.cart?.selectedPaymentMethod ?? null } : null;
    },
  };
};
