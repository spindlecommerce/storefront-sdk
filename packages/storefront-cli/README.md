# @spindlecommerce/storefront-cli

Page builder components defined in a [SpindleCommerce](https://spindlecommerce.com) storefront's code: deploy them to the platform, and generate TypeScript types for their content.

```bash
pnpm add -D @spindlecommerce/storefront-cli

spindle-storefront components pull --out components.json        # export the platform's library
spindle-storefront components push components.json [--prune]   # deploy definitions
spindle-storefront components types --from components.json --out lib/builder-components.ts
```

`push` updates components by code and marks them as managed in code; the admin warns before anyone edits those. `--prune` deletes code-managed components missing from the file, and is refused while pages use them. The whole push is one transaction.

The commands call the Admin API with an admin API key: `content:read` to pull, `content:write` to push. Pass `--url` and `--key`, or set `SPINDLE_API_URL` and `SPINDLE_API_KEY`. `--env-file .env.local` also reads them from that file, if it exists.

`generateTypes(definitions)` is also exported, for build scripts.
