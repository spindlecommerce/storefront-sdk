/**
 * Component definitions as the admin API takes and returns them (componentsSync, components). The
 * platform's own model must stay assignable to these: test/unit/page-builder.test.ts checks it.
 */

export type FieldType = "text" | "richText" | "number" | "boolean" | "select" | "color" | "image" | "link" | "date" | "product" | "products" | "category" | "blocks" | "list";

export type TemplateFor = "product" | "category";

export type FieldOption = { value: string; label: string };

export type FieldDefinition = {
  key: string;
  type: FieldType;
  label: string;
  description?: string;
  required?: boolean;
  /** Text and rich text only: one value per locale. */
  localized?: boolean;
  /** Inspector tab, e.g. "Content", "Style". */
  group?: string;
  /** Only shown for these variations; all when absent. */
  variations?: string[];
  placeholder?: string;
  multiline?: boolean;
  options?: FieldOption[];
  /** Numbers: value range. Text: length. blocks, list, products: item count. */
  min?: number;
  max?: number;
  /** blocks only: component codes allowed here; empty allows every component. */
  allowedComponents?: string[];
  /** list only: the fields of each item. */
  fields?: FieldDefinition[];
  defaultValue?: unknown;
};

export type Variation = { code: string; name: string; description?: string; previewImageUrl?: string };

export type ComponentDefinition = {
  code: string;
  kind: "content_type" | "component";
  name: string;
  description?: string | null;
  groupName?: string | null;
  icon?: string | null;
  previewImageUrl?: string | null;
  fields: FieldDefinition[];
  variations: Variation[];
  routable?: boolean;
  singleton?: boolean;
  /** A content type with it is a product or category template; a component with it shows that object's data. */
  templateFor?: TemplateFor | null;
  /** Content types only: pages of this type are one product's or category's own sections. */
  sectionsFor?: TemplateFor | null;
};
