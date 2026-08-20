import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { getConfigDirectory } from "./config.js";

function digest(value) {
  return createHash("sha256").update(String(value ?? ""), "utf8").digest("hex");
}

function workspaceId(root) {
  return createHash("sha256").update(root, "utf8").digest("hex").slice(0, 20);
}

async function contentIfFile(target) {
  try {
    const info = await stat(target);
    if (!info.isFile()) return { exists: false, content: "" };
    return { exists: true, content: await readFile(target, "utf8") };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false, content: "" };
    throw error;
  }
}

export class CheckpointStore {
  constructor(workspaceRoot) {
    this.workspaceRoot = workspaceRoot;
    this.directory = path.join(getConfigDirectory(), "checkpoints", workspaceId(workspaceRoot));
    this.activeTurn = null;
    this.records = [];
  }

  async beginTurn(turnId) {
    this.activeTurn = turnId;
    this.records = [];
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
  }

  async record({ type, target, label, before, after }) {
    if (!this.activeTurn) return;
    const next = typeof after === "string" ? { exists: true, content: after } : { exists: Boolean(after?.exists), content: after?.content || "" };
    const prior = typeof before === "string" ? { exists: true, content: before } : { exists: Boolean(before?.exists), content: before?.content || "" };
    const existing = this.records.find((entry) => entry.target === target);
    if (existing) {
      existing.after = next.content;
      existing.afterExists = next.exists;
      existing.afterDigest = digest(existing.after);
      existing.type = type;
      await this.flush();
      return;
    }
    const entry = {
      type,
      target,
      label,
      beforeExists: prior.exists,
      before: prior.content,
      afterExists: next.exists,
      after: next.content,
      afterDigest: digest(next.content),
    };
    this.records.push(entry);
    await this.flush();
  }

  async flush() {
    if (!this.activeTurn || !this.records.length) return;
    const target = path.join(this.directory, `${this.activeTurn}.json`);
    const payload = { version: 1, turnId: this.activeTurn, createdAt: new Date().toISOString(), workspaceRoot: this.workspaceRoot, records: this.records };
    await writeFile(target, `${JSON.stringify(payload)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  async list() {
    try {
      const names = (await readdir(this.directory)).filter((name) => name.endsWith(".json")).sort().reverse();
      return names;
    } catch (error) {
      if (error?.code === "ENOENT") return [];
      throw error;
    }
  }

  async undoLatest() {
    const names = await this.list();
    const filename = names[0];
    if (!filename) return { found: false, restored: [], removed: [], conflicts: [], failed: [] };
    const checkpointPath = path.join(this.directory, filename);
    const checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
    const restored = [];
    const removed = [];
    const conflicts = [];
    const failed = [];
    for (const record of [...(checkpoint.records || [])].reverse()) {
      try {
        const current = await contentIfFile(record.target);
        if (digest(current.content) !== record.afterDigest || current.exists !== record.afterExists) {
          conflicts.push(record.label);
          continue;
        }
        if (record.beforeExists) {
          await mkdir(path.dirname(record.target), { recursive: true, mode: 0o700 });
          await writeFile(record.target, record.before, { encoding: "utf8", mode: 0o600 });
          restored.push(record.label);
        } else {
          await rm(record.target, { force: false });
          removed.push(record.label);
        }
      } catch (error) {
        if (error?.code === "ENOENT" && !record.beforeExists) {
          removed.push(record.label);
        } else {
          failed.push({ path: record.label, error: error?.message || String(error) });
        }
      }
    }
    if (!conflicts.length && !failed.length) await rm(checkpointPath, { force: true });
    return { found: true, restored, removed, conflicts, failed, turnId: checkpoint.turnId };
  }
}
