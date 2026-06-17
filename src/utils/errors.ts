// src/utils/errors.ts

export type ErrorType = "quota" | "auth" | "network" | "model" | "unknown";

export interface ParsedError {
  type: ErrorType;
  recoverable: boolean;
  message: string;
  userMessage: string;
  details: Record<string, string>;
  suggestion?: string;
}

/**
 * Strip ANSI escape codes from string
 */
export function stripAnsi(str: string): string {
  if (typeof str !== "string") return String(str ?? "");
  return str.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "");
}

/**
 * Parse cursor-agent error output into structured format
 */
export function parseAgentError(stderr: string | unknown): ParsedError {
  const input = typeof stderr === "string" ? stderr : String(stderr ?? "");
  const clean = stripAnsi(input).trim();

  // Quota/usage limit error
  if (clean.includes("usage limit") || clean.includes("hit your usage limit")) {
    const savingsMatch = clean.match(/saved \$(\d+(?:\.\d+)?)/i);
    const resetMatch = clean.match(/reset[^0-9]*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    const modelMatch = clean.match(/continue with (\w+)/i);

    const details: Record<string, string> = {};
    if (savingsMatch) details.savings = `$${savingsMatch[1]}`;
    if (resetMatch) details.resetDate = resetMatch[1];
    if (modelMatch) details.affectedModel = modelMatch[1];

    return {
      type: "quota",
      recoverable: false,
      message: clean,
      userMessage: "You've hit your Cursor usage limit",
      details,
      suggestion: "Switch to a different model or set a Spend Limit in Cursor settings",
    };
  }

  // Authentication error
  if (clean.includes("not logged in") || clean.includes("auth") || clean.includes("unauthorized")) {
    return {
      type: "auth",
      recoverable: false,
      message: clean,
      userMessage: "Not authenticated with Cursor",
      details: {},
      suggestion: "Run: opencode auth login → Other → cursor-acp, or: cursor-agent login",
    };
  }

  // Network error
  if (clean.includes("ECONNREFUSED") || clean.includes("network") || clean.includes("fetch failed")) {
    return {
      type: "network",
      recoverable: true,
      message: clean,
      userMessage: "Connection to Cursor failed",
      details: {},
      suggestion: "Check your internet connection and try again",
    };
  }

  // Model not found / not available
  if (clean.includes("model not found") || clean.includes("invalid model") || clean.includes("Cannot use this model")) {
    // Extract model name and available models from error
    const modelMatch = clean.match(/Cannot use this model: ([^.]+)/);
    const availableMatch = clean.match(/Available models: (.+)/);

    const details: Record<string, string> = {};
    if (modelMatch) details.requested = modelMatch[1];
    if (availableMatch) details.available = availableMatch[1].split(", ").slice(0, 5).join(", ") + "...";

    return {
      type: "model",
      recoverable: false,
      message: clean,
      userMessage: modelMatch ? `Model '${modelMatch[1]}' not available` : "Requested model not available",
      details,
      suggestion: "Use cursor-acp/auto or check available models with: cursor-agent models",
    };
  }

  // Unknown error
  const recoverable = clean.includes("timeout") || clean.includes("ETIMEDOUT");
  return {
    type: "unknown",
    recoverable,
    message: clean,
    userMessage: clean.substring(0, 200) || "An error occurred",
    details: {},
  };
}

/**
 * Check if an error is recoverable (worth retrying).
 */
export function isRecoverableError(error: ParsedError): boolean {
  return error.recoverable;
}

/** Resume-specific failure signatures from cursor-agent stderr/stdout. */
const RESUME_FAILURE_PATTERNS = [
  /session\s+(?:not\s+found|expired|invalid)/i,
  /chat\s+(?:not\s+found|expired|invalid)/i,
  /resume\s+(?:failed|error|invalid)/i,
  /no\s+active\s+session/i,
];

/**
 * Decide whether a cursor-agent failure is specific to the resumed session.
 * Transient errors (network, auth, OOM, signal kills) should not evict a
 * valid chat ID; only failures that indicate the session itself is gone.
 */
export function isResumeSpecificFailure(stderr: string): boolean {
  const text = typeof stderr === "string" ? stderr : String(stderr ?? "");
  const clean = stripAnsi(text);
  return RESUME_FAILURE_PATTERNS.some((pattern) => pattern.test(clean));
}

/**
 * Format parsed error for user display
 */
export function formatErrorForUser(error: ParsedError): string {
  let output = `cursor-acp error: ${error.userMessage || error.message || "Unknown error"}`;

  const details = error.details || {};
  if (Object.keys(details).length > 0) {
    const detailParts = Object.entries(details)
      .map(([k, v]) => `${k}: ${v}`)
      .join(" | ");
    output += `\n  ${detailParts}`;
  }

  if (error.suggestion) {
    output += `\n  Suggestion: ${error.suggestion}`;
  }

  return output;
}
