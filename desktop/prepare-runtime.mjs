import { copyFile, mkdir, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const runtimeDir = path.resolve("desktop", "tauri", "runtime");
const executable = process.platform === "win32" ? "node.exe" : "node";
const target = path.join(runtimeDir, executable);

await mkdir(runtimeDir, { recursive: true });
await copyFile(process.execPath, target);
const details = await stat(target);
if (!details.size) throw new Error("Не удалось подготовить bundled Node runtime для desktop-сборки.");
console.log(`Prepared bundled Node runtime: ${target}`);
