import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { ComponentDefinition } from "../src/definitions.ts";
import { generateTypes } from "../src/generate.ts";

// The demo store's component library, as `components pull` exports it.
const demo = JSON.parse(readFileSync(new URL("components.json", import.meta.url), "utf8")) as ComponentDefinition[];

describe("component types", () => {
  it("generates a node type per component and unions for blocks fields", () => {
    const source = generateTypes(demo);
    expect(source).toContain('export type HeroNode = BuilderNode<"hero", HeroFields, "split" | "centered" | "full_bleed">;');
    expect(source).toContain("actions: Array<ButtonNode>;");
    expect(source).toContain("/** Image. Only for split, full_bleed. */\n  image?: BuilderImage | null;");
    expect(source).toMatch(/export type BuilderContentTypeNode = LandingPageNode \| SiteHeaderNode \| SiteFooterNode \| ProductPageNode \| CategoryPageNode \| ProductSectionsPageNode \| CategorySectionsPageNode;/);
    expect(source).toContain('export type BuilderProductComponentCode = "product_details" | "product_description" | "product_specs" | "related_products" | "product_sections";');
    expect(source).toContain('export type BuilderCategoryComponentCode = "category_header" | "subcategories" | "category_products" | "category_sections";');
    expect(source).toContain("/** Product sections: One product's own sections, shown where its template places them. Belongs to one product: render it where the product's template places its sections. */");
  });
});
