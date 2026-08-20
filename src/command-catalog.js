export const COMMAND_CATALOG = [
  { name: "help", usage: "/help [команда]", title: "Справка", short: "Показать все команды или описание одной команды", category: "Навигация" },
  { name: "model", usage: "/model [ID] [policy]", title: "Выбрать модель", short: "Открыть список Hugging Face моделей или переключить модель", category: "Модель" },
  { name: "models", usage: "/models [поиск]", title: "Показать модели", short: "Вывести coding-модели из каталога", category: "Модель" },
  { name: "effort", usage: "/effort [уровень]", title: "Настроить reasoning", short: "Изменить глубину рассуждения выбранной модели", category: "Модель" },
  { name: "theme", aliases: ["color"], usage: "/theme [название]", title: "Изменить цвет", short: "Открыть выбор цветовой темы или применить название", category: "Интерфейс" },
  { name: "mode", aliases: ["permissions"], usage: "/mode [режим]", title: "Изменить доступ", short: "Выбрать правила подтверждений и автономности", category: "Интерфейс" },
  { name: "status", usage: "/status", title: "Статус сессии", short: "Показать модель, режим, workspace и контекст", category: "Интерфейс" },
  { name: "context", usage: "/context", title: "Контекст", short: "Показать размер истории и порог сжатия", category: "Контекст" },
  { name: "compact", usage: "/compact [фокус]", title: "Сжать контекст", short: "Сохранить рабочее резюме вместо длинной истории", category: "Контекст" },
  { name: "clear", aliases: ["new", "reset"], usage: "/clear", title: "Очистить контекст", short: "Начать чистую историю, сохранив текущую сессию", category: "Контекст" },
  { name: "undo", usage: "/undo", title: "Откатить правки", short: "Восстановить последний checkpoint с изменениями агента", category: "Проект" },
  { name: "verify", aliases: ["run"], usage: "/verify", title: "Проверить проект", short: "Найти и запустить lint, test или build с нужными подтверждениями", category: "Проект" },
  { name: "diff", usage: "/diff", title: "Показать Git diff", short: "Вывести текущие незакоммиченные изменения проекта", category: "Проект" },
  { name: "review", aliases: ["code-review"], usage: "/review [фокус]", title: "Review изменений", short: "Попросить агента провести read-only обзор текущего diff", category: "Проект" },
  { name: "security-review", usage: "/security-review [фокус]", title: "Security review", short: "Попросить read-only проверку изменений на риски безопасности", category: "Проект" },
  { name: "simplify", usage: "/simplify [фокус]", title: "Найти упрощения", short: "Попросить агента найти дублирование и лишнюю сложность без правок", category: "Проект" },
  { name: "plan", usage: "/plan [задача]", title: "Спланировать задачу", short: "Перейти в read-only plan mode и построить план", category: "Проект" },
  { name: "init", usage: "/init", title: "Создать память проекта", short: "Создать шаблон HUGGINGCODE.md с правилами проекта", category: "Проект" },
  { name: "memory", usage: "/memory [add текст]", title: "Память проекта", short: "Посмотреть или дополнить HUGGINGCODE.md", category: "Проект" },
  { name: "sessions", usage: "/sessions [поиск]", title: "Открыть сессии", short: "Найти сохранённые разговоры", category: "Сессии" },
  { name: "resume", usage: "/resume <ID>", title: "Продолжить сессию", short: "Восстановить сохранённый разговор по ID", category: "Сессии" },
  { name: "branch", usage: "/branch [имя]", title: "Создать ветку сессии", short: "Создать альтернативную локальную историю разговора", category: "Сессии" },
  { name: "rename", usage: "/rename <имя>", title: "Переименовать сессию", short: "Задать понятное имя текущему разговору", category: "Сессии" },
  { name: "export", usage: "/export [файл.md]", title: "Экспортировать сессию", short: "Сохранить разговор в Markdown внутри workspace", category: "Сессии" },
  { name: "skills", aliases: ["reload-skills"], usage: "/skills", title: "Навыки проекта", short: "Показать Markdown-навыки из .huggingcode/skills", category: "Расширения" },
  { name: "skill", usage: "/skill <имя> [аргументы]", title: "Запустить навык", short: "Выполнить выбранный Markdown-навык проекта", category: "Расширения" },
  { name: "attach", usage: "/attach <путь>", title: "Прикрепить файл", short: "Добавить UTF-8 файл workspace к следующему запросу", category: "Расширения" },
  { name: "subtask", usage: "/subtask <задача>", title: "Запустить подзадачу", short: "Параллельно исследовать небольшой вопрос без изменений", category: "Расширения" },
  { name: "tasks", aliases: ["agents"], usage: "/tasks", title: "Подзадачи", short: "Показать состояние локальных исследовательских задач", category: "Расширения" },
  { name: "stop", usage: "/stop <ID>", title: "Остановить подзадачу", short: "Не принимать результат выбранной локальной задачи", category: "Расширения" },
  { name: "doctor", aliases: ["checkup"], usage: "/doctor", title: "Диагностика", short: "Проверить платформу, хранилище, workspace и настройки", category: "Сервис" },
  { name: "logout", usage: "/logout", title: "Удалить токен", short: "Удалить защищённо сохранённый Hugging Face токен", category: "Сервис" },
  { name: "exit", aliases: ["quit"], usage: "/exit", title: "Выйти", short: "Завершить HuggingCode", category: "Сервис" },
];

export function findCommand(name) {
  const needle = String(name || "").replace(/^\//, "").trim().toLowerCase();
  return COMMAND_CATALOG.find((command) => command.name === needle || command.aliases?.includes(needle)) || null;
}

export function commandSuggestions() {
  return COMMAND_CATALOG.map((command) => [command.name, command.short]);
}

export function commandPaletteItems() {
  return COMMAND_CATALOG.map((command) => ({ command: `/${command.name}`, label: command.title, detail: command.short, category: command.category }));
}

export function formatHelp(commandName = "") {
  const target = commandName ? findCommand(commandName) : null;
  if (commandName && !target) return `Команда /${commandName} не найдена. Используйте /help для списка действий.`;
  if (target) {
    const aliases = target.aliases?.length ? `\nАльтернативы: ${target.aliases.map((alias) => `/${alias}`).join(", ")}` : "";
    return `${target.usage}\n${target.short}${aliases}`;
  }
  const groups = new Map();
  for (const command of COMMAND_CATALOG) {
    const entries = groups.get(command.category) || [];
    entries.push(`/${command.name} — ${command.short}`);
    groups.set(command.category, entries);
  }
  return [...groups.entries()].map(([category, entries]) => `${category}\n${entries.join("\n")}`).join("\n\n");
}
