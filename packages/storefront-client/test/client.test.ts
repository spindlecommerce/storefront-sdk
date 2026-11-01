import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { buildSchema, parse, validate } from "graphql";
import { describe, expect, it } from "vitest";
import * as documents from "../src/documents.ts";
import {
  changesFor,
  chooseValue,
  createCartSession,
  createStorefrontClient,
  inStock,
  isPreviewExpired,
  parseWebhookEvent,
  StorefrontApiError,
  verifyWebhookSignature,
  type Cart,
  type WebhookEvent,
} from "../src/index.ts";

type Call = { url: string; init: RequestInit; query: string; variables: Record<string, unknown> };

/** A Storefront API that answers each request with `answer(call)`. */
const fakeApi = (answer: (call: Call) => unknown, status = 200) => {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit) => {
    const { query, variables } = JSON.parse(String(init.body)) as { query: string; variables: Record<string, unknown> };
    const call = { url, init, query, variables };
    calls.push(call);
    return Response.json(answer(call), { status });
  };
  return { calls, fetch };
};

const cart = (id: string, currencyCode = "GBP"): Cart => ({ id, isOpen: true, totalQuantity: 1, currencyCode, cost: null, lines: [] });

const memoryStore = (id: string | null = null) => {
  const store = {
    id,
    get: () => store.id,
    set: (c: Cart) => {
      store.id = c.id;
    },
    clear: () => {
      store.id = null;
    },
  };
  return store;
};

const operation = (call: Call) => /(query|mutation) (\w+)/.exec(call.query)?.[2];

describe("storefront client documents", () => {
  it("are valid against the Storefront API's schema", () => {
    const schema = buildSchema(readFileSync(new URL("../../../schema/storefront.graphql", import.meta.url), "utf8"));
    const all = Object.entries(documents).flatMap(([name, value]): [string, string][] => {
      if (typeof value === "function") return [[name, value(documents.PAYMENT_FIELDS)], [`${name} (older API)`, value(documents.LEGACY_PAYMENT_FIELDS)]];
      return typeof value === "string" && /^\s*(query|mutation) /.test(value) ? [[name, value]] : [];
    });
    expect(all.length).toBeGreaterThan(20);
    for (const [name, document] of all) expect(validate(schema, parse(document)).map((e) => `${name}: ${e.message}`)).toEqual([]);
  });
});

describe("storefront client", () => {
  it("sends the scope, the preview token and the caller's fetch options", async () => {
    const api = fakeApi(() => ({ data: { route: null } }));
    const client = createStorefrontClient({ url: "https://shop.example/", channel: "eu", locale: "de-DE", currency: "EUR", previewToken: "pt", fetch: api.fetch, init: { cache: "no-store" } });
    await client.route("/x");
    const [call] = api.calls;
    expect(call?.url).toBe("https://shop.example/graphql");
    expect(call?.init.headers).toMatchObject({ "x-channel": "eu", "x-locale": "de-DE", "x-currency": "EUR", "x-preview-token": "pt" });
    expect(call?.init.cache).toBe("no-store");
    expect(call?.variables).toEqual({ path: "/x" });
  });

  it("throws the API's errors, and a preview error for a refused preview token", async () => {
    const failing = createStorefrontClient({ url: "https://shop.example", channel: "eu", fetch: fakeApi(() => ({ errors: [{ message: "Boom", extensions: { code: "BAD_REQUEST" } }] }), 400).fetch });
    await expect(failing.route("/")).rejects.toMatchObject({ name: "StorefrontApiError", status: 400, codes: ["BAD_REQUEST"] });

    const unreachable = createStorefrontClient({ url: "https://shop.example", channel: "eu", fetch: () => Promise.reject(new TypeError("fetch failed")) });
    const error = await unreachable.route("/").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(StorefrontApiError);
    expect((error as StorefrontApiError).status).toBe(0);

    const expired = createStorefrontClient({ url: "https://shop.example", channel: "eu", previewToken: "old", fetch: fakeApi(() => ({ errors: [{ message: "No", extensions: { code: "UNAUTHENTICATED" } }] }), 401).fetch });
    expect(isPreviewExpired(await expired.route("/").catch((e: unknown) => e))).toBe(true);
    expect(await expired.previewSession()).toBeNull();
  });

  it("resolves media paths against the API's origin", () => {
    const client = createStorefrontClient({ url: "https://api.example/base", channel: "eu" });
    expect(client.mediaUrl("/media/a.jpg")).toBe("https://api.example/media/a.jpg");
    expect(client.mediaUrl("https://cdn.example/a.jpg")).toBe("https://cdn.example/a.jpg");
    expect(client.mediaUrl("//cdn.example/a.jpg")).toBe("//cdn.example/a.jpg");
  });
});

