import assert from "node:assert/strict";
import test from "node:test";
import { checkForUpdate, compareVersions, fetchLatestVersion, formatUpdateNotice } from "../src/update-check.js";

function jsonResponse(version, ok = true) {
  return {
    ok,
    async json() { return { version }; },
  };
}

test("compareVersions корректно сравнивает stable и prerelease npm-версии", () => {
  assert.equal(compareVersions("0.4.1", "0.4.0"), 1);
  assert.equal(compareVersions("0.4.0", "0.4.0"), 0);
  assert.equal(compareVersions("0.4.0", "0.4.1"), -1);
  assert.equal(compareVersions("1.0.0", "1.0.0-beta.1"), 1);
  assert.equal(compareVersions("bad", "1.0.0"), 0);
});

test("checkForUpdate возвращает рекомендацию только для более новой registry-версии", async () => {
  const update = await checkForUpdate("0.4.0", {
    fetchImpl: async () => jsonResponse("0.4.1"),
  });
  assert.deepEqual(update, {
    current: "0.4.0",
    latest: "0.4.1",
    command: "npm install --global huggingcode@latest",
  });
  assert.match(formatUpdateNotice(update), /Доступно обновление HuggingCode 0\.4\.1/);

  const current = await checkForUpdate("0.4.0", { fetchImpl: async () => jsonResponse("0.4.0") });
  assert.equal(current, null);
});

test("registry error, invalid payload и timeout не мешают запуску", async () => {
  assert.equal(await fetchLatestVersion({ fetchImpl: async () => jsonResponse("0.4.1", false) }), null);
  assert.equal(await fetchLatestVersion({ fetchImpl: async () => jsonResponse("not-a-version") }), null);
  assert.equal(await checkForUpdate("0.4.0", { fetchImpl: async () => { throw new Error("offline"); } }), null);
  assert.equal(formatUpdateNotice(null), "");
});
