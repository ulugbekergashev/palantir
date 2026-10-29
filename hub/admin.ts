/**
 * Sotuvchining sahifasi (/admin): klinikalar — aloqadami, nashri — va «Panelni ochish». Tugma hubdan kirish kalitini so'raydi
 * (POST /admin/clinics/<klinika>/panel, admin kaliti bilan), klinika uni egasi ruxsat bergan bo'lsa beradi, panel yangi oynada
 * kalit bilan ochiladi (#kirish=…, src/lib/telegramLaunch.ts). Sahifada sir yo'q. Klinika nomlari faqat textContent bilan chiqadi.
 *
 * Klinika panellari (/c/…) shu manzilda turadi va ularni klinika kompyuteri beradi — buzilgan klinika o'z sahifasidan admin kalitini
 * o'qishga urinishi mumkin. Shuning uchun: kalit faqat sahifa xotirasida (o'zgaruvchida, brauzer xotirasida emas — yangi oynaga
 * nusxalanmaydi), panel oynasi ochuvchisiz (opener = null) va sahifada Cross-Origin-Opener-Policy (hub/server.ts) — panel bu
 * sahifaga qo'l cho'za olmaydi. Sahifa yangilansa, kalit qayta so'raladi.
 *
 * O'zi ulangan kompyuter «tasdiqlanmagan» (hub/server.ts, 11-band): «Tasdiqlash» — egasi panelidagi kompyuter kodini kiritasiz (kod
 * yozuvnikiga mos kelishi kerak); bir xil kodli bir nechta yozuv bo'lsa ogohlantiriladi. Soxta yozuv — «O'chirish».
 */

