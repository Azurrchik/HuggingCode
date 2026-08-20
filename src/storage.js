import { spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { credentialBackend } from "./platform.js";

const APP_NAME = "HuggingCode";
const CREDENTIAL_FILE = "credentials.json";
const DEFAULT_PROVIDER = "huggingface";
const sessionTokens = new Map();

function normalizedProvider(provider = DEFAULT_PROVIDER) {
  const id = String(provider || DEFAULT_PROVIDER).trim().toLowerCase();
  if (!/^[a-z0-9-]{2,40}$/.test(id)) throw new Error("Некорректный идентификатор провайдера.");
  return id;
}

function credentialsDirectory() {
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(homedir(), "AppData", "Roaming"), APP_NAME);
  return path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "huggingcode");
}
function credentialsPath() { return path.join(credentialsDirectory(), CREDENTIAL_FILE); }

function run(executable, args, input = "", { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = ""; let stderr = "";
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      if (allowFailure && error?.code === "ENOENT") resolve(""); else reject(error);
    });
    child.on("close", (code) => {
      if (code === 0 || allowFailure) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `${executable} завершился с кодом ${code}.`));
    });
    child.stdin.end(input, "utf8");
  });
}
function runPowerShell(script, input = "") { return run("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], input); }
function protectWithDpapi(secret) { return runPowerShell("$value = [Console]::In.ReadToEnd(); $secure = ConvertTo-SecureString -String $value -AsPlainText -Force; ConvertFrom-SecureString -SecureString $secure", secret); }
function unprotectWithDpapi(ciphertext) { return runPowerShell("$value = [Console]::In.ReadToEnd(); $secure = ConvertTo-SecureString -String $value; $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }", ciphertext); }
function keychainAccount(provider) { return `${provider}:${process.env.USER || process.env.LOGNAME || "default"}`; }
function keychainRead(provider) { return run("security", ["find-generic-password", "-s", APP_NAME, "-a", keychainAccount(provider), "-w"], "", { allowFailure: true }); }
function keychainWrite(provider, token) { return run("security", ["add-generic-password", "-U", "-s", APP_NAME, "-a", keychainAccount(provider), "-w", token]); }
function keychainClear(provider) { return run("security", ["delete-generic-password", "-s", APP_NAME, "-a", keychainAccount(provider)], "", { allowFailure: true }); }
function secretAttributes(provider) { return ["application", "huggingcode", "service", "provider", "id", provider]; }
function secretServiceRead(provider) { return run("secret-tool", ["lookup", ...secretAttributes(provider)], "", { allowFailure: true }); }
function secretServiceWrite(provider, token) { return run("secret-tool", ["store", `--label=HuggingCode ${provider} token`, ...secretAttributes(provider)], token); }
function secretServiceClear(provider) { return run("secret-tool", ["clear", ...secretAttributes(provider)], "", { allowFailure: true }); }

export function validateToken(token) { return typeof token === "string" && /^hf_[A-Za-z0-9]{20,}$/.test(token.trim()); }
export function validateProviderToken(provider, token) {
  const value = String(token || "").trim();
  return normalizedProvider(provider) === DEFAULT_PROVIDER ? validateToken(value) : value.length >= 8 && value.length <= 4096;
}
export function isStorageSupported() { return true; }
export function getStorageInfo() { const backend = credentialBackend(); return { ...backend, sessionOnly: !backend.persistent }; }

async function readDpapiTokens() {
  try {
    const record = JSON.parse(await readFile(credentialsPath(), "utf8"));
    if (record?.version === 1 && record?.encryptedToken) {
      const token = await unprotectWithDpapi(record.encryptedToken);
      return validateToken(token) ? { [DEFAULT_PROVIDER]: token.trim() } : {};
    }
    if (record?.version !== 2 || !record.encryptedTokens) return {};
    const decoded = JSON.parse(await unprotectWithDpapi(record.encryptedTokens));
    return Object.fromEntries(Object.entries(decoded || {}).filter(([provider, token]) => validateProviderToken(provider, token)));
  } catch (error) {
    if (error?.code === "ENOENT") return {};
    throw new Error("Не удалось прочитать зашифрованные учётные данные HuggingCode.");
  }
}
async function saveDpapiTokens(tokens) {
  const ciphertext = await protectWithDpapi(JSON.stringify(tokens));
  const directory = credentialsDirectory(); const target = credentialsPath(); const temporary = `${target}.${process.pid}.tmp`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(temporary, JSON.stringify({ version: 2, encryptedTokens: ciphertext }, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
}

export async function saveProviderToken(provider, token) {
  const id = normalizedProvider(provider); const value = String(token || "").trim();
  if (!validateProviderToken(id, value)) throw new Error(id === DEFAULT_PROVIDER ? "Токен Hugging Face должен начинаться с hf_ и быть вставлен полностью." : "Ключ провайдера выглядит неполным.");
  sessionTokens.set(id, value);
  const backend = credentialBackend();
  try {
    if (backend.id === "dpapi") { const tokens = await readDpapiTokens(); tokens[id] = value; await saveDpapiTokens(tokens); }
    else if (backend.id === "keychain") await keychainWrite(id, value);
    else if (backend.id === "secret-service") await secretServiceWrite(id, value);
    else return { persistent: false, backend: backend.label, warning: "Ключ сохранён только до закрытия приложения." };
    return { persistent: true, backend: backend.label };
  } catch (error) {
    return { persistent: false, backend: backend.label, warning: `Защищённое хранилище недоступно; ключ сохранён только до закрытия приложения (${error.message}).` };
  }
}

export async function getProviderToken(provider = DEFAULT_PROVIDER) {
  const id = normalizedProvider(provider);
  if (sessionTokens.has(id)) return sessionTokens.get(id);
  const backend = credentialBackend();
  try {
    const token = backend.id === "dpapi" ? (await readDpapiTokens())[id]
      : backend.id === "keychain" ? await keychainRead(id)
        : backend.id === "secret-service" ? await secretServiceRead(id) : null;
    if (validateProviderToken(id, token)) { sessionTokens.set(id, String(token).trim()); return String(token).trim(); }
    return null;
  } catch { return null; }
}

export async function clearProviderToken(provider = DEFAULT_PROVIDER) {
  const id = normalizedProvider(provider); sessionTokens.delete(id); const backend = credentialBackend();
  if (backend.id === "dpapi") { const tokens = await readDpapiTokens(); delete tokens[id]; if (Object.keys(tokens).length) await saveDpapiTokens(tokens); else await rm(credentialsPath(), { force: true }); }
  else if (backend.id === "keychain") await keychainClear(id);
  else if (backend.id === "secret-service") await secretServiceClear(id);
}

export async function saveToken(token) { return saveProviderToken(DEFAULT_PROVIDER, token); }
export async function getStoredToken() { return getProviderToken(DEFAULT_PROVIDER); }
export async function clearStoredToken() { return clearProviderToken(DEFAULT_PROVIDER); }
export function getCredentialLocation() { const backend = credentialBackend(); return backend.id === "dpapi" ? credentialsPath() : backend.persistent ? backend.label : "session-only"; }
