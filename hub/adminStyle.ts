/** Boshqaruv markazi (/admin) ko'rinishi — admin.ts sahifasiga qo'shiladi. Tashqi shrift va fayl yo'q: sahifa bitta javobda keladi */
export const ADMIN_CSS = String.raw`
:root{--bg:#f4f5f7;--panel:#fff;--panel2:#f8f9fb;--ink:#14161c;--muted:#5d6472;--faint:#8b919d;--line:#e2e5ea;--accent:#c96a0a;--accent-ink:#fff;
--accent-soft:rgba(201,106,10,.1);--ok:#0f9d58;--ok-soft:rgba(15,157,88,.12);--bad:#d93a3a;--bad-soft:rgba(217,58,58,.1);--warn:#b7791f;--warn-soft:rgba(183,121,31,.12);
--shadow:0 1px 2px rgba(16,18,24,.05),0 4px 16px rgba(16,18,24,.05);color-scheme:light}
@media (prefers-color-scheme:dark){:root{--bg:#0a0b0e;--panel:#121419;--panel2:#171a20;--ink:#eeece6;--muted:#9aa0ab;--faint:#6b717c;--line:#23262e;--accent:#f0a24b;
--accent-ink:#1a1206;--accent-soft:rgba(240,162,75,.12);--ok:#3ccf8e;--ok-soft:rgba(60,207,142,.12);--bad:#f26b6b;--bad-soft:rgba(242,107,107,.12);--warn:#e8b04b;
--warn-soft:rgba(232,176,75,.13);--shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.25);color-scheme:dark}}
*{box-sizing:border-box}
[hidden]{display:none!important}
html,body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
button,input,select,textarea{font:inherit;color:inherit}
button{cursor:pointer}
.num{font-variant-numeric:tabular-nums}

/* Kirish */
.login{min-height:100vh;display:grid;place-items:center;padding:24px 16px}
.login form{width:100%;max-width:360px;display:grid;gap:12px;padding:28px;border:1px solid var(--line);border-radius:18px;background:var(--panel);box-shadow:var(--shadow)}
.login h1{margin:0;font-size:20px;letter-spacing:-.01em}
.login p{margin:0 0 6px;color:var(--muted)}

/* Ramka */
.top{position:sticky;top:0;z-index:20;display:flex;align-items:center;gap:18px;padding:0 20px;height:60px;background:color-mix(in srgb,var(--bg) 82%,transparent);
backdrop-filter:blur(12px);border-bottom:1px solid var(--line)}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;letter-spacing:-.01em;white-space:nowrap}
.orb{width:22px;height:22px;border-radius:50%;background:radial-gradient(circle at 38% 34%,#ffe2b0 0,#f0a24b 30%,#8a4a10 68%,#1d1006 100%);box-shadow:0 0 14px rgba(240,162,75,.45)}
.brand small{font-weight:500;color:var(--faint)}
nav{display:flex;gap:2px;overflow-x:auto;scrollbar-width:none;flex:1;min-width:0}
nav button{position:relative;display:flex;align-items:center;gap:6px;padding:8px 12px;border:0;border-radius:10px;background:none;color:var(--muted);font-weight:600;white-space:nowrap}
nav button:hover{color:var(--ink);background:var(--panel2)}
nav button[aria-current=page]{color:var(--ink);background:var(--panel)}
nav button[aria-current=page]::after{content:"";position:absolute;left:12px;right:12px;bottom:-11px;height:2px;border-radius:2px;background:var(--accent)}
.badge{min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:var(--bad);color:#fff;font-size:11px;line-height:18px;text-align:center}
.me{display:flex;align-items:center;gap:8px;white-space:nowrap;color:var(--muted)}
.me b{color:var(--ink);font-weight:600}
main{max-width:1240px;margin:0 auto;padding:24px 20px 64px}
.head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:12px;margin:0 0 18px}
.head h1{margin:0;font-size:24px;letter-spacing:-.02em}
.head p{margin:2px 0 0;color:var(--muted)}

/* Tugmalar va maydonlar */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;padding:8px 14px;border:1px solid transparent;border-radius:10px;background:var(--accent);
color:var(--accent-ink);font-weight:600;white-space:nowrap;transition:filter .15s,background .15s}
.btn:hover{filter:brightness(1.07)}
.btn:disabled{opacity:.45;cursor:default;filter:none}
.btn.ghost{background:transparent;color:var(--ink);border-color:var(--line)}
.btn.ghost:hover{background:var(--panel2)}
.btn.danger{background:transparent;color:var(--bad);border-color:color-mix(in srgb,var(--bad) 35%,var(--line))}
.btn.sm{padding:5px 10px;font-size:13px;border-radius:8px}
input,select,textarea{width:100%;min-width:0;padding:9px 11px;border:1px solid var(--line);border-radius:10px;background:var(--panel);outline:none}
input:focus,select:focus,textarea:focus{border-color:var(--accent);box-shadow:0 0 0 3px var(--accent-soft)}
textarea{resize:vertical;min-height:4.5em}
label.f{display:grid;gap:5px;font-size:12px;font-weight:600;color:var(--muted)}
.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}

/* Kartalar */
.card{background:var(--panel);border:1px solid var(--line);border-radius:16px;box-shadow:var(--shadow)}
.card>h2,.card>header h2{margin:0;font-size:14px;font-weight:700}
.card>header{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:16px 18px 0}
.card .sub{color:var(--faint);font-size:12px;font-weight:500}
.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:12px;margin:0 0 16px}
.kpi{padding:16px 18px;text-align:left;border:1px solid var(--line);border-radius:16px;background:var(--panel);box-shadow:var(--shadow);cursor:pointer;transition:border-color .15s,transform .15s}
.kpi:hover{border-color:color-mix(in srgb,var(--accent) 45%,var(--line));transform:translateY(-1px)}
.kpi span{display:block;color:var(--muted);font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.04em}
.kpi b{display:block;margin:6px 0 2px;font-size:28px;line-height:1.1;letter-spacing:-.02em}
.kpi small{color:var(--faint)}
.kpi.bad b{color:var(--bad)}.kpi.warn b{color:var(--warn)}.kpi.ok b{color:var(--ok)}
.grid2{display:grid;grid-template-columns:minmax(0,1.6fr) minmax(0,1fr);gap:12px;margin:0 0 12px;align-items:start}
@media (max-width:900px){.grid2{grid-template-columns:1fr}}
.chart{padding:8px 14px 14px}
.chart svg{display:block;width:100%;height:190px}
.chart .axis{stroke:var(--line)}
.chart .lbl{fill:var(--faint);font-size:10px}
.legend{display:flex;gap:14px;padding:12px 18px 0;color:var(--muted);font-size:12px}
.legend i{display:inline-block;width:10px;height:3px;border-radius:2px;margin-right:6px;vertical-align:middle}
.empty{padding:28px 18px;color:var(--faint);text-align:center}

/* Diqqat ro'yxati */
.alerts{list-style:none;margin:0;padding:8px}
.alerts li{display:flex;gap:10px;align-items:flex-start;padding:10px;border-radius:12px;cursor:pointer}
.alerts li:hover{background:var(--panel2)}
.more{display:block;margin:0 8px 10px;padding:8px 10px;border:0;border-radius:10px;background:none;color:var(--accent);font-weight:600;text-align:left}
.more:hover{background:var(--panel2)}
.alerts .what{flex:1;min-width:0}
.alerts .what b{display:block;font-weight:600}
.alerts .what small{display:block;color:var(--muted);overflow-wrap:anywhere}
.lvl{flex:none;width:8px;height:8px;margin-top:6px;border-radius:50%}
.lvl.high{background:var(--bad);box-shadow:0 0 0 4px var(--bad-soft)}.lvl.mid{background:var(--warn);box-shadow:0 0 0 4px var(--warn-soft)}.lvl.low{background:var(--faint)}
.bars{display:grid;gap:10px;padding:16px 18px 18px}
.bar{display:grid;grid-template-columns:minmax(90px,140px) 1fr 34px;gap:10px;align-items:center;font-size:13px}
.bar .track{height:8px;border-radius:4px;background:var(--panel2);overflow:hidden}
.bar .fill{height:100%;border-radius:4px;background:var(--accent)}
.bar .fill.ok{background:var(--ok)}.bar .fill.old{background:var(--faint)}
.bar b{text-align:right;font-weight:600}
.money{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--line);border-top:1px solid var(--line);border-radius:0 0 16px 16px;overflow:hidden;margin-top:4px}
.money div{padding:12px 14px;background:var(--panel)}
.money span{display:block;color:var(--muted);font-size:12px}
.money b{font-size:15px}

/* Mijozlar jadvali */
.tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 12px}
.tools input{flex:1 1 220px;width:auto}
.tools select{width:auto}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 12px}
.chip{padding:6px 12px;border:1px solid var(--line);border-radius:999px;background:var(--panel);color:var(--muted);font-weight:600;font-size:13px}
.chip[aria-pressed=true]{background:var(--accent-soft);border-color:color-mix(in srgb,var(--accent) 40%,var(--line));color:var(--ink)}
.chip small{margin-left:4px;color:var(--faint)}
.table{overflow:hidden}
table{width:100%;border-collapse:collapse}
th{padding:11px 14px;text-align:left;font-size:12px;font-weight:600;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;border-bottom:1px solid var(--line);background:var(--panel2);white-space:nowrap}
td{padding:12px 14px;border-bottom:1px solid var(--line);vertical-align:middle}
tbody tr{cursor:pointer;transition:background .12s}
tbody tr:hover{background:var(--panel2)}
tbody tr:last-child td{border-bottom:0}
td .nm{font-weight:600}
td small{display:block;color:var(--faint);font-size:12px}
.dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--faint)}
.dot.on{background:var(--ok);box-shadow:0 0 0 4px var(--ok-soft)}.dot.off,.dot.bad{background:var(--bad)}.dot.bad{box-shadow:0 0 0 4px var(--bad-soft)}.dot.new{background:var(--warn)}
.pill{display:inline-block;padding:2px 8px;border-radius:999px;font-size:12px;font-weight:600;white-space:nowrap;background:var(--panel2);color:var(--muted)}
.pill.ok{background:var(--ok-soft);color:var(--ok)}.pill.bad{background:var(--bad-soft);color:var(--bad)}.pill.warn{background:var(--warn-soft);color:var(--warn)}
@media (max-width:820px){thead{display:none}table,tbody{display:block}
tr{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;padding:14px 16px;border-bottom:1px solid var(--line)}
td{display:inline-flex;align-items:center;gap:5px;padding:0;border:0;font-size:13px}
td:nth-child(2){flex:1 1 calc(100% - 30px)}
td[data-l]:not([data-l=""])::before{content:attr(data-l);color:var(--faint);font-size:12px}}

/* Mijoz oynasi */
.scrim{position:fixed;inset:0;z-index:40;background:rgba(5,6,8,.45);backdrop-filter:blur(2px)}
.drawer{position:fixed;top:0;right:0;bottom:0;z-index:41;width:min(560px,100%);display:flex;flex-direction:column;background:var(--bg);border-left:1px solid var(--line);
box-shadow:-12px 0 40px rgba(0,0,0,.25);animation:slide .18s ease-out}
@keyframes slide{from{transform:translateX(24px);opacity:0}}
@media (prefers-reduced-motion:reduce){.drawer{animation:none}}
.drawer>header{display:flex;gap:12px;align-items:flex-start;padding:18px 20px;border-bottom:1px solid var(--line);background:var(--panel)}
.drawer>header h2{margin:0;font-size:18px;letter-spacing:-.01em;overflow-wrap:anywhere}
.drawer>header p{margin:2px 0 0;color:var(--muted)}
.drawer .x{margin-left:auto;flex:none;width:34px;height:34px;border:1px solid var(--line);border-radius:10px;background:var(--panel);font-size:18px;line-height:1}
.drawer .body{flex:1;overflow:auto;padding:16px 20px 32px;display:grid;gap:14px;align-content:start}
.sect{padding:14px 16px}
.sect h3{margin:0 0 10px;font-size:13px;font-weight:700;color:var(--muted);text-transform:uppercase;letter-spacing:.04em}
.facts{display:grid;grid-template-columns:auto 1fr;gap:6px 14px;margin:0}
.facts dt{color:var(--muted)}.facts dd{margin:0;overflow-wrap:anywhere}
.issues{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.issues li{display:flex;gap:8px;align-items:flex-start}
.form{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.form .wide{grid-column:1/-1}
@media (max-width:520px){.form{grid-template-columns:1fr}}
.actions{display:flex;flex-wrap:wrap;gap:8px}
.pick{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}

/* Ro'yxatlar: yordam, jamoa, jurnal */
.list{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.item{padding:14px 16px}
.item .meta{color:var(--faint);font-size:12px}
.item p{margin:8px 0;white-space:pre-wrap;overflow-wrap:anywhere}
.item pre{max-height:20rem;overflow:auto;margin:8px 0;padding:10px;border:1px solid var(--line);border-radius:10px;background:var(--panel2);font:12px/1.4 ui-monospace,Consolas,monospace;white-space:pre-wrap}
.ans{margin-top:8px;padding-left:10px;border-left:3px solid var(--ok)}
.log li{display:flex;gap:10px;align-items:baseline;padding:10px 14px;border-bottom:1px solid var(--line)}
.log li:last-child{border-bottom:0}
.log time{flex:none;color:var(--faint);font-size:12px;min-width:7.5rem}
.secret{display:grid;gap:8px;padding:14px 16px;margin:0 0 12px;border:1px solid var(--accent);border-radius:14px;background:var(--accent-soft)}
.secret code{display:block;padding:8px 10px;border:1px solid var(--line);border-radius:10px;background:var(--panel);font:13px/1.4 ui-monospace,Consolas,monospace;word-break:break-all;user-select:all}
.secret small{color:var(--muted)}
.dim{opacity:.55}
.meta{color:var(--faint);font-size:12px}
.log{list-style:none;margin:0;padding:0}
.toast{position:fixed;left:50%;bottom:20px;z-index:60;max-width:min(560px,calc(100% - 32px));transform:translateX(-50%);padding:11px 16px;border-radius:12px;
background:var(--ink);color:var(--bg);box-shadow:var(--shadow);font-weight:500}
@media (max-width:640px){.top{gap:10px;padding:0 12px}.brand small,.me .role,.me b,#pw{display:none}main{padding:18px 16px 56px}.head h1{font-size:20px}}
`;
