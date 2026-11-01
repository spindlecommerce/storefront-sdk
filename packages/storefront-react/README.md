# @spindlecommerce/storefront-react

React bindings for [SpindleCommerce](https://spindlecommerce.com) storefronts, on [`@spindlecommerce/storefront-client`](https://www.npmjs.com/package/@spindlecommerce/storefront-client).

**Page builder content.** One component per code, with a context of your own. Components may be async Server Components.

```tsx
import { createRenderer, type NodeProps } from "@spindlecommerce/storefront-react";

type Own = { tone: "light" | "dark" };

const { RenderNode, contextFor } = createRenderer<Own>({
  components: { hero: Hero, rich_text: RichText },
  fallback: ({ node }) => null, // codes the storefront doesn't know yet
});

function Hero({ node, ctx }: NodeProps<HeroNode, Own>) {
  return <section {...ctx.edit.node(node)}>{ctx.renderBlocks(node.fields.actions)}</section>;
}

const ctx = contextFor(page, draft, { tone: "light" });
page.content.fields.sections.map((section) => <RenderNode key={section.id} node={section} ctx={ctx} />);
```

`spindle-storefront components types` ([`@spindlecommerce/storefront-cli`](https://www.npmjs.com/package/@spindlecommerce/storefront-cli)) generates the node types, such as `HeroNode`.

**Variant pickers.** `useVariantSelection(variants)`, from `@spindlecommerce/storefront-react/client`, returns `selection`, `variant`, `choose(attribute, value)` and `available(attribute, value)`.
