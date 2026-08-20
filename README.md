# HuggingCode

**HuggingCode** — интерактивный терминальный coding agent для Windows с удалёнными моделями **Hugging Face Inference Providers**. Он показывает потоковый transcript работы агента, безопасные карточки подтверждения, контекст и usage в постоянной status bar, сохраняет сессии и file checkpoints для `/undo`. Модельные веса не скачиваются и не запускаются на компьютере.

> HuggingCode не является копией или ребрендингом другого CLI. Это независимая реализация общих сценариев терминального coding agent; фирменные облачные сервисы, чужой закрытый код и небезопасный обход подтверждений не включены.

| Возможность | Что делает HuggingCode |
|---|---|
| Удалённые модели | Отправляет запросы через Hugging Face Inference Providers. Модель по умолчанию — `openai/gpt-oss-120b:fastest`. |
| Первый вход | Запрашивает и проверяет fine-grained токен Hugging Face с разрешением **Make calls to Inference Providers**. |
| Хранение токена | Шифрует токен Windows DPAPI, привязанный к текущей учётной записи. |
| Файловая защита | Работает только в доверенных каталогах, не выходит по символьным ссылкам и блокирует `.env` и типовые файлы секретов. |
| Интерактивный TUI | Показывает timeline сообщений, tool calls, результаты, безопасные confirmation cards, slash-подсказки и историю ввода. |
| Потоковые ответы | Использует Hugging Face chat-completion streaming, когда он поддержан выбранным model/provider; при отказе прозрачно переходит к обычному запросу. |
| Режимы прав | Поддерживает `manual`, `accept-edits`, `plan` и консервативный `safe-auto`; bypass-режима нет. |
| Recovery | Создаёт приватный file checkpoint для agent edits; `/undo` восстанавливает последний turn, не затирая более новые ручные изменения. |
| Сессии и расширение | Сохраняет локальные сессии, ветви и экспорт; загружает Markdown-навыки из `.huggingcode/skills`. |

## Установка и запуск

Требуются **Windows**, Node.js **22+**, npm и аккаунт Hugging Face. Hugging Face предоставляет единый маршрутизатор для удалённых моделей и JavaScript-клиент для chat completion.[1]

### Вариант 1 — установить через npm (рекомендуется)

Этот способ не требует вручную скачивать или клонировать GitHub-репозиторий. Команда устанавливается в систему и запускается из любой папки:

```powershell
npm install --global huggingcode
huggingcode
```

### Вариант 2 — разовый запуск через npx

Подходит, если не хочется выполнять глобальную установку. npm автоматически загрузит текущую публичную версию и запустит её:

```powershell
npx huggingcode
```

### Вариант 3 — запустить из исходного кода GitHub

Этот вариант нужен разработчикам: чтобы изучать код, вносить изменения или запускать свою локальную версию.

```powershell
git clone https://github.com/Azurrchik/HuggingCode.git
cd HuggingCode
npm install
npm start
```

Чтобы сделать локальную копию глобальной командой во время разработки, выполните из папки проекта:

```powershell
npm link
huggingcode
```

На первом запуске создайте fine-grained token с **Make calls to Inference Providers** на [странице Hugging Face](https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained). Hugging Face рекомендует создавать отдельный токен на приложение и не сохранять его в исходном коде.[2]

## Ключевые команды

| Задача | Команда |
|---|---|
| Посмотреть подсказки и каталог моделей | `/help`, `/models`, `/model <идентификатор>` |
| Показать/сменить режим прав | `/mode`, `/mode manual`, `/mode plan` |
| Посмотреть контекст и сжать его | `/context`, `/compact` |
| Откатить поддержанные file edits | `/undo` |
| Запустить найденные lint/typecheck/test | `/verify` |
| Управлять сессиями | `/sessions [поиск]`, `/resume <id>`, `/branch <имя>`, `/rename <имя>`, `/export [путь]` |
| Использовать пользовательский навык | `/skills`, `/skill <имя> [аргументы]` |
| Добавить текстовый файл к следующему запросу | `/attach <путь>`, `/attach clear` |
| Запустить локальную исследовательскую подзадачу | `/subtask <задача>`, `/tasks`, `/stop <id>` |

