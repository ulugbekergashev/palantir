# Palantir на подписке Claude — план

Дата: 2026-11-01. Цель: чтобы клиника могла работать с ИИ на **своей подписке Claude (Pro/Max)**, а не только на API-ключе, не нарушая правил Anthropic.

## 0. Что выяснили (проверено 2026-11-01)

| Вопрос | Ответ | Источник |
|---|---|---|
| Можно ли подписку (токен claude.ai) вставить прямо в Palantir, например в `ANTHROPIC_AUTH_TOKEN`? | **Нет.** Сторонним программам запрещено принимать вход claude.ai, хранить токены подписки и пропускать через подписку запросы своих пользователей. С 4 апреля 2026 Anthropic это ещё и технически блокирует | [legal-and-compliance](https://code.claude.com/docs/en/legal-and-compliance) |
| Можно ли запускать внутри своей программы **неизменённый** Claude Code, в который клиника сама вошла своей подпиской? | **Да, при условиях:** бинарник не изменён; каждый входит своим аккаунтом через окно Anthropic; мы не платим за клиники и не перепродаём; мы принимаем Commercial Terms | там же, раздел «Can customers offer Claude Code in their products?» |
| Лимиты подписки | Рассчитаны на «обычное индивидуальное использование». Бот, который весь день отвечает пациентам, — **серая зона**: может упереться в лимит или попасть под ограничения | там же |
| MCP: приложение Claude вызывает инструменты Palantir | Полностью в рамках правил: это обычное использование приложения Claude | — |
| Channels (Telegram-бот, подключённый к Claude Code) | Research preview. Работает на подписке. Нужны Bun и постоянно запущенная сессия. **Только для доверенных отправителей**: кто пишет в канал, тот разрешает действия в сессии. Поэтому для пациентов не подходит | [channels](https://code.claude.com/docs/en/channels) |

Итоговая схема:

- **Владелец** → приложение Claude / Telegram-канал Claude Code → **подписка клиники** → инструменты Palantir через **MCP**.
- **Пациенты** → Telegram-бот Palantir → **API-ключ клиники** (как сейчас). По желанию клиники — через подписку (этап 3).
- Только с API-ключом: глубокий анализ на Python ([server/insights/deep.ts](../server/insights/deep.ts)) и работа на компьютере ([server/computer/jobs.ts](../server/computer/jobs.ts)).

## 1. Что подготовить на другом компьютере

1. Репозиторий: `git pull`, ветка `obuna`, затем `npm ci`.
2. **Claude Code** с официального установщика, вход подпиской: `claude auth login --claudeai`. Проверка входа: `claude auth status --json`.
3. **Claude Desktop** — для проверки расширения .mcpb (этап 1).
4. **Bun** — его требует Telegram-плагин канала (этап 2).
5. **Второй Telegram-бот** у @BotFather для канала владельца. Токен бота Palantir для этого брать нельзя: один токен не могут опрашивать две программы.
6. **API-ключ** в console.anthropic.com: для бота пациентов и для тестов. Аккаунт Console — это и есть принятие Commercial Terms.
7. В настройках claude.ai выключить «Help improve Claude»: через подписку пойдут данные пациентов.
8. Windows — на этом компьютере или через Windows CI: клиники работают на Windows.

## 2. Этап 1 — MCP-сервер Palantir

Нужен во всех схемах: Claude Desktop, канал владельца, Remote Control, этап 3.

**Что сделать**

- Новый `server/mcp.ts` на `@modelcontextprotocol/sdk`. Инструменты брать из тех же таблиц, что и ИИ Palantir: `DEFS`, `REQUEST_DEFS`, `CAMERA_DEFS`, а при подключённой DentaCRM — ещё `CRM_DEFS`. Схемы — через `schemaOf`, выполнение — через `runTool` ([server/tools.ts:398-425](../server/tools.ts#L398-L425)). `COMPUTER_DEFS` не отдавать: работа на компьютере идёт только через API.
- Транспорт: Streamable HTTP на сервере Palantir, `http://127.0.0.1:<env.port>/mcp` (по умолчанию порт 3200). Только localhost. Bearer-токен генерировать и хранить, как остальные секреты. Claude Code подключается напрямую через `--mcp-config`.
- Для Claude Desktop — расширение **.mcpb**: небольшой stdio→HTTP мост к тому же `/mcp`, ставится в один клик. Сторонний `mcp-remote` не использовать.
- Инструкции MCP-сервера (поле `instructions`): сокращённый `buildSystem` ([server/agent.ts:92](../server/agent.ts#L92)) и `profileText` ([server/claude.ts](../server/claude.ts)).
- Аннотации MCP:
  - `readOnlyHint` — на читающие инструменты;
  - `destructiveHint` — на пишущие: `book_appointment`, `record_payment`, `record_expense`, `pay_doctor`, `save_prices`, `forget`, `remember`, `write_page`, `save_lead`, `update_lead`, `create_task`, `update_task`, `open_request`, `close_request`.

  Приложение Claude перед пишущими инструментами должно спрашивать разрешение.

**Отличия от нынешнего ИИ Palantir — решить в коде**

- **Защита от чужого текста.** Сейчас `readStrangers` ([server/toolkit.ts:26-38](../server/toolkit.ts#L26-L38)) закрывает запись в знания до конца хода. В MCP ходов нет, а разговор в Claude Palantir не видит. Поэтому `ToolCtx` живёт всю MCP-сессию, и после чтения чужого текста запись в знания закрыта **до конца сессии**. Это строже, чем сейчас, и сделано сознательно. Текст отказа должен подсказывать: «начните новый чат».
- **Лимиты на ход** (`crmWrites`, `moneyDrafts`, `leadsSaved`, `cameraLooks`) считать на сессию или на окно времени.
- **Инструменты, которые сами вызывают ИИ Palantir**, переделать, чтобы через MCP им не нужен был API-ключ:
  - `create_document` (`writeDocument` в [server/docs/writer.ts](../server/docs/writer.ts)): в MCP принимать готовый текст от Claude и только собирать .docx;
  - `look_camera` (`lookAt` в [server/camera/ask.ts](../server/camera/ask.ts)): возвращать кадр как картинку в результате MCP, чтобы смотрел сам Claude.
- **Артефакты** (`ctx.artifacts`: документы, черновики с кнопкой «Отправить» от `draft_followup`): в результат MCP отдавать ссылку на панель. Черновик с кнопкой отправлять владельцу в бот Palantir, как сейчас.
- **Журнал**: вызовы через MCP записывать в журнал, чтобы владелец видел, что сделал Claude.

**Тесты**: `scripts/e2e-mcp.ts` и `npm run test:mcp`:
- список инструментов;
- вызов читающего инструмента;
- вызов пишущего инструмента;
- без токена — 401;
- не с localhost — отказ;
- после `read_conversation` вызов `remember` получает отказ.

**Готово, когда**: в Claude Desktop с расширением на вопрос «сколько записей сегодня?» приходит ответ по настоящим данным, а перед записью к врачу Claude спрашивает разрешение.

## 3. Этап 2 — владелец с телефона, без выхода компьютера в интернет

- На компьютере клиники постоянно работает Claude Code с MCP Palantir и Telegram-каналом:
  `claude --channels plugin:telegram@claude-plugins-official --mcp-config <palantir-mcp.json> --tools ""`
  - Встроенные инструменты Claude Code (Bash, Edit, Read…) выключены: остаются только инструменты Palantir.
  - Проверить, не отключает ли `--strict-mcp-config` плагин канала.
  - Флаг `--channels` в research preview не показывается в `claude --help` (проверено на 2.1.312) и может поменяться.
- Запуск и перезапуск — через супервизор Palantir ([scripts/supervise.mjs](../scripts/supervise.mjs)), с автозапуском вместе с Palantir.
- Привязка: владелец пишет боту, бот выдаёт код, код подтверждается через `/telegram:access pair <код>`, затем включается `/telegram:access policy allowlist`. Писать может **только владелец**.
- Запасной вариант без Telegram: Remote Control (`claude --remote-control`) — владелец открывает сессию в приложении Claude на телефоне.
- Панель: показывать, запущена ли сессия и вошла ли клиника (`claude auth status --json`).

**Готово, когда**: владелец пишет боту с телефона и получает ответ по настоящим данным. Посторонний человек от бота ничего не получает.

## 4. Этап 3 (по желанию клиники) — пациенты через подписку

Серая зона и лимиты (см. §0): клиника включает это сама, а API-ключ остаётся запасным.

- `AI_ENGINE=api|obuna` в [server/env.ts](../server/env.ts) и переключатель «Источник ИИ» в панели.
- В [server/claude.ts](../server/claude.ts) добавить второй путь для разовых запросов: [server/inbox/replier.ts](../server/inbox/replier.ts), [server/docs/writer.ts](../server/docs/writer.ts), [server/insights/analyze.ts](../server/insights/analyze.ts), [server/callreview.ts](../server/callreview.ts), [server/phone/analysis.ts](../server/phone/analysis.ts), [server/orders/parse.ts](../server/orders/parse.ts).
  Команда: `claude -p --output-format json --system-prompt … --json-schema … --tools "" --strict-mcp-config --no-session-persistence --permission-prompts none --model … --effort … --fallback-model …`, запуск в пустой рабочей папке.
  - `--bare` не использовать: в этом режиме вход по подписке игнорируется.
  - `--setting-sources` — минимальный набор (проверить, принимает ли он пустое значение).
- Помощник владельца ([server/agent.ts](../server/agent.ts)) — через `claude -p` с MCP Palantir из этапа 1.
- Картинки ([server/vision.ts](../server/vision.ts), [server/orders/look.ts](../server/orders/look.ts)) — через `--input-format stream-json`. Проверить, что картинки проходят.
- Только API: [server/insights/deep.ts](../server/insights/deep.ts) и [server/computer/jobs.ts](../server/computer/jobs.ts). В режиме подписки они пишут «нужен API-ключ».
- Лимит подписки: распознать в результате сообщение о лимите. Если есть ключ ([server/keys.ts](../server/keys.ts)) — перейти на него, если нет — понятное сообщение в панели: «лимит подписки, восстановится в …».
- Вход: кнопка в панели открывает видимое окно с `claude auth login --claudeai`, клиника входит на странице Anthropic. Palantir **не читает** файлы входа и **не использует** `claude setup-token`.
- Учёт: дневные лимиты `aiUsage` остаются, токены брать из `usage` в результате.
- Телефон: замерить задержку запуска `claude -p`. Если медленно — живые звонки остаются на API.

**Готово, когда**: клиника вошла подпиской, API-ключа нет — пациент в Telegram получает ответ. Когда лимит кончился — Palantir переходит на ключ или выводит понятное сообщение.

## 5. Правила, которые нельзя нарушать

- Claude Code ставится и запускается как есть, ничего в нём не менять.
- Каждая клиника входит **своим** аккаунтом. Palantir не хранит и не передаёт её токены.
- Не платить за клиники, не перепродавать доступ к Claude.
- Не использовать «Claude Code», «Claude», «Anthropic» в названии или логотипе продукта. Можно писать простым текстом: «внутри работает Claude Code».
- Канал Claude Code — только для владельца, не для пациентов.
- Правила в 2026 году менялись дважды: перед запуском у клиник перечитать страницы из §0.
