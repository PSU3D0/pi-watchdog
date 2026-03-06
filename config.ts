import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { WatchdogConfig } from "./types.js";

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends Array<infer U>
    ? U[]
    : T[K] extends object
      ? DeepPartial<T[K]>
      : T[K];
};

const DEFAULT_CONFIG: WatchdogConfig = {
  enabled: true,
  debug: false,
  maxHistoryEvents: 5000,
  rebuildHistoryOnSessionStart: true,
  detectors: {
    repetitiveRead: {
      enabled: true,
      readTools: ["read"],
      searchTools: ["grep", "find"],
      windowToolCalls: 120,
      minReadCalls: 24,
      minDominantPathReads: 12,
      suspicious: {
        topPathShare: 0.35,
        exactChunkShare: 0.2,
        overlapShare: 0.55,
        readSearchRatio: 0.85,
        maxUniquePaths: 8,
        restarts: 5,
        minScore: 5,
      },
      pathological: {
        topPathShare: 0.5,
        exactChunkShare: 0.3,
        overlapShare: 0.7,
        readSearchRatio: 0.92,
        maxUniquePaths: 6,
        restarts: 10,
        minScore: 8,
      },
    },
    toolBudget: {
      enabled: true,
      softToolCalls: 300,
      hardToolCalls: 600,
      softDurationMs: 20 * 60 * 1000,
      hardDurationMs: 45 * 60 * 1000,
    },
  },
  actions: {
    suspicious: ["status", "persist"],
    stuck: ["status", "persist", "notify"],
    pathological: ["status", "persist", "notify"],
    cooldownToolCalls: 25,
    delivery: "custom",
    customMessageType: "watchdog",
    displayMessages: true,
    triggerTurn: true,
  },
};

export function getDefaultConfig(): WatchdogConfig {
  return structuredClone(DEFAULT_CONFIG);
}

export function mergeConfig(
  ...overrides: Array<DeepPartial<WatchdogConfig> | undefined>
): WatchdogConfig {
  const config = getDefaultConfig();

  for (const override of overrides) {
    if (override) {
      mergeDeep(config, override);
    }
  }

  return config;
}

export function getConfigSearchPaths(
  cwd: string,
  homeDir = homedir(),
): string[] {
  const globalDir = join(homeDir, ".pi", "agent");
  const localDir = join(cwd, ".pi");

  return [
    join(globalDir, "watchdog.json"),
    join(globalDir, "watchdog.jsonc"),
    join(localDir, "watchdog.json"),
    join(localDir, "watchdog.jsonc"),
  ];
}

export function parseConfigText(text: string): DeepPartial<WatchdogConfig> {
  const withoutBom = text.replace(/^\uFEFF/, "");
  const withoutComments = stripJsonComments(withoutBom);
  const withoutTrailingCommas = withoutComments.replace(/,\s*([}\]])/g, "$1");
  return JSON.parse(withoutTrailingCommas);
}

export function loadConfig(cwd: string, homeDir = homedir()): WatchdogConfig {
  const overrides: Array<DeepPartial<WatchdogConfig>> = [];

  for (const path of getConfigSearchPaths(cwd, homeDir)) {
    const override = readConfigOverride(path);
    if (override) {
      overrides.push(override);
    }
  }

  return mergeConfig(...overrides);
}

function readConfigOverride(
  path: string,
): DeepPartial<WatchdogConfig> | undefined {
  if (!existsSync(path)) {
    return undefined;
  }

  try {
    return parseConfigText(readFileSync(path, "utf8"));
  } catch (error) {
    console.error(`[watchdog] Failed to load config from ${path}:`, error);
    return undefined;
  }
}

function stripJsonComments(input: string): string {
  let output = "";
  let inString = false;
  let stringDelimiter = '"';
  let escaping = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    const next = input[index + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        output += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index++;
      }
      continue;
    }

    if (inString) {
      output += char;
      if (escaping) {
        escaping = false;
        continue;
      }
      if (char === "\\") {
        escaping = true;
        continue;
      }
      if (char === stringDelimiter) {
        inString = false;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      stringDelimiter = char;
      output += char;
      continue;
    }

    if (char === "/" && next === "/") {
      inLineComment = true;
      index++;
      continue;
    }

    if (char === "/" && next === "*") {
      inBlockComment = true;
      index++;
      continue;
    }

    output += char;
  }

  return output;
}

function mergeDeep(target: any, source: any): any {
  if (isObject(target) && isObject(source)) {
    for (const key in source) {
      if (isObject(source[key])) {
        if (!target[key]) Object.assign(target, { [key]: {} });
        mergeDeep(target[key], source[key]);
      } else {
        Object.assign(target, { [key]: source[key] });
      }
    }
  }
  return target;
}

function isObject(item: any) {
  return item && typeof item === "object" && !Array.isArray(item);
}
