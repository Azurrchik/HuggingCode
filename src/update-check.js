const PACKAGE_NAME = "huggingcode";
const REGISTRY_URL = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
const UPDATE_TIMEOUT_MS = 900;

function parseVersion(value) {
  const match = String(value || "").trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || "",
  };
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true });
}

export async function fetchLatestVersion({ fetchImpl = fetch, timeoutMs = UPDATE_TIMEOUT_MS } = {}) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const response = await fetchImpl(REGISTRY_URL, {
      headers: { Accept: "application/json" },
      signal: abort.signal,
    });
    if (!response?.ok) return null;
    const version = (await response.json())?.version;
    return parseVersion(version) ? String(version) : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkForUpdate(currentVersion, options = {}) {
  if (process.env.HUGGINGCODE_NO_UPDATE_CHECK === "1") return null;
  const current = String(currentVersion || "").trim();
  if (!parseVersion(current)) return null;
  const latest = await fetchLatestVersion(options);
  if (!latest || compareVersions(latest, current) <= 0) return null;
  return {
    current,
    latest,
    command: "npm install --global huggingcode@latest",
  };
}

export function formatUpdateNotice(update) {
  if (!update) return "";
  return `Доступно обновление HuggingCode ${update.latest} (установлено ${update.current}). После завершения работы выполните: ${update.command}`;
}
