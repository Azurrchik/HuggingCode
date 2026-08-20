# Запуск, GitHub и публикация HuggingCode

## Как запустить у себя

Откройте PowerShell и выполните:

```powershell
cd C:\Users\nesme\Desktop\HuggingCode
npm install
npm start
```

При первом запуске приложение запросит Hugging Face token. Создайте fine-grained token с разрешением **Make calls to Inference Providers**, вставьте его в скрытое поле и продолжайте работу. Модели не скачиваются: запросы идут к выбранной удалённой модели.

Для запуска из любого проекта на **вашем** компьютере создайте глобальную ссылку:

```powershell
cd C:\Users\nesme\Desktop\HuggingCode
npm link

cd C:\path\to\your\project
huggingcode
```

`npm link` предназначен для локальной разработки. Для пользователей нужен npm registry, описанный ниже.

## Что получат пользователи после публикации

Имя пакета `huggingcode` свободно на npm на момент подготовки проекта. После первой публичной публикации пользователи смогут выполнить одну из команд:

```powershell
# Разовый запуск без глобальной установки
npx huggingcode

# Установка команды глобально
npm install --global huggingcode
huggingcode
```

Поле `bin` в `package.json` уже связывает имя команды `huggingcode` с `bin/huggingcode.js`. Команда появится в PATH после глобальной установки.

## Подготовить публичный GitHub-репозиторий

Перед публикацией убедитесь, что в репозитории нет токенов, файлов `.env`, личных журналов или папки `node_modules`. Текущий `.gitignore` исключает основные такие файлы.

### Вариант A: через GitHub CLI

После входа в GitHub CLI выполните из корня проекта:

```powershell
cd C:\Users\nesme\Desktop\HuggingCode

git init -b main
git add .
git commit -m "feat: prepare HuggingCode npm CLI"

gh auth login
gh repo create HuggingCode --public --source=. --remote=origin --push
```

Эта команда создаёт **публичный** репозиторий в вашем аккаунте GitHub, добавляет remote `origin` и отправляет исходный код. Перед выполнением последней строки перепроверьте, что публичный репозиторий действительно нужен.

### Вариант B: через сайт GitHub

Создайте на GitHub пустой public repository с именем `HuggingCode`, **без** автоматического README или `.gitignore`. Затем выполните в PowerShell команды, заменив `YOUR_GITHUB_USERNAME`:

```powershell
cd C:\Users\nesme\Desktop\HuggingCode

git init -b main
git add .
git commit -m "feat: prepare HuggingCode npm CLI"
git remote add origin https://github.com/YOUR_GITHUB_USERNAME/HuggingCode.git
git push -u origin main
```

После создания репозитория добавьте его адрес в `package.json`:

```powershell
npm pkg set repository.type="git"
npm pkg set repository.url="git+https://github.com/YOUR_GITHUB_USERNAME/HuggingCode.git"
npm pkg set homepage="https://github.com/YOUR_GITHUB_USERNAME/HuggingCode#readme"
npm pkg set bugs.url="https://github.com/YOUR_GITHUB_USERNAME/HuggingCode/issues"
git add package.json
git commit -m "chore: add repository metadata"
git push
```

## Первая публикация в npm

Выполните проверку состава пакета до любой внешней публикации:

```powershell
cd C:\Users\nesme\Desktop\HuggingCode
npm run lint
npm test
npm pack --dry-run
```

Войдите в npm в интерактивном режиме. Не передавайте пароль, one-time password или access token в чат, commit или файл проекта.

```powershell
npm adduser
npm whoami
npm publish --dry-run
```

Когда dry-run показывает только ожидаемые файлы, выполните фактическую публикацию:

```powershell
npm publish
```

Публикация делает пакет доступным публично. npm не позволяет повторно опубликовать уже существующую пару имени и версии, поэтому для следующего релиза сначала повышайте версию.[1]

## Рекомендуемый релиз через GitHub Actions

В проект добавлен `.github/workflows/publish.yml`. Он запускает `npm ci`, lint, tests и `npm publish`, когда вы отправляете Git tag вида `v*`. Workflow использует OIDC и не хранит долгоживущий npm token в GitHub secrets.

После появления репозитория и **после первой ручной публикации** откройте в npm страницу пакета: **Settings → Trusted Publisher**. Выберите GitHub Actions и заполните:

| Поле npm | Значение |
|---|---|
| Organization or user | Ваш GitHub username или организация. |
| Repository | `HuggingCode` или фактическое имя репозитория. |
| Workflow filename | `publish.yml` |
| Allowed actions | `npm publish` |

Trusted publishing в npm использует короткоживущие OIDC-учётные данные, а workflow требует `id-token: write`.[2] Проверьте, что поле `repository.url` в `package.json` **точно** соответствует адресу репозитория: npm требует это для публикации из GitHub Actions.[2]

После настройки следующий выпуск выглядит так:

```powershell
cd C:\Users\nesme\Desktop\HuggingCode
npm version patch
git push --follow-tags
```

`npm version patch` поднимет, например, версию `0.2.0` до `0.2.1`, создаст Git tag, а push запустит workflow. Перед этим всегда проверяйте изменения и версию.

## Контрольный список перед публикацией

| Проверка | Команда или действие |
|---|---|
| Нет секретов | `git status --ignored` и визуальная проверка файлов. |
| Код проходит проверки | `npm run lint` и `npm test`. |
| В архив попадают только нужные файлы | `npm pack --dry-run`. |
| Пользовательская установка проверена | `npm install --global .` и `huggingcode --help` локально. |
| GitHub repository metadata заполнены | `repository`, `homepage`, `bugs` в `package.json`. |
| Первая версия выбрана окончательно | Проверьте `npm pkg get version`; опубликованную версию нельзя использовать повторно.[1] |

## Sources

[1]: https://docs.npmjs.com/cli/v11/commands/npm-publish "npm publish — npm Docs"
[2]: https://docs.npmjs.com/trusted-publishers/ "Trusted publishing for npm packages — npm Docs"
[3]: https://docs.npmjs.com/creating-and-publishing-scoped-public-packages/ "Creating and publishing scoped public packages — npm Docs"
