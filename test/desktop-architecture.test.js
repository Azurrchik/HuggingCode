import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "..");

async function text(relative) {
  return readFile(path.join(root, relative), "utf8");
}

test("desktop scripts use Tauri 2 rather than Electron", async () => {
  const manifest = JSON.parse(await text("package.json"));
  assert.match(manifest.scripts.desktop, /^tauri dev/);
  assert.match(manifest.scripts["desktop:win"], /^npm run desktop:prepare-runtime && tauri build/);
  assert.equal("electron" in (manifest.devDependencies || {}), false);
  assert.equal("electron-builder" in (manifest.devDependencies || {}), false);
  assert.ok(manifest.devDependencies["@tauri-apps/cli"]);
});

test("Tauri config bundles the safe local controller bridge and source modules", async () => {
  const config = JSON.parse(await text("desktop/tauri/tauri.conf.json"));
  assert.equal(config.app.withGlobalTauri, true);
  assert.equal(config.bundle.resources["../tauri-bridge.js"], "tauri-bridge.js");
  assert.equal(config.bundle.resources["../../src"], "src");
  assert.equal(config.bundle.resources["../runtime"], "runtime");
});

test("desktop trajectory renderer exposes observed events but has no raw thinking display", async () => {
  const renderer = await text("desktop/renderer/renderer.js");
  const bridge = await text("desktop/tauri-bridge.js");
  assert.match(renderer, /Trajectory/);
  assert.match(renderer, /hidden reasoning|скрытые рассуждения/);
  assert.match(renderer, /tauri\.core\.invoke\("bridge_call"/);
  assert.doesNotMatch(bridge, /thinking_delta/);
  assert.match(bridge, /"activity"/);
});
