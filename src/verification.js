import { readFile, stat } from "node:fs/promises";
import path from "node:path";

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function packageChecks(root) {
  const packagePath = path.join(root, "package.json");
  if (!(await exists(packagePath))) return [];
  try {
    const pkg = JSON.parse(await readFile(packagePath, "utf8"));
    const scripts = pkg.scripts || {};
    return ["lint", "typecheck", "test", "build"]
      .filter((name) => typeof scripts[name] === "string" && scripts[name].trim())
      .map((name) => ({ id: `npm:${name}`, label: `npm run ${name}`, command: `npm run ${name}`, source: "package.json" }));
  } catch {
    return [];
  }
}

export async function detectProjectChecks(root) {
  const checks = await packageChecks(root);
  if (await exists(path.join(root, "pyproject.toml"))) checks.push({ id: "python:pytest", label: "pytest", command: "python -m pytest", source: "pyproject.toml" });
  if (await exists(path.join(root, "Cargo.toml"))) checks.push({ id: "rust:test", label: "cargo test", command: "cargo test", source: "Cargo.toml" });
  if (await exists(path.join(root, "go.mod"))) checks.push({ id: "go:test", label: "go test ./...", command: "go test ./...", source: "go.mod" });
  return checks.slice(0, 8);
}
