# Кнопка «Facebook orqali ulash» (Targetolog) — настройка Meta-приложения

Клиника нажимает кнопку в панели (Targetolog → Kabinet). Дальше всё идёт само:

1. Открывается страница Hub с названием клиники, к которой подключается кабинет: так пересланную чужую ссылку легко заметить. Ссылка одноразовая. Дальше Facebook: человек входит и разрешает доступ.
2. Palantir Hub меняет код на 60-дневный токен. Секрет приложения хранится только в Hub, а сам токен лежит в очереди Hub не больше часа.
3. Токен через очередь Hub приходит в Palantir клиники.
4. Palantir находит рекламный кабинет, страницу и Instagram. Если кабинетов несколько, клиника выбирает нужный в панели.

ID и токены вручную вводить не нужно. Ручной способ (токен системного пользователя) остаётся в панели свёрнутым — для тех, кому нужен бессрочный токен.

## Что сделать один раз (владелец Palantir)

1. На developers.facebook.com/apps откройте приложение Palantir (то же, что для Instagram) или создайте новое (тип Business).
2. Добавьте два сценария (use cases):
   - **Create & manage ads with ads MCP server** — даёт разрешение `ads_mcp_management`. Без него Targetolog не получит инструменты Meta (MCP), останется только простой путь через план.
   - **Facebook Login for Business**.
3. Facebook Login for Business → Settings → **Valid OAuth Redirect URIs**: `https://<hub>/ads/callback`. Сейчас это `https://92-5-56-138.sslip.io/ads/callback`.
4. Settings → Basic: скопируйте **App ID** и **App Secret** и выполните:
   ```
   FB_APP_ID=… FB_APP_SECRET=… npm run hub:deploy
   ```
   Скрипт запомнит значения в `~/.palantir/hub.env`. Проверка: `https://<hub>/health` показывает `"ads":true`.
5. Если Facebook пишет «Invalid Scopes» или не спрашивает разрешения, приложению нужна конфигурация:
   - Facebook Login for Business → Configurations → Create, тип токена — **User access token**;
   - выберите разрешения: `ads_mcp_management`, `ads_management`, `ads_read`, `business_management`, `pages_show_list`, `pages_read_engagement`, `pages_manage_ads`, `instagram_basic`;
   - затем выполните `FB_LOGIN_CONFIG_ID=<id> npm run hub:deploy`.

## Ограничения

- **Пока приложение в режиме Development**, войти могут только люди с ролью в приложении (администраторы, разработчики, тестировщики). Вы сами можете пользоваться сразу. Для чужих клиник нужно:
  - пройти App Review: Advanced Access на `ads_management`, `ads_mcp_management`, `business_management`, `pages_*`;
  - пройти Business Verification.
- Токен действует **60 дней**. Продлить его без человека нельзя. За 5 дней до конца Palantir напишет владельцу клиники в Telegram. Повторное нажатие кнопки обновит токен, а тот же кабинет подключится сам.
- Деньги по-прежнему тратятся только по кнопке владельца клиники: включение, буст и изменение бюджета. Способ подключения на это не влияет.

Проверка без настоящего Facebook: `npm run test:ads-hub`.
