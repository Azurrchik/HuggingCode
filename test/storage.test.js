import test from "node:test";
import assert from "node:assert/strict";
import { clearStoredToken, getStoredToken, isStorageSupported, saveToken } from "../src/storage.js";

const TEST_TOKEN = "hf_abcdefghijklmnopqrstuvwx";

test("encrypts and restores an access token with Windows DPAPI", { skip: !isStorageSupported() }, async () => {
  await clearStoredToken();
  try {
    await saveToken(TEST_TOKEN);
    assert.equal(await getStoredToken(), TEST_TOKEN);
  } finally {
    await clearStoredToken();
  }
});
