# @spindlecommerce/storefront-next

Next.js App Router integration for [SpindleCommerce](https://spindlecommerce.com) storefronts, on [`@spindlecommerce/storefront-client`](https://www.npmjs.com/package/@spindlecommerce/storefront-client).

```ts
// lib/storefront.ts
import { createNextStorefront } from "@spindlecommerce/storefront-next";

export const storefront = createNextStorefront({
  url: process.env.SPINDLE_API_URL!,
  market: async () => ({ channel: "eu", locale: "en-GB", currency: "GBP" }),
});
```

- **Reads** (`getRoute`, `getSite`, `getNewestProducts`, `getCategoryProducts`, `getLocalizedPath`, `getSitemap`) are cached under tags (`TAG`) and refetched after `revalidate` seconds (300). In draft mode they read fresh, with the preview token. `reader(tags)` gives a client for your own cached queries.
- **The cart** lives in an httpOnly cookie: `const cart = await storefront.cart()`, then `cart.add(lines)`, `cart.update(lineId, quantity)`, `cart.move({ locale, currency })` or `cart.checkout.placeOrder(…)`. Make changes in Server Actions or Route Handlers.
- **Routes** for the platform's preview and webhooks:

```ts
// app/api/draft/route.ts
export const GET = createDraftRoute(storefront, { channel: "eu" });
// app/api/draft/disable/route.ts
const route = createDraftDisableRoute();
export const GET = route.GET;
export const POST = route.POST;
// app/api/revalidate/route.ts: verifies x-spindle-signature with SPINDLE_REVALIDATE_SECRET
export const POST = createRevalidateRoute();
```

- **In the browser** (`@spindlecommerce/storefront-next/client`): `<VisualEditing adminOrigin bridgeUrl />` connects draft pages to the admin's editor, and `useCartCount()` and `notifyCartChanged()` keep a cart badge current without making pages dynamic.
- **Images** (`@spindlecommerce/storefront-next/images`): `imagePatterns({ apiUrl, mediaHosts })` for `images.remotePatterns`, and `isOptimizable(src, patterns)`.
