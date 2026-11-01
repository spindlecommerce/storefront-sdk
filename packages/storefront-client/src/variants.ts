import type { ProductOption, VariantSummary } from "./types.ts";

/** Option values by attribute code, e.g. { color: "blue", size: "m" }. */
export type Selection = Record<string, string>;

type WithOptions = Pick<VariantSummary, "selectedOptions">;
type Stocked = WithOptions & Pick<VariantSummary, "isAvailable">;

export const selectionOf = (variant: WithOptions | undefined): Selection => Object.fromEntries((variant?.selectedOptions ?? []).map((o) => [o.attribute, o.value]));

/** The selection names every option of the variant. */
export const matches = (variant: WithOptions, selection: Selection) => variant.selectedOptions.every((o) => selection[o.attribute] === o.value);

/** The variant has the selection's values, and maybe other options. */
export const hasValues = (variant: WithOptions, selection: Selection) =>
  Object.entries(selection).every(([attribute, value]) => variant.selectedOptions.some((o) => o.attribute === attribute && o.value === value));

export const variantFor = <V extends WithOptions>(variants: V[], selection: Selection) => variants.find((v) => matches(v, selection));

/**
 * Choosing `value` keeps the other choices when that combination exists; otherwise it moves to one
 * that does, in stock if there is one.
 */
export const chooseValue = <V extends Stocked>(variants: V[], selection: Selection, attribute: string, value: string) => {
  const wanted = { ...selection, [attribute]: value };
  const variant =
    variants.find((v) => matches(v, wanted)) ??
    variants.find((v) => v.isAvailable && hasValues(v, { [attribute]: value })) ??
    variants.find((v) => hasValues(v, { [attribute]: value }));
  return { selection: variant ? selectionOf(variant) : wanted, variant };
};

/** Whether choosing `value`, keeping the other choices, gives a variant in stock. */
export const inStock = (variants: Stocked[], selection: Selection, attribute: string, value: string) =>
  variants.some((v) => v.isAvailable && matches(v, { ...selection, [attribute]: value }));

/** The attribute's value on the first variant in stock, else on the first variant. */
export const firstValue = (variants: Stocked[], attribute: string) => selectionOf(variants.find((v) => v.isAvailable) ?? variants[0])[attribute] ?? null;

/** The option's values some variant has along with the selection, each with that variant. */
export const valuesWith = <V extends WithOptions>(variants: V[], option: ProductOption, selection: Selection) =>
  option.values.flatMap((value) => {
    const variant = variantFor(variants, { ...selection, [option.attribute.code]: value.code });
    return variant ? [{ value, variant }] : [];
  });
