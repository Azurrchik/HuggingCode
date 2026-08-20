import { spawn } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
const APP_NAME = "HuggingCode";
const CREDENTIAL_FILE = "credentials.json";

function credentialsDirectory() {
  if (process.platform === "win32") {
    return path.join(process.env.APPDATA || path.join(homedir(), "AppData", "Roaming"), APP_NAME);
  }
  return path.join(process.env.XDG_CONFIG_HOME || path.join(homedir(), ".config"), "huggingcode");
}

function credentialsPath() {
  return path.join(credentialsDirectory(), CREDENTIAL_FILE);
}

async function runPowerShell(script, input = "") {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(stderr.trim() || `PowerShell завершился с кодом ${code}.`));
    });
    child.stdin.end(input, "utf8");
  });
}

async function protectWithDpapi(secret) {
  return runPowerShell(
    "$value = [Console]::In.ReadToEnd(); $secure = ConvertTo-SecureString -String $value -AsPlainText -Force; ConvertFrom-SecureString -SecureString $secure",
    secret,
  );
}

async function unprotectWithDpapi(ciphertext) {
  return runPowerShell(
    "$value = [Console]::In.ReadToEnd(); $secure = ConvertTo-SecureString -String $value; $ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure); try { [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr) }",
    ciphertext,
  );
}

export function isStorageSupported() {
  return process.platform === "win32";
}

export function validateToken(token) {
  return typeof token === "string" && /^hf_[A-Za-z0-9]{20,}$/.test(token.trim());
}

export async function saveToken(token) {
  if (!isStorageSupported()) {
    throw new Error("В этой версии безопасное хранение токена поддерживается только в Windows.");
  }

  const normalized = token.trim();
  if (!validateToken(normalized)) {
    throw new Error("Токен должен начинаться с hf_ и быть вставлен полностью.");
  }

  const ciphertext = await protectWithDpapi(normalized);
  const directory = credentialsDirectory();
  const target = credentialsPath();
  const temporary = `${target}.${process.pid}.tmp`;

  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(
    temporary,
    JSON.stringify({ version: 1, provider: "huggingface", encryptedToken: ciphertext }, null, 2),
    { encoding: "utf8", mode: 0o600 },
  );
  await rename(temporary, target);
}

export async function getStoredToken() {
  if (!isStorageSupported()) return null;

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

export async function clearStoredToken() {
  await rm(credentialsPath(), { force: true });
}

export function getCredentialLocation() {
  return credentialsPath();
}
