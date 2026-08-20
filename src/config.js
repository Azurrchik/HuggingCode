import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

export const DEFAULT_MODEL = "openai/gpt-oss-120b:fastest";
export const DEFAULT_MAX_TOKENS = 4096;
export const DEFAULT_PERMISSION_MODE = "manual";
export const DEFAULT_REASONING_EFFORT = "medium";
export const DEFAULT_AUTO_COMPACT_THRESHOLD = 48_000;
export const PERMISSION_MODES = ["manual", "accept-edits", "plan", "safe-auto", "full"];
export const REASONING_EFFORTS = ["auto", "none", "minimal", "low", "medium", "high", "xhigh"];

function configDirectory() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(homedir(), "AppData", "Roaming"), "HuggingCode");
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "huggingcode");
}

function configPath() {
  return path.join(configDirectory(), "config.json");
}

function integerOr(value, fallback, minimum, maximum) {
  return Number.isInteger(value) && value >= minimum && value <= maximum ? value : fallback;
}

function normalizeConfig(stored = {}) {
  return {
    model: typeof stored.model === "string" && stored.model.trim() ? stored.model.trim() : DEFAULT_MODEL,
    maxTokens: integerOr(stored.maxTokens, DEFAULT_MAX_TOKENS, 256, 32_768),
    permissionMode: PERMISSION_MODES.includes(stored.permissionMode) && stored.permissionMode !== "full" ? stored.permissionMode : DEFAULT_PERMISSION_MODE,
    reasoningEffort: REASONING_EFFORTS.includes(stored.reasoningEffort) ? stored.reasoningEffort : DEFAULT_REASONING_EFFORT,
    autoCompactThreshold: integerOr(stored.autoCompactThreshold, DEFAULT_AUTO_COMPACT_THRESHOLD, 4_000, 1_000_000),
    theme: typeof stored.theme === "string" && stored.theme.trim() ? stored.theme.trim() : "orange",
    debug: stored.debug === true,
  };
}

export async function getConfig() {
  try {
    return normalizeConfig(JSON.parse(await readFile(configPath(), "utf8")));
  } catch (error) {
    if (error?.code === "ENOENT") return normalizeConfig();
    throw new Error("Не удалось прочитать файл настроек HuggingCode.");
  }
}

export async function updateConfig(patch) {
  const current = await getConfig();
  const next = normalizeConfig({ ...current, ...patch });
  const directory = configDirectory();
  const target = configPath();
  const temporary = `${target}.${process.pid}.tmp`;

  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
  return next;
}

export function getConfigLocation() {
  return configPath();
}

export function getConfigDirectory() {
  return configDirectory();
}
