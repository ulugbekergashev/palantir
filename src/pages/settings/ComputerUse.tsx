/**
 * Kompyuterda ishlash: egasi Palantir'ga brauzerda ishlashga ruxsat beradi — saytga kirib ma'lumot topish, forma to'ldirish, fayl yuklab
 * olish, sozlamani o'zgartirish (masalan, Meta Business'dagi nom). Uch holat:
 *   «Mening Chrome'im» (tavsiya) — egasining odatdagi Chrome'ida, u allaqachon kirgan saytlar bilan: hech qayerga qayta kirish shart emas.
 *     Bir marta Chrome'da ulanishni yoqadi (tugma chrome://inspect ni o'zi ochadi), birinchi ishda Chrome «Allow?» so'raydi;
 *   «Alohida brauzer» — Palantir'ning o'z Chrome oynasi; saytlarga «Saytlarga kirish» oynasida bir marta kiriladi;
 *   «O'chiq».
 * Saqlash/yuborish/o'chirishdan oldin Telegram'da so'raydi; pul (bank, to'lov, xarid) kodda yopiq. Tanlash — faqat egasi;
 * .env da o'rnatuvchi sozlagan bo'lsa — faqat ko'rsatiladi.
 */
import { useEffect, useState } from 'react';
import { AppWindow as Chrome, CheckCircle2, Globe, KeyRound, Loader2, MonitorCog, PowerOff, RefreshCw, ShieldCheck } from 'lucide-react';
import { api, type ComputerMode, type ComputerView } from '../../data/api';
import type { Notify } from '../../components/Artifacts';

const POINTS = [
  { icon: Globe, text: "Saytga kiradi, qidiradi, forma to'ldiradi, fayl yuklab oladi — o'z vkladkasida, sizning vkladkalaringizga tegmaydi" },
  { icon: ShieldCheck, text: "Saqlash, yuborish yoki o'chirishdan oldin Telegram'da sizdan so'raydi. Bank, to'lov va xarid — butunlay yopiq" },
  { icon: KeyRound, text: "Parolni AI ko'rmaydi va yozmaydi" },
];

const MODES: { id: ComputerMode; title: string; text: string; icon: typeof Chrome }[] = [
  { id: 'chrome', title: "Mening Chrome'im", text: "Siz kirgan saytlar (Facebook, Google…) bilan — qayta kirish shart emas", icon: Chrome },
  { id: 'browser', title: 'Alohida brauzer', text: "Palantir'ning o'z oynasi — saytlarga unda bir marta kirasiz", icon: MonitorCog },
  { id: 'off', title: "O'chiq", text: "Saytlarda o'zi ishlamaydi, faqat qanday qilishni aytadi", icon: PowerOff },
];

