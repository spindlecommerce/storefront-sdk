import type { ContentNode } from "./types.ts";

export const isContentNode = (value: unknown): value is ContentNode =>
  typeof value === "object" && value !== null && typeof (value as ContentNode).id === "string" && typeof (value as ContentNode).component === "string" && typeof (value as ContentNode).fields === "object";

/** The nodes in a node's blocks fields, in field order. */
export const blockNodes = (node: ContentNode) => Object.values(node.fields).flatMap((value) => (Array.isArray(value) ? value.filter(isContentNode) : []));

/** Whether a component appears among these nodes, nested ones included. */
export const containsComponent = (nodes: readonly ContentNode[], code: string): boolean => nodes.some((node) => node.component === code || containsComponent(blockNodes(node), code));
