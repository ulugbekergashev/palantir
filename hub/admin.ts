/**
 * Palantir Hub — boshqaruv markazi (/admin): sotuvchining hamma mijozlari (klinikalar va boshqa bizneslar) bitta joyda.
 *   Umumiy — ko'rsatkichlar (mijozlar, aloqada, diqqat kerak, yordam, litsenziya, nashr), 14 kunlik grafik, «Diqqat talab qiladi»
 *   ro'yxati, biznes turlari, nashrlar va to'lovlar (mijoz kartasidagi tarif va sana bo'yicha — hub pul olmaydi).
 *   Mijozlar — qidiruv, tur va holat filtri, jadval; qatorni bosish — mijoz oynasi: holat, muammolar, karta (egasi, telefon, shahar,
 *   tur, tarif, to'langan sana, izoh — clients.ts) va amallar (panel, tasdiqlash, litsenziya, kompyuter almashdi, kirishni tiklash).
 *   Yordam, Jamoa, Jurnal — avvalgidek. Ko'rinish — adminStyle.ts, ish — adminApp.ts va adminDrawer.ts.
 *
 * Klinika panellari (/c/…) shu manzilda turadi va ularni klinika kompyuteri beradi — buzilgan klinika o'z sahifasidan admin kalitini
 * o'qishga urinishi mumkin. Shuning uchun: kalit faqat sahifa xotirasida (o'zgaruvchida, brauzer xotirasida emas — yangi oynaga
 * nusxalanmaydi), panel oynasi ochuvchisiz (opener = null) va sahifada Cross-Origin-Opener-Policy (hub/server.ts) — panel bu
 * sahifaga qo'l cho'za olmaydi. Sahifa yangilansa, kalit qayta so'raladi. Klinikadan kelgan matn faqat textContent bilan chiqadi.
 *
 * Asosiy yo'l: yangi o'rnatilgan kompyuter o'zi ulanadi va «tasdiqlanmagan» bo'ladi (hub/server.ts, 11-band). «Tasdiqlash va
 * aktivlashtirish» — klinika ekranidagi kompyuter kodini kiritasiz (kod yozuvnikiga mos kelishi kerak), shu bosishda litsenziya ham
 * beriladi. «Yangi mijoz» — zaxira yo'l (kompyuter o'zi ulana olmasa): ulanish kodi BIR MARTA ko'rsatiladi (hubda faqat xeshi).
 *
 * Kirish — har kishining o'z logini va paroli (hub/team.ts): kalit sahifa xotirasida, 12 soat. Login bo'sh qoldirilsa — parol
 * o'rniga asosiy kalit (HUB_ADMIN_KEY). Asoschi hammasini ko'radi; o'rnatuvchi — o'zi ochgan mijozlarni, kartani faqat o'qiydi.
 */
import { ADMIN_APP_JS } from './adminApp.ts';
import { ADMIN_DRAWER_JS } from './adminDrawer.ts';
import { ADMIN_PLAN_JS } from './adminPlan.ts';
import { ADMIN_COMMANDS_JS } from './adminCommands.ts';
import { ADMIN_CSS } from './adminStyle.ts';

