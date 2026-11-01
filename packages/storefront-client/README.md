# @spindlecommerce/storefront-client

A typed client for the [SpindleCommerce](https://spindlecommerce.com) Storefront API. It runs wherever `fetch` does: Node, edge runtimes and browsers.

```ts
import { createCartSession, createStorefrontClient } from "@spindlecommerce/storefront-client";

const client = createStorefrontClient({ url: "https://api.example.com", channel: "eu", locale: "de-DE", currency: "EUR" });

const route = await client.route("/products/oxford-shirt");
const { products, endCursor } = await client.categoryProducts(categoryId, { first: 24 });

// The cart's id lives where you keep it: here, browser storage.
const cart = createCartSession(client, {
  get: () => localStorage.getItem("cart"),
  set: (c) => localStorage.setItem("cart", c.id),
  clear: () => localStorage.removeItem("cart"),
});
await cart.add([{ variantId, quantity: 1 }]);
const result = await cart.checkout.placeOrder({ idempotencyKey, payment: { token } });
```

- **Reads**: `route`, `routeTemplate`, `routeSections`, `site`, `newestProducts`, `categoryProducts`, `pages`, `productSlugs`, `categoryTree`, `localizedPath`, `previewSession`, `countries` and `guestOrder`. `query(document, variables)` runs your own, and `fragments` holds the client's to spread in them.
- **Errors**: `StorefrontApiError` (`status` 0 when the API can't be reached), and `PreviewExpiredError` for a preview token the API no longer accepts. Cart and checkout problems come back as values, such as `{ ok: false, reason: "invalid", fieldErrors }`.
- **Helpers**: `chooseValue` and `inStock` for variant pickers, `verifyWebhookSignature` and `changesFor` for platform webhooks, `editable` for visual editing markup.
- **Schema**: `@spindlecommerce/storefront-client/schema.graphql` is the Storefront API's schema, for generating types for your own queries.

React: [`@spindlecommerce/storefront-react`](https://www.npmjs.com/package/@spindlecommerce/storefront-react). Next.js: [`@spindlecommerce/storefront-next`](https://www.npmjs.com/package/@spindlecommerce/storefront-next).
