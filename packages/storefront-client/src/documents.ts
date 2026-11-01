/** The GraphQL documents behind the client's methods. */

const MONEY = `fragment Money on Money { amount currencyCode formatted }`;

const ADDRESS = `fragment Address on Address { firstName lastName company line1 line2 city region regionCode postalCode countryCode phone }`;

const PRODUCT_SUMMARY = `
  fragment ProductSummary on Product {
    id name slug isAvailable
    priceRange { minVariantPrice { ...Money } maxVariantPrice { ...Money } compareAtMinVariantPrice { ...Money } }
    media { url alt kind variant { id } }
    options { attribute { code label } values { code label swatch } }
    variants { id isAvailable selectedOptions { attribute value } }
  }
  ${MONEY}`;

const BUILDER_PAGE = `
  fragment BuilderPage on Page {
    id type path title isPreview publishedAt updatedAt
    seo { title description noIndex image { url alt width height } }
    content
    references {
      products { ...ProductSummary }
      categories { id name path }
      pages { id path title }
    }
  }`;

const CART = `
  fragment Cart on Cart {
    id isOpen totalQuantity currencyCode
    cost { subtotal { ...Money } total { ...Money } tax { ...Money } shipping { ...Money } discountTotal { ...Money } pricesIncludeTax }
    lines {
      id name quantity quantityAvailable
      unitPrice { ...Money } compareAtUnitPrice { ...Money } total { ...Money }
      issue { code message }
      product { name slug media { url alt kind } }
      variant { id name selectedOptions { name label } media { url alt } }
    }
  }
  ${MONEY}`;

/** For your own documents: spread `...ProductSummary` and append the fragment. */
export const fragments = { money: MONEY, address: ADDRESS, productSummary: PRODUCT_SUMMARY, builderPage: `${BUILDER_PAGE}${PRODUCT_SUMMARY}`, cart: CART };

// ---------------------------------------------------------------- catalog and pages

export const ROUTE = `
  query Route($path: String!) {
    route(path: $path) {
      __typename
      ... on Page { ...BuilderPage }
      ... on Product {
        ...ProductSummary
        description
        seo { title description }
        categories { id name path }
        media { id url alt kind position variant { id } }
        variants {
          id sku name isAvailable quantityAvailable
          price { ...Money } compareAtPrice { ...Money }
          selectedOptions { attribute value label name swatch }
          media { url alt }
        }
        attributes { attribute { code label } value }
      }
      ... on Category { id name slug path description ancestors { id name path } children { id name path } }
      ... on Redirect { location statusCode }
    }
  }
  ${BUILDER_PAGE}
  ${PRODUCT_SUMMARY}`;

// Not part of the route query, which would then select more than the API's limit of 250 fields
// (counting the __typename and id fields its response cache adds).
export const TEMPLATE = `
  query Template($path: String!) {
    route(path: $path) {
      ... on Product { template { ...BuilderPage templateFor } }
      ... on Category { template { ...BuilderPage templateFor } }
    }
  }
  ${BUILDER_PAGE}
  ${PRODUCT_SUMMARY}`;

// Not part of the route query either, for the same reason.
export const SECTIONS = `
  query Sections($path: String!) {
    route(path: $path) {
      ... on Product { sections { ...BuilderPage } }
      ... on Category { sections { ...BuilderPage } }
    }
  }
  ${BUILDER_PAGE}
  ${PRODUCT_SUMMARY}`;

export const SITE = `
  query Site($header: String!, $footer: String!) {
    header: singletonPage(type: $header) { ...BuilderPage }
    footer: singletonPage(type: $footer) { ...BuilderPage }
    localization { locale currencyCode channel { code name } }
  }
  ${BUILDER_PAGE}
  ${PRODUCT_SUMMARY}`;

export const NEWEST_PRODUCTS = `
  query NewestProducts($first: Int!) {
    products(first: $first, sort: { field: NEWEST, direction: DESC }) { edges { node { ...ProductSummary } } }
  }
  ${PRODUCT_SUMMARY}`;

export const CATEGORY_PRODUCTS = `
  query CategoryProducts($id: ID!, $first: Int!, $after: String, $sort: ProductSortInput) {
    category(id: $id) {
      id name path
      products(first: $first, after: $after, sort: $sort) {
        totalCount
        pageInfo { hasNextPage endCursor }
        edges { node { ...ProductSummary } }
      }
    }
  }
  ${PRODUCT_SUMMARY}`;

export const PAGES = `
  query Pages($type: String, $first: Int!, $after: String) {
    pages(type: $type, first: $first, after: $after) {
      pageInfo { hasNextPage endCursor }
      edges { node { path updatedAt seo { noIndex } } }
    }
  }`;

export const PRODUCT_SLUGS = `
  query ProductSlugs($after: String) {
    products(first: 100, after: $after) { pageInfo { hasNextPage endCursor } edges { node { slug } } }
  }`;

export const CATEGORY_TREE = `
  query CategoryTree { categoryTree { path children { path children { path children { path } } } } }`;

export const LOCALIZED_PATH = `
  query LocalizedPath($id: ID!) {
    node(id: $id) { ... on Product { slug } ... on Category { path } }
  }`;

export const PREVIEW_SESSION = `query PreviewSession { previewSession { expiresAt adminOrigin at } }`;

export const COUNTRIES = `query Countries { localization { locale channel { countries { code name } } } }`;

// ---------------------------------------------------------------- carts

/** Only adding and changing quantities can return InsufficientStockError. */
const cartResult = (canRunOutOfStock: boolean) => `
  __typename
  ... on CartPayload { cart { ...Cart } }
  ... on Error { code message }
  ${canRunOutOfStock ? "... on InsufficientStockError { available }" : ""}`;

