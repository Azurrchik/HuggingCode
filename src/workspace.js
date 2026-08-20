import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";

const execFileAsync = promisify(execFile);
const MAX_FILE_BYTES = 200_000;
const MAX_OUTPUT_CHARS = 30_000;
const IGNORED_DIRECTORIES = new Set([".git", "node_modules", "dist", "build", ".next", ".cache", "coverage"]);
const SECRET_FILE = /(^|[\\/])(?:\.env(?:\..+)?|\.npmrc|\.pypirc|id_rsa|id_ed25519|credentials(?:\.json)?|.*\.(?:pem|key|pfx|p12))$/i;

const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "list_files",
      description: "List files and directories in an allowed workspace root. Never inspect any path outside the roots listed in the system context.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path, or @aux-id/relative-path for an added directory." },
          max_depth: { type: "integer", description: "Maximum nesting depth from 0 to 6. Defaults to 3." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a UTF-8 text file from an allowed workspace root. Do not request .env or secret files.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path, or @aux-id/relative-path for an added directory." },
          start_line: { type: "integer", description: "Optional first line, one-indexed." },
          end_line: { type: "integer", description: "Optional final line, one-indexed." },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_files",
      description: "Search UTF-8 text files inside an allowed workspace root for a literal text query.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "Literal text to search for." },
          path: { type: "string", description: "Relative directory, or @aux-id/relative-path." },
          max_results: { type: "integer", description: "Maximum matching lines, defaults to 30." },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create or replace a UTF-8 file in an allowed workspace root. The host applies permission rules before this action.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative destination path." },
          content: { type: "string", description: "Complete replacement content." },
          reason: { type: "string", description: "Brief explanation of the change." },
        },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "replace_in_file",
      description: "Make a precise text replacement in a UTF-8 file in an allowed workspace root. The host applies permission rules before this action.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path of the target file." },
          old_string: { type: "string", description: "Exact existing text to replace." },
          new_string: { type: "string", description: "Replacement text." },
          replace_all: { type: "boolean", description: "Replace every occurrence; defaults to false." },
          reason: { type: "string", description: "Brief explanation of the change." },
        },
        required: ["path", "old_string", "new_string"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "Delete one ordinary file inside an allowed workspace root. The host always applies permission rules before this destructive action.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Relative path of the file to delete." },
          reason: { type: "string", description: "Brief explanation of why the file is obsolete." },
        },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_git_status",
      description: "Get read-only Git status for the primary workspace, if it is a Git repository.",
      parameters: { type: "object", properties: {} },
    },
  },
  {
    type: "function",
    function: {
      name: "get_git_diff",
      description: "Get a read-only summary or unified diff for the primary workspace, if it is a Git repository.",
      parameters: {
        type: "object",
        properties: {
          staged: { type: "boolean", description: "Use the staged index diff when true." },
          stat_only: { type: "boolean", description: "Return only change statistics when true." },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_command",
      description: "Run a Windows shell command in the primary workspace. The host always enforces its permission mode and asks when required.",
      parameters: {
        type: "object",
        properties: {
          command: { type: "string", description: "Command to run using cmd.exe in the primary workspace." },
          timeout_seconds: { type: "integer", description: "Timeout between 1 and 120 seconds; default is 30." },
          reason: { type: "string", description: "Brief explanation of why the command is needed." },
        },
        required: ["command"],
      },
    },
  },
];

function truncate(value, limit = MAX_OUTPUT_CHARS) {
  const text = String(value ?? "");
  return text.length > limit ? `${text.slice(0, limit)}\n\n[output truncated]` : text;
}

function isSecretPath(label) {
  return SECRET_FILE.test(label.replaceAll("\\", "/"));
}

async function statIfExists(target) {
  try {
    return await stat(target);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function assertPhysicalContainment(root, target) {
  let existing = target;
  while (!(await statIfExists(existing))) {
    const parent = path.dirname(existing);
    if (parent === existing) throw new Error("Не удалось определить физический путь рабочего каталога.");
    existing = parent;
  }
  const physical = await realpath(existing);
  const relative = path.relative(root, physical);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Символьная ссылка ведёт за пределы доверенного рабочего каталога.");
  }
}

export async function createWorkspace(workspacePath = process.cwd(), addedDirectories = []) {
  const primaryRoot = await realWorkspacePath(workspacePath);
  const roots = new Map([["workspace", primaryRoot]]);

  for (const candidate of addedDirectories) {
    try {
      await addDirectory(candidate);
    } catch {
      // Historical extra roots that no longer exist are ignored rather than blocking startup.
    }
  }

  function getRootFromInput(inputPath = ".") {
    const value = typeof inputPath === "string" && inputPath.trim() ? inputPath.trim() : ".";
    const match = value.match(/^@([a-z0-9_-]+)(?:[\\/](.*))?$/i);
    if (match) {
      const root = roots.get(match[1]);
      if (!root) throw new Error("Этот дополнительный каталог не добавлен в текущую сессию.");
      return { rootId: match[1], root, relativePath: match[2] || "." };
    }
    return { rootId: "workspace", root: primaryRoot, relativePath: value };
  }

  function resolveInput(inputPath = ".") {
    const { rootId, root, relativePath } = getRootFromInput(inputPath);
    const candidate = path.resolve(root, relativePath);
    const relative = path.relative(root, candidate);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error("Доступ за пределы доверенного рабочего каталога запрещён.");
    }
    return { rootId, root, target: candidate, relative };
  }

  function displayPath(rootId, root, target) {
    const relative = path.relative(root, target).replaceAll("\\", "/") || ".";
    return rootId === "workspace" ? relative : `@${rootId}/${relative}`;
  }

  async function listFiles(inputPath = ".", maxDepth = 3) {
    const { rootId, root, target: start } = resolveInput(inputPath);
    const depthLimit = Math.max(0, Math.min(Number(maxDepth) || 3, 6));
    await assertPhysicalContainment(root, start);
    const info = await statIfExists(start);
    if (!info?.isDirectory()) throw new Error("Указанный путь не является каталогом.");
    const result = [];

    async function visit(directory, depth) {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
        const fullPath = path.join(directory, entry.name);
        const label = displayPath(rootId, root, fullPath);
        result.push(entry.isDirectory() ? `${label}/` : label);
        if (entry.isDirectory() && depth < depthLimit) await visit(fullPath, depth + 1);
        if (result.length >= 500) return;
      }
    }

    await visit(start, 0);
    return result.length ? result.join("\n") : "(empty directory)";
  }

  async function readTextFile(inputPath, startLine, endLine) {
    const { rootId, root, target } = resolveInput(inputPath);
    const label = displayPath(rootId, root, target);
    await assertPhysicalContainment(root, target);
    if (isSecretPath(label)) throw new Error("Чтение файлов секретов запрещено по умолчанию.");
    const info = await statIfExists(target);
    if (!info?.isFile()) throw new Error("Указанный путь не является файлом.");
    if (info.size > MAX_FILE_BYTES) throw new Error(`Файл больше лимита ${MAX_FILE_BYTES} байт.`);
    const content = await readFile(target, "utf8");
    if (content.includes("\u0000")) throw new Error("Двоичные файлы не поддерживаются.");
    const lines = content.split(/\r?\n/);
    const from = Math.max(1, Number(startLine) || 1);
    const to = Math.min(lines.length, Number(endLine) || lines.length);
    return lines.slice(from - 1, to).map((line, index) => `${from + index}: ${line}`).join("\n");
  }

  async function searchFiles(query, inputPath = ".", maxResults = 30) {
    if (typeof query !== "string" || !query) throw new Error("Запрос поиска не может быть пустым.");
    const { rootId, root, target: start } = resolveInput(inputPath);
    await assertPhysicalContainment(root, start);
    const info = await statIfExists(start);
    if (!info?.isDirectory()) throw new Error("Указанный путь не является каталогом.");
    const limit = Math.max(1, Math.min(Number(maxResults) || 30, 100));
    const matches = [];

    async function visit(directory) {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (matches.length >= limit) return;
        if (entry.isSymbolicLink()) continue;
        if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await visit(fullPath);
          continue;
        }
        const label = displayPath(rootId, root, fullPath);
        if (isSecretPath(label)) continue;
        const fileInfo = await stat(fullPath);
        if (fileInfo.size > MAX_FILE_BYTES) continue;
        const content = await readFile(fullPath, "utf8");
        if (content.includes("\u0000")) continue;
        const lines = content.split(/\r?\n/);
        for (let index = 0; index < lines.length && matches.length < limit; index += 1) {
          if (lines[index].includes(query)) matches.push(`${label}:${index + 1}: ${lines[index]}`);
        }
      }
    }

    await visit(start);
    return matches.length ? matches.join("\n") : "No matches found.";
  }

  async function writeTextFile(inputPath, content) {
    const { rootId, root, target } = resolveInput(inputPath);
    const label = displayPath(rootId, root, target);
    await assertPhysicalContainment(root, path.dirname(target));
    if (isSecretPath(label)) throw new Error("Запись файлов секретов запрещена по умолчанию.");
    await mkdir(path.dirname(target), { recursive: true });
    await assertPhysicalContainment(root, path.dirname(target));
    await writeFile(target, content, "utf8");
    return `Written ${label} (${Buffer.byteLength(content, "utf8")} bytes).`;
  }

  async function replaceInFile(inputPath, oldString, newString, replaceAll = false) {
    if (typeof oldString !== "string" || oldString.length === 0) throw new Error("old_string не может быть пустой строкой.");
    const { rootId, root, target } = resolveInput(inputPath);
    const label = displayPath(rootId, root, target);
    await assertPhysicalContainment(root, target);
    if (isSecretPath(label)) throw new Error("Изменение файлов секретов запрещено по умолчанию.");
    const content = await readFile(target, "utf8");
    const occurrences = content.split(oldString).length - 1;
    if (occurrences === 0) throw new Error("old_string не найдена в целевом файле.");
    if (occurrences > 1 && !replaceAll) throw new Error("old_string встречается несколько раз; используйте replace_all или более точный фрагмент.");
    const next = replaceAll ? content.replaceAll(oldString, newString) : content.replace(oldString, newString);
    await writeFile(target, next, "utf8");
    return `Replaced ${replaceAll ? occurrences : 1} occurrence(s) in ${label}.`;
  }

  async function deleteOneFile(inputPath) {
    const { rootId, root, target } = resolveInput(inputPath);
    const label = displayPath(rootId, root, target);
    await assertPhysicalContainment(root, target);
    if (isSecretPath(label)) throw new Error("Удаление файлов секретов через агент запрещено.");
    const info = await statIfExists(target);
    if (!info?.isFile()) throw new Error("Можно удалить только существующий обычный файл.");
    await rm(target, { force: false });
    return `Deleted ${label}.`;
  }

  async function runGit(args) {
    try {
      const { stdout, stderr } = await execFileAsync("git", args, {
        cwd: primaryRoot,
        windowsHide: true,
        timeout: 20_000,
        maxBuffer: 1024 * 1024,
      });
      return truncate([stdout, stderr].filter(Boolean).join("\n").trim() || "Git returned no output.");
    } catch (error) {
      const output = [error.stdout, error.stderr, error.message].filter(Boolean).join("\n");
      return truncate(`Git command failed.\n${output}`);
    }
  }

  async function getGitStatus() {
    return runGit(["status", "--short", "--branch"]);
  }

  async function getGitDiff({ staged = false, statOnly = false } = {}) {
    const args = ["diff"];
    if (staged) args.push("--cached");
    if (statOnly) args.push("--stat");
    return runGit(args);
  }

  async function runCommand(command, timeoutSeconds = 30) {
    if (typeof command !== "string" || !command.trim()) throw new Error("Команда не может быть пустой.");
    const timeout = Math.max(1, Math.min(Number(timeoutSeconds) || 30, 120)) * 1000;
    try {
      const { stdout, stderr } = await execFileAsync("cmd.exe", ["/d", "/s", "/c", command], {
        cwd: primaryRoot,
        timeout,
        windowsHide: false,
        maxBuffer: 1024 * 1024,
      });
      return truncate([stdout, stderr].filter(Boolean).join("\n").trim() || "Command completed successfully.");
    } catch (error) {
      const output = [error.stdout, error.stderr, error.message].filter(Boolean).join("\n");
      return truncate(`Command exited with code ${error.code ?? "unknown"}.\n${output}`);
    }
  }

  async function addDirectory(directory) {
    const resolved = await realWorkspacePath(directory);
    if (resolved === primaryRoot || [...roots.values()].includes(resolved)) {
      return [...roots.entries()].find(([, candidate]) => candidate === resolved)?.[0] || "workspace";
    }
    const id = `aux${roots.size}`;
    roots.set(id, resolved);
    return id;
  }

  function listRoots() {
    return [...roots.entries()].map(([id, root]) => ({ id, root, primary: id === "workspace" }));
  }

  async function execute(name, args, approve) {
    switch (name) {
      case "list_files":
        return listFiles(args.path, args.max_depth);
      case "read_file":
        return readTextFile(args.path, args.start_line, args.end_line);
      case "search_files":
        return searchFiles(args.query, args.path, args.max_results);
      case "get_git_status":
        return getGitStatus();
      case "get_git_diff":
        return getGitDiff({ staged: args.staged, statOnly: args.stat_only });
      case "write_file": {
        const allowed = await approve({ type: "write", path: args.path, content: args.content, reason: args.reason });
        return allowed ? writeTextFile(args.path, args.content) : "User declined this file change.";
      }
      case "replace_in_file": {
        const allowed = await approve({ type: "write", path: args.path, content: `Replace:\n${args.old_string}\n→\n${args.new_string}`, reason: args.reason });
        return allowed ? replaceInFile(args.path, args.old_string, args.new_string, args.replace_all) : "User declined this file change.";
      }
      case "delete_file": {
        const allowed = await approve({ type: "delete", path: args.path, reason: args.reason });
        return allowed ? deleteOneFile(args.path) : "User declined file deletion.";
      }
      case "run_command": {
        const allowed = await approve({ type: "command", command: args.command, reason: args.reason });
        return allowed ? runCommand(args.command, args.timeout_seconds) : "User declined this command.";
      }
      default:
        throw new Error(`Неизвестный инструмент: ${name}`);
    }
  }

  return {
    root: primaryRoot,
    toolDefinitions,
    execute,
    listFiles,
    readTextFile,
    searchFiles,
    writeTextFile,
    replaceInFile,
    deleteOneFile,
    runCommand,
    getGitStatus,
    getGitDiff,
    addDirectory,
    listRoots,
  };
}

async function realWorkspacePath(workspacePath) {
  const resolved = path.resolve(workspacePath);
  const info = await stat(resolved);
  if (!info.isDirectory()) throw new Error("Рабочий путь должен указывать на существующий каталог.");
  return realpath(resolved);
}
