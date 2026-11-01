import { normalizePath, type ContentChange, type TemplateKind } from "@spindlecommerce/storefront-client";

/** Cache tags on reads. The revalidate route maps webhook events onto them. */
export const TAG = {
  /** Every read: component library changes expire everything. */
  all: "spindle",
  /** Builder pages. One tag for all of them, since pages link to each other. */
  pages: "spindle:pages",
  /** Products and categories, including links and references to them in pages. */
  catalog: "spindle:catalog",
  /** route(path) for one URL path. */
  path: (path: string) => `spindle:path:${normalizePath(path)}`.slice(0, 256),
  /** A singleton page such as the site header. */
  singleton: (type: string) => `spindle:singleton:${type}`.slice(0, 256),
  /** Product or category pages, which hold the template they render with. */
  templates: (kind: TemplateKind) => `spindle:templates:${kind}`,
  /** Product or category pages' own sections. */
  sections: (kind: TemplateKind) => `spindle:sections:${kind}`,
};

const tagFor = (change: ContentChange) => {
  switch (change.kind) {
    case "everything":
      return TAG.all;
    case "pages":
      return TAG.pages;
    case "catalog":
      return TAG.catalog;
    case "path":
      return TAG.path(change.path);
    case "templates":
      return TAG.templates(change.for);
    case "sections":
      return TAG.sections(change.for);
    case "singleton":
      return TAG.singleton(change.type);
  }
};

export const tagsFor = (changes: ContentChange[]) => [...new Set(changes.map(tagFor))];
