/**
 * Markup for the visual editing bridge (see the header of the API's /visual-editing/bridge.js).
 * Outside draft mode every helper returns no attributes.
 *
 *   data-ecom-document   around each document: the page, the header, the footer
 *   data-ecom-node       on a component's root element (with data-ecom-component)
 *   data-ecom-field      on an element showing a field: "<nodeId>.<field>", or for a list item
 *                        "<nodeId>.<field>.<itemId>[.<subField>]"
 *   data-ecom-patch      "text" when the element shows the field's text as is, so the bridge can
 *                        update it as the editor types
 */

export type EditAttributes = { [attribute: `data-ecom-${string}`]: string };

const NONE: EditAttributes = {};

export type Editable = {
  draft: boolean;
  document: (id: string) => EditAttributes;
  node: (node: { id: string; component: string }) => EditAttributes;
  field: (nodeId: string, ...path: string[]) => EditAttributes;
  /** A field whose element shows exactly the field's text. */
  text: (nodeId: string, ...path: string[]) => EditAttributes;
};

export const editable = (draft: boolean): Editable => ({
  draft,
  document: (id) => (draft ? { "data-ecom-document": id } : NONE),
  node: (node) => (draft ? { "data-ecom-node": node.id, "data-ecom-component": node.component } : NONE),
  field: (nodeId, ...path) => (draft ? { "data-ecom-field": [nodeId, ...path].join(".") } : NONE),
  text: (nodeId, ...path) => (draft ? { "data-ecom-field": [nodeId, ...path].join("."), "data-ecom-patch": "text" } : NONE),
});

/** The bridge, protocol version 1. */
export type VisualEditingBridge = {
  version: number;
  readonly connected: boolean;
  init(options: {
    adminOrigin: string;
    onRefresh?: () => void | Promise<void>;
    onPatch?: (patch: { nodeId: string; path: string[]; value: unknown }) => void;
    navigate?: (path: string) => void;
  }): VisualEditingBridge;
  /** Tells the editor a refresh has rendered. */
  rendered(): void;
};

/** Where the platform serves the bridge's script. */
export const visualEditingBridgeUrl = (apiUrl: string) => `${apiUrl.replace(/\/+$/, "")}/visual-editing/bridge.js`;

/** The bridge, once its script has run in this window. */
export const visualEditingBridge = () => (globalThis as { EcomVisualEditing?: VisualEditingBridge }).EcomVisualEditing;
