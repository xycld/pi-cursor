import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  calculateCost,
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type Context,
  type Model,
  type SimpleStreamOptions,
} from "@earendil-works/pi-ai";
import type { ExtensionAPI, ProviderModelConfig } from "@earendil-works/pi-coding-agent";

const PROVIDER_ID = "cursor-acp";
const API_ID = "cursor-agent-stream" as Api;
const DEFAULT_BASE_URL = "cursor-agent://local";
const DEFAULT_API_KEY = "cursor-acp";

// Pi Cursor provider bridge. It intentionally does not copy Cursor OAuth tokens;
// authentication stays in Cursor Agent and is managed with `cursor-agent login`.

function resolveCursorAgentBinary(): string {
  const configured = process.env.CURSOR_AGENT_EXECUTABLE || process.env.CURSOR_AGENT_PATH;
  if (configured && existsSync(configured)) return configured;

  const candidates = [
    join(homedir(), ".cursor-agent", "cursor-agent"),
    join(homedir(), ".local", "bin", "cursor-agent"),
    join(homedir(), ".npm-global", "bin", "cursor-agent"),
    "/usr/local/bin/cursor-agent",
    "/opt/homebrew/bin/cursor-agent",
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  const found = spawnSync("sh", ["-lc", "command -v cursor-agent"], { encoding: "utf8" });
  const path = found.stdout?.trim();
  return path || "cursor-agent";
}

const EXTENSION_DIR = dirname(fileURLToPath(import.meta.url));

function normalizeModels(models: unknown): ProviderModelConfig[] {
  if (!Array.isArray(models)) return [];
  return models.map((m: any) => ({
    id: String(m.id),
    name: String(m.name ?? m.id),
    reasoning: Boolean(m.reasoning),
    input: Array.isArray(m.input) ? m.input : ["text"],
    cost: {
      input: Number(m.cost?.input ?? 0),
      output: Number(m.cost?.output ?? 0),
      cacheRead: Number(m.cost?.cacheRead ?? m.cost?.cache_read ?? 0),
      cacheWrite: Number(m.cost?.cacheWrite ?? m.cost?.cache_write ?? 0),
    },
    contextWindow: Number(m.contextWindow ?? m.context_window ?? 128000),
    maxTokens: Number(m.maxTokens ?? m.max_tokens ?? 16384),
    compat: m.compat,
  }));
}

function readModelsFromFile(path: string): ProviderModelConfig[] {
  try {
    const raw = JSON.parse(readFileSync(path, "utf8"));
    const models = raw?.providers?.[PROVIDER_ID]?.models ?? raw?.[PROVIDER_ID]?.models ?? raw?.models ?? raw;
    return normalizeModels(models);
  } catch {
    return [];
  }
}

function readCursorModels(): ProviderModelConfig[] {
  const agentDir = process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent");
  const configured = process.env.PI_CURSOR_MODELS_JSON;
  const candidates = [
    configured,
    join(agentDir, "models.json"),
    join(EXTENSION_DIR, "models.json"),
  ].filter((path): path is string => Boolean(path));

  for (const path of [...new Set(candidates)]) {
    if (!existsSync(path)) continue;
    const models = readModelsFromFile(path);
    if (models.length > 0) return models;
  }

  return normalizeModels([{ id: "auto", name: "Auto", input: ["text"], contextWindow: 128000, maxTokens: 16384 }]);
}

function textFromContent(content: any): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return content == null ? "" : JSON.stringify(content);

  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      if (part.type === "text" && typeof part.text === "string") return part.text;
      if (part.type === "thinking" && typeof part.thinking === "string") return `[thinking]\n${part.thinking}`;
      if (part.type === "image") return "[image omitted: Cursor Agent CLI prompt bridge is text-only]";
      if (part.type === "toolCall") return `tool_call(${part.name ?? "?"}): ${JSON.stringify(part.arguments ?? {})}`;
      return "";
    })
    .filter(Boolean)
    .join("\n");
}

function toolSchemaBlock(tools: any[] | undefined): string {
  if (!Array.isArray(tools) || tools.length === 0) return "";
  const lines = tools.map((tool: any) => {
    const fn = tool.function ?? tool;
    const name = fn.name ?? "unknown";
    const description = fn.description ?? "";
    const parameters = JSON.stringify(fn.parameters ?? {});
    return `- ${name}: ${description}\n  Parameters: ${parameters}`;
  });
  return [
    "SYSTEM: Pi exposed these tools to the model. Cursor Agent also has its own CLI tools; when you need to change files or inspect the repo, use Cursor Agent tools directly.",
    "Available Pi tools for context:",
    lines.join("\n"),
  ].join("\n");
}

