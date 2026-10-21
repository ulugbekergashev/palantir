/**
 * Hubning ochiq sahifalari — Meta ilovasi tekshiruvi talab qiladi: maxfiylik siyosati (/privacy), foydalanish shartlari (/terms),
 * ma'lumotni o'chirish yo'riqnomasi (/data-deletion) va o'chirish so'rovi holati (/data-deletion/status?id=…).
 * Uch tilda: inglizcha (Meta tekshiruvchisi uchun), o'zbekcha, ruscha. Operator nomi va aloqa manzili — HUB_OPERATOR, HUB_CONTACT_EMAIL.
 * Matn kod nima qilishini aytadi (hub xabarni klinika olguncha, ko'pi bilan 3 kun saqlaydi, tokenni saqlamaydi va h.k.) —
 * kod o'zgarsa, shu yer ham.
 */

export interface LegalInfo {
  /** Xizmatni taqdim etuvchi (yuridik nomi) */
  operator: string;
  email: string;
  publicUrl: string;
}

export const LEGAL_UPDATED = '2026-10-20';

const esc = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function shell(title: string, body: string): string {
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
:root{--bg:#fff;--fg:#13161d;--muted:#5b6170;--line:#e4e6eb;--link:#3346d3}
@media (prefers-color-scheme:dark){:root{--bg:#111318;--fg:#e8eaf0;--muted:#9aa1b2;--line:#2a2e38;--link:#8fa0ff}}
body{background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;max-width:46rem;margin:0 auto;padding:32px 16px 64px}
h1{font-size:1.6rem;margin:0 0 4px}h2{font-size:1.2rem;margin:40px 0 8px;padding-top:24px;border-top:1px solid var(--line)}h3{font-size:1rem;margin:24px 0 4px}
p,li{margin:6px 0}a{color:var(--link)}.muted{color:var(--muted);font-size:.9rem}nav a{margin-right:16px}code{font-size:.9em}
</style>
<body>${body}</body></html>`;
}

const langs = '<nav><a href="#en">English</a><a href="#uz">O\'zbekcha</a><a href="#ru">Русский</a></nav>';
const contact = (i: LegalInfo) => `<a href="mailto:${esc(i.email)}">${esc(i.email)}</a>`;

export function privacyPage(i: LegalInfo): string {
  const op = esc(i.operator), url = esc(i.publicUrl);
  return shell(`Privacy Policy — ${i.operator}`, `
<h1>Privacy Policy</h1>
<p class="muted">Palantir · ${op} · updated ${LEGAL_UPDATED}</p>
${langs}

<h2 id="en">English</h2>
<h3>Who we are</h3>
<p>${op} ("we") provides Palantir, software that helps a business (for example, a dental clinic) answer its customers. The business runs Palantir on its own computer. Palantir Hub (${url}) is a small service that connects the business's Instagram professional account to that computer through the official Instagram API. For conversations between a business and its customers, the business decides how the data is used; we process it on the business's behalf.</p>
<h3>What we receive</h3>
<ul>
<li>From the business that connects Instagram: the Instagram professional account ID and username, and an access token. The token is handed once to the business's own computer and is not kept on the Hub.</li>
<li>From people who message the business on Instagram: the messages and attachments they send to the business, and the Instagram-scoped ID and name that Instagram provides with them.</li>
<li>Technical data: standard server logs (IP address, time, request), kept only as long as needed for security and troubleshooting.</li>
</ul>
<h3>How it is used</h3>
<p>Only to deliver the messages to the business's Palantir and to let the business reply. Depending on the business's settings, Palantir prepares or sends replies with the help of AI: the business's computer sends the conversation text to Anthropic's Claude API, which processes it as a service provider under its commercial terms. We do not sell data and do not use it for advertising.</p>
<h3>Where it is stored and for how long</h3>
<ul>
<li>Messages pass through the Hub and are deleted as soon as the business's computer receives them, and in any case within 3 days.</li>
<li>Conversations and customer records are stored on the business's own computer, under the business's control.</li>
<li>The Hub keeps the link between the Instagram account and the business until the business disconnects Instagram or removes the app.</li>
<li>If the business turns on off-site backup, the Hub keeps the last 7 daily backups. They are encrypted on the business's computer with a key that only ${op} holds offline; the Hub cannot read them. They are used only to restore the business's data at its request.</li>
<li>If the business asks for technical support, its Palantir sends a diagnostic report (status and recent technical logs, without passwords or keys); the Hub keeps the last 10.</li>
</ul>
<h3>Who else receives it</h3>
<p>Meta (to deliver the business's replies on Instagram), Anthropic (AI drafting, as above), and the hosting provider of the Hub. Nobody else, unless the law requires it.</p>
<h3>Your choices</h3>
<ul>
<li>If you wrote to a business: ask that business to delete your conversation, or write to us at ${contact(i)} with your Instagram username and the business's name — we will pass the request on and confirm.</li>
<li>If you are a business: disconnect Instagram in the Palantir panel, or remove the app in Instagram (Settings → Website permissions → Apps and websites). See <a href="/data-deletion">data deletion</a>.</li>
</ul>
<h3>Security</h3>
<p>Connections use HTTPS. Instagram webhooks are verified with Meta's signature. On the business's computer the access token is stored encrypted.</p>
<h3>Children</h3>
<p>Palantir is a tool for businesses and is not directed to children.</p>
<h3>Changes and contact</h3>
<p>We will publish changes on this page with a new date. Questions: ${contact(i)}.</p>

<h2 id="uz">O'zbekcha</h2>
<h3>Biz kimmiz</h3>
<p>${op} («biz») Palantir dasturini taqdim etadi — u biznesga (masalan, stomatologiya klinikasiga) mijozlariga javob berishda yordam beradi. Biznes Palantir'ni o'z kompyuterida ishlatadi. Palantir Hub (${url}) — biznesning Instagram professional akkauntini rasmiy Instagram API orqali o'sha kompyuterga ulaydigan kichik xizmat. Biznes va uning mijozlari orasidagi yozishmalardan qanday foydalanishni biznes hal qiladi; biz ularni biznes nomidan qayta ishlaymiz.</p>
<h3>Nima olamiz</h3>
<ul>
<li>Instagram'ni ulagan biznesdan: Instagram professional akkaunt ID'si va nomi, kirish tokeni. Token biznesning o'z kompyuteriga bir marta beriladi va hubda saqlanmaydi.</li>
<li>Biznesga Instagram'da yozgan odamlardan: biznesga yuborgan xabarlari va fayllari, Instagram ular bilan birga beradigan ID va ism.</li>
<li>Texnik ma'lumot: oddiy server jurnallari (IP manzil, vaqt, so'rov) — xavfsizlik va nosozlikni topish uchun kerakli muddatgacha.</li>
</ul>
<h3>Qanday foydalaniladi</h3>
<p>Faqat xabarlarni biznesning Palantir'iga yetkazish va biznes javob bera olishi uchun. Biznes sozlamasiga qarab Palantir javobni AI yordamida tayyorlaydi yoki yuboradi: biznesning kompyuteri yozishma matnini Anthropic kompaniyasining Claude API'siga yuboradi, u xizmat ko'rsatuvchi sifatida o'z tijorat shartlari asosida qayta ishlaydi. Biz ma'lumotni sotmaymiz va reklama uchun ishlatmaymiz.</p>
<h3>Qayerda va qancha saqlanadi</h3>
<ul>
<li>Xabarlar hub orqali o'tadi va biznes kompyuteri olishi bilan, har holda 3 kun ichida o'chiriladi.</li>
<li>Yozishmalar va mijozlar kartalari biznesning o'z kompyuterida, biznes nazoratida saqlanadi.</li>
<li>Hub Instagram akkaunti va biznes orasidagi bog'lanishni biznes Instagram'ni uzguncha yoki ilovani o'chirguncha saqlaydi.</li>
<li>Biznes tashqi zaxirani yoqsa, hub oxirgi 7 kunlik zaxirani saqlaydi. Ular biznes kompyuterida faqat ${op}da (internetdan tashqarida) turgan kalit bilan shifrlanadi; hub ularni o'qiy olmaydi. Faqat biznes so'raganda uning ma'lumotini tiklash uchun ishlatiladi.</li>
<li>Biznes texnik yordam so'rasa, Palantir diagnostika hisobotini yuboradi (holat va oxirgi texnik jurnallar, parol va kalitlarsiz); hub oxirgi 10 tasini saqlaydi.</li>
</ul>
<h3>Yana kimga beriladi</h3>
<p>Meta (biznes javobini Instagram'da yetkazish uchun), Anthropic (AI, yuqorida aytilganidek) va hub joylashgan hosting. Qonun talab qilmasa — boshqa hech kimga.</p>
<h3>Sizning tanlovingiz</h3>
<ul>
<li>Biznesga yozgan bo'lsangiz: o'sha biznesdan yozishmangizni o'chirishni so'rang yoki ${contact(i)} ga Instagram nomingiz va biznes nomini yozing — so'rovni biznesga yetkazamiz va javob beramiz.</li>
<li>Biznes bo'lsangiz: Palantir panelida Instagram'ni uzing yoki Instagram'da ilovani o'chiring (Sozlamalar → Veb-sayt ruxsatlari → Ilovalar va saytlar). Batafsil: <a href="/data-deletion">ma'lumotni o'chirish</a>.</li>
</ul>
<h3>Xavfsizlik</h3>
<p>Ulanishlar HTTPS orqali. Instagram webhook'lari Meta imzosi bilan tekshiriladi. Biznes kompyuterida kirish tokeni shifrlangan holda saqlanadi.</p>
<h3>Bolalar</h3>
<p>Palantir biznes uchun vosita, bolalarga mo'ljallanmagan.</p>
<h3>O'zgarishlar va aloqa</h3>
<p>O'zgarishlar shu sahifada yangi sana bilan e'lon qilinadi. Savollar: ${contact(i)}.</p>

<h2 id="ru">Русский</h2>
<h3>Кто мы</h3>
<p>${op} («мы») предоставляет Palantir — программу, которая помогает бизнесу (например, стоматологической клинике) отвечать клиентам. Бизнес запускает Palantir на своём компьютере. Palantir Hub (${url}) — небольшой сервис, который подключает профессиональный аккаунт Instagram бизнеса к этому компьютеру через официальный Instagram API. Как использовать переписку между бизнесом и его клиентами, решает бизнес; мы обрабатываем её от его имени.</p>
<h3>Что мы получаем</h3>
<ul>
<li>От бизнеса, подключившего Instagram: ID и имя профессионального аккаунта Instagram и токен доступа. Токен один раз передаётся на компьютер бизнеса и в Hub не хранится.</li>
<li>От людей, которые пишут бизнесу в Instagram: их сообщения и вложения, а также ID и имя, которые Instagram передаёт вместе с ними.</li>
<li>Технические данные: обычные журналы сервера (IP-адрес, время, запрос) — столько, сколько нужно для безопасности и поиска неисправностей.</li>
</ul>
<h3>Как используется</h3>
<p>Только чтобы доставить сообщения в Palantir бизнеса и дать бизнесу ответить. В зависимости от настроек бизнеса Palantir готовит или отправляет ответы с помощью ИИ: компьютер бизнеса отправляет текст переписки в Claude API компании Anthropic, которая обрабатывает его как поставщик услуг на своих коммерческих условиях. Мы не продаём данные и не используем их для рекламы.</p>
<h3>Где и сколько хранится</h3>
<ul>
<li>Сообщения проходят через Hub и удаляются, как только компьютер бизнеса их получил, и в любом случае в течение 3 дней.</li>
<li>Переписка и карточки клиентов хранятся на компьютере бизнеса под его контролем.</li>
<li>Hub хранит связь между аккаунтом Instagram и бизнесом, пока бизнес не отключит Instagram или не удалит приложение.</li>
<li>Если бизнес включил внешнее резервное копирование, Hub хранит 7 последних ежедневных копий. Они шифруются на компьютере бизнеса ключом, который есть только у ${op} (хранится офлайн); Hub не может их прочитать. Используются только для восстановления данных бизнеса по его просьбе.</li>
<li>Если бизнес обращается в техподдержку, Palantir отправляет диагностический отчёт (состояние и последние технические журналы, без паролей и ключей); Hub хранит 10 последних.</li>
</ul>
<h3>Кому ещё передаётся</h3>
<p>Meta (чтобы доставить ответы бизнеса в Instagram), Anthropic (ИИ, как указано выше) и хостинг-провайдеру Hub. Больше никому, если этого не требует закон.</p>
<h3>Ваш выбор</h3>
<ul>
<li>Если вы писали бизнесу: попросите этот бизнес удалить вашу переписку или напишите нам на ${contact(i)}, указав ваше имя в Instagram и название бизнеса, — мы передадим запрос и ответим.</li>
<li>Если вы бизнес: отключите Instagram в панели Palantir или удалите приложение в Instagram (Настройки → Разрешения для сайтов → Приложения и сайты). Подробнее: <a href="/data-deletion">удаление данных</a>.</li>
</ul>
<h3>Безопасность</h3>
<p>Соединения — по HTTPS. Вебхуки Instagram проверяются по подписи Meta. На компьютере бизнеса токен доступа хранится в зашифрованном виде.</p>
<h3>Дети</h3>
<p>Palantir — инструмент для бизнеса и не предназначен для детей.</p>
<h3>Изменения и контакты</h3>
<p>Изменения публикуются на этой странице с новой датой. Вопросы: ${contact(i)}.</p>
`);
}

export function termsPage(i: LegalInfo): string {
  const op = esc(i.operator);
  return shell(`Terms of Service — ${i.operator}`, `
<h1>Terms of Service</h1>
<p class="muted">Palantir · ${op} · updated ${LEGAL_UPDATED}</p>
${langs}

<h2 id="en">English</h2>
<p>These terms apply to businesses that connect an Instagram professional account to Palantir through Palantir Hub.</p>
<ol>
<li><b>The service.</b> The Hub delivers Instagram messages to the business's own Palantir installation and lets it reply through the official Instagram API. ${op} operates the Hub; the business operates its Palantir.</li>
<li><b>The business's responsibilities.</b> Follow Meta's Platform Terms and Instagram's rules (including the messaging window), the applicable law, including personal data law, and its own privacy notice to customers. Do not use the service for spam or unsolicited promotion. Review AI-prepared messages according to the settings it chooses; the business is responsible for what is sent in its name.</li>
<li><b>Data.</b> Handled as described in the <a href="/privacy">Privacy Policy</a>.</li>
<li><b>Availability.</b> We work to keep the Hub available, but it is provided "as is"; Instagram or network outages can delay messages.</li>
<li><b>Ending.</b> The business can disconnect at any time in the Palantir panel or by removing the app in Instagram. We may suspend access that breaks these terms or Meta's rules.</li>
<li><b>Liability.</b> To the extent the law allows, ${op} is not liable for indirect losses or for messages delayed or not delivered by third-party platforms.</li>
<li><b>Contact.</b> ${contact(i)}.</li>
</ol>

<h2 id="uz">O'zbekcha</h2>
<p>Bu shartlar Instagram professional akkauntini Palantir Hub orqali Palantir'ga ulagan bizneslarga tegishli.</p>
<ol>
<li><b>Xizmat.</b> Hub Instagram xabarlarini biznesning o'z Palantir'iga yetkazadi va rasmiy Instagram API orqali javob berish imkonini beradi. Hubni ${op} yuritadi; Palantir'ni — biznesning o'zi.</li>
<li><b>Biznes majburiyatlari.</b> Meta platforma shartlari va Instagram qoidalariga (xabar yozish muddati ham), amaldagi qonunlarga, jumladan shaxsga doir ma'lumotlar to'g'risidagi qonunga va mijozlariga bergan maxfiylik bildirishnomasiga rioya qilish. Xizmatni spam yoki so'ralmagan reklama uchun ishlatmaslik. AI tayyorlagan xabarlarni o'zi tanlagan sozlamaga ko'ra ko'rib chiqish; biznes nomidan yuborilgan xabar uchun biznes javobgar.</li>
<li><b>Ma'lumot.</b> <a href="/privacy">Maxfiylik siyosati</a>da aytilganidek.</li>
<li><b>Ishlash.</b> Hub uzluksiz ishlashi uchun harakat qilamiz, lekin xizmat «boricha» taqdim etiladi; Instagram yoki tarmoqdagi uzilishlar xabarni kechiktirishi mumkin.</li>
<li><b>To'xtatish.</b> Biznes istalgan vaqtda Palantir panelida uzishi yoki Instagram'da ilovani o'chirishi mumkin. Shu shartlar yoki Meta qoidalari buzilsa, kirishni to'xtatishimiz mumkin.</li>
<li><b>Javobgarlik.</b> Qonun ruxsat bergan darajada ${op} bilvosita zarar va boshqa platformalar kechiktirgan yoki yetkazmagan xabarlar uchun javobgar emas.</li>
<li><b>Aloqa.</b> ${contact(i)}.</li>
</ol>

<h2 id="ru">Русский</h2>
<p>Эти условия относятся к бизнесам, которые подключают профессиональный аккаунт Instagram к Palantir через Palantir Hub.</p>
<ol>
<li><b>Сервис.</b> Hub доставляет сообщения Instagram в Palantir бизнеса и позволяет отвечать через официальный Instagram API. Hub управляет ${op}; Palantir — сам бизнес.</li>
<li><b>Обязанности бизнеса.</b> Соблюдать условия платформы Meta и правила Instagram (включая окно для сообщений), применимое законодательство, в том числе о персональных данных, и собственное уведомление о конфиденциальности для клиентов. Не использовать сервис для спама или навязчивой рекламы. Проверять сообщения, подготовленные ИИ, в соответствии с выбранными настройками; за отправленное от имени бизнеса отвечает бизнес.</li>
<li><b>Данные.</b> Как описано в <a href="/privacy">Политике конфиденциальности</a>.</li>
<li><b>Доступность.</b> Мы стараемся обеспечить работу Hub, но сервис предоставляется «как есть»; сбои Instagram или сети могут задерживать сообщения.</li>
<li><b>Прекращение.</b> Бизнес может отключиться в любой момент в панели Palantir или удалив приложение в Instagram. Мы можем приостановить доступ при нарушении этих условий или правил Meta.</li>
<li><b>Ответственность.</b> В пределах, допускаемых законом, ${op} не отвечает за косвенные убытки и за сообщения, задержанные или не доставленные сторонними платформами.</li>
<li><b>Контакты.</b> ${contact(i)}.</li>
</ol>
`);
}

export function deletionPage(i: LegalInfo): string {
  const op = esc(i.operator);
  return shell(`Data deletion — ${i.operator}`, `
<h1>Data deletion</h1>
<p class="muted">Palantir · ${op} · updated ${LEGAL_UPDATED}</p>
${langs}

<h2 id="en">English</h2>
<h3>If you are a business that connected Instagram</h3>
<ol>
<li>In the Palantir panel open Connections → Instagram and press Disconnect; or</li>
<li>In Instagram open Settings → Website permissions → Apps and websites, and remove the app.</li>
</ol>
<p>When the app is removed, Instagram notifies us automatically. We then delete the link between your account and your business and any messages still waiting on the Hub, and instruct your Palantir to delete the Instagram access token and the messages it received through Instagram. If you send a deletion request from Instagram, you receive a confirmation code; you can check its status at <code>/data-deletion/status?id=&lt;code&gt;</code>.</p>
<h3>If you wrote to a business on Instagram</h3>
<p>Your conversation is stored on that business's own computer. Ask the business to delete it, or write to ${contact(i)} with your Instagram username and the business's name — we will pass the request on and confirm when it is done.</p>

<h2 id="uz">O'zbekcha</h2>
<h3>Instagram'ni ulagan biznes bo'lsangiz</h3>
<ol>
<li>Palantir panelida Ulanishlar → Instagram → «Uzish» ni bosing; yoki</li>
<li>Instagram'da Sozlamalar → Veb-sayt ruxsatlari → Ilovalar va saytlar bo'limida ilovani o'chiring.</li>
</ol>
<p>Ilova o'chirilsa, Instagram bizga o'zi xabar beradi. Shundan keyin akkauntingiz va biznesingiz orasidagi bog'lanishni va hubda kutib turgan xabarlarni o'chiramiz, Palantir'ingizga esa Instagram tokenini va Instagram orqali kelgan xabarlarni o'chirishni buyuramiz. Instagram'dan o'chirish so'rovini yuborsangiz, tasdiq kodi olasiz; holatini <code>/data-deletion/status?id=&lt;kod&gt;</code> da ko'rish mumkin.</p>
<h3>Biznesga Instagram'da yozgan bo'lsangiz</h3>
<p>Yozishmangiz o'sha biznesning o'z kompyuterida saqlanadi. Biznesdan o'chirishni so'rang yoki ${contact(i)} ga Instagram nomingiz va biznes nomini yozing — so'rovni yetkazamiz va bajarilganda xabar beramiz.</p>

<h2 id="ru">Русский</h2>
<h3>Если вы бизнес, подключивший Instagram</h3>
<ol>
<li>В панели Palantir откройте Подключения → Instagram и нажмите «Отключить»; или</li>
<li>В Instagram откройте Настройки → Разрешения для сайтов → Приложения и сайты и удалите приложение.</li>
</ol>
<p>Когда приложение удалено, Instagram сообщает нам автоматически. Мы удаляем связь между вашим аккаунтом и бизнесом и сообщения, ожидающие в Hub, и даём команду вашему Palantir удалить токен Instagram и сообщения, полученные через Instagram. Если вы отправили запрос на удаление из Instagram, вы получите код подтверждения; статус можно проверить на <code>/data-deletion/status?id=&lt;код&gt;</code>.</p>
<h3>Если вы писали бизнесу в Instagram</h3>
<p>Ваша переписка хранится на компьютере этого бизнеса. Попросите бизнес удалить её или напишите на ${contact(i)}, указав ваше имя в Instagram и название бизнеса, — мы передадим запрос и сообщим, когда он будет выполнен.</p>
`);
}

export interface DeletionView { code: string; status: 'pending' | 'done'; createdAt: string; doneAt: string | null }

export function deletionStatusPage(i: LegalInfo, d: DeletionView | null): string {
  const when = (iso: string) => esc(iso.slice(0, 16).replace('T', ' ')) + ' UTC';
  const body = !d
    ? '<p>No deletion request with this code. · Bu kod bilan so\'rov yo\'q. · Запрос с таким кодом не найден.</p>'
    : d.status === 'done'
      ? `<p><b>Completed</b> ${d.doneAt ? when(d.doneAt) : ''}. · <b>Bajarildi.</b> · <b>Выполнено.</b></p>`
      : `<p><b>In progress.</b> The Hub part is done; the business's Palantir completes the rest as soon as its computer is online.</p>
<p><b>Bajarilmoqda.</b> Hubdagi qismi bajarildi; qolganini biznesning Palantir'i kompyuteri yoqilishi bilan bajaradi.</p>
<p><b>Выполняется.</b> Часть в Hub выполнена; остальное Palantir бизнеса выполнит, как только его компьютер будет в сети.</p>`;
  return shell('Data deletion status', `
<h1>Data deletion status</h1>
${d ? `<p class="muted">Code ${esc(d.code)} · received ${when(d.createdAt)}</p>` : ''}
${body}
<p class="muted">Questions: ${contact(i)} · <a href="/data-deletion">Data deletion</a> · <a href="/privacy">Privacy Policy</a></p>`);
}
