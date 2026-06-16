/**
 * Integration test: verify that extractEventJson produces output that
 * parseStreamJsonLine can parse back into the original event object.
 * This validates the Q2 optimization (skip re-stringify) end-to-end.
 */
import { describe, it, expect } from "bun:test";
import { extractEventJson } from "../../src/client/sdk-child.js";
import { parseStreamJsonLine } from "../../src/streaming/parser.js";

function simulateRunnerLine(id: string, event: Record<string, unknown>): string {
  return JSON.stringify({ id, event });
}

describe("SDK demux round-trip (Q2 optimization)", () => {
  const testEvents = [
    { type: "text", text: "Hello, world!" },
    { type: "text", text: 'She said "hello" and left.' },
    { type: "text", text: "Line 1\nLine 2\nLine 3" },
    { type: "tool_call", call_id: "call-1", tool_call: { read: { args: { path: "/foo/bar.ts" }, result: undefined } } },
    { type: "result", subtype: "success" },
    { type: "result", subtype: "error", is_error: true, error: { message: "Something went wrong" } },
    { type: "text", text: "Brackets: {}, [], ()" },
    { type: "text", text: "" },
    { type: "thinking", thinking: "Let me consider {\"nested\": true} objects" },
  ];

  for (const event of testEvents) {
    it(`round-trips event: ${event.type} ${JSON.stringify(event).slice(0, 60)}...`, () => {
      const runnerLine = simulateRunnerLine("req-123", event);
      const extractedJson = extractEventJson(runnerLine);
      const parsed = parseStreamJsonLine(extractedJson);

      expect(parsed).not.toBeNull();
      expect(parsed).toEqual(event);
    });
  }

  it("handles many events without data loss", () => {
    const events = Array.from({ length: 100 }, (_, i) => ({
      type: "text" as const,
      text: `Token ${i}: ${"x".repeat(i * 10)}`,
    }));

    for (const event of events) {
      const line = simulateRunnerLine("req-bulk", event);
      const extracted = extractEventJson(line);
      const parsed = parseStreamJsonLine(extracted);
      expect(parsed).toEqual(event);
    }
  });

  it("matches JSON.stringify output exactly for all test events", () => {
    for (const event of testEvents) {
      const line = simulateRunnerLine("req-exact", event);
      const extracted = extractEventJson(line);
      expect(extracted).toBe(JSON.stringify(event));
    }
  });
});
