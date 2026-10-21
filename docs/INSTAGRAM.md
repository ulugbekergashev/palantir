# Instagram: официальное подключение (Meta) через Palantir Hub

Два способа, оба в панели → «Ulanishlar» → «3. Instagram Direct»:

| | Официальный (Meta API) — **основной** | Через браузер — запасной |
|---|---|---|
| Как работает | Meta сама присылает сообщения (вебхук), ответ — через Graph API | Chrome на ПК клиники под логином владельца |
| Риск блокировки | нет | есть (неофициальный способ) |
| Что нужно | Meta-приложение + Palantir Hub (облако) | только Chrome/Edge на ПК |
| Ограничения Instagram | ответ — в течение 24 ч после последнего сообщения клиента (с «Human Agent» — 7 дней), сообщение до 1000 байт (длинное Palantir делит сам) | ограничения веб-версии |

## Как устроено

```
Клиент пишет в Direct ─► Meta ─► Palantir Hub (облако, HTTPS) ─► очередь клиники
                                                               ▲
ПК клиники (Palantir) ── исходящий запрос «есть новое?» (long-poll) ┘   ← порты на ПК не открываются
ПК клиники ── ответ напрямую в graph.instagram.com своим токеном
```

Hub хранит секрет Meta-приложения и принимает вебхуки за все клиники. Токен клиники (60 дней, продлевается сам) живёт только у клиники: hub передаёт его один раз и удаляет.

## Шаг 1. Instagram-аккаунт клиники
Instagram → Настройки → «Тип аккаунта» → **Профессиональный** (Business или Creator). Facebook-страница не нужна.

## Шаг 2. Meta-приложение (один раз, на все клиники)
1. developers.facebook.com → My Apps → Create app → сценарий про Instagram-сообщения («Manage messaging & content on Instagram»), тип Business.
2. Instagram → **API setup with Instagram business login** → записать **Instagram App ID** и **Instagram App Secret**.
3. Там же, «Business login settings» → **OAuth redirect URI**: `https://<адрес-хаба>/ig/callback`.
4. «Webhooks» → Callback URL: `https://<адрес-хаба>/ig/webhook`, Verify token: значение `HUB_VERIFY_TOKEN` (шаг 3) → подписаться на поле **messages**.
   Там же, в «Business login settings»: **Deauthorize callback URL** — `https://<адрес-хаба>/ig/deauthorize`, **Data deletion request URL** — `https://<адрес-хаба>/ig/data-deletion`.
   App settings → Basic: **Privacy Policy URL** — `https://<адрес-хаба>/privacy`, **Terms of Service URL** — `https://<адрес-хаба>/terms`, **User data deletion** → «Data deletion instructions URL» — `https://<адрес-хаба>/data-deletion` (страницы на английском, узбекском и русском; имя компании и e-mail — переменные `HUB_OPERATOR`, `HUB_CONTACT_EMAIL`, шаг 3).
5. App roles → **Instagram testers** → добавить аккаунт клиники; в Instagram принять приглашение (Настройки → «Приложения и сайты» → приглашения тестировщика).
6. Переключить приложение в режим **Live** (без этого Meta не шлёт вебхуки).

Пока у приложения нет Advanced Access, работают только аккаунты с ролью в приложении (тестировщики) — для первых клиник этого достаточно. Для массового подключения: App Review на `instagram_business_basic` и `instagram_business_manage_messages` + Business Verification (документы компании, политика конфиденциальности, видео работы). Срок — от нескольких дней до недель, поэтому подавать стоит сразу. Функция **Human Agent** (ответ до 7 дней) — отдельная заявка; после одобрения на ПК клиники `IG_HUMAN_AGENT=1`.

## Шаг 3. Развернуть Palantir Hub (Railway или любой хостинг с HTTPS)
Папка `hub/` самостоятельная: Node 24, без зависимостей (`node server.ts`).

