import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfigDirectory } from "./config.js";

function sessionDirectory() {
  return path.join(getConfigDirectory(), "sessions");
}

function sessionPath(id) {
  if (!/^[a-zA-Z0-9_-]{8,100}$/.test(id)) throw new Error("Некорректный идентификатор сессии.");
  return path.join(sessionDirectory(), `${id}.json`);
}

function now() {
  return new Date().toISOString();
}

function createId() {
  return `s_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function cleanName(name, fallback = "Новая сессия") {
  const normalized = String(name || "").replace(/[\u0000-\u001f]/g, " ").trim().replace(/\s+/g, " ");
  return (normalized || fallback).slice(0, 120);
}

function normalizeSession(raw) {
  if (!raw || raw.version !== 1 || typeof raw.id !== "string" || !Array.isArray(raw.messages)) {
    throw new Error("Файл сессии имеет неподдерживаемый формат.");
  }
  return {
    version: 1,
    id: raw.id,
    name: cleanName(raw.name, "Без названия"),
    workspaceRoot: typeof raw.workspaceRoot === "string" ? raw.workspaceRoot : "",
    messages: raw.messages,
    createdAt: raw.createdAt || now(),
    updatedAt: raw.updatedAt || now(),
    metadata: raw.metadata && typeof raw.metadata === "object" ? raw.metadata : {},
  };
}

async function atomicWrite(target, object) {
  const temporary = `${target}.${process.pid}.tmp`;
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(temporary, `${JSON.stringify(object, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
}

export async function createSession({ name, workspaceRoot, messages = [], metadata = {} } = {}) {
  const createdAt = now();
  const session = {
    version: 1,
    id: createId(),
    name: cleanName(name),
    workspaceRoot: workspaceRoot || "",
    messages,
    createdAt,
    updatedAt: createdAt,
    metadata,
  };
  await atomicWrite(sessionPath(session.id), session);
  return session;
}

export async function saveSession(session) {
  const next = normalizeSession({ ...session, updatedAt: now() });
  await atomicWrite(sessionPath(next.id), next);
  return next;
}

export async function loadSession(id) {
  return normalizeSession(JSON.parse(await readFile(sessionPath(id), "utf8")));
}

export async function listSessions(limit = 30) {
  try {
    const entries = await readdir(sessionDirectory(), { withFileTypes: true });
    const sessions = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".json")) continue;
      try {
        const session = normalizeSession(JSON.parse(await readFile(path.join(sessionDirectory(), entry.name), "utf8")));
        sessions.push({
          id: session.id,
          name: session.name,
          workspaceRoot: session.workspaceRoot,
          createdAt: session.createdAt,
          updatedAt: session.updatedAt,
          messageCount: session.messages.length,
        });
      } catch {
        // Ignore one corrupted historical snapshot rather than hiding every valid session.
      }
    }
    return sessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)).slice(0, Math.max(1, Math.min(limit, 100)));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export async function branchSession(session, name) {
  return createSession({
    name: cleanName(name, `${session.name} — ветка`),
    workspaceRoot: session.workspaceRoot,
    messages: structuredClone(session.messages),
    metadata: { ...session.metadata, branchedFrom: session.id },
  });
}

export function sessionToText(session) {
  const heading = `# HuggingCode — ${session.name}\n\n`;
  const header = `- ID: ${session.id}\n- Рабочая область: ${session.workspaceRoot || "не указана"}\n- Обновлено: ${session.updatedAt}\n\n`;
  const transcript = session.messages
    .filter((message) => ["user", "assistant", "system", "tool"].includes(message.role))
    .map((message) => {
      const role = { system: "System", user: "User", assistant: "HuggingCode", tool: "Tool" }[message.role] || message.role;
      const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "");
      return `## ${role}\n\n${content}\n`;
    })
    .join("\n");
  return `${heading}${header}${transcript}`;
}

export function getSessionDirectory() {
  return sessionDirectory();
}