export function adminPage(): string {
  return `<!doctype html><html lang="uz"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Palantir klinikalari</title>
<style>
:root{--bg:#f6f7f9;--card:#fff;--ink:#13161d;--muted:#5b6170;--line:#e3e6eb;--accent:#3346d3;--ok:#12a150;--off:#9aa1ad}
@media (prefers-color-scheme:dark){:root{--bg:#0b0c10;--card:#14161c;--ink:#f2f0ea;--muted:#8a909c;--line:#262a33;--accent:#8fa0ff;--ok:#34d399;--off:#4b5160}}
*{box-sizing:border-box}
[hidden]{display:none!important}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:46rem;margin:0 auto;padding:28px 16px 48px}
h1{font-size:1.35rem;margin:0 0 4px}
.lead{color:var(--muted);margin:0 0 18px}
form,li{background:var(--card);border:1px solid var(--line);border-radius:14px}
form{display:flex;gap:8px;padding:12px}
input{flex:1;min-width:0;padding:9px 11px;border:1px solid var(--line);border-radius:10px;background:transparent;color:inherit;font:inherit}
button{padding:9px 14px;border:0;border-radius:10px;background:var(--accent);color:#fff;font:inherit;font-weight:600;cursor:pointer;white-space:nowrap}
@media (prefers-color-scheme:dark){button{color:#0b0c10}}
button:disabled{opacity:.4;cursor:default}
ul{list-style:none;margin:0;padding:0;display:grid;gap:10px}
li{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px;padding:12px 14px}
.who{flex:1;min-width:11rem}.who b{display:block}.who small{color:var(--muted)}
.dot{width:9px;height:9px;border-radius:50%;background:var(--off);flex:none}.dot.on{background:var(--ok)}
.pick{display:flex;flex-wrap:wrap;gap:6px;width:100%}
.pick button,button.second{background:transparent;color:var(--accent);border:1px solid var(--line)}
#msg{min-height:1.4em;margin:12px 0;color:var(--muted)}
</style>
<main>
<h1>Palantir klinikalari</h1>
<p class="lead">Klinika paneliga Palantir jamoasi sifatida kirish — egasining roziligi bilan: doimiy ruxsat bermagan bo'lsa, Telegram'da so'raladi (2 daqiqagacha). Har kirish egasiga aytiladi.</p>
<form id="key" hidden><input id="k" type="password" placeholder="Admin kaliti (HUB_ADMIN_KEY)" autocomplete="off" required><button>Kirish</button></form>
<div id="msg" role="status"></div>
<ul id="list"></ul>
</main>
<script>
const $ = id => document.getElementById(id);
let adminKey = null;
const store = { get: () => adminKey, set: v => { adminKey = v || null; } };
const say = t => { $('msg').textContent = t; };
const api = (path, body) => fetch(path, {
  method: body ? 'POST' : 'GET',
  headers: { authorization: 'Bearer ' + store.get(), 'content-type': 'application/json' },
  body: body ? JSON.stringify(body) : undefined,
});
const ago = iso => {
  if (!iso) return "hali ko'rinmagan";
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  return m < 60 ? m + ' daqiqa oldin' : m < 1440 ? Math.round(m / 60) + ' soat oldin' : Math.round(m / 1440) + ' kun oldin';
};
const el = (tag, cls, text) => { const x = document.createElement(tag); if (cls) x.className = cls; if (text) x.textContent = text; return x; };

async function load() {
  const r = await api('/admin/clinics').catch(() => null);
  if (!r) return say("Hub bilan aloqa yo'q");
  if (r.status === 401) {
    store.set(null);
    $('list').replaceChildren();
    $('key').hidden = false;
    return say("Admin kaliti noto'g'ri");
  }
  if (!r.ok) return say('Xato: ' + r.status);
  $('key').hidden = true;
  const { clinics } = await r.json();
  // Bir xil kompyuter kodi bir nechta yozuvda — takror o'rnatish yoki kimdir kodni bilib soxta yozuv ochgan
  const seen = {};
  for (const c of clinics) if (c.machineId) seen[c.machineId] = (seen[c.machineId] || 0) + 1;
  $('list').replaceChildren(...clinics.map(c => row(c, c.machineId ? seen[c.machineId] : 1)));
  say(clinics.length ? '' : "Hali klinika yo'q");
}

function row(c, twins) {
  const li = el('li');
  const dot = el('span', 'dot' + (c.online ? ' on' : ''));
  dot.title = c.online ? 'aloqada' : 'aloqada emas';
  const who = el('div', 'who');
  const lic = c.status && c.status.license;
  const licText = !lic ? '' : lic.activated ? ' · litsenziya bor' : ' · litsenziyasiz (' + lic.daysLeft + ' kun qoldi)';
  // O'zi ulangan kompyuter: nomi — kompyuter nomi, yonida ulash ustasida yozilgan klinika nomi
  const label = c.status && c.status.label ? ' — ' + c.status.label : '';
  const fresh = c.approved ? '' : 'tasdiqlanmagan · ';
  const twin = twins > 1 ? ' · ⚠ bu kod ' + twins + ' ta yozuvda' : '';
  who.append(el('b', '', c.name + label), el('small', '', fresh + (c.online ? 'aloqada' : 'aloqada emas · ' + ago(c.seenAt)) + (c.status && c.status.version ? ' · v' + c.status.version : '') + licText + (c.machineId ? ' · ' + c.machineId : '') + twin));
  li.append(dot, who);
  if (!c.approved) {
    const ok = el('button', '', 'Tasdiqlash');
    ok.onclick = () => approve(c, ok);
    const del = el('button', 'second', "O'chirish");
    del.onclick = () => remove(c, del);
    li.append(ok, del);
    return li;
  }
  const btn = el('button', '', 'Panelni ochish');
  btn.disabled = !c.online;
  btn.onclick = () => enter(c, li, btn);
  if (lic && !lic.activated) {
    const act = el('button', 'second', 'Aktivlashtirish');
    act.disabled = !c.online;
    act.onclick = () => license(c, act);
    li.append(act);
  }
  li.append(btn);
  return li;
}

async function approve(c, btn) {
  const code = prompt("«" + c.name + "» egasidan panelidagi kompyuter kodini so'rang (Litsenziya oynasi) va kiriting — XXXX-XXXX-XXXX-XXXX:");
  if (!code) return;
  btn.disabled = true;
  try {
    const r = await api('/admin/clinics/' + c.id + '/approve', { machineId: code.trim() });
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) return load();
    say(r.ok ? '«' + c.name + '» tasdiqlandi' : (j.error || 'Xato: ' + r.status));
    if (r.ok) load();
  } catch {
    say("Hub bilan aloqa yo'q");
  } finally {
    btn.disabled = false;
  }
}

async function remove(c, btn) {
  if (!confirm("«" + c.name + "» yozuvi o'chirilsinmi? (tasdiqlanmagan — soxta yoki takror yozuv)")) return;
  btn.disabled = true;
  try {
    const r = await api('/admin/clinics/' + c.id + '/delete', {});
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) return load();
    say(r.ok ? "O'chirildi" : (j.error || 'Xato: ' + r.status));
    if (r.ok) load();
  } catch {
    say("Hub bilan aloqa yo'q");
  } finally {
    btn.disabled = false;
  }
}

async function license(c, btn) {
  btn.disabled = true;
  say('«' + c.name + "» uchun litsenziya berilmoqda…");
  try {
    const r = await api('/admin/clinics/' + c.id + '/license', {});
    const j = await r.json().catch(() => ({}));
    if (r.status === 401) return load();
    say(r.ok ? '«' + c.name + '» aktivlashtirildi' : (j.error || 'Xato: ' + r.status));
    if (r.ok) load();
  } catch {
    say("Hub bilan aloqa yo'q");
  } finally {
    btn.disabled = false;
  }
}

async function enter(c, li, btn, business) {
  // Oyna bosish paytida ochiladi (javobdan keyin ochilsa brauzer to'sib qo'yadi); panel bu sahifaga qaytib murojaat qila olmasin
  const tab = window.open('', '_blank');
  if (tab) tab.opener = null;
  btn.disabled = true;
  say('«' + c.name + "» egasidan ruxsat so'ralmoqda (Telegram'da, 2 daqiqagacha)…");
  try {
    const r = await api('/admin/clinics/' + c.id + '/panel', business ? { business } : {});
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.token) {
      if (tab) tab.location.href = '/c/' + c.id + '/#kirish=' + encodeURIComponent(j.token);
      return say('');
    }
    if (tab) tab.close();
    if (r.status === 401) return load();
    if (r.status === 409 && Array.isArray(j.businesses)) return choose(c, li, btn, j.businesses);
    say(j.error || 'Xato: ' + r.status);
  } catch {
    if (tab) tab.close();
    say("Hub bilan aloqa yo'q");
  } finally {
    btn.disabled = false;
  }
}

function choose(c, li, btn, list) {
  li.querySelector('.pick')?.remove();
  const box = el('div', 'pick');
  for (const b of list) {
    const x = el('button', '', b.name);
    x.onclick = () => { box.remove(); enter(c, li, btn, b.id); };
    box.append(x);
  }
  li.append(box);
  say('Bu kompyuterda bir nechta biznes — qaysi biri?');
}

$('key').onsubmit = e => { e.preventDefault(); store.set($('k').value.trim()); $('k').value = ''; load(); };
if (store.get()) load(); else { $('key').hidden = false; }
setInterval(() => { if (store.get() && document.visibilityState === 'visible' && !document.querySelector('.pick')) load(); }, 30000);
</script>`;
}