export function ComputerUse({ notify, onChange }: { notify: Notify; onChange?: (v: ComputerView) => void }) {
  const [view, setView] = useState<ComputerView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [url, setUrl] = useState('');
  const [closed, setClosed] = useState<string | null>(null);
  // Xodimga hisob sozlamalari yopiq (403) — xato emas, tushuntiriladi
  useEffect(() => { api.computer().then(setView).catch(e => setClosed((e as Error).message)); }, []);
  if (closed) return <p className="text-[13px] text-[#8a909c]">{closed}</p>;
  if (!view) return <p className="text-[13px] text-[#8a909c]">Yuklanmoqda…</p>;

  const canChange = view.owner && !view.fixed;
  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    try { await fn(); } catch (e) { notify((e as Error).message, true); } finally { setBusy(null); }
  };
  const choose = (mode: ComputerMode) => run(`mode:${mode}`, async () => {
    if (mode === view.mode) return;
    if (view.job && !window.confirm(`Hozir ish bajarilyapti: «${view.job.task}». Almashtirilsa, u to'xtaydi. Davom etilsinmi?`)) return;
    const next = await api.setComputer(mode);
    setView(next);
    onChange?.(next);
    notify(mode === 'off' ? "Kompyuterda ishlash o'chirildi" : mode === 'chrome' ? "Tanlandi: sizning Chrome'ingiz. Endi pastdagi bir martalik ulanishni yoqing" : "Tanlandi: alohida brauzer");
  });
  const refresh = () => run('refresh', async () => setView(await api.computer()));
  const setupChrome = () => run('setup', async () => {
    await api.chromeSetup();
    notify("Chrome'da sozlama sahifasi ochildi — «Allow remote debugging for this browser instance» belgisini qo'ying");
  });
  const login = () => run('login', async () => {
    const target = url.trim();
    if (target && !/^https?:\/\//i.test(target)) throw new Error('Manzil https:// bilan boshlansin');
    const r = await api.computerLogin(target || undefined);
    setView({ ...view, loginOpen: true });
    notify(r.text);
  });
  const closeLogin = () => run('close', async () => {
    await api.closeComputerLogin();
    setView({ ...view, loginOpen: false });
    notify('Kirish oynasi yopildi — kirishlaringiz saqlandi');
  });
  const chrome = view.chrome;

  return (
    <section className="rounded-[22px] border border-glass/[0.07] bg-[#0b0c10] p-5">
      <h3 className="text-[16px] font-semibold text-[#f2f0ea]">Brauzerda ishlash</h3>
      <p className="mt-0.5 text-[13px] leading-snug text-[#8a909c]">Vazifani ovozda yoki yozib ayting — Palantir saytda o'zi bajaradi, natija Telegram'ga keladi.</p>

      <div role="radiogroup" aria-label="Brauzerda ishlash" className="mt-4 grid gap-2.5 sm:grid-cols-3">
        {MODES.map(m => {
          const on = view.mode === m.id;
          return (
            <button key={m.id} type="button" role="radio" aria-checked={on} disabled={!canChange || !!busy} onClick={() => { void choose(m.id); }}
              className={`flex flex-col items-start gap-1.5 rounded-2xl border px-4 py-3.5 text-left transition-colors disabled:cursor-default ${on ? 'border-emerald-400/50 bg-emerald-400/[0.07]' : 'border-glass/[0.07] bg-glass/[0.02] enabled:hover:bg-glass/[0.04]'}`}>
              <span className="flex w-full items-center gap-2 text-[14px] font-semibold text-[#f2f0ea]">
                {busy === `mode:${m.id}` ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <m.icon className={`h-4 w-4 ${on ? 'text-emerald-300' : 'text-[#8a909c]'}`} aria-hidden="true" />}
                {m.title}
                {m.id === 'chrome' && <span className="ml-auto rounded-full bg-[#ff9a3c]/15 px-2 py-0.5 text-[10.5px] font-semibold text-[#ffc58a]">tavsiya</span>}
              </span>
              <span className="text-[12.5px] leading-snug text-[#a3a9b5]">{m.text}</span>
            </button>
          );
        })}
      </div>
      {!canChange && <p className="mt-2 text-[12px] text-[#7d838f]">{view.fixed ? "O'rnatuvchi sozlagan — o'zgartirish uning qo'lida" : "Buni faqat egasi o'zgartiradi"}</p>}

      {view.mode === 'chrome' && chrome && (
        <div className="mt-4 rounded-2xl border border-glass/[0.07] bg-glass/[0.02] p-4">
          {chrome.debugging ? (
            <p className="flex items-start gap-2 text-[13px] leading-snug text-emerald-200">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              {chrome.connected ? "Chrome'ingizga ulangan — vazifa bersangiz bo'ladi." : "Chrome ulanishga tayyor. Birinchi vazifada Chrome «Allow?» deb so'raydi — «Allow» ni bosing (Chrome har ochilganda bir marta)."}
            </p>
          ) : (
            <>
              <p className="text-[13px] font-semibold text-[#f2f0ea]">Bir marta: Chrome'da ulanishni yoqing</p>
              <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-[13px] leading-snug text-[#c3c7d0]">
                <li>Pastdagi tugmani bosing — Chrome'da sozlama sahifasi ochiladi{!chrome.installed && " (Google Chrome o'rnatilmagan bo'lsa — avval o'rnating)"}.</li>
                <li>«Allow remote debugging for this browser instance» belgisini qo'ying.</li>
                <li>«Tekshirish» ni bosing.</li>
              </ol>
              <div className="mt-3 flex flex-wrap gap-2.5">
                {view.owner && (
                  <button type="button" disabled={!!busy} onClick={() => { void setupChrome(); }} className="flex min-h-10 items-center gap-2 rounded-xl bg-[#3fd6c3] px-4 text-[13px] font-semibold text-[#07080b] disabled:opacity-50">
                    {busy === 'setup' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Chrome className="h-4 w-4" aria-hidden="true" />}Chrome'da ochish
                  </button>
                )}
                <button type="button" disabled={!!busy} onClick={() => { void refresh(); }} className="flex min-h-10 items-center gap-2 rounded-xl border border-glass/10 px-4 text-[13px] text-[#d9dbe1] hover:bg-glass/5 disabled:opacity-50">
                  {busy === 'refresh' ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <RefreshCw className="h-4 w-4" aria-hidden="true" />}Tekshirish
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {view.mode !== 'off' && (
        <ul className="mt-4 grid gap-2 sm:grid-cols-3">
          {POINTS.map(p => (
            <li key={p.text} className="flex gap-2.5 rounded-2xl border border-glass/[0.06] bg-glass/[0.02] px-3.5 py-3 text-[12.5px] leading-snug text-[#c3c7d0]">
              <p.icon className="mt-0.5 h-4 w-4 shrink-0 text-[#8a909c]" aria-hidden="true" />{p.text}
            </li>
          ))}
        </ul>
      )}

      {view.job && (
        <p role="status" className="mt-4 rounded-xl bg-[#ff9a3c]/10 px-3.5 py-2.5 text-[13px] text-[#ffd7ad]">
          Hozir bajarilyapti: «{view.job.task}» — {view.job.steps} qadam. To'xtatish: Telegram'da /toxta
        </p>
      )}

      {view.mode === 'browser' && view.owner && (
        <div className="mt-5 border-t border-glass/[0.06] pt-4">
          <h4 className="text-[14px] font-semibold text-[#f2f0ea]">Saytlarga kirish</h4>
          <p className="mt-0.5 text-[13px] leading-snug text-[#8a909c]">Alohida brauzerda saytlarga bir marta o'zingiz kirasiz — Palantir kirishni eslab qoladi.</p>
          {view.loginOpen ? (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <span className="text-[13px] text-emerald-300">Oyna ochiq — kirib bo'lgach yoping</span>
              <button type="button" onClick={() => { void closeLogin(); }} className="flex min-h-10 items-center rounded-xl bg-[#3fd6c3] px-4 text-[13px] font-semibold text-[#07080b]">Kirdim, yopish</button>
            </div>
          ) : (
            <form className="mt-3 flex flex-wrap items-center gap-2.5" onSubmit={e => { e.preventDefault(); void login(); }}>
              <input value={url} onChange={e => setUrl(e.target.value)} placeholder="https://… (ixtiyoriy)" aria-label="Qaysi sayt"
                className="h-10 min-w-0 flex-1 rounded-xl border border-glass/10 bg-glass/[0.03] px-3.5 text-[13px] text-[#f2f0ea] placeholder:text-[#6b717d] focus:border-[#3fd6c3]/50 focus:outline-none sm:max-w-sm" />
              <button type="submit" disabled={busy === 'login' || !!view.job} className="flex min-h-10 items-center gap-2 rounded-xl border border-glass/10 px-4 text-[13px] text-[#d9dbe1] hover:bg-glass/5 disabled:opacity-50">
                {busy === 'login' && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}Oynani ochish
              </button>
            </form>
          )}
        </div>
      )}
      {view.desktop && <p className="mt-4 text-[12px] text-[#7d838f]">Butun ekranda ishlash ham yoqilgan (o'rnatuvchi sozlagan): boshqa dasturlarda ham ishlaydi, har safar Telegram'da tasdiqlaysiz.</p>}
    </section>
  );
}
