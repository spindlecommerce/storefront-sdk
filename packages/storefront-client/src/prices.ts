import type { Money, PriceRange } from "./types.ts";

/** Whether a compare-at price is above the price, so the item shows as on sale. */
export const isLower = (price: Money, compareAt: Money | null | undefined): compareAt is Money => !!compareAt && Number(compareAt.amount) > Number(price.amount);

export const isOnSale = (range: PriceRange | null | undefined) => !!range?.minVariantPrice && isLower(range.minVariantPrice, range.compareAtMinVariantPrice);
