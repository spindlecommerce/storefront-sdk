# SpindleCommerce storefront SDK

Packages for building storefronts on the [SpindleCommerce](https://github.com/spindlecommerce/spindlecommerce) Storefront API. The platform's Next.js sample storefront is built on them.

## Naming

Every package is under `@spindlecommerce`. The word after the scope says which side of the platform it is for:

| Prefix | For | Packages |
|---|---|---|
| `storefront-` | Shop frontends, on the public Storefront API | `storefront-client`, `storefront-react`, `storefront-next`, `storefront-cli` (this repository) |
| `plugin-` | Extending the platform | `plugin-sdk`, `plugin-shippo`, `plugin-hello-world` |
| `admin-` | The Admin API and the admin app | none yet |

Exports that could be read either way say so too: `createStorefrontClient`, `StorefrontApiError`, the `spindle-storefront` command. Cookies the packages set start with `spindle_`.

## The packages

**[`@spindlecommerce/storefront-client`](packages/storefront-client)** runs wherever `fetch` does: Node, edge runtimes and browsers.

- `createStorefrontClient({ url, channel, locale, currency, previewToken })` reads in one channel, language and currency: routes, product and category templates and sections, the header and footer, product listings, pages, the category tree, localized paths, preview sessions, countries and guest orders. `query()` runs your own documents, and `fragments` holds the client's to spread in them. Failures throw `StorefrontApiError` (status 0 when the API can't be reached) or `PreviewExpiredError`.
- `createCartSession(client, store)` keeps the cart's id in a `CartStore` you supply, such as a cookie or browser storage, and adds, updates, moves and checks out. Checkout returns typed results such as `{ ok: false, reason: "invalid", fieldErrors }`, with the API's English for the storefront to word.
- Helpers for variant choice (`chooseValue`, `inStock`), webhooks (`verifyWebhookSignature`, `changesFor`), visual editing markup (`editable`) and the API's path rules.
- `@spindlecommerce/storefront-client/schema.graphql` is the Storefront API's schema, for generating types for your own queries. Production APIs turn introspection off.

**[`@spindlecommerce/storefront-react`](packages/storefront-react)**: `createRenderer({ components, fallback })` renders page builder content with one component per code and a context the storefront extends. `useVariantSelection`, from `/client`, holds the shopper's options.

**[`@spindlecommerce/storefront-next`](packages/storefront-next)**, for the App Router:

- `createNextStorefront({ url, market })`. Reads are cached under tags outside draft mode, and fresh with the preview token in it. `getRoute` returns products and categories with their templates and own sections. `cart()` keeps the cart in an httpOnly cookie, and `privateClient()` serves anything else that must not be cached.
- `createDraftRoute`, `createDraftDisableRoute` and `createRevalidateRoute`: the routes [Connecting a frontend](https://github.com/spindlecommerce/spindlecommerce/blob/main/docs/visual-editing.md#connecting-a-frontend) asks for.
- `/client` has `<VisualEditing>`, `useCartCount` and `notifyCartChanged`. `/images` has `imagePatterns` and `isOptimizable` for `next/image`, and imports nothing from Next.js, so `next.config.ts` can load it.

**[`@spindlecommerce/storefront-cli`](packages/storefront-cli)**: `spindle-storefront components pull|push|types`, for [components in code](https://github.com/spindlecommerce/spindlecommerce/blob/main/docs/visual-editing.md#components-in-code).

## Compatibility

The packages are 0.x, so a minor version may break. A release works with the platform as it was when the release was made. `schema/storefront.graphql` is a copy of the platform's Storefront API schema, and the client's tests check its documents against it. Refresh it with `pnpm schema:pull` when the API changes. Where a document needs newer fields, the client falls back for older platforms. Checkout does this for the payment provider fields.

## Developing

```bash
pnpm install
pnpm typecheck   # each package, then the tests
pnpm test
pnpm build       # each package into its dist, the client first
```

Each package's `exports` has a `source` condition pointing at `src`. The others' `tsconfig.json` resolves it, so they type-check against each other's source without a build. `publishConfig.exports` drops it from the published `package.json`.

To try unreleased changes in a storefront, pack the packages and point the storefront's `pnpm-workspace.yaml` `overrides` at the tarballs, such as `file:../storefront-sdk/packages/storefront-client/spindlecommerce-storefront-client-0.1.0.tgz`:

```bash
pnpm build && pnpm -r exec pnpm pack
```

## Releasing

Versions and changelogs come from [Changesets](https://github.com/changesets/changesets), and each package is versioned on its own.

1. With each change, run `pnpm changeset` and commit the file it writes.
2. To release, run `pnpm changeset version`. It raises the versions and writes the changelogs. A package whose dependency moves out of its range is raised too. Commit and push.
3. Run `pnpm changeset git-tag`, then `git push --tags`. For each new tag, the Release workflow tests, builds and stages that version on npm, and creates the GitHub release.
4. Approve each staged version on npmjs.com, under **Staged Packages**, with 2FA.

The workflow publishes with npm's trusted publishing, so it needs no token. A package's first version is staged by hand, the client before the packages that depend on it:

```bash
pnpm build
cd packages/storefront-client && pnpm pack && npm stage publish spindlecommerce-storefront-client-0.1.0.tgz
```

Before a package's first release from the workflow, link it to the workflow. Run it just before tagging: npm drops a link that isn't used within 48 hours.

```bash
npm trust github @spindlecommerce/storefront-client --repo spindlecommerce/storefront-sdk --file release.yml --allow-stage-publish
```

## License

MIT
