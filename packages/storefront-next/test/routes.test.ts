import { createHmac } from "node:crypto";
import type {} from "next";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidateTag: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn(), draftMode: vi.fn() }));

import { revalidateTag } from "next/cache";
import { createRevalidateRoute } from "../src/routes.ts";

const secret = "webhook-test-secret";
const limit = 1024 * 1024;
const post = createRevalidateRoute({ secret });
const signature = (body: string) => {
  const timestamp = Math.floor(Date.now() / 1000);
  return `t=${timestamp},v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
};

const streamingRequest = (headers: Record<string, string> = {}, chunk = new Uint8Array(64 * 1024)) => {
  let read = 0;
  let canceled = false;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      read += chunk.byteLength;
      controller.enqueue(chunk);
      if (read >= 2 * limit) controller.close();
    },
    cancel() { canceled = true; },
  }, { highWaterMark: 0 });
  const request = new Request("http://shop.test/api/revalidate", { method: "POST", headers, body, duplex: "half" } as RequestInit);
  return { request, read: () => read, canceled: () => canceled };
};

beforeEach(() => vi.clearAllMocks());

describe("revalidation body limits", () => {
  it.each<Record<string, string>>([{}, { "content-length": "1" }, { "content-length": "not-a-number" }])("bounds and cancels unsigned streams with headers %j", async (headers) => {
    const input = streamingRequest(headers);
    expect((await post(input.request)).status).toBe(413);
    expect(input.read()).toBeLessThanOrEqual(limit + 64 * 1024);
    expect(input.canceled()).toBe(true);
    expect(revalidateTag).not.toHaveBeenCalled();
  });

  it("counts UTF-8 bytes rather than characters", async () => {
    const input = streamingRequest({}, new TextEncoder().encode("é".repeat(64 * 1024)));
    expect((await post(input.request)).status).toBe(413);
    expect(input.canceled()).toBe(true);
  });

  it("rejects a declared oversized body before reading", async () => {
    const input = streamingRequest({ "content-length": String(limit + 1) });
    expect((await post(input.request)).status).toBe(413);
    expect(input.read()).toBe(0);
  });

  it("accepts a signed body exactly at the limit, including split UTF-8", async () => {
    const event = { id: "event-1", type: "product.updated", data: { text: "é" } };
    const base = JSON.stringify(event);
    const body = base + " ".repeat(limit - Buffer.byteLength(base));
    const bytes = new TextEncoder().encode(body);
    const split = bytes.indexOf(0xc3) + 1;
    const stream = new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, split)); c.enqueue(bytes.slice(split)); c.close(); } });
    const request = new Request("http://shop.test/api/revalidate", { method: "POST", headers: { "x-spindle-signature": signature(body) }, body: stream, duplex: "half" } as RequestInit);
    expect((await post(request)).status).toBe(200);
    expect(revalidateTag).toHaveBeenCalled();
  });

  it("retains signature and payload checks for bounded requests", async () => {
    expect((await post(new Request("http://shop.test", { method: "POST", body: "{}" }))).status).toBe(401);
    expect((await post(new Request("http://shop.test", { method: "POST", body: "{}", headers: { "x-spindle-signature": signature("{}") } }))).status).toBe(400);
  });

  it("does not read a body while revalidation is disabled", async () => {
    const input = streamingRequest();
    expect((await createRevalidateRoute({ secret: "" })(input.request)).status).toBe(503);
    expect(input.read()).toBe(0);
  });
});
