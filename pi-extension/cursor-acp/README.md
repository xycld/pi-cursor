# Pi Cursor ACP Extension

Pi extension for using Cursor subscription models through `cursor-agent`.

## What it does

- Registers a Pi provider named `cursor-acp`.
- Loads model metadata from Pi global config or the bundled `models.json`.
- Bridges Pi's custom provider streaming API to `cursor-agent --print --output-format stream-json`.
- Keeps authentication in Cursor Agent; it does **not** copy or store Cursor OAuth tokens.

## Pi global setup

Use the package installer from the repository root:

```bash
./install.sh
```

Or add the extension path to `~/.pi/agent/settings.json` manually:

```json
{
  "extensions": ["/absolute/path/to/pi-cursor/pi-extension/cursor-acp/index.ts"]
}
```

Then authenticate Cursor Agent and verify the provider:

```bash
cursor-agent login
cursor-agent status
pi --offline --list-models cursor-acp
```

Start Pi with a Cursor model once the provider is visible:

```bash
pi --model cursor-acp/auto
```

For a one-shot smoke test without installing the extension globally:

```bash
pi --no-extensions \
  -e /absolute/path/to/pi-cursor/pi-extension/cursor-acp/index.ts \
  --model cursor-acp/auto \
  --no-tools --no-session --print "Reply with exactly: OK"
```

## Current scope

- This is a Pi extension entry point.
- Authentication stays in Cursor Agent. Use `cursor-agent login`; Pi login is not used for Cursor OAuth.
- The bridge sends a text prompt to `cursor-agent --print` and reads `stream-json` events back into Pi.
- Cursor Agent receives `--force` by default to match unattended provider behavior; set `CURSOR_ACP_FORCE=false` for manual confirmation behavior.
- Pi tool-call forwarding and binary/image block passthrough are intentionally out of scope for this first provider bridge. Cursor Agent can still use its own tools according to its CLI mode and flags.

## Environment knobs

- `PI_CURSOR_MODELS_JSON`: override the model metadata JSON file used for the `cursor-acp` model list.
- `CURSOR_AGENT_EXECUTABLE` or `CURSOR_AGENT_PATH`: override `cursor-agent` binary path.
- `CURSOR_ACP_FORCE=false`: do not pass `--force` to Cursor Agent.
- `CURSOR_ACP_SANDBOX=enabled|disabled`: pass Cursor Agent sandbox mode.
- `CURSOR_ACP_MODE=plan|ask`: run Cursor Agent in plan/ask mode.
