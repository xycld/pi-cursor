import { describe, expect, it } from "bun:test";

import { extractCompletionFromStream } from "../../src/plugin";

describe("extractCompletionFromStream", () => {
  it("does not duplicate assistant text when partial events are followed by final accumulated event", () => {
    const output = [
      JSON.stringify({
        type: "assistant",
        timestamp_ms: 1,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello" }],
        },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp_ms: 2,
        message: {
          role: "assistant",
          content: [{ type: "text", text: " world" }],
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello world" }],
        },
      }),
      JSON.stringify({
        type: "assistant",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello world" }],
        },
      }),
    ].join("\n");

    expect(extractCompletionFromStream(output)).toEqual({
      assistantText: "Hello world",
      reasoningText: "",
    });
  });

  it("does not duplicate assistant text when partial events mix delta and accumulated payloads", () => {
    const output = [
      JSON.stringify({
        type: "assistant",
        timestamp_ms: 1,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello" }],
        },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp_ms: 2,
        message: {
          role: "assistant",
          content: [{ type: "text", text: " world" }],
        },
      }),
      JSON.stringify({
        type: "assistant",
        timestamp_ms: 3,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Hello world!" }],
        },
      }),
    ].join("\n");

    expect(extractCompletionFromStream(output)).toEqual({
      assistantText: "Hello world!",
      reasoningText: "",
    });
  });

  it("does not duplicate thinking text when partial events are followed by final accumulated event", () => {
    const output = [
      JSON.stringify({
        type: "thinking",
        subtype: "delta",
        timestamp_ms: 1,
        text: "Plan",
      }),
      JSON.stringify({
        type: "thinking",
        subtype: "delta",
        timestamp_ms: 2,
        text: " more",
      }),
      JSON.stringify({
        type: "thinking",
        text: "Plan more",
      }),
    ].join("\n");

    expect(extractCompletionFromStream(output)).toEqual({
      assistantText: "",
      reasoningText: "Plan more",
    });
  });

  it("does not duplicate thinking text when partial events mix delta and accumulated payloads", () => {
    const output = [
      JSON.stringify({
        type: "thinking",
        subtype: "delta",
        timestamp_ms: 1,
        text: "Plan",
      }),
      JSON.stringify({
        type: "thinking",
        subtype: "delta",
        timestamp_ms: 2,
        text: " more",
      }),
      JSON.stringify({
        type: "thinking",
        subtype: "delta",
        timestamp_ms: 3,
        text: "Plan more carefully",
      }),
    ].join("\n");

    expect(extractCompletionFromStream(output)).toEqual({
      assistantText: "",
      reasoningText: "Plan more carefully",
    });
  });

  it("does not duplicate thinking text when multiple final accumulated events arrive without partials", () => {
    // Mirrors the assistant branch: multiple finals should replace, not concatenate.
    const output = [
      JSON.stringify({ type: "thinking", text: "Plan more" }),
      JSON.stringify({ type: "thinking", text: "Plan more" }),
    ].join("\n");

    expect(extractCompletionFromStream(output)).toEqual({
      assistantText: "",
      reasoningText: "Plan more",
    });
  });
});