export const CART_QUERY = `query Cart($id: ID!) { cart(id: $id) { ...Cart } } ${CART}`;

export const CART_CREATE = `mutation CartCreate($lines: [CartLineInput!]) { result: cartCreate(input: { lines: $lines }) { ${cartResult(true)} } } ${CART}`;

export const CART_LINES_ADD = `mutation CartLinesAdd($id: ID!, $lines: [CartLineInput!]!) { result: cartLinesAdd(cartId: $id, lines: $lines) { ${cartResult(true)} } } ${CART}`;

export const CART_LINES_UPDATE = `mutation CartLinesUpdate($id: ID!, $lines: [CartLineUpdateInput!]!) { result: cartLinesUpdate(cartId: $id, lines: $lines) { ${cartResult(true)} } } ${CART}`;

export const CART_LINES_REMOVE = `mutation CartLinesRemove($id: ID!, $lineIds: [ID!]!) { result: cartLinesRemove(cartId: $id, lineIds: $lineIds) { ${cartResult(false)} } } ${CART}`;

export const CART_MOVE = `mutation CartMove($id: ID!, $input: CartUpdateInput!) { result: cartUpdate(cartId: $id, input: $input) { ${cartResult(false)} } } ${CART}`;

// ---------------------------------------------------------------- checkout

/** PaymentMethodOption.provider and sessionRequired are newer than the rest of the API. */
export const PAYMENT_FIELDS = "code name instructions provider sessionRequired";
export const LEGACY_PAYMENT_FIELDS = "code name instructions";

export const checkoutCart = (paymentFields: string) => `
  query CheckoutCart($id: ID!) {
    cart(id: $id) {
      id isOpen currencyCode version email requiresShipping missing billingSameAsShipping
      shippingAddress { ...Address }
      billingAddress { ...Address }
      availableShippingMethods { code name description price { ...Money } minDeliveryDays maxDeliveryDays }
      selectedShippingMethod { code name price { ...Money } }
      availablePaymentMethods { ${paymentFields} }
      selectedPaymentMethod { code }
      coupons { code applied reason }
      discounts { name couponCode amount { ...Money } }
      cost { subtotal { ...Money } total { ...Money } tax { ...Money } pricesIncludeTax }
      lines {
        id name quantity quantityAvailable
        unitPrice { ...Money } compareAtUnitPrice { ...Money } subtotal { ...Money } total { ...Money }
        issue { code message }
        product { name slug media { url alt kind } }
        variant { id name selectedOptions { name label } media { url alt } }
      }
    }
  }
  ${MONEY}
  ${ADDRESS}`;

/** What checkout reads of a cart mutation's result. */
const CHANGE_RESULT = `__typename ... on Error { code message } ... on ValidationError { fieldErrors { path message } }`;

export const CART_UPDATE = `mutation CheckoutUpdate($cartId: ID!, $input: CartUpdateInput!) { result: cartUpdate(cartId: $cartId, input: $input) { ${CHANGE_RESULT} } }`;

export const COUPON_APPLY = `mutation CheckoutCouponApply($cartId: ID!, $code: String!) { result: cartCouponApply(cartId: $cartId, code: $code) { ${CHANGE_RESULT} ... on CouponNotApplicableError { reason } } }`;

export const COUPON_REMOVE = `mutation CheckoutCouponRemove($cartId: ID!, $code: String!) { result: cartCouponRemove(cartId: $cartId, code: $code) { ${CHANGE_RESULT} } }`;

export const PAYMENT_SESSION_CREATE = `
  mutation CheckoutPaymentSession($cartId: ID!) {
    result: cartPaymentSessionCreate(cartId: $cartId) {
      __typename
      ... on CartPaymentSessionPayload { session { provider methodCode amount { ...Money } clientData } }
      ... on Error { code message }
    }
  }
  ${MONEY}`;

const PLACED = `number email billingAddress { postalCode }`;

export const PLACE_ORDER = `
  mutation CheckoutPlaceOrder($cartId: ID!, $idempotencyKey: String!, $input: CartUpdateInput, $payment: PaymentDataInput) {
    result: checkoutPlaceOrder(cartId: $cartId, idempotencyKey: $idempotencyKey, input: $input, payment: $payment) {
      __typename
      ... on CheckoutPayload { order { ${PLACED} } }
      ... on Error { code message }
      ... on ValidationError { fieldErrors { path message } }
      ... on CartNotReadyError { missing fieldErrors { path message } }
      ... on InsufficientStockError { sku available }
    }
  }`;

/** A cart that became an order elsewhere: a payment webhook, or another tab. */
export const CONVERTED_CART = `query CheckoutConvertedCart($id: ID!) { cart(id: $id) { isOpen order { ${PLACED} } } }`;

export const GUEST_ORDER = `
  query GuestOrder($email: EmailAddress!, $number: String!, $postalCode: String!, $cartId: ID!) {
    order: guestOrder(email: $email, number: $number, postalCode: $postalCode) {
      number email locale status paymentStatus placedAt currencyCode
      lines {
        id name sku quantity
        unitPrice { ...Money } subtotal { ...Money } total { ...Money }
        product { name slug media { url alt kind } }
        variant { selectedOptions { name label } media { url alt } }
      }
      totals { subtotal { ...Money } shipping { ...Money } tax { ...Money } total { ...Money } pricesIncludeTax discounts { name couponCode amount { ...Money } } }
      shippingAddress { ...Address }
      billingAddress { ...Address }
      shippingMethod { name }
    }
    cart(id: $cartId) { selectedPaymentMethod { code name instructions } }
  }
  ${MONEY}
  ${ADDRESS}`;