function buildPrompt(context: Context): string {
  const parts: string[] = [];

  if (context.systemPrompt?.trim()) {
    parts.push(`SYSTEM: ${context.systemPrompt.trim()}`);
  }

  const tools = toolSchemaBlock((context as any).tools);
  if (tools) parts.push(tools);

  for (const msg of context.messages ?? []) {
    const role = (msg as any).role ?? "user";
    if (role === "toolResult") {
      const callId = (msg as any).toolCallId ?? "unknown";
      const body = textFromContent((msg as any).content);
      parts.push(`TOOL_RESULT (call_id: ${callId}): ${body}`);
      continue;
    }
    const body = textFromContent((msg as any).content);
    if (body.trim()) {
      parts.push(`${String(role).toUpperCase()}: ${body}`);
    }
  }

  return parts.join("\n\n").trim();
}

function parseStreamJsonLine(line: string): any | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function extractText(event: any): string {
  if (event?.type !== "assistant") return "";
  return (event.message?.content ?? [])
    .filter((c: any) => c?.type === "text" && typeof c.text === "string")
    .map((c: any) => c.text)
    .join("");
}

function extractThinking(event: any): string {
  if (event?.type === "thinking") return typeof event.text === "string" ? event.text : "";
  if (event?.type !== "assistant") return "";
  return (event.message?.content ?? [])
    .filter((c: any) => c?.type === "thinking" && typeof c.thinking === "string")
    .map((c: any) => c.thinking)
    .join("");
}

function isPartial(event: any): boolean {
  return typeof event?.timestamp_ms === "number" || event?.subtype === "delta";
}

class DeltaTracker {
  private emitted = "";
  next(value: string): string {
    if (!value) return "";
    if (!this.emitted) {
      this.emitted = value;
      return value;
    }
    if (value.startsWith(this.emitted)) {
      const delta = value.slice(this.emitted.length);
      this.emitted = value;
      return delta;
    }
    if (this.emitted.startsWith(value)) return "";
    this.emitted += value;
    return value;
  }
}

function readTokenCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

function applyCursorUsage(output: AssistantMessage, model: Model<Api>, usage: unknown): void {
  if (!usage || typeof usage !== "object") return;
  const u = usage as Record<string, unknown>;
  const input = readTokenCount(u.inputTokens ?? u.input_tokens ?? u.prompt_tokens);
  const outputTokens = readTokenCount(u.outputTokens ?? u.output_tokens ?? u.completion_tokens);
  const reasoningTokens = readTokenCount(u.reasoningTokens ?? u.reasoning_tokens);
  const cacheRead = readTokenCount(u.cacheReadTokens ?? u.cache_read_tokens);
  const cacheWrite = readTokenCount(u.cacheWriteTokens ?? u.cache_write_tokens);

  output.usage.input = input;
  output.usage.output = outputTokens;
  output.usage.cacheRead = cacheRead;
  output.usage.cacheWrite = cacheWrite;
  output.usage.totalTokens = input + outputTokens + reasoningTokens + cacheRead + cacheWrite;

  const explicitCost = u.cost ?? u.totalCost ?? u.total_cost;
  if (typeof explicitCost === "number" && Number.isFinite(explicitCost) && explicitCost >= 0) {
    output.usage.cost.total = explicitCost;
  } else {
    try { calculateCost(model, output.usage); } catch {}
  }
}

