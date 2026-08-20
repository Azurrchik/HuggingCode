import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { decidePermission, isSafeAutoCommand } from "../src/permissions.js";
import { branchSession, createSession, listSessions, loadSession, saveSession, sessionToText } from "../src/session-store.js";
import { listSkills, loadSkill } from "../src/skills.js";

async function withDirectory(prefix, run) {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("permission modes keep dangerous actions behind an explicit prompt", () => {
  assert.equal(decidePermission("manual", { type: "write" }).decision, "ask");
  assert.equal(decidePermission("accept-edits", { type: "write" }).decision, "allow");
  assert.equal(decidePermission("accept-edits", { type: "command", command: "npm test" }).decision, "ask");
  assert.equal(decidePermission("plan", { type: "write" }).decision, "deny");
  assert.equal(decidePermission("plan", { type: "command", command: "npm test" }).decision, "deny");
  assert.equal(decidePermission("safe-auto", { type: "command", command: "npm test" }).decision, "allow");
  assert.equal(decidePermission("safe-auto", { type: "command", command: "del important.txt" }).decision, "ask");
  assert.equal(isSafeAutoCommand("npm test && del important.txt"), false);
});

test("sessions can be saved, listed, branched and exported", async () => {
  await withDirectory("huggingcode-session-", async (configHome) => {
    const previousAppData = process.env.APPDATA;
    process.env.APPDATA = configHome;
    try {
      const session = await createSession({
        name: "Первый план",
        workspaceRoot: "C:/project",
        messages: [{ role: "system", content: "system" }, { role: "user", content: "hello" }],
      });
      const saved = await saveSession({ ...session, name: "Переименованная сессия" });
      const loaded = await loadSession(saved.id);
      assert.equal(loaded.name, "Переименованная сессия");
      const sessions = await listSessions();
      assert.equal(sessions.length, 1);
      const branch = await branchSession(loaded, "Эксперимент");
      assert.notEqual(branch.id, loaded.id);
      assert.equal(branch.metadata.branchedFrom, loaded.id);
      assert.match(sessionToText(branch), /Эксперимент/);
    } finally {
      if (previousAppData === undefined) delete process.env.APPDATA;
      else process.env.APPDATA = previousAppData;
    }
  });
});

test("project skills are discovered and receive arguments", async () => {
  await withDirectory("huggingcode-skills-", async (workspace) => {
    const skillDir = path.join(workspace, ".huggingcode", "skills");
    await mkdir(skillDir, { recursive: true });
    await writeFile(path.join(skillDir, "review.md"), "---\ndescription: Проверить локальные изменения\n---\nReview $ARGUMENTS and report only findings.", "utf8");
    const skills = await listSkills(workspace);
    assert.equal(skills.length, 1);
    assert.equal(skills[0].name, "review");
    const skill = await loadSkill(workspace, "review", "the auth flow");
    assert.match(skill.prompt, /the auth flow/);
  });
});


test("stopped local tasks ignore a late completion", async () => {
  const { TaskManager } = await import("../src/tasks.js");
  let complete;
  const promise = new Promise((resolve) => { complete = resolve; });
  const tasks = new TaskManager();
  const task = tasks.start("slow investigation", () => promise);
  tasks.stop(task.id);
  complete("late answer");
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(tasks.get(task.id).status, "stopped");
});
