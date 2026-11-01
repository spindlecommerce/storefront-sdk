import type { RequestOptions, StorefrontClient } from "./client.ts";
import {
  CART_CREATE,
  CART_LINES_ADD,
  CART_LINES_REMOVE,
  CART_LINES_UPDATE,
  CART_MOVE,
  CART_QUERY,
  CART_UPDATE,
  checkoutCart,
  CONVERTED_CART,
  COUPON_APPLY,
  COUPON_REMOVE,
  LEGACY_PAYMENT_FIELDS,
  PAYMENT_FIELDS,
  PAYMENT_SESSION_CREATE,
  PLACE_ORDER,
} from "./documents.ts";
import { StorefrontApiError } from "./errors.ts";
import type { Cart, CartRequirement, CartUpdateInput, CheckoutCart, CheckoutLine, Discount, FieldError, Money, PaymentMethod, PlacedOrderRef, ShippingRate } from "./types.ts";

/** Where the cart's id is kept between requests, such as a cookie or browser storage. */
export type CartStore = {
  get: () => string | null | Promise<string | null>;
  /** After every change, with the cart as it now is. */
  set: (cart: Cart) => void | Promise<void>;
  clear: () => void | Promise<void>;
};

/** A failed cart change. `available` is set when there is not enough stock. */
export class CartError extends Error {
  readonly code: string;
  readonly available: number | null;
  constructor(message: string, code: string, available: number | null = null) {
    super(message);
    this.name = "CartError";
    this.code = code;
    this.available = available;
  }
}

/** "invalid": fix the input. "expired": the cart is gone. "closed": it became an order. */
export type CartChange =
  | { ok: true }
  | {
      ok: false;
      reason: "invalid" | "expired" | "closed" | "error";
      /** The API's result type, such as ValidationError or CouponNotApplicableError. */
      type: string | null;
      /** The API's message, in English. */
      message: string | null;
      fieldErrors: FieldError[];
      /** Why a coupon does not apply, in the API's English. */
      couponReason: string | null;
    };

export type PaymentSession = { provider: string; methodCode: string; amount: Money | null; clientData: Record<string, unknown> };

/** "not_ready": the cart still lacks details. "refused": it became an order, or the provider said no. */
export type PaymentSessionResult = { ok: true; session: PaymentSession } | { ok: false; reason: "expired" | "not_ready" | "refused"; message: string | null };

/**
 * After "error" the outcome is unknown, so a retry reuses the idempotency key. After the others, it
 * is a new attempt.
 */
export type PlaceOrderFailure = "declined" | "not_ready" | "stock" | "closed" | "expired" | "invalid" | "error";

export type PlaceOrderResult =
  | { ok: true; order: PlacedOrderRef; cartId: string }
  | { ok: false; reason: PlaceOrderFailure; type: string | null; message: string | null; missing: CartRequirement[]; fieldErrors: FieldError[] };

type CartResult = { __typename: string; cart?: Cart | null; code?: string; message?: string; available?: number | null };

type ResultUnion = {
  __typename: string;
  code?: string | null;
  message?: string | null;
  fieldErrors?: { path: string[] | null; message: string | null }[] | null;
  reason?: string | null;
};

type PlaceOrderUnion = ResultUnion & { order?: PlacedOrderRef | null; missing?: CartRequirement[] | null };

type RawPaymentMethod = { code: string; name: string | null; instructions: string | null; provider?: string | null; sessionRequired?: boolean | null };

type RawCheckoutCart = Omit<CheckoutCart, "shippingMethods" | "selectedShipping" | "paymentMethods" | "selectedPayment" | "missing" | "coupons" | "discounts" | "lines"> & {
  isOpen: boolean;
  currencyCode: string | null;
  missing: CartRequirement[] | null;
  availableShippingMethods: ShippingRate[] | null;
  selectedShippingMethod: CheckoutCart["selectedShipping"];
  availablePaymentMethods: RawPaymentMethod[] | null;
  selectedPaymentMethod: { code: string } | null;
  coupons: CheckoutCart["coupons"] | null;
  discounts: Discount[] | null;
  lines: CheckoutLine[] | null;
};

const FRESH: RequestOptions = { init: { cache: "no-store" } };

/** NotFoundError: the cart is gone. InvalidStateError: it became an order. */
const isGone = (typename: string | undefined) => typename === "NotFoundError" || typename === "InvalidStateError";

const unwrap = (result: CartResult | null | undefined): Cart => {
  if (result?.cart) return result.cart;
  throw new CartError(result?.message ?? "The cart could not be updated", result?.code ?? result?.__typename ?? "UNKNOWN", result?.available ?? null);
};

