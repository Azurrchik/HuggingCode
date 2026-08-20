# HuggingCode

**HuggingCode** — независимый интерактивный terminal coding agent для **Windows, Linux и macOS**. Он использует удалённые модели через **Hugging Face Inference Providers**, поэтому модельные веса не скачиваются и не запускаются на компьютере. В терминале доступны потоковый transcript, карточки инструментов и diff, checkpoints для `/undo`, сессии, проектные навыки и keyboard-first управление.

> HuggingCode не является копией или ребрендингом другого CLI. Это самостоятельная реализация общих сценариев terminal coding agent. Он не подключает закрытый код, фирменные облачные сервисы или чужие учётные записи.

| Возможность | Реализация в 0.5 |
|---|---|
| Удалённые модели | Запросы проходят через Hugging Face Inference Providers. Базовая модель — `openai/gpt-oss-120b:fastest`. [1] |
| Первый вход | Приложение запрашивает и проверяет fine-grained токен с разрешением **Make calls to Inference Providers**. [2] |
| Защищённое хранение | Windows — DPAPI; macOS — Keychain; Linux — Secret Service. Если системное хранилище недоступно, токен остаётся только в памяти текущего процесса. |
| Live model catalog | `/model` открывает searchable picker из Hugging Face Router; при временной недоступности сети используется встроенный fallback-каталог. |
| Keyboard-first TUI | Многострочный composer, история ввода, slash-подсказки, command palette, persistent header/status/footer, transcript с tool, diff и verification-карточками. |
| Trajectory | Отдельная вкладка с последовательностью пользовательских задач, наблюдаемых этапов, tool calls, команд, правок и результатов; поиск работает по этому журналу. Скрытые рассуждения и системные инструкции не выводятся. |
| Desktop-приложение | Tauri 2 приложение с Chat и Trajectory, нативным выбором workspace, безопасными approvals, выбором модели и темы; единый исходный код для Windows, macOS и Linux. |
| Режимы прав | `manual`, `accept-edits`, `plan`, `safe-auto` и session-only `full`. |
| Безопасность workspace | Агент ограничен подключёнными workspace, не выходит по символьным ссылкам и не читает или не записывает типовые секреты, включая `.env`. |
| Recovery | Каждый turn с правками создаёт приватный checkpoint; `/undo` восстанавливает последний поддержанный turn и не затирает более новые ручные изменения. |

## Установка и запуск

Требуются Node.js **22+**, npm и аккаунт Hugging Face. Hugging Face предоставляет единый маршрутизатор и JavaScript-интерфейс для вызовов удалённых моделей.[1]

### Через npm — рекомендуемый способ

Этот вариант устанавливает команду глобально. После этого перейдите в папку любого проекта и запустите агент.

```bash
npm install --global huggingcode
cd your-project
huggingcode
```

### Разовый запуск без глобальной установки

```bash
cd your-project
npx huggingcode
```

### HuggingCode Desktop

Desktop-приложение использует Tauri 2 host и локальный Node bridge поверх того же controller, тех же workspace-границ и защищённого хранения токена, что и CLI. Из исходного кода запустите его так:

```bash
npm install
npm run desktop
```

Для нативных пакетов применяются следующие команды. Они создают Windows `.exe`, macOS `.dmg`/`.zip` и Linux `.AppImage`/`.deb` на соответствующей платформе; GitHub Actions также собирает эти артефакты на нативных runners.

```bash
npm run desktop:win
npm run desktop:mac
npm run desktop:linux
```

### Уведление об обновлении

При интерактивном запуске HuggingCode в фоне проверяет npm registry. Если доступна более новая стабильная версия, в transcript появляется ненавязчивое уведомление с командой обновления; запуск, первый вход и работа с агентом не ожидают сеть. При отсутствии сети или ошибке registry приложение продолжает работу без сообщения.

```bash
npm install --global huggingcode@latest
```

Чтобы отключить сетевую проверку в конкретном запуске, задайте переменную окружения `HUGGINGCODE_NO_UPDATE_CHECK=1`.

### Из исходного кода

```bash
git clone https://github.com/Azurrchik/HuggingCode.git
cd HuggingCode
npm install
npm start
```

На Windows те же команды работают в PowerShell. Для разработки локальной команды используйте:

```bash
npm link
huggingcode
```

