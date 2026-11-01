#!/usr/bin/env node
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import type { ComponentDefinition } from "./definitions.ts";
import { generateTypes } from "./generate.ts";

const usage = `Usage:
  spindle-storefront components pull  [--out components.json]
  spindle-storefront components push  [components.json] [--prune]
  spindle-storefront components types [--from components.json] [--out builder-components.ts]
Options:
  --url <url>        The platform (SPINDLE_API_URL), by default http://localhost:4000
  --key <key>        An admin API key (SPINDLE_API_KEY): content:read to pull, content:write to push
  --env-file <path>  Also read those variables from this file, if it exists`;

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    url: { type: "string" },
    key: { type: "string" },
    out: { type: "string" },
    from: { type: "string" },
    prune: { type: "boolean", default: false },
    "env-file": { type: "string" },
    help: { type: "boolean", short: "h", default: false },
  },
});

const envFile = values["env-file"];
if (envFile && existsSync(envFile)) process.loadEnvFile(envFile);

const url = (values.url ?? process.env.SPINDLE_API_URL ?? "http://localhost:4000").replace(/\/+$/, "");
const key = values.key ?? process.env.SPINDLE_API_KEY;
const [group, command, file] = positionals;

const admin = async <T>(query: string, variables: Record<string, unknown> = {}): Promise<T> => {
  if (!key) throw new Error("Pass an admin API key with --key or SPINDLE_API_KEY (System › API keys in the admin).");
  const response = await fetch(`${url}/admin/graphql`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await response.json().catch(() => null)) as { data?: T; errors?: { message: string }[] } | null;
  if (!response.ok || !body || body.errors?.length) throw new Error(`The API refused the request: ${body?.errors?.map((e) => e.message).join("; ") ?? `HTTP ${response.status}`}`);
  return body.data as T;
};

const pullDefinitions = async () => (await admin<{ components: { definition: ComponentDefinition }[] }>(`{ components { definition } }`)).components.map((c) => c.definition);

const readDefinitions = async (path: string) => {
  const parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  const list = Array.isArray(parsed) ? parsed : (parsed as { components?: unknown }).components;
  if (!Array.isArray(list)) throw new Error(`${path} should hold an array of component definitions (or { "components": [...] })`);
  return list as ComponentDefinition[];
};

type SyncResult = {
  __typename: string;
  message?: string;
  created?: string[];
  updated?: string[];
  unchanged?: string[];
  removed?: string[];
  fieldErrors?: { path: string[]; message: string }[];
};

const run = async () => {
  if (values.help || !group) return console.log(usage);
  if (group !== "components") throw new Error(`Unknown command ${group}.\n${usage}`);
  if (command === "pull") {
    const definitions = await pullDefinitions();
    const json = `${JSON.stringify(definitions, null, 2)}\n`;
    if (values.out) {
      await writeFile(values.out, json);
      console.log(`Wrote ${definitions.length} definitions to ${values.out}.`);
    } else process.stdout.write(json);
    return;
  }
  if (command === "push") {
    const path = file ?? "components.json";
    const definitions = await readDefinitions(path);
    const { componentsSync: result } = await admin<{ componentsSync: SyncResult }>(
      `mutation($d: JSON!, $p: Boolean) { componentsSync(definitions: $d, prune: $p) { __typename ... on ComponentsSyncPayload { created updated unchanged removed } ... on Error { message } ... on ValidationError { fieldErrors { path message } } } }`,
      { d: definitions, p: values.prune },
    );
    if (result.__typename !== "ComponentsSyncPayload") {
      const details = result.fieldErrors?.map((f) => `  ${f.path.join(".")}: ${f.message}`).join("\n");
      throw new Error(`${result.message ?? result.__typename}${details ? `\n${details}` : ""}`);
    }
    const count = (codes: string[] | undefined) => codes?.length ?? 0;
    console.log(`Deployed ${definitions.length} definitions from ${path}: ${count(result.created)} created, ${count(result.updated)} updated, ${count(result.unchanged)} unchanged, ${count(result.removed)} removed.`);
    for (const [label, codes] of [["created", result.created], ["updated", result.updated], ["removed", result.removed]] as const) if (codes?.length) console.log(`  ${label}: ${codes.join(", ")}`);
    return;
  }
  if (command === "types") {
    const definitions = values.from ? await readDefinitions(values.from) : await pullDefinitions();
    const source = generateTypes(definitions);
    if (values.out) {
      await writeFile(values.out, source);
      console.log(`Wrote types for ${definitions.length} components to ${values.out}.`);
    } else process.stdout.write(source);
    return;
  }
  throw new Error(`Unknown command components ${command ?? ""}.\n${usage}`);
};

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