const fieldErrorsOf = (errors: ResultUnion["fieldErrors"]): FieldError[] => (errors ?? []).flatMap((e) => (e.path?.length && e.message ? [{ path: e.path, message: e.message }] : []));

const lacksPaymentFields = (error: unknown) => error instanceof StorefrontApiError && /Cannot query field "(provider|sessionRequired)"/.test(error.message);

const toPaymentMethod = (m: RawPaymentMethod): PaymentMethod => ({
  code: m.code,
  name: m.name || m.code,
  instructions: m.instructions,
  provider: m.provider ?? null,
  sessionRequired: m.sessionRequired ?? false,
});

const toChange = (result: ResultUnion | null | undefined): CartChange => {
  const failure = (reason: "invalid" | "expired" | "closed" | "error"): CartChange => ({
    ok: false,
    reason,
    type: result?.__typename ?? null,
    message: result?.message ?? null,
    fieldErrors: fieldErrorsOf(result?.fieldErrors),
    couponReason: result?.reason ?? null,
  });
  switch (result?.__typename) {
    case "CartPayload":
      return { ok: true };
    case "ValidationError":
    case "CouponNotApplicableError":
      return failure("invalid");
    case "NotFoundError":
      return failure("expired");
    case "InvalidStateError":
      return failure("closed");
    default:
      return failure("error");
  }
};

export type CartSessionOptions = {
  /** Whether a stored cart can still be used, e.g. not one in another channel's currency. By default, while it is open. */
  isUsable?: (cart: { isOpen: boolean; currencyCode: string | null }) => boolean;
};