1. Railway → New project → из репозитория, **Root directory: `hub`**, Start command: `node server.ts`.
2. Volume, смонтированный в `/data`, и переменная `HUB_DB=/data/hub.db` (иначе очередь пропадёт при перезапуске).
3. Переменные:
   - `IG_APP_ID`, `IG_APP_SECRET` — из шага 2;
   - `HUB_PUBLIC_URL` — публичный адрес (`https://…up.railway.app`), без `/` в конце;
   - `HUB_VERIFY_TOKEN` — любая длинная случайная строка (та же — в Meta, шаг 2.4);
   - `HUB_ADMIN_KEY` — длинная случайная строка, только для вас.
   - `HUB_TRUST_PROXY=1` — на Railway и любом хостинге за прокси: для удалённого доступа к панели адрес телефона берётся из `X-Forwarded-For` (иначе все клиенты выглядят одним адресом и ограничение попыток пароля общее на всех).
   - `HUB_OPERATOR` — юридическое название компании (как в Business Verification), `HUB_CONTACT_EMAIL` — e-mail для вопросов о данных. Без e-mail Meta политику не примет; `/health` показывает `"legal":true`, когда он задан.
   - Внешние резервные копии клиник (зашифрованы вашим открытым ключом — хаб их прочитать не может): хранятся в `HUB_BACKUP_DIR` (по умолчанию `zaxira` рядом с `HUB_DB` — то есть на томе), по `HUB_BACKUP_KEEP` (7) последних на клинику, до `HUB_BACKUP_MAX_MB` (512) каждая. Список: `GET /admin/backups`, скачать: `GET /admin/backups/<клиника>/<день>.czb`, открыть: `npm run restore-backup -- <файл>` (закрытый ключ `~/.cerebro/zaxira-kaliti.pem`).
   - `HUB_BOT_TOKEN` и `HUB_ALERT_CHAT` (необязательно, но нужно для контроля): ваш отдельный бот (@BotFather) и ваш chat id — хаб напишет туда, если ПК клиники 15 минут не на связи (`HUB_OFFLINE_MS`), и когда связь вернётся. Список клиник с версией, свободным местом на диске и открытыми проблемами: `curl https://<адрес-хаба>/admin/clinics -H "Authorization: Bearer <HUB_ADMIN_KEY>"`.
4. Проверка: `https://<адрес-хаба>/health` → `{"ok":true,"instagram":true,"legal":true}`; открыть `/privacy` и проверить название и e-mail.

### Лицензия клиники
Срок и приостановка задаются в хабе, клиника узнаёт в ближайшем сообщении о состоянии (раз в 5 минут):
```
curl -X PATCH https://<адрес-хаба>/admin/clinics/<клиника> -H "Authorization: Bearer <HUB_ADMIN_KEY>" -d "{\"licenseUntil\":\"2026-12-31\"}"
curl -X PATCH https://<адрес-хаба>/admin/clinics/<клиника> -H "Authorization: Bearer <HUB_ADMIN_KEY>" -d "{\"suspended\":true}"
```
`licenseUntil: null` — бессрочно. За 7 дней до конца, после окончания, при приостановке и если ПК клиники 7 дней не связывался с хабом — предупреждение в панели и владельцу в Telegram (раз в день). **Работа Palantir пока не ограничивается** — только предупреждения. Список с лицензиями: `GET /admin/clinics`.

## Шаг 4. Код клиники
```
curl -X POST https://<адрес-хаба>/admin/clinics -H "Authorization: Bearer <HUB_ADMIN_KEY>" -d "{\"name\":\"Shifo Dent\"}"
```
Ответ содержит `code` вида `chub.…` — показывается один раз. На ПК клиники: панель → «Ulash» → ключи → **Palantir Hub kodi** (проверяется сразу на хабе).

## Шаг 5. Подключить Instagram клиники
Панель → «Ulanishlar» → Instagram → **«Instagram'ni rasmiy ulash»** → откроется Instagram → войти в аккаунт клиники → «Разрешить». Через несколько секунд в панели: «✓ @аккаунт», владельцу в Telegram: «📸 Instagram rasmiy ulandi».

С этого момента: клиент пишет в Direct → Palantir отвечает (черновик на одобрение или сам — по настройке «Mijozlarga javob») → если клиент просит перезвонить или оставляет номер — заявка уходит в регистратуру.

## Что проверено и что нет
- **Проверено автотестом** (`npm run test:instagram`, 44 проверки) на **фейковом** Meta с настоящим процессом хаба: OAuth и обмен кода (секрет только в хабе), подделанный `state` отклоняется, подпись вебхука, подтверждение вебхука, повторная доставка не дублируется, эхо собственных ответов, ответ владельца с телефона, правило 24 часов, отключение; страницы политики (три языка, имя и e-mail); `signed_request` с чужой подписью отклоняется; запрос на удаление данных (по Instagram id и по id приложения) — хаб отвечает кодом и ссылкой на статус, ПК клиники удаляет токен, сообщения из Instagram и карточки, известные только по Instagram (карточка, сохранённая владельцем, остаётся без Instagram), статус становится «Completed»; удаление приложения в Instagram — подключение снимается, переписка остаётся, хаб больше не пересылает сообщения.
- **Что удаляется по запросу Meta** (`server/forget.ts`): сообщения из Instagram, черновики ответов в Instagram, цитаты из Instagram в заявках регистратуры, Instagram-имя пользователя; карточки, появившиеся в Instagram и не имеющие другого следа (Telegram, звонки, другие каналы), — целиком. Владелец получает в Telegram отчёт, сколько удалено. Отдельно в панели (карточка клиента → «Mijozni o'chirish») владелец удаляет одного клиента по его просьбе.
- **Не проверено на настоящем Meta**: формат реальных вебхуков и ошибок Graph API, App Review. Первый живой прогон: шаги 1–5 с тестовым аккаунтом клиники, затем одно сообщение в Direct с другого аккаунта.
- Продление токена (раз в сутки, за 10 дней до конца) написано, автотестом не покрыто.
