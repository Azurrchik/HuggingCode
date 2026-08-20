import { PERMISSION_MODES } from "./config.js";

const DANGEROUS_COMMAND = /(^|\s)(del|erase|rd|rmdir|format|shutdown|restart-computer|remove-item|rm|curl|wget|invoke-webrequest|certutil|reg|setx|net\s+user|git\s+push|git\s+reset\s+--hard|npm\s+publish)(\s|$)/i;
const SHELL_COMPOSITION = /[&|;<>`]|\$\(|\r|\n/;
const SAFE_COMMAND = /^(?:git\s+(?:status|diff(?:\s+--(?:stat|name-only|cached))?|log(?:\s+--oneline)?|show(?:\s+--stat)?|branch|rev-parse\s+--show-toplevel|ls-files)|npm\s+(?:test|run\s+(?:test|lint|build|typecheck|format)|--version|ls\s+--depth=0)|node\s+(?:--version|--check\s+[^\s]+)|dir(?:\s+[^&|;<>`]+)?|type\s+[^&|;<>`]+)$/i;

export function normalizePermissionMode(mode) {
  return PERMISSION_MODES.includes(mode) ? mode : "manual";
}

export function isSafeAutoCommand(command) {
  return typeof command === "string" && !SHELL_COMPOSITION.test(command) && !DANGEROUS_COMMAND.test(command) && SAFE_COMMAND.test(command.trim());
}

export function decidePermission(mode, action) {
  const normalized = normalizePermissionMode(mode);
  const type = action?.type;

  if (type === "read" || type === "search" || type === "list") {
    return { decision: "allow", reason: "Операции чтения разрешены в пределах рабочей области." };
  }

  if (normalized === "plan") {
    return { decision: "deny", reason: "Режим plan запрещает изменение файлов и запуск команд." };
  }

  if (normalized === "manual") {
    return { decision: "ask", reason: "Режим manual требует подтверждения каждого действия с побочным эффектом." };
  }

  if (normalized === "accept-edits") {
    if (type === "write") {
      return { decision: "allow", reason: "Режим accept-edits разрешает изменения обычных файлов в рабочей области." };
    }
    return { decision: "ask", reason: "Режим accept-edits не запускает команды без подтверждения." };
  }

  if (normalized === "safe-auto") {
    if (type === "write") {
      return { decision: "allow", reason: "Режим safe-auto разрешает изменения обычных файлов в рабочей области." };
    }
    if (type === "command" && isSafeAutoCommand(action.command)) {
      return { decision: "allow", reason: "Команда входит в консервативный безопасный список safe-auto." };
    }
    return { decision: "ask", reason: "Действие не входит в безопасный список и требует подтверждения." };
  }

  return { decision: "ask", reason: "Неизвестное действие требует подтверждения." };
}

export const permissionModeDescriptions = {
  manual: "Чтение разрешено; каждая запись и команда подтверждаются.",
  "accept-edits": "Обычные записи в проекте разрешены; команды подтверждаются.",
  plan: "Только исследование и план; записи и команды блокируются.",
  "safe-auto": "Обычные записи и короткий безопасный список проверочных команд выполняются автоматически.",
};
