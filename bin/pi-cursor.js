#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROVIDER_ID = "cursor-acp";
const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = dirname(__dirname);
const extensionPath = join(packageRoot, "pi-extension", "cursor-acp", "index.ts");
const bundledModelsPath = join(packageRoot, "pi-extension", "cursor-acp", "models.json");

function agentDir() {
  return resolve(process.env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent"));
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Failed to parse ${path}: ${error.message}`);
  }
}

function writeJsonChanged(path, value) {
  const next = `${JSON.stringify(value, null, 2)}\n`;
  const previous = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (previous === next) return { changed: false, backup: null };
  mkdirSync(dirname(path), { recursive: true });
  let backup = null;
  if (previous !== null) {
    backup = `${path}.bak.${timestamp()}`;
    writeFileSync(backup, previous);
  }
  writeFileSync(path, next);
  return { changed: true, backup };
}

function loadBundledModels() {
  const raw = readJson(bundledModelsPath, { models: [] });
  if (!Array.isArray(raw.models)) throw new Error(`Bundled models file is invalid: ${bundledModelsPath}`);
  return raw.models;
}

function install() {
  if (!existsSync(extensionPath)) throw new Error(`Extension entry not found: ${extensionPath}`);

  const dir = agentDir();
  const settingsPath = join(dir, "settings.json");
  const modelsPath = join(dir, "models.json");
  const settings = readJson(settingsPath, {});
  const modelsConfig = readJson(modelsPath, {});

  settings.extensions = Array.isArray(settings.extensions) ? settings.extensions : [];
  if (!settings.extensions.includes(extensionPath)) settings.extensions.push(extensionPath);

  modelsConfig.providers = modelsConfig.providers && typeof modelsConfig.providers === "object" ? modelsConfig.providers : {};
  modelsConfig.providers[PROVIDER_ID] = {
    ...(modelsConfig.providers[PROVIDER_ID] || {}),
    id: PROVIDER_ID,
    name: "Cursor Agent",
    baseUrl: "cursor-agent://local",
    apiKey: PROVIDER_ID,
    api: "cursor-agent-stream",
    models: loadBundledModels(),
  };

  const settingsWrite = writeJsonChanged(settingsPath, settings);
  const modelsWrite = writeJsonChanged(modelsPath, modelsConfig);

  console.log(`Pi agent directory: ${dir}`);
  console.log(`${settingsWrite.changed ? "Updated" : "Unchanged"}: ${settingsPath}`);
  if (settingsWrite.backup) console.log(`Backup: ${settingsWrite.backup}`);
  console.log(`${modelsWrite.changed ? "Updated" : "Unchanged"}: ${modelsPath}`);
  if (modelsWrite.backup) console.log(`Backup: ${modelsWrite.backup}`);
  console.log(`Extension: ${extensionPath}`);
  console.log(`Models: ${modelsConfig.providers[PROVIDER_ID].models.length}`);
  console.log("Next: cursor-agent login && pi --offline --list-models cursor-acp");
}

function status() {
  const dir = agentDir();
  const settingsPath = join(dir, "settings.json");
  const modelsPath = join(dir, "models.json");
  const settings = readJson(settingsPath, {});
  const modelsConfig = readJson(modelsPath, {});
  const extensions = Array.isArray(settings.extensions) ? settings.extensions : [];
  const modelCount = modelsConfig?.providers?.[PROVIDER_ID]?.models?.length ?? 0;
  const cursorStatus = spawnSync("cursor-agent", ["status"], { encoding: "utf8" });

  console.log(`Pi agent directory: ${dir}`);
  console.log(`Extension installed: ${extensions.includes(extensionPath) ? "yes" : "no"}`);
  console.log(`Model count: ${modelCount}`);
  if (cursorStatus.error) {
    console.log(`cursor-agent status: failed (${cursorStatus.error.message})`);
  } else {
    const output = `${cursorStatus.stdout || ""}${cursorStatus.stderr || ""}`.trim();
    console.log(`cursor-agent status: ${cursorStatus.status === 0 ? "ok" : `exit ${cursorStatus.status}`}`);
    if (output) console.log(output.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "<redacted-email>"));
  }
}

function models() {
  for (const model of loadBundledModels()) {
    console.log(`${model.id}\t${model.name ?? model.id}`);
  }
}

function help() {
  console.log(`pi-cursor\n\nCommands:\n  install   Install/update Pi global extension and model metadata\n  status    Show Pi config and cursor-agent status\n  models    List bundled Cursor models\n  help      Show this help\n\nEnvironment:\n  PI_CODING_AGENT_DIR        Pi global agent directory (default: ~/.pi/agent)\n  PI_CURSOR_MODELS_JSON      Runtime model metadata override\n  CURSOR_AGENT_EXECUTABLE    cursor-agent binary override\n`);
}

const command = process.argv[2] || "help";
try {
  if (command === "install") install();
  else if (command === "status") status();
  else if (command === "models") models();
  else if (command === "help" || command === "--help" || command === "-h") help();
  else {
    console.error(`Unknown command: ${command}`);
    help();
    process.exit(2);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
