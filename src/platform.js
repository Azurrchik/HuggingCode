export function normalizePlatform(platform = process.platform) {
  if (platform === "win32") return "windows";
  if (platform === "darwin") return "macos";
  if (platform === "linux") return "linux";
  return "other";
}

export function platformLabel(platform = process.platform) {
  return {
    windows: "Windows",
    macos: "macOS",
    linux: "Linux",
    other: platform,
  }[normalizePlatform(platform)];
}

export function shellAdapter(platform = process.platform) {
  const normalized = normalizePlatform(platform);
  if (normalized === "windows") {
    return {
      executable: "cmd.exe",
      argumentsFor: (command) => ["/d", "/s", "/c", command],
      label: "cmd.exe",
    };
  }
  return {
    executable: "/bin/sh",
    argumentsFor: (command) => ["-lc", command],
    label: "/bin/sh",
  };
}

export function credentialBackend(platform = process.platform) {
  const normalized = normalizePlatform(platform);
  if (normalized === "windows") return { id: "dpapi", label: "Windows DPAPI", persistent: true };
  if (normalized === "macos") return { id: "keychain", label: "macOS Keychain", persistent: true };
  if (normalized === "linux") return { id: "secret-service", label: "Linux Secret Service", persistent: true };
  return { id: "session-only", label: "session-only memory", persistent: false };
}

export function platformSnapshot(platform = process.platform) {
  const normalized = normalizePlatform(platform);
  const shell = shellAdapter(platform);
  const credentials = credentialBackend(platform);
  return { id: normalized, label: platformLabel(platform), shell: shell.label, credentials };
}
