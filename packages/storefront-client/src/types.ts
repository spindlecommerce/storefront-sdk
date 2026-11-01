/** What the Storefront API returns, as this package's documents select it. */

export type Money = { amount: string; currencyCode: string; formatted: string };

export type PriceRange = { minVariantPrice: Money | null; maxVariantPrice: Money | null; compareAtMinVariantPrice: Money | null };

export type ProductOptionValue = { code: string; label: string; swatch: string | null };
export type ProductOption = { attribute: { code: string; label: string | null }; values: ProductOptionValue[] };

/** A variant as cards need it: what to add, and whether it can be bought. */
export type VariantSummary = { id: string; isAvailable: boolean; selectedOptions: { attribute: string; value: string }[] };

/** What product cards and grids show. */
export type ProductSummary = {
  id: string;
  name: string;
  slug: string;
  isAvailable: boolean;
  priceRange: PriceRange | null;
  /** In position order. A photo of one variant names it. */
  media: { url: string; alt: string | null; kind: "IMAGE" | "VIDEO"; variant: { id: string } | null }[];
  options: ProductOption[];
  variants: VariantSummary[];
};

export type SelectedOption = { attribute: string; value: string; label: string; name: string; swatch: string | null };

export type ProductVariant = {
  id: string;
  sku: string;
  name: string;
  isAvailable: boolean;
  quantityAvailable: number | null;
  price: Money | null;
  compareAtPrice: Money | null;
  selectedOptions: SelectedOption[];
  media: { url: string; alt: string | null }[];
};

export type CategoryLink = { id: string; name: string; path: string };

export type Product = Omit<ProductSummary, "media" | "variants"> & {
  description: string | null;
  seo: { title: string | null; description: string | null } | null;
  categories: CategoryLink[];
  variants: ProductVariant[];
  media: { id: string; url: string; alt: string | null; kind: "IMAGE" | "VIDEO"; position: number; variant: { id: string } | null }[];
  attributes: { attribute: { code: string; label: string }; value: string | null }[];
};

export type Category = CategoryLink & {
  slug: string;
  description: string | null;
  ancestors: CategoryLink[];
  children: CategoryLink[];
};

export type Connection<N> = { pageInfo: { hasNextPage: boolean; endCursor: string | null }; edges: { node: N | null }[] };

export type ProductConnection = Connection<ProductSummary> & { totalCount: number };

export type ProductSort = { field: "NEWEST" | "PRICE" | "NAME"; direction: "ASC" | "DESC" };

export type CategoryTreeNode = { path: string; children?: CategoryTreeNode[] };

export type PageLink = { id: string; path: string | null; title: string | null };

export type PageEntry = { path: string | null; updatedAt: string | null; seo: { noIndex: boolean } | null };

export type PageImage = { url: string; alt: string | null; width: number | null; height: number | null };

/** A component instance as the API delivers it. */
export type ContentNode = { id: string; component: string; variation: string | null; fields: Record<string, unknown> };

/** A component tree in the request locale, and what it refers to. */
export type BuilderPage<Root extends { id: string; component: string } = ContentNode> = {
  id: string;
  type: string;
  path: string | null;
  title: string | null;
  isPreview: boolean;
  publishedAt: string | null;
  /** Changes with every draft save (in preview) or publish. */
  updatedAt: string;
  seo: { title: string | null; description: string | null; noIndex: boolean; image: PageImage | null };
  content: Root;
  references: { products: ProductSummary[]; categories: CategoryLink[]; pages: PageLink[] };
};

export type TemplateKind = "product" | "category";

/**
 * A pathless builder page that product or category pages render with. The product or category
 * supplies its components' data.
 */
export type TemplatePage = BuilderPage & { templateFor: "PRODUCT" | "CATEGORY" };

/** A null template renders the storefront's built-in layout. The template places the sections. */
export type WithTemplate = { template: TemplatePage | null; sections: BuilderPage | null };

export type Redirect = { location: string; statusCode: number };

export type RouteResult =
  | ({ __typename: "Page" } & BuilderPage)
  | ({ __typename: "Product" } & Product & WithTemplate)
  | ({ __typename: "Category" } & Category & WithTemplate)
  | ({ __typename: "Redirect" } & Redirect);

/** route() without a product's or category's template and sections, which load separately. */
export type RouteData =
  | Exclude<RouteResult, { __typename: "Product" | "Category" }>
  | ({ __typename: "Product" } & Product)
  | ({ __typename: "Category" } & Category);

export type Localization = { locale: string; currencyCode: string; channel: { code: string; name: string } };

export type SiteData<Header extends { id: string; component: string } = ContentNode, Footer extends { id: string; component: string } = ContentNode> = {
  header: BuilderPage<Header> | null;
  footer: BuilderPage<Footer> | null;
  localization: Localization | null;
};

export type PreviewSession = { expiresAt: string; adminOrigin: string | null; at: string | null };

// ---------------------------------------------------------------- carts

