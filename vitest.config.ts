import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({ resolve: { alias: { "@spindlecommerce/storefront-client": fileURLToPath(new URL("./packages/storefront-client/src/index.ts", import.meta.url)) } } });