describe("cart session", () => {
  it("adds to the stored cart, and starts a new one when that became an order", async () => {
    const api = fakeApi((call) => {
      switch (operation(call)) {
        case "Cart":
          return { data: { cart: cart("old") } };
        case "CartLinesAdd":
          return { data: { result: { __typename: "InvalidStateError", code: "INVALID_STATE", message: "The cart is closed" } } };
        case "CartCreate":
          return { data: { result: { __typename: "CartPayload", cart: cart("new") } } };
      }
      throw new Error(`Unexpected ${operation(call)}`);
    });
    const store = memoryStore("old");
    const session = createCartSession(createStorefrontClient({ url: "https://shop.example", channel: "eu", fetch: api.fetch }), store);
    const added = await session.add([{ variantId: "v1", quantity: 2 }]);
    expect(added.id).toBe("new");
    expect(store.id).toBe("new");
    expect(api.calls.map(operation)).toEqual(["Cart", "CartLinesAdd", "CartCreate"]);
    expect(api.calls.every((c) => c.init.cache === "no-store")).toBe(true);
  });

  it("leaves a cart the storefront cannot use alone", async () => {
    const api = fakeApi((call) => (operation(call) === "Cart" ? { data: { cart: cart("usd", "USD") } } : { data: { result: { __typename: "CartPayload", cart: cart("gbp") } } }));
    const store = memoryStore("usd");
    const session = createCartSession(createStorefrontClient({ url: "https://shop.example", channel: "eu", fetch: api.fetch }), store, { isUsable: (c) => c.isOpen && c.currencyCode === "GBP" });
    expect(await session.get()).toBeNull();
    expect((await session.add([{ variantId: "v1", quantity: 1 }])).id).toBe("gbp");
    expect(api.calls.map(operation)).toEqual(["Cart", "Cart", "CartCreate"]);
  });

  it("reports stock problems and forgets a cart that is gone", async () => {
    const stock = fakeApi(() => ({ data: { result: { __typename: "InsufficientStockError", code: "INSUFFICIENT_STOCK", message: "Not enough", available: 2 } } }));
    const session = createCartSession(createStorefrontClient({ url: "https://shop.example", channel: "eu", fetch: stock.fetch }), memoryStore("c1"));
    await expect(session.update("line", 5)).rejects.toMatchObject({ name: "CartError", code: "INSUFFICIENT_STOCK", available: 2 });

    const gone = fakeApi(() => ({ data: { result: { __typename: "NotFoundError", code: "NOT_FOUND", message: "No cart" } } }));
    const store = memoryStore("c1");
    const change = await createCartSession(createStorefrontClient({ url: "https://shop.example", channel: "eu", fetch: gone.fetch }), store).checkout.update({ email: "a@example.com" });
    expect(change).toMatchObject({ ok: false, reason: "expired" });
    expect(store.id).toBeNull();
  });

  it("returns the order a cart already became when placing it again", async () => {
    const order = { number: "EU-1", email: "a@example.com", billingAddress: { postalCode: "10115" } };
    const api = fakeApi((call) =>
      operation(call) === "CheckoutPlaceOrder"
        ? { data: { result: { __typename: "InvalidStateError", code: "INVALID_STATE", message: "Already placed" } } }
        : { data: { cart: { isOpen: false, order } } },
    );
    const store = memoryStore("c1");
    const result = await createCartSession(createStorefrontClient({ url: "https://shop.example", channel: "eu", fetch: api.fetch }), store).checkout.placeOrder({ idempotencyKey: "key-12345678" });
    expect(result).toEqual({ ok: true, order, cartId: "c1" });
    expect(store.id).toBeNull();
  });

  it("reads checkout from an API without the newer payment fields", async () => {
    const api = fakeApi((call) =>
      call.query.includes("sessionRequired")
        ? { errors: [{ message: 'Cannot query field "provider" on type "PaymentMethodOption".' }] }
        : {
            data: {
              cart: {
                id: "c1", isOpen: true, currencyCode: "GBP", version: 3, email: null, requiresShipping: true, missing: ["EMAIL"], billingSameAsShipping: true,
                shippingAddress: null, billingAddress: null, availableShippingMethods: [], selectedShippingMethod: null,
                availablePaymentMethods: [{ code: "invoice", name: null, instructions: null }], selectedPaymentMethod: { code: "invoice" },
                coupons: null, discounts: null, cost: null, lines: [],
              },
            },
          },
    );
    const checkout = await createCartSession(createStorefrontClient({ url: "https://shop.example", channel: "eu", fetch: api.fetch }), memoryStore("c1")).checkout.get();
    expect(checkout?.selectedPayment).toEqual({ code: "invoice", name: "invoice", instructions: null, provider: null, sessionRequired: false });
    expect(api.calls).toHaveLength(2);
  });
});