При первом запуске создайте fine-grained токен с разрешением **Make calls to Inference Providers** на [странице Hugging Face](https://huggingface.co/settings/tokens/new?ownUserPermissions=inference.serverless.write&tokenType=fineGrained). Не добавляйте токен в репозиторий, `.env` или код проекта.[2]

## Работа с интерфейсом

TUI рассчитан на работу с клавиатуры. В верхней панели отображаются текущий workspace, модель, режим и заполненность контекста. Status bar показывает usage, очередь и цель, а transcript выделяет обращения пользователя, потоковый ответ, reasoning-preview, tool calls, изменения файлов и результаты проверок.

| Действие | Клавиатура или команда |
|---|---|
| Отправить задачу | `Enter` |
| Вставить новую строку | `Shift+Enter` |
| История сообщений | `↑` / `↓` |
| Slash-подсказка | Введите `/`, затем `Tab` |
| Открыть палитру | `Ctrl+P` |
| Открыть выбор модели | `Ctrl+M` или `/model` |
| Открыть выбор цвета | `Ctrl+T` или `/theme` / `/color` |
| Очистить transcript | `Ctrl+L` или `/clear` |
| Отменить текущий turn / закрыть overlay | `Esc` |
| Выйти | `Ctrl+C`, `Ctrl+D`, `/exit` |

### Выбор модели

Выполните `/model`, чтобы открыть интерактивный picker. Он обновляет доступный каталог через Hugging Face Router, ищет по ID, провайдеру, имени и тегам, а также фильтрует модели по code, tool calling и vision-возможностям. Клавиши `←` и `→` выбирают стратегию маршрутизации `fastest`, `cheapest` или `preferred`. Если известен точный model ID, его можно указать командой:

```text
/model Qwen/Qwen3-Coder-480B-A35B-Instruct fastest
```

Каталог является подсказкой, а не гарантией доступа: итоговая доступность модели зависит от токена, провайдера и аккаунта Hugging Face.[1] [3]

## Команды

`/help` выводит команды по категориям с одним понятным предложением для каждого действия. Для точной подсказки используйте `/help <команда>` — например, `/help model` объяснит, что `/model` открывает список моделей Hugging Face и позволяет переключиться на выбранную.

| Что нужно сделать | Команда | Краткое действие |
|---|---|---|
| Выбрать AI-модель | `/model` | Открыть searchable каталог Hugging Face; `Enter` применяет модель. |
| Сменить модель по ID | `/model <ID> [policy]` | Сохранить указанную модель с policy `fastest`, `cheapest` или `preferred`. |
| Изменить цвет интерфейса | `/theme` или `/color` | Открыть picker из семи тем; цвет применяется сразу. |
| Сменить режим доступа | `/mode <режим>` | Управлять подтверждениями для файлов и команд; `/mode full` требует typed-подтверждение. |
| Понять состояние | `/status`, `/context` | Показать модель, режим, workspace, usage и размер контекста. |
| Сжать или очистить историю | `/compact [фокус]`, `/clear` | Сохранить резюме длинного чата или начать чистый контекст. |
| Проверить проект | `/verify` или `/run` | Найти lint/test/build и запускать их с применимыми разрешениями. |
| Увидеть Git diff | `/diff` | Показать текущие изменения рабочей области без записи файлов. |
| Провести review | `/review [фокус]`, `/security-review`, `/simplify` | Выполнить read-only анализ diff: качество, безопасность или упрощение. |
| Построить план | `/plan [задача]` | Перейти в plan mode и составить план без изменения файлов. |
| Запомнить правила проекта | `/init`, `/memory`, `/memory add <текст>` | Создать, показать или дополнить `HUGGINGCODE.md`. |
| Управлять сессиями | `/sessions`, `/resume <ID>`, `/branch`, `/rename`, `/export` | Найти, восстановить, ветвить, назвать или экспортировать разговор. |
| Использовать навыки | `/skills`, `/skill <имя>` или `/<имя>` | Показать и запустить Markdown-навык проекта. |
| Вложения и подзадачи | `/attach`, `/subtask`, `/tasks`, `/stop` | Передать текстовый файл модели или исследовать отдельный вопрос. |
| Проверить окружение | `/doctor` или `/checkup` | Показать платформу, защищённое хранилище, workspace и диагностику. |

Доступные цветовые темы: `ember`, `ocean`, `forest`, `violet`, `midnight`, `rose` и `mono`. Также принимаются удобные алиасы `blue`, `green`, `purple`, `teal`, `pink` и `gray`.

## Режимы разрешений

| Режим | Обычные записи | Shell-команды | Назначение |
|---|---:|---:|---|
| `manual` | Всегда подтверждаются | Всегда подтверждаются | Незнакомые и чувствительные проекты. |
| `accept-edits` | Разрешены | Всегда подтверждаются | Быстрые итерации с контролем запуска команд. |
| `plan` | Заблокированы | Заблокированы | Исследование, планирование и review. |
| `safe-auto` | Разрешены | Только короткий строгий allowlist | Ограниченные безопасные проверки. |
| `full` | Разрешены | Разрешены внутри workspace | Автономное выполнение в текущей сессии после typed-подтверждения. |

### Full mode

`full` включается **только** через `/mode full`, после чего интерфейс показывает предупреждение и требует ввести точную фразу:

```text
ENABLE FULL MODE
```

Режим действует только до закрытия HuggingCode и **не записывается** в конфигурацию. В нём агент не спрашивает перед операциями с обычными файлами или неадминистративными командами внутри выбранного workspace.

> Full mode не отключает жёсткие границы: агент не получает доступ вне доверенных workspace, не читает и не записывает секретные файлы, не обходит проверку символьных ссылок и не получает административных прав. Shell-инструмент также блокирует ссылки на внешние пути, системные домашние каталоги, секретные файлы, сетевые transfer-утилиты и вложенные shell/interpreter-вызовы. Режим предназначен только для осознанного автономного выполнения в проекте пользователя.

## Проектная память и навыки

Файл `HUGGINGCODE.md` в корне проекта добавляется к системному контексту локальной сессии. Храните в нём соглашения команды, команды проверки и архитектурные заметки; не помещайте туда секреты.

Пользовательский навык — это Markdown-файл в `.huggingcode/skills`. Например:

```markdown
---
description: Проверить локальные изменения
---

Review $ARGUMENTS. Read the diff and relevant files. Do not make changes.
```

Сохраните файл как `.huggingcode/skills/local-review.md`, затем вызовите `/skill local-review auth flow`. Если имя не пересекается со встроенной командой, допускается короткий вызов `/local-review auth flow`.

## Проверка проекта и разработка

```bash
npm run lint
npm test
npm pack --dry-run
```

Тесты покрывают platform adapter, защищённое хранилище, изоляцию workspace, secret-file блокировки, permission modes, shell adapter, model catalog, typed full mode, потоковый transcript, checkpoints, сессии и навыки. Спецификация 0.4 находится в [docs/0.4-cross-platform-tui-spec.md](docs/0.4-cross-platform-tui-spec.md), архитектура — в [docs/0.4-architecture.md](docs/0.4-architecture.md), а публикация описана в [docs/PUBLISHING.md](docs/PUBLISHING.md).

## Ограничения и конфиденциальность

HuggingCode — локальный CLI, а не размещённая облачная среда. Он не подключает чужие облачные сессии, сторонний OAuth, удалённое управление, фоновые демоны, фирменные плагины, веб-агентов или автоматическое создание pull request без отдельной инфраструктуры и учётных данных.

Удалённые модели получают текст задачи и данные, которые вернули разрешённые инструменты. Не используйте HuggingCode для кода, секретов или данных, которые нельзя передавать внешнему сервису. Inference Providers маршрутизирует запросы к доступным провайдерам; стоимость и доступность определяются моделью, провайдером и состоянием аккаунта.[1] [3]

## Структура

```text
HuggingCode/
├── bin/huggingcode.js
├── src/
│   ├── platform.js          # platform, shell и credential boundaries
│   ├── storage.js           # DPAPI, Keychain, Secret Service и session fallback
│   ├── model-catalog.js     # live catalog, fallback и model policies
│   ├── agent.js             # контекст, streaming, compact и usage
│   ├── config.js            # модель, effort, режимы и настройки
│   ├── permissions.js       # независимый контроллер разрешений
│   ├── workspace.js         # file isolation, Git, diff preview и инструменты
│   ├── checkpoints.js       # conflict-aware undo
│   ├── controller.js        # orchestration, full mode и model selection
│   └── tui/                 # responsive layout, overlays и transcript cards
├── test/
└── docs/
```

## References

[1]: https://huggingface.co/docs/inference-providers/index "Hugging Face — Inference Providers"
[2]: https://huggingface.co/docs/hub/en/security-tokens "Hugging Face — User Access Tokens"
[3]: https://huggingface.co/docs/inference-providers/en/pricing "Hugging Face — Pricing and Billing"
