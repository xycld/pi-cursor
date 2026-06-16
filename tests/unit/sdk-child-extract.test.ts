import { describe, it, expect } from "bun:test";
import { extractEventJson } from "../../src/client/sdk-child.js";

describe("extractEventJson", () => {
  it("extracts the inner event JSON from a wrapper line", () => {
    const event = { type: "text", text: "hello" };
    const line = JSON.stringify({ id: "req-1", event });
    expect(extractEventJson(line)).toBe(JSON.stringify(event));
  });

  it("handles nested objects in the event", () => {
    const event = { type: "tool_call", tool_call: { read: { args: { path: "/foo" } } } };
    const line = JSON.stringify({ id: "req-2", event });
    expect(JSON.parse(extractEventJson(line))).toEqual(event);
  });

  it("returns the full line when no event key is found", () => {
    const line = '{"id":"req-3","done":true,"exitCode":0}';
    expect(extractEventJson(line)).toBe(line);
  });

  it("handles event values with escaped quotes", () => {
    const event = { type: "text", text: 'say "hello"' };
    const line = JSON.stringify({ id: "req-4", event });
    expect(JSON.parse(extractEventJson(line))).toEqual(event);
  });
});