function streamCursorAgent(model: Model<Api>, context: Context, options?: SimpleStreamOptions): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();

  (async () => {
    const output: AssistantMessage = {
      role: "assistant",
      content: [],
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: Date.now(),
    } as AssistantMessage;

    const textBlock: any = { type: "text", text: "" };
    const thinkingBlock: any = { type: "thinking", thinking: "" };
    let textStarted = false;
    let thinkingStarted = false;
    let sawTextPartials = false;
    let sawThinkingPartials = false;
    const textTracker = new DeltaTracker();
    const thinkingTracker = new DeltaTracker();

    const pushText = (delta: string) => {
      if (!delta) return;
      if (!textStarted) {
        output.content.push(textBlock);
        textStarted = true;
        stream.push({ type: "text_start", contentIndex: output.content.length - 1, partial: output });
      }
      textBlock.text += delta;
      stream.push({ type: "text_delta", contentIndex: output.content.indexOf(textBlock), delta, partial: output });
    };

    const pushThinking = (delta: string) => {
      if (!delta) return;
      if (!thinkingStarted) {
        output.content.push(thinkingBlock);
        thinkingStarted = true;
        stream.push({ type: "thinking_start", contentIndex: output.content.length - 1, partial: output });
      }
      thinkingBlock.thinking += delta;
      stream.push({ type: "thinking_delta", contentIndex: output.content.indexOf(thinkingBlock), delta, partial: output });
    };

    try {
      const prompt = buildPrompt(context);
      if (!prompt) throw new Error("Cursor Agent prompt bridge received an empty prompt");

      const binary = resolveCursorAgentBinary();
      const cursorModel = model.id.startsWith(`${PROVIDER_ID}/`) ? model.id.slice(PROVIDER_ID.length + 1) : model.id;
      const args = [
        "--print",
        "--output-format",
        "stream-json",
        "--stream-partial-output",
        "--workspace",
        currentCwd,
        "--model",
        cursorModel,
        "--trust",
      ];

      const mode = (process.env.CURSOR_ACP_MODE ?? "default").trim().toLowerCase();
      if (mode === "plan") args.push("--plan");
      else if (mode === "ask") args.push("--mode", "ask");
      if (process.env.CURSOR_ACP_FORCE !== "false") args.push("--force");
      if (process.env.CURSOR_ACP_SANDBOX === "enabled" || process.env.CURSOR_ACP_SANDBOX === "disabled") {
        args.push("--sandbox", process.env.CURSOR_ACP_SANDBOX);
      }

      stream.push({ type: "start", partial: output });

      const child = spawn(binary, args, { cwd: currentCwd, stdio: ["pipe", "pipe", "pipe"] });
      let stderr = "";
      let buffer = "";
      let processError: Error | null = null;

      const abort = () => {
        processError = new Error("Request was aborted");
        child.kill("SIGTERM");
      };
      options?.signal?.addEventListener("abort", abort, { once: true });

      child.stdin.write(prompt);
      child.stdin.end();

      child.stderr.on("data", (chunk) => {
        stderr += chunk.toString();
      });
      child.on("error", (err) => {
        processError = err;
      });

      for await (const chunk of child.stdout) {
        buffer += chunk.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const event = parseStreamJsonLine(line);
          if (!event) continue;

          const text = extractText(event);
          if (text) {
            if (isPartial(event)) {
              sawTextPartials = true;
              pushText(textTracker.next(text));
            } else if (!sawTextPartials) {
              const delta = text.slice(textBlock.text.length);
              pushText(delta || text);
            }
          }

          const thinking = extractThinking(event);
          if (thinking) {
            if (isPartial(event)) {
              sawThinkingPartials = true;
              pushThinking(thinkingTracker.next(thinking));
            } else if (!sawThinkingPartials) {
              const delta = thinking.slice(thinkingBlock.thinking.length);
              pushThinking(delta || thinking);
            }
          }

          if (event.type === "result") {
            applyCursorUsage(output, model, event.usage);
            if (event.is_error || event.subtype === "error") {
              const message = event.error?.message ?? event.result ?? "cursor-agent returned an error";
              throw new Error(message);
            }
          }
        }
      }

      const finalLine = buffer.trim();
      if (finalLine) {
        const event = parseStreamJsonLine(finalLine);
        if (event?.type === "result") applyCursorUsage(output, model, event.usage);
      }

      const code: number | null = await new Promise((resolve) => child.on("close", resolve));
      options?.signal?.removeEventListener("abort", abort);

      if (processError) throw processError;
      if (code !== 0) {
        throw new Error(`cursor-agent exited with code ${code}${stderr.trim() ? `: ${stderr.trim()}` : ""}`);
      }

      if (thinkingStarted) {
        stream.push({ type: "thinking_end", contentIndex: output.content.indexOf(thinkingBlock), content: thinkingBlock.thinking, partial: output });
      }
      if (textStarted) {
        stream.push({ type: "text_end", contentIndex: output.content.indexOf(textBlock), content: textBlock.text, partial: output });
      }
      output.stopReason = "stop";
      stream.push({ type: "done", reason: "stop", message: output });
      stream.end();
    } catch (error) {
      output.stopReason = options?.signal?.aborted ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
      stream.push({ type: "error", reason: output.stopReason, error: output });
      stream.end();
    }
  })();

  return stream;
}

let currentCwd = process.cwd();

export default function (pi: ExtensionAPI) {
  const models = readCursorModels();

  pi.registerProvider(PROVIDER_ID, {
    name: "Cursor Agent (pi-cursor)",
    baseUrl: DEFAULT_BASE_URL,
    apiKey: DEFAULT_API_KEY,
    api: API_ID,
    models,
    streamSimple: streamCursorAgent,
  });

  pi.on("session_start", async (_event, ctx) => {
    currentCwd = ctx.cwd || process.cwd();
    ctx.ui.setStatus(PROVIDER_ID, `cursor-acp: ${currentCwd}`);
  });

  pi.registerCommand("cursor-acp-status", {
    description: "Show Cursor Agent login/status used by the cursor-acp provider",
    handler: async (_args, ctx) => {
      currentCwd = ctx.cwd || currentCwd;
      const binary = resolveCursorAgentBinary();
      const result = await pi.exec(binary, ["status"], { cwd: currentCwd });
      const text = `${result.stdout || ""}${result.stderr || ""}`.trim();
      ctx.ui.notify(text || `cursor-agent status exited with ${result.exitCode}`, result.exitCode === 0 ? "info" : "warning");
    },
  });
}
