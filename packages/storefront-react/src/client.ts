"use client";

import { chooseValue, inStock, selectionOf, variantFor, type Selection } from "@spindlecommerce/storefront-client";
import { useState } from "react";

type Variant = { isAvailable: boolean; selectedOptions: { attribute: string; value: string }[] };

/**
 * The shopper's options, starting from the first variant in stock. `choose` keeps the other
 * choices when that combination exists, and returns the variant chosen.
 */
export const useVariantSelection = <V extends Variant>(variants: V[]) => {
  const [selection, setSelection] = useState<Selection>(() => selectionOf(variants.find((v) => v.isAvailable) ?? variants[0]));
  const variant = variants.length === 1 ? variants[0] : variantFor(variants, selection);
  const choose = (attribute: string, value: string) => {
    const next = chooseValue(variants, selection, attribute, value);
    setSelection(next.selection);
    return next.variant;
  };
  /** Whether choosing this value, keeping the other choices, gives a variant in stock. */
  const available = (attribute: string, value: string) => inStock(variants, selection, attribute, value);
  return { selection, variant, choose, available };
};
