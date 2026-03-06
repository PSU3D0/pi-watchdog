#!/usr/bin/env bun
import {
  replaySession,
  formatReplaySummary,
  type ReplayRequest,
} from "../replay.js";

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.sessionPath) {
    printUsage("Missing required --session path");
    process.exit(1);
  }

  const summary = replaySession(args);
  process.stdout.write(
    `${formatReplaySummary(summary, args.output ?? "markdown")}\n`,
  );
}

function parseArgs(
  argv: string[],
): ReplayRequest & { output?: "markdown" | "json" } {
  const request: ReplayRequest & { output?: "markdown" | "json" } = {
    sessionPath: "",
  };

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case "--session":
        request.sessionPath = requireValue(arg, next);
        index++;
        break;
      case "--cwd":
        request.cwd = requireValue(arg, next);
        index++;
        break;
      case "--config":
        request.configPath = requireValue(arg, next);
        index++;
        break;
      case "--head-line":
        request.headLine = Number.parseInt(requireValue(arg, next), 10);
        index++;
        break;
      case "--head-message-id":
        request.headMessageId = requireValue(arg, next);
        index++;
        break;
      case "--subagent-line":
        request.subagentLine = Number.parseInt(requireValue(arg, next), 10);
        index++;
        break;
      case "--subagent-result-index":
        request.subagentResultIndex = Number.parseInt(
          requireValue(arg, next),
          10,
        );
        index++;
        break;
      case "--output":
        request.output = requireValue(arg, next) as "markdown" | "json";
        index++;
        break;
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
      default:
        printUsage(`Unknown argument: ${arg}`);
        process.exit(1);
    }
  }

  return request;
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function printUsage(error?: string) {
  if (error) {
    console.error(error);
    console.error("");
  }

  console.error(`Usage:
  bun run replay-watchdog --session <session.jsonl> [options]

Options:
  --cwd <path>                    Working directory used for path normalization/config loading
  --config <path>                 Explicit watchdog.json/jsonc override
  --head-line <n>                 Replay a normal session up to JSONL line n
  --head-message-id <id>          Replay a normal session up to a specific message entry id
  --subagent-line <n>             Replay embedded subagent messages from JSONL line n
  --subagent-result-index <n>     Pick a specific result from a subagent tool result (default: 0)
  --output <markdown|json>        Output format (default: markdown)

Examples:
  bun run replay-watchdog --session ~/.pi/agent/sessions/foo.jsonl --head-line 1200
  bun run replay-watchdog --session ~/.pi/agent/sessions/foo.jsonl --subagent-line 507
`);
}

main();