Спецификация Interactive TUI находится в [docs/0.3-interactive-tui-spec.md](docs/0.3-interactive-tui-spec.md), а архитектура — в [docs/0.3-architecture.md](docs/0.3-architecture.md). Пошаговый запуск, публикация в GitHub и npm описаны в [docs/PUBLISHING.md](docs/PUBLISHING.md).

## Режимы разрешений

Режимы определяют, какие действия проходят без запроса. Независимая модель HuggingCode намеренно строже неограниченных режимов: она не предоставляет bypass-режим и всегда сохраняет защиту секретов и границ рабочей области.

| Режим | Записи файлов | Shell-команды | Применение |
|---|---|---|---|
| `manual` | Всегда подтверждаются | Всегда подтверждаются | Незнакомый или чувствительный код. |
| `accept-edits` | Обычные файлы разрешены | Всегда подтверждаются | Быстрые итерации с контролем команд. |
| `plan` | Заблокированы | Заблокированы | Исследование и согласование плана. |
| `safe-auto` | Обычные файлы разрешены | Только короткий строгий allowlist | Ограниченные проверки проекта. |

> Даже в `safe-auto` удаление, сетевые запросы, перенаправления, цепочки команд, повышенные права и опасные системные действия не получают автоматического разрешения.

## Проектная память и навыки

Файл `HUGGINGCODE.md` в корне проекта добавляется к системному контексту локальной сессии. Создайте его вручную для соглашений команды и не помещайте в него секреты.

Пользовательский навык — это Markdown-файл в `.huggingcode/skills`. Пример:

```markdown
---
description: Проверить локальные изменения
---

Review $ARGUMENTS. Read the diff and relevant files. Do not make changes.
```

Сохраните пример как `.huggingcode/skills/local-review.md` и вызовите `/skill local-review auth flow`. Если имя навыка не пересекается со встроенной командой, можно вызвать коротко: `/local-review auth flow`.

## Ограничения

HuggingCode не выдаёт себя за внешнюю облачную систему. Поэтому подключение чужих облачных сессий, сторонний OAuth, удалённое управление, фирменные плагины и MCP, GitHub/Slack-приложения, облачные worktree, автоматическое создание PR, фоновые демоны, голосовые функции, веб-агенты и безусловный обход подтверждений не реализованы. Для этих сценариев требуется собственная инфраструктура, отдельные учётные данные и осознанная модель безопасности.

Удалённые модели получают только текст задачи и данные, которые были возвращены разрешёнными инструментами. Не используйте приложение для кода, секретов или данных, которые нельзя передавать стороннему сервису. Hugging Face документирует, что Inference Providers маршрутизирует запросы к доступным провайдерам и что стоимость/доступность зависят от выбранной модели, провайдера и аккаунта.[1] [3]

## Проверка проекта

```powershell
npm run lint
npm test
```

Набор тестов проверяет шифрование временного токена, границы и секреты рабочей области, подтверждение правок, безопасные режимы разрешений, сессии и пользовательские навыки.

## Структура

```text
HuggingCode/
├── bin/huggingcode.js
├── src/
│   ├── agent.js            # контекст, compact, side-вопросы, usage
│   ├── config.js           # модель, effort, режимы и настройки
│   ├── permissions.js      # независимый контроллер разрешений
│   ├── session-store.js    # снимки, ветки и экспорт сессий
│   ├── skills.js           # Markdown-навыки проекта
│   ├── tasks.js            # локальные подзадачи в открытой сессии
│   ├── workspace.js        # изоляция файлов, Git, preview и инструменты
│   ├── checkpoints.js      # приватные file checkpoints и conflict-aware undo
│   ├── verification.js     # определение lint/typecheck/test
│   ├── controller.js       # orchestration TUI, sessions и policy
│   └── tui/                # transcript, composer, status bar и approval cards
├── test/
└── docs/
```

## References

[1]: https://huggingface.co/docs/inference-providers/index "Hugging Face — Inference Providers"
[2]: https://huggingface.co/docs/hub/en/security-tokens "Hugging Face — User Access Tokens"
[3]: https://huggingface.co/docs/inference-providers/en/pricing "Hugging Face — Pricing and Billing"
