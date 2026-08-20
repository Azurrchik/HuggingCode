import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createWorkspace } from "../src/workspace.js";

async function withWorkspace(run) {
  const directory = await mkdtemp(path.join(tmpdir(), "huggingcode-test-"));
  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("reads text files only from the workspace", async () => {
  await withWorkspace(async (directory) => {
    await writeFile(path.join(directory, "hello.txt"), "hello\nworld\n", "utf8");
    const workspace = await createWorkspace(directory);

    const content = await workspace.readTextFile("hello.txt");
    assert.match(content, /1: hello/);
    await assert.rejects(() => workspace.readTextFile("../outside.txt"), /за пределы/);
  });
});

test("blocks reads of environment-secret files", async () => {
  await withWorkspace(async (directory) => {
    await writeFile(path.join(directory, ".env"), "TOP_SECRET=value", "utf8");
    const workspace = await createWorkspace(directory);
    await assert.rejects(() => workspace.readTextFile(".env"), /секретов/);
  });
});

test("requires approval before a model can write a file", async () => {
  await withWorkspace(async (directory) => {
    const workspace = await createWorkspace(directory);
    const denied = await workspace.execute(
      "write_file",
      { path: "created.txt", content: "content" },
      async () => false,
    );
    assert.equal(denied, "User declined this file change.");
    await assert.rejects(() => readFile(path.join(directory, "created.txt"), "utf8"));

    const accepted = await workspace.execute(
      "write_file",
      { path: "created.txt", content: "content" },
      async () => true,
    );
    assert.match(accepted, /Written created.txt/);
    assert.equal(await readFile(path.join(directory, "created.txt"), "utf8"), "content");
  });
});

test("lists files while skipping dependency directories", async () => {
  await withWorkspace(async (directory) => {
    await writeFile(path.join(directory, "app.js"), "export {};", "utf8");
    await mkdirSafe(path.join(directory, "node_modules"));
    await writeFile(path.join(directory, "node_modules", "ignored.js"), "", "utf8");
    const workspace = await createWorkspace(directory);
    const files = await workspace.listFiles();
    assert.match(files, /app.js/);
    assert.doesNotMatch(files, /node_modules/);
  });
});

async function mkdirSafe(directory) {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(directory, { recursive: true });
}
