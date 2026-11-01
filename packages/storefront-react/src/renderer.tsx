import { editable, type CategoryLink, type ContentNode, type Editable, type ProductSummary } from "@spindlecommerce/storefront-client";
import type { ReactNode } from "react";

/** What every component gets besides its node. `X` is the storefront's own context. */
export type RenderContext<X extends object = object> = X & {
  /** Visual editing attributes (empty outside draft mode). */
  edit: Editable;
  draft: boolean;
  /** Objects the document refers to by global id. */
  products: ReadonlyMap<string, ProductSummary>;
  categories: ReadonlyMap<string, CategoryLink>;
  /** Renders a blocks field's nodes, optionally with a changed context. */
  renderBlocks: (nodes: readonly ContentNode[], overrides?: Partial<X>) => ReactNode;
};

export type NodeProps<N, X extends object = object> = { node: N; ctx: RenderContext<X> };

/** A component for one code. Server Components may be async. */
export type Renderer<N, X extends object = object> = (props: NodeProps<N, X>) => ReactNode | Promise<ReactNode>;

type Document = { references: { products: ProductSummary[]; categories: CategoryLink[] } };

/**
 * Renders builder content with one component per code. `fallback` renders codes without one, such
 * as a component added in the admin after the storefront was built.
 */
export const createRenderer = <X extends object>(renderers: { components: Partial<Record<string, Renderer<never, X>>>; fallback: Renderer<ContentNode, X> }) => {
  function RenderNode({ node, ctx }: NodeProps<ContentNode, X>) {
    // The API delivers fields in the shape the component's generated type describes.
    const Component = (renderers.components[node.component] ?? renderers.fallback) as Renderer<ContentNode, X>;
    return <Component node={node} ctx={ctx} />;
  }

  type Base = Omit<RenderContext<X>, "renderBlocks">;

  const withRenderer = (base: Base): RenderContext<X> => {
    const ctx = {
      ...base,
      renderBlocks: (nodes: readonly ContentNode[], overrides?: Partial<X>) => {
        const child = overrides ? withRenderer({ ...base, ...overrides }) : ctx;
        return nodes.map((node) => <RenderNode key={node.id} node={node} ctx={child} />);
      },
    } as RenderContext<X>;
    return ctx;
  };

  /** The context for one document: a page, a template, the header or the footer. */
  const contextFor = (document: Document, draft: boolean, own: X): RenderContext<X> =>
    withRenderer({
      ...own,
      edit: editable(draft),
      draft,
      products: new Map(document.references.products.map((p) => [p.id, p])),
      categories: new Map(document.references.categories.map((c) => [c.id, c])),
    } as Base);

  return { RenderNode, contextFor };
};
