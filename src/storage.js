import { spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { credentialBackend } from "./platform.js";

const APP_NAME = "HuggingCode";
const CREDENTIAL_FILE = "credentials.json";
const SECRET_SERVICE_ATTRIBUTES = ["application", "huggingcode", "service", "huggingface"];
let sessionToken = null;

function credentialsDirectory() {
  if (process.platform === "win32") return path.join(process.env.APPDATA || path.join(homedir(), "AppData", "Roaming"), APP_NAME);
  return path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "huggingcode");
}

function credentialsPath() {
  return path.join(credentialsDirectory(), CREDENTIAL_FILE);
}

function run(executable, args, input = "", { allowFailure = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      if (allowFailure && error?.code === "ENOENT") resolve("");
      else reject(error);
    });
    child.on("close", (code) => {
      if (code === 0 || allowFailure) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `${executable} завершился с кодом ${code}.`));
    });
    child.stdin.end(input, "utf8");
  });
}

function runPowerShell(script, input = "") {
  return run("powershell.exe", ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script], input);
}

function protectWithDpapi(secret) {
  return runPowerShell("$value = [Console]::In.ReadToEnd(); $secure = ConvertTo-SecureString -String $value -AsPlainText -Force; ConvertFrom-SecureString -SecureString $secure", secret);
}

function unprotectWithDpapi(ciphertext) {
  return runPowerShell("$value = [Console]::In.ReadToEnd(); $secure = ConvertTo-SecureString -String $value; $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }", ciphertext);
}

function keychainAccount() {
  return process.env.USER || process.env.LOGNAME || "default";
}

function keychainRead() {
  return run("security", ["find-generic-password", "-s", APP_NAME, "-a", keychainAccount(), "-w"], "", { allowFailure: true });
}

async function keychainWrite(token) {
  await run("security", ["add-generic-password", "-U", "-s", APP_NAME, "-a", keychainAccount(), "-w", token]);
}

function keychainClear() {
  return run("security", ["delete-generic-password", "-s", APP_NAME, "-a", keychainAccount()], "", { allowFailure: true });
}

function secretServiceRead() {
  return run("secret-tool", ["lookup", ...SECRET_SERVICE_ATTRIBUTES], "", { allowFailure: true });
}

function secretServiceWrite(token) {
  return run("secret-tool", ["store", "--label=HuggingCode Hugging Face token", ...SECRET_SERVICE_ATTRIBUTES], token);
}

function secretServiceClear() {
  return run("secret-tool", ["clear", ...SECRET_SERVICE_ATTRIBUTES], "", { allowFailure: true });
}

export function isStorageSupported() {
  return true;
}

export function getStorageInfo() {
  const backend = credentialBackend();
  return { ...backend, sessionOnly: !backend.persistent };
}

export function validateToken(token) {
  return typeof token === "string" && /^hf_[A-Za-z0-9]{20,}$/.test(token.trim());
}

async function saveDpapi(token) {
  const ciphertext = await protectWithDpapi(token);
  const directory = credentialsDirectory();
  const target = credentialsPath();
  const temporary = `${target}.${process.pid}.tmp`;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(temporary, JSON.stringify({ version: 1, provider: "huggingface", encryptedToken: ciphertext }, null, 2), { encoding: "utf8", mode: 0o600 });
  await rename(temporary, target);
}

async function readDpapi() {
  try {
    const raw = await readFile(credentialsPath(), "utf8");
    const credentials = JSON.parse(raw);
    if (!credentials?.encryptedToken || credentials.version !== 1) return null;
    const token = await unprotectWithDpapi(credentials.encryptedToken);
    return validateToken(token) ? token : null;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw new Error("Не удалось прочитать зашифрованные учётные данные HuggingCode.");
  }
}

export async function saveToken(token) {
  const normalized = token.trim();
  if (!validateToken(normalized)) throw new Error("Токен должен начинаться с hf_ и быть вставлен полностью.");
  sessionToken = normalized;
  const backend = credentialBackend();
  try {
    if (backend.id === "dpapi") await saveDpapi(normalized);
    else if (backend.id === "keychain") await keychainWrite(normalized);
    else if (backend.id === "secret-service") await secretServiceWrite(normalized);
    else return { persistent: false, backend: backend.label, warning: "Токен сохранён только до закрытия приложения." };
    return { persistent: true, backend: backend.label };
  } catch (error) {
    return { persistent: false, backend: backend.label, warning: `Защищённое хранилище недоступно; токен сохранён только до закрытия приложения (${error.message}).` };
  }
}

export async function getStoredToken() {
  if (sessionToken && validateToken(sessionToken)) return sessionToken;
  const backend = credentialBackend();
  try {
    const token = backend.id === "dpapi" ? await readDpapi()
      : backend.id === "keychain" ? await keychainRead()
        : backend.id === "secret-service" ? await secretServiceRead()
          : null;
    if (validateToken(token)) {
      sessionToken = token.trim();
      return sessionToken;
    }
    return null;
  } catch {
    return null;
  }
}

export async function clearStoredToken() {
  sessionToken = null;
  const backend = credentialBackend();
  if (backend.id === "dpapi") await rm(credentialsPath(), { force: true });
  else if (backend.id === "keychain") await keychainClear();
  else if (backend.id === "secret-service") await secretServiceClear();
}

export function getCredentialLocation() {
  const backend = credentialBackend();
  if (backend.id === "dpapi") return credentialsPath();
  return backend.persistent ? backend.label : "session-only";
}
