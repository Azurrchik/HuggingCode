import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

const SKILL_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/i;

function skillDirectory(workspaceRoot) {
  return path.join(workspaceRoot, ".huggingcode", "skills");
}

function skillPath(workspaceRoot, name) {
  if (!SKILL_NAME.test(name)) throw new Error("Имя навыка может содержать только буквы, цифры, _ и -.");
  return path.join(skillDirectory(workspaceRoot), `${name}.md`);
}

function parseSkill(raw, name) {
  const frontmatter = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)?.[1] || "";
  const body = raw.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim();
  const description = frontmatter.match(/^description:\s*(.+)$/im)?.[1]?.trim() || body.split(/\r?\n/).find(Boolean)?.replace(/^#+\s*/, "") || "Пользовательский навык";
  return { name, description, body };
}

export async function listSkills(workspaceRoot) {
  try {
    const entries = await readdir(skillDirectory(workspaceRoot), { withFileTypes: true });
    const skills = [];
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
      const name = entry.name.slice(0, -3);
      if (!SKILL_NAME.test(name)) continue;
      try {
        const raw = await readFile(skillPath(workspaceRoot, name), "utf8");
        skills.push(parseSkill(raw, name));
      } catch {
        // A malformed custom skill should not make the rest unavailable.
      }
    }
    return skills.sort((left, right) => left.name.localeCompare(right.name));
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
}

export async function loadSkill(workspaceRoot, name, argumentsText = "") {
  const target = skillPath(workspaceRoot, name);
  const info = await stat(target);
  if (!info.isFile()) throw new Error("Навык не найден.");
  if (info.size > 100_000) throw new Error("Файл навыка превышает лимит 100 KB.");
  const skill = parseSkill(await readFile(target, "utf8"), name);
  if (!skill.body) throw new Error("Навык не содержит инструкций.");
  return {
    ...skill,
    prompt: skill.body.replaceAll("$ARGUMENTS", argumentsText.trim()),
  };
}

export function getSkillDirectory(workspaceRoot) {
  return skillDirectory(workspaceRoot);
}