describe("webhooks", () => {
  const secret = "whsec_test";
  const sign = (body: string, t: number) => `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
  const now = 1_800_000_000;

  it("accepts its own signature and refuses changed, stale or malformed ones", async () => {
    const body = JSON.stringify({ id: "e1", type: "page.published", occurredAt: "", data: { path: "/sale" } });
    expect(await verifyWebhookSignature(secret, body, sign(body, now), now)).toBe(true);
    expect(await verifyWebhookSignature(secret, `${body} `, sign(body, now), now)).toBe(false);
    expect(await verifyWebhookSignature(secret, body, sign(body, now - 600), now)).toBe(false);
    expect(await verifyWebhookSignature(secret, body, "t=1,v1=zz", now)).toBe(false);
    expect(await verifyWebhookSignature(secret, body, null, now)).toBe(false);
    expect(parseWebhookEvent(body)?.type).toBe("page.published");
    expect(parseWebhookEvent("[]")).toBeNull();
  });

  it("names what an event changed", () => {
    const event = (type: string, data: WebhookEvent["data"] = {}): WebhookEvent => ({ id: "e", type, occurredAt: "", data });
    expect(changesFor(event("page.published", { path: "/sale", previousPath: "/old" }))).toEqual({
      changes: [{ kind: "path", path: "/sale" }, { kind: "path", path: "/old" }, { kind: "pages" }],
      immediate: true,
    });
    expect(changesFor(event("page.published", { path: "/sale", previousPath: "/sale" })).changes).toEqual([{ kind: "path", path: "/sale" }]);
    expect(changesFor(event("page.published", { type: "site_header" })).changes).toEqual([{ kind: "singleton", type: "site_header" }]);
    expect(changesFor(event("page.published", { templateFor: "product" })).changes).toContainEqual({ kind: "templates", for: "product" });
    expect(changesFor(event("component.updated"))).toEqual({ changes: [{ kind: "everything" }], immediate: true });
    expect(changesFor(event("inventory.changed"))).toEqual({ changes: [{ kind: "catalog" }], immediate: false });
    expect(changesFor(event("order.placed"))).toEqual({ changes: [], immediate: false });
  });
});

describe("variants", () => {
  const variant = (id: string, color: string, size: string, isAvailable = true) => ({ id, isAvailable, selectedOptions: [{ attribute: "color", value: color }, { attribute: "size", value: size }] });
  const variants = [variant("blue-s", "blue", "s"), variant("blue-m", "blue", "m", false), variant("red-m", "red", "m")];

  it("keeps the other choices when the combination exists, and moves to one in stock otherwise", () => {
    expect(chooseValue(variants, { color: "blue", size: "s" }, "size", "m").variant?.id).toBe("blue-m");
    expect(chooseValue(variants, { color: "blue", size: "s" }, "color", "red")).toEqual({ selection: { color: "red", size: "m" }, variant: variants[2] });
    expect(inStock(variants, { color: "blue", size: "s" }, "size", "m")).toBe(false);
    expect(inStock(variants, { color: "red", size: "m" }, "size", "m")).toBe(true);
  });
});