export type CartLine = {
  id: string;
  name: string;
  quantity: number;
  quantityAvailable: number | null;
  unitPrice: Money | null;
  compareAtUnitPrice: Money | null;
  total: Money | null;
  issue: { code: string; message: string } | null;
  product: { name: string; slug: string; media: { url: string; alt: string | null; kind: string }[] } | null;
  variant: { id: string; name: string; selectedOptions: { name: string; label: string }[]; media: { url: string; alt: string | null }[] } | null;
};

export type Cart = {
  id: string;
  isOpen: boolean;
  totalQuantity: number;
  currencyCode: string;
  cost: { subtotal: Money | null; total: Money | null; tax: Money | null; shipping: Money | null; discountTotal: Money | null; pricesIncludeTax: boolean } | null;
  lines: CartLine[];
};

// ---------------------------------------------------------------- checkout

export type Address = {
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  line1: string | null;
  line2: string | null;
  city: string | null;
  region: string | null;
  regionCode: string | null;
  postalCode: string | null;
  countryCode: string | null;
  phone: string | null;
};

/** An address as cartUpdate takes it. Incomplete addresses are saved as drafts. */
export type AddressInput = { [Field in Exclude<keyof Address, "countryCode">]?: string | null } & { countryCode: string };

/** cartUpdate's input. Fields left out stay as they are. */
export type CartUpdateInput = {
  email?: string;
  locale?: string;
  currencyCode?: string;
  shippingAddress?: { address: AddressInput };
  billingAddress?: { sameAsShipping: true } | { address: AddressInput };
  /** Null goes back to the cheapest rate. */
  shippingMethodCode?: string | null;
  paymentMethodCode?: string;
};

/** What a cart still needs before it can become an order (Cart.missing). */
export type CartRequirement = "EMAIL" | "LINES" | "LINE_ISSUES" | "SHIPPING_ADDRESS" | "SHIPPING_METHOD" | "BILLING_ADDRESS" | "PAYMENT_METHOD";

export type ShippingRate = {
  code: string;
  name: string;
  description: string | null;
  price: Money | null;
  minDeliveryDays: number | null;
  maxDeliveryDays: number | null;
};

/**
 * `provider`: offline, test_gateway, stripe, … `sessionRequired`: needs a payment session before
 * the order is placed. An older API gives null and false.
 */
export type PaymentMethod = { code: string; name: string; instructions: string | null; provider: string | null; sessionRequired: boolean };

export type Country = { code: string; name: string };

export type Discount = { name: string; couponCode: string | null; amount: Money | null };

/** `subtotal`: quantity × unit price, before discounts and any tax added on top. */
export type CheckoutLine = CartLine & { subtotal: Money | null };

export type CheckoutCart = {
  id: string;
  /** Increments on every change to the cart. */
  version: number;
  email: string | null;
  requiresShipping: boolean;
  missing: CartRequirement[];
  /** As far as the shopper filled them in. */
  shippingAddress: Address | null;
  /** The cart's own, or else the shipping address. */
  billingAddress: Address | null;
  billingSameAsShipping: boolean;
  shippingMethods: ShippingRate[];
  /** Before shipping discounts (see `discounts`). The cheapest until the shopper chooses. */
  selectedShipping: { code: string; name: string; price: Money | null } | null;
  paymentMethods: PaymentMethod[];
  selectedPayment: PaymentMethod | null;
  coupons: { code: string; applied: boolean; reason: string | null }[];
  discounts: Discount[];
  cost: { subtotal: Money | null; total: Money | null; tax: Money | null; pricesIncludeTax: boolean } | null;
  lines: CheckoutLine[];
};

/** `path` runs from the argument root, e.g. ["input", "shippingAddress", "address", "postalCode"]. */
export type FieldError = { path: string[]; message: string };

/** What guestOrder needs to look the order up: its number, email and billing postal code. */
export type PlacedOrderRef = { number: string; email: string; billingAddress: { postalCode: string | null } | null };

export type PlacedOrder = {
  number: string;
  email: string;
  locale: string | null;
  status: "OPEN" | "COMPLETED" | "CANCELED";
  paymentStatus: "PENDING" | "AUTHORIZED" | "PAID" | "PARTIALLY_PAID" | "REFUNDED" | "PARTIALLY_REFUNDED" | "VOIDED" | null;
  placedAt: string | null;
  currencyCode: string;
  lines: {
    id: string;
    name: string;
    sku: string;
    quantity: number;
    unitPrice: Money | null;
    subtotal: Money | null;
    total: Money | null;
    product: { name: string; slug: string; media: { url: string; alt: string | null; kind: string }[] } | null;
    variant: { selectedOptions: { name: string; label: string }[]; media: { url: string; alt: string | null }[] } | null;
  }[];
  totals: { subtotal: Money | null; shipping: Money | null; tax: Money | null; total: Money | null; pricesIncludeTax: boolean; discounts: Discount[] | null } | null;
  shippingAddress: Address | null;
  billingAddress: Address | null;
  shippingMethod: { name: string } | null;
};