/** The shopper's cart and checkout, with the cart's id kept in `store`. Nothing is read from a cache. */
export const createCartSession = (client: StorefrontClient, store: CartStore, options: CartSessionOptions = {}) => {
  const isUsable = options.isUsable ?? ((cart) => cart.isOpen);
  const run = <T>(document: string, variables: Record<string, unknown>) => client.query<T>(document, variables, FRESH);
  const keep = async (cart: Cart) => {
    await store.set(cart);
    return cart;
  };

  const get = async (): Promise<Cart | null> => {
    const id = await store.get();
    if (!id) return null;
    const { cart } = await run<{ cart: Cart | null }>(CART_QUERY, { id });
    return cart && isUsable(cart) ? cart : null;
  };

  /** Creates a cart on the first add, or when the stored one became an order or was removed. */
  const add = async (lines: { variantId: string; quantity: number }[]) => {
    const id = await store.get();
    if (id && (await get())) {
      const { result } = await run<{ result: CartResult }>(CART_LINES_ADD, { id, lines });
      if (!isGone(result.__typename)) return keep(unwrap(result));
    }
    return keep(unwrap((await run<{ result: CartResult }>(CART_CREATE, { lines })).result));
  };

  /** Changes a line's quantity; 0 removes the line. */
  const update = async (lineId: string, quantity: number) => {
    const id = await store.get();
    if (!id) throw new CartError("The cart has expired", "NOT_FOUND");
    const { result } =
      quantity > 0
        ? await run<{ result: CartResult }>(CART_LINES_UPDATE, { id, lines: [{ lineId, quantity }] })
        : await run<{ result: CartResult }>(CART_LINES_REMOVE, { id, lineIds: [lineId] });
    if (isGone(result.__typename)) {
      await store.clear();
      throw new CartError("The cart has expired", "NOT_FOUND");
    }
    return keep(unwrap(result));
  };

  /** Moves the cart to another of the channel's languages and currencies, keeping its items, codes and details. */
  const move = async (to: { locale: string; currency: string }) => {
    const id = await store.get();
    if (!id) return;
    const { result } = await run<{ result: CartResult }>(CART_MOVE, { id, input: { locale: to.locale, currencyCode: to.currency } });
    if (result.cart) await store.set(result.cart);
    else if (isGone(result.__typename)) await store.clear();
    else throw new CartError(result.message ?? "The cart could not be moved", result.code ?? result.__typename);
  };

  /** A change to the stored cart. A cart that is gone is forgotten. */
  const change = async (document: string, variables: Record<string, unknown>): Promise<CartChange> => {
    const id = await store.get();
    if (!id) return toChange({ __typename: "NotFoundError" });
    const { result } = await run<{ result: ResultUnion | null }>(document, { cartId: id, ...variables });
    const outcome = toChange(result);
    if (!outcome.ok && outcome.reason === "expired") await store.clear();
    return outcome;
  };

  /** The order a cart already became, e.g. when a payment webhook placed it first. */
  const convertedOrder = async (id: string): Promise<PlacedOrderRef | null> => {
    try {
      const { cart } = await run<{ cart: { isOpen: boolean; order: PlacedOrderRef | null } | null }>(CONVERTED_CART, { id });
      return cart && !cart.isOpen ? cart.order : null;
    } catch (error) {
      console.error("Could not check whether the cart became an order", error);
      return null;
    }
  };

  const checkout = {
    /** The cart with everything checkout shows; null when there is none to check out. */
    get: async (): Promise<CheckoutCart | null> => {
      const id = await store.get();
      if (!id) return null;
      type Data = { cart: RawCheckoutCart | null };
      let data: Data;
      try {
        data = await run<Data>(checkoutCart(PAYMENT_FIELDS), { id });
      } catch (error) {
        // An older API without these fields: everything but the payment form works.
        if (!lacksPaymentFields(error)) throw error;
        data = await run<Data>(checkoutCart(LEGACY_PAYMENT_FIELDS), { id });
      }
      const cart = data.cart;
      if (!cart || !isUsable(cart)) return null;
      const paymentMethods = (cart.availablePaymentMethods ?? []).map(toPaymentMethod);
      return {
        id: cart.id,
        version: cart.version,
        email: cart.email,
        requiresShipping: cart.requiresShipping,
        missing: cart.missing ?? [],
        shippingAddress: cart.shippingAddress,
        billingAddress: cart.billingAddress,
        billingSameAsShipping: cart.billingSameAsShipping,
        shippingMethods: cart.availableShippingMethods ?? [],
        selectedShipping: cart.selectedShippingMethod,
        paymentMethods,
        selectedPayment: paymentMethods.find((m) => m.code === cart.selectedPaymentMethod?.code) ?? null,
        coupons: cart.coupons ?? [],
        discounts: cart.discounts ?? [],
        cost: cart.cost,
        lines: cart.lines ?? [],
      };
    },
    /** Saves any of the shopper's details, complete or not. */
    update: (input: CartUpdateInput) => change(CART_UPDATE, { input }),
    applyCoupon: (code: string) => change(COUPON_APPLY, { code }),
    removeCoupon: (code: string) => change(COUPON_REMOVE, { code }),
    /** Starts the payment session, or updates it after the total changed. For Stripe, a PaymentIntent's client secret and the publishable key. */
    createPaymentSession: async (): Promise<PaymentSessionResult> => {
      const id = await store.get();
      if (!id) return { ok: false, reason: "expired", message: null };
      type Session = Omit<PaymentSession, "clientData"> & { clientData: Record<string, unknown> | null };
      const { result } = await run<{ result: (ResultUnion & { session?: Session | null }) | null }>(PAYMENT_SESSION_CREATE, { cartId: id });
      if (result?.__typename === "CartPaymentSessionPayload" && result.session) return { ok: true, session: { ...result.session, clientData: result.session.clientData ?? {} } };
      if (result?.__typename === "CartNotReadyError") return { ok: false, reason: "not_ready", message: result.message ?? null };
      // InvalidStateError: the cart became an order, or the provider refused (the message says why).
      return { ok: false, reason: "refused", message: result?.message ?? null };
    },
    /**
     * Saves `input` and places the order in one call, then forgets the cart. Retrying with the same
     * idempotency key returns the same order instead of placing another.
     */
    placeOrder: async (order: { idempotencyKey: string; payment?: { token?: string }; input?: CartUpdateInput }): Promise<PlaceOrderResult> => {
      const fail = (reason: PlaceOrderFailure, result?: PlaceOrderUnion | null): PlaceOrderResult => ({
        ok: false,
        reason,
        type: result?.__typename ?? null,
        message: result?.message ?? null,
        missing: result?.missing ?? [],
        fieldErrors: fieldErrorsOf(result?.fieldErrors),
      });
      const id = await store.get();
      if (!id) return fail("expired");
      const placed = async (ref: PlacedOrderRef): Promise<PlaceOrderResult> => {
        await store.clear();
        return { ok: true, order: ref, cartId: id };
      };
      const { result } = await run<{ result: PlaceOrderUnion | null }>(PLACE_ORDER, { cartId: id, idempotencyKey: order.idempotencyKey, payment: order.payment ?? {}, input: order.input ?? null });
      switch (result?.__typename) {
        case "CheckoutPayload":
          if (result.order) return placed(result.order);
          break;
        case "PaymentDeclinedError":
          return fail("declined", result);
        case "CartNotReadyError":
          return fail("not_ready", result);
        case "InsufficientStockError":
          return fail("stock", result);
        case "InvalidStateError": {
          const ref = await convertedOrder(id);
          return ref ? placed(ref) : fail("closed", result);
        }
        case "NotFoundError":
          await store.clear();
          return fail("expired", result);
        case "ValidationError":
          return fail("invalid", result);
      }
      return fail("error", result);
    },
  };

  return { id: () => store.get(), get, add, update, move, forget: () => store.clear(), checkout };
};

export type CartSession = ReturnType<typeof createCartSession>;