const MARKUP = `
<div id="login" class="login">
  <form id="key">
    <div class="brand"><span class="orb" aria-hidden="true"></span>Palantir Hub</div>
    <h1>Boshqaruv markazi</h1>
    <p>Hamma mijozlar — klinikalar va boshqa bizneslar — bitta joyda.</p>
    <label class="f">Login<input id="lg" placeholder="Asosiy kalit bilan — bo'sh qoldiring" autocomplete="username" maxlength="40"></label>
    <label class="f">Parol<input id="k" type="password" autocomplete="current-password" required autofocus></label>
    <button class="btn">Kirish</button>
    <small class="meta">Ish stolidagi «Palantir Hub» yorlig'i asosiy kalitni nusxalaydi — Ctrl+V va Enter.</small>
  </form>
</div>

<div id="app" hidden>
  <header class="top">
    <div class="brand"><span class="orb" aria-hidden="true"></span>Palantir Hub <small>boshqaruv</small></div>
    <nav aria-label="Bo'limlar">
      <button data-view="overview">Umumiy</button>
      <button data-view="clients">Mijozlar</button>
      <button data-view="help">Yordam <span id="helpBadge" class="badge num" hidden></span></button>
      <button data-view="team" id="navTeam" hidden>Jamoa</button>
      <button data-view="audit" id="navAudit" hidden>Jurnal</button>
    </nav>
    <div class="me"><b id="meName"></b><span class="role" id="meRole"></span>
      <button class="btn ghost sm" id="pw">Parolim</button><button class="btn ghost sm" id="out">Chiqish</button></div>
  </header>

  <main>
    <form id="pwf" class="card sect row" hidden>
      <input id="pw1" type="password" placeholder="Joriy parol" autocomplete="current-password" required style="flex:1 1 200px;width:auto">
      <input id="pw2" type="password" placeholder="Yangi parol (10+ belgi)" autocomplete="new-password" minlength="10" required style="flex:1 1 200px;width:auto">
      <button class="btn">Almashtirish</button>
    </form>

    <section id="v-overview">
      <div class="head"><div><h1>Umumiy</h1><p>Mijozlar holati hozir va so'nggi 14 kunda. Raqamni bosing — ro'yxat ochiladi.</p></div></div>
      <div class="kpis" id="kpis"></div>
      <div class="grid2">
        <div class="card" id="chartCard">
          <header><h2>Aloqadagi mijozlar — 14 kun</h2></header>
          <div class="legend"><span><i style="background:var(--accent)"></i>aloqada</span><span><i style="background:var(--faint)"></i>jami</span><span><i style="background:var(--bad);opacity:.5"></i>muammoli</span></div>
          <div class="chart" id="chart"></div>
        </div>
        <div class="card">
          <header><h2>Diqqat talab qiladi</h2><span class="sub" id="attentionCount"></span></header>
          <ul class="alerts" id="attention"></ul>
          <button class="more" id="attentionMore" type="button" hidden></button>
        </div>
      </div>
      <div class="grid2">
        <div class="card"><header><h2>Biznes turlari</h2></header><div class="bars" id="kinds"></div></div>
        <div class="card"><header><h2>Nashrlar</h2><span class="sub">klinikalar kechasi o'zi yangilanadi</span></header><div class="bars" id="versions"></div></div>
      </div>
      <div class="card" id="payCard">
        <header><h2>To'lovlar</h2><span class="sub">mijoz kartasidagi tarif va to'langan sana bo'yicha</span></header>
        <ul class="alerts" id="payList"></ul>
        <div class="money" id="money"></div>
      </div>
    </section>

    <section id="v-clients" hidden>
      <div class="head">
        <div><h1>Mijozlar</h1><p id="clientCount"></p></div>
        <div id="newBox" class="row">
          <form id="claim" class="row"><input id="cm" placeholder="O'zim o'rnatgan: XXXX-XXXX-XXXX-XXXX" maxlength="24" required style="width:16rem"><button class="btn ghost">Biriktirish</button></form>
          <form id="new" class="row"><input id="nm" placeholder="Kompyuter o'zi ulana olmasa: nomi" maxlength="80" required style="width:16rem"><button class="btn">Yangi mijoz</button></form>
        </div>
      </div>
      <div id="code" class="secret" hidden></div>
      <div class="tools"><input id="q" type="search" placeholder="Qidirish: nomi, egasi, telefon, shahar, kompyuter kodi" aria-label="Qidirish"><select id="stateSel" aria-label="Holat"></select></div>
      <div class="chips" id="kindChips"></div>
      <div class="card table">
        <table>
          <thead><tr><th></th><th>Mijoz</th><th>Turi</th><th>Shahar</th><th>Aloqa</th><th>Nashr</th><th>Litsenziya</th><th>To'lov</th><th>Diqqat</th></tr></thead>
          <tbody id="rows"></tbody>
        </table>
        <div id="noRows" class="empty" hidden></div>
      </div>
    </section>

    <section id="v-help" hidden>
      <div class="head"><div><h1>Yordam so'rovlari</h1><p id="helpSub"></p></div></div>
      <ul class="list" id="helpList"></ul>
    </section>

    <section id="v-team" hidden>
      <div class="head"><div><h1>Jamoa</h1><p>Har kishi o'z logini bilan kiradi. O'rnatuvchi faqat o'zi o'rnatgan mijozlarni ko'radi.</p></div></div>
      <form id="addm" class="card sect row" style="margin-bottom:12px">
        <input id="mn" placeholder="Ismi" maxlength="60" required style="flex:1 1 160px;width:auto">
        <input id="ml" placeholder="login" maxlength="32" pattern="[a-zA-Z0-9._\\-]{3,32}" required style="flex:1 1 140px;width:auto">
        <select id="mr" style="width:auto"><option value="installer">o'rnatuvchi</option><option value="founder">asoschi</option></select>
        <button class="btn">Qo'shish</button>
      </form>
      <div id="mcode" class="secret" hidden></div>
      <ul class="list" id="members"></ul>
    </section>

    <section id="v-audit" hidden>
      <div class="head"><div><h1>Jurnal</h1><p>Kim, qachon, qaysi mijozga nima qildi.</p></div></div>
      <div class="card"><ul class="log" id="log"></ul></div>
    </section>
  </main>
</div>

<div id="scrim" class="scrim" hidden></div>
<aside id="drawer" class="drawer" hidden aria-labelledby="dTitle" role="dialog">
  <header><div><h2 id="dTitle"></h2><p id="dSub"></p></div><button class="x" id="drawerClose" aria-label="Yopish">×</button></header>
  <div class="body" id="dBody"></div>
  <div id="dSecret" class="secret" hidden style="margin:0 20px 20px"></div>
</aside>
<div id="toast" class="toast" role="status" hidden></div>
`;

export function adminPage(): string {
  return `<!doctype html><html lang="uz"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Palantir Hub</title><link rel="icon" href="data:,"><style>${ADMIN_CSS}</style>${MARKUP}<script>${ADMIN_APP_JS}${ADMIN_DRAWER_JS}${ADMIN_PLAN_JS}${ADMIN_COMMANDS_JS}</script>`;
}
