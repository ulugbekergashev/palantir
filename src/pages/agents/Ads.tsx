/**
 * Marketing → Targetolog: Meta reklama kampaniyalari. Topshiriq → AI reja → siz tekshirasiz/tuzatasiz → «Ishga tushirish» (pul shu
 * paytdan ketadi). Ishlayotgan kampaniya: sarf, natija, to'xtatish. Kabinet: token va qat'iy limitlar (o'rnatilmasa — hech narsa ishga tushmaydi).
 */
import { useEffect, useState, type FormEvent } from 'react';
import { ImagePlus, Loader2, Pause, Play, Rocket, Sparkles, X } from 'lucide-react';
import type { AdCampaign, AdPlan, AdsView } from '../../types';
import { api } from '../../data/api';
import type { Notify } from '../../components/Artifacts';
import { HUE, Panel, Quiet } from '../../components/agent';
import { hrefOf } from '../../lib/nav';
import { shrink } from './Posts';

type Campaign = AdsView['campaigns'][number];
const ACCENT = HUE.target.a;
const field = 'w-full rounded-xl border border-glass/40 bg-glass/[0.03] px-3.5 py-2.5 text-[14.5px] text-[#f2f0ea] outline-none placeholder:text-[#7d838f] focus:border-glass/60';
const small = 'w-24 rounded-lg border border-glass/40 bg-glass/[0.03] px-2.5 py-1.5 text-[14px] text-[#f2f0ea] outline-none focus:border-glass/60';
const button = 'inline-flex min-h-10 items-center gap-2 rounded-xl px-3.5 text-[13.5px] font-semibold transition-opacity disabled:opacity-40';
const ghost = `${button} border border-glass/10 text-[#c9cbd2] hover:bg-glass/5`;
const spin = <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />;

const STATUS: Record<AdCampaign['status'], { label: string; cls: string }> = {
  proposed: { label: 'Reja — tasdiqingizni kutyapti', cls: 'bg-[#f5b454]/15 text-[#fde2b0]' },
  launching: { label: 'Meta’da yaratilmoqda…', cls: 'bg-[#3fb6ff]/15 text-[#bfe6ff]' },
  active: { label: 'Ishlayapti', cls: 'bg-emerald-400/15 text-[#a7f3d0]' },
  paused: { label: "To'xtatilgan", cls: 'bg-glass/10 text-[#d9dbe1]' },
  finished: { label: 'Tugadi', cls: 'bg-glass/10 text-[#a3a9b5]' },
  failed: { label: 'Yaratilmadi', cls: 'bg-[#f87171]/15 text-[#fecaca]' },
  cancelled: { label: 'Bekor qilingan', cls: 'bg-glass/10 text-[#a3a9b5]' },
};
const DEST: Record<AdPlan['destination'], string> = { instagram: 'Instagram Direct', whatsapp: 'WhatsApp', messenger: 'Messenger', website: 'Sayt' };

export function useAds(notify: Notify, tick: number): [AdsView | null, (v: AdsView) => void] {
  const [view, setView] = useState<AdsView | null>(null);
  useEffect(() => {
    let stale = false;
    api.ads().then(v => { if (!stale) setView(v); }).catch(e => notify((e as Error).message, true));
    return () => { stale = true; };
  }, [tick]); // eslint-disable-line react-hooks/exhaustive-deps
  return [view, setView];
}

function useRun(notify: Notify, setView: (v: AdsView) => void) {
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (what: string, fn: () => Promise<AdsView>, done?: string): Promise<boolean> => {
    setBusy(what);
    try { setView(await fn()); if (done) notify(done); return true; } catch (e) { notify((e as Error).message, true); return false; } finally { setBusy(null); }
  };
  return [busy, run] as const;
}

export function adsStats(v: AdsView | null) {
  const cur = v?.account?.currency ?? '';
  const l = v?.limits;
  return [
    { label: 'Tasdiq kutyapti', value: v ? v.campaigns.filter(c => c.status === 'proposed').length : '—' },
    { label: 'Ishlayapti', value: v ? v.campaigns.filter(c => c.status === 'active').length : '—' },
    { label: 'Bugun sarf', value: v?.spend ? `${v.spend.today} ${cur}` : '—', hint: l?.daily ? `limit ${l.daily} ${cur}` : 'limit yo‘q', tone: v?.spend && l?.daily && v.spend.today >= l.daily * 0.8 ? 'warn' as const : undefined },
    { label: 'Shu oy', value: v?.spend ? `${v.spend.month} ${cur}` : '—', hint: l?.monthly ? `limit ${l.monthly} ${cur}` : undefined },
  ];
}

function AdImage({ refId, className }: { refId: string; className: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null, stale = false;
    api.adsImage(refId).then(b => { if (stale) return; url = URL.createObjectURL(b); setSrc(url); }).catch(() => {});
    return () => { stale = true; if (url) URL.revokeObjectURL(url); };
  }, [refId]);
  return src ? <img src={src} alt="Reklama rasmi" className={`${className} object-cover`} /> : <span className={`${className} block animate-pulse bg-glass/[0.05]`} aria-hidden="true" />;
}

// ─── Reja (tahrir) ────────────────────────────────────────────────────────────

function PlanEditor({ c, view, setView, notify }: { c: Campaign; view: AdsView; setView: (v: AdsView) => void; notify: Notify }) {
  const [plan, setPlan] = useState<AdPlan>(c.plan);
  const [busy, run] = useRun(notify, setView);
  const changed = JSON.stringify(plan) !== JSON.stringify(c.plan);
  const cur = c.currency;
  const set = <K extends keyof AdPlan>(k: K, v: AdPlan[K]) => setPlan(p => ({ ...p, [k]: v }));
  const setAd = (i: number, patch: Partial<AdPlan['ads'][number]>) => setPlan(p => ({ ...p, ads: p.ads.map((a, j) => (j === i ? { ...a, ...patch } : a)) }));
  const upload = async (i: number, f: File) => {
    try { const r = await api.adsUpload(await shrink(f)); setView(r); setAd(i, { image: r.ref }); } catch (e) { notify((e as Error).message, true); }
  };
  const num = (v: string) => (v.trim() === '' ? null : Number(v));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3 text-[13.5px] text-[#c9cbd2]">
        <label className="flex flex-col gap-1">Jami byudjet, {cur}<input type="number" min={1} step="1" value={plan.budget ?? ''} onChange={e => set('budget', num(e.target.value))} className={small} /></label>
        <label className="flex flex-col gap-1">Kun<input type="number" min={1} max={30} value={plan.days} onChange={e => set('days', Number(e.target.value) || 1)} className={small} /></label>
        <label className="flex flex-col gap-1">Yosh<span className="flex items-center gap-1"><input type="number" min={18} max={65} value={plan.ageMin} onChange={e => set('ageMin', Number(e.target.value) || 18)} className="w-16 rounded-lg border border-glass/40 bg-glass/[0.03] px-2 py-1.5 text-[#f2f0ea]" />–<input type="number" min={18} max={65} value={plan.ageMax} onChange={e => set('ageMax', Number(e.target.value) || 65)} className="w-16 rounded-lg border border-glass/40 bg-glass/[0.03] px-2 py-1.5 text-[#f2f0ea]" /></span></label>
        <label className="flex flex-col gap-1">Qayerga yozishadi
          <select value={plan.destination} onChange={e => set('destination', e.target.value as AdPlan['destination'])} className="rounded-lg border border-glass/10 bg-[#0b0c10] px-2 py-1.5 text-[#f2f0ea]">
            {(Object.keys(DEST) as AdPlan['destination'][]).map(d => <option key={d} value={d}>{DEST[d]}</option>)}
          </select>
        </label>
        {plan.destination === 'website' && <label className="flex min-w-60 flex-1 flex-col gap-1">Sayt<input value={plan.link ?? ''} onChange={e => set('link', e.target.value || null)} placeholder="https://…" className={field} /></label>}
        {plan.budget ? <span className="pb-1.5 text-[12.5px] text-[#8a909c]">≈ {Math.round((plan.budget / plan.days) * 100) / 100} {cur}/kun</span> : null}
      </div>
      <ul className="space-y-3">
        {plan.ads.map((a, i) => (
          <li key={i} className="flex flex-col gap-3 rounded-xl border border-glass/[0.06] p-3 sm:flex-row">
            <div className="space-y-2 sm:w-36">
              {a.image ? <AdImage refId={a.image} className="aspect-square w-full rounded-lg" /> : <span className="flex aspect-square w-full items-center justify-center rounded-lg border border-dashed border-glass/15 text-[12px] text-[#7d838f]">rasm yo'q</span>}
              <select aria-label={`${i + 1}-reklama rasmi`} value={a.image} onChange={e => setAd(i, { image: e.target.value })} className="w-full rounded-lg border border-glass/10 bg-[#0b0c10] px-2 py-1 text-[12.5px] text-[#f2f0ea]">
                <option value="">— rasm yoki video —</option>
                {view.images.map(img => <option key={img.ref} value={img.ref}>{img.label.slice(0, 40)}</option>)}
              </select>
              <label className="flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-glass/10 py-1.5 text-[12.5px] text-[#c9cbd2] hover:bg-glass/5">
                <ImagePlus className="h-3.5 w-3.5" aria-hidden="true" /> Yuklash
                <input type="file" accept="image/*" className="sr-only" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void upload(i, f); }} />
              </label>
            </div>
            <div className="min-w-0 flex-1 space-y-2">
              <input aria-label={`${i + 1}-reklama sarlavhasi`} value={a.headline ?? ''} onChange={e => setAd(i, { headline: e.target.value || null })} maxLength={80} placeholder="Sarlavha (25 belgigacha)" className={field} />
              <textarea aria-label={`${i + 1}-reklama matni`} value={a.text} onChange={e => setAd(i, { text: e.target.value })} rows={4} maxLength={2000} className={field} />
            </div>
          </li>
        ))}
      </ul>
      {changed && (
        <div className="flex gap-2">
          <button type="button" disabled={!!busy} onClick={() => void run('save', () => api.adsEdit(c.id, plan), "Reja saqlandi — Telegram'ga yangi karta yuborildi")} className={`${button} text-[#07080b]`} style={{ background: ACCENT }}>{busy === 'save' && spin} Rejani saqlash</button>
          <button type="button" onClick={() => setPlan(c.plan)} className={ghost}>Qaytarish</button>
        </div>
      )}
    </div>
  );
}

// ─── Kampaniya kartasi ────────────────────────────────────────────────────────

function CampaignCard({ c, view, setView, notify }: { c: Campaign; view: AdsView; setView: (v: AdsView) => void; notify: Notify }) {
  const [busy, run] = useRun(notify, setView);
  const s = STATUS[c.status], cur = c.currency, budget = c.plan.budget ?? 0;
  const pct = budget ? Math.min(100, Math.round((c.spent / budget) * 100)) : 0;
  const launch = () => {
    if (!window.confirm(`Meta'da ishga tushiriladi: ${budget} ${cur} jami, ${c.plan.days} kun. Shu paytdan pul sarflana boshlaydi. Davom etilsinmi?`)) return;
    void run('launch', () => api.adsLaunch(c.id), 'Ishga tushdi — Meta tekshiruvidan keyin ko‘rsatiladi');
  };
  return (
    <li className="space-y-3 rounded-2xl border border-glass/[0.06] bg-glass/[0.02] p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[16px] font-semibold text-[#f2f0ea]">{c.plan.name}</span>
        <span className={`rounded-full px-2.5 py-0.5 text-[12px] font-semibold ${s.cls}`}>{s.label}</span>
        <span className="ml-auto text-[12px] tabular-nums text-[#7d838f]">{new Date(c.launchedAt ?? c.createdAt).toLocaleDateString('uz', { day: '2-digit', month: '2-digit' })}{c.endsAt ? ` → ${new Date(c.endsAt).toLocaleDateString('uz', { day: '2-digit', month: '2-digit' })}` : ''}</span>
      </div>
      <ul className="space-y-0.5 text-[13.5px] text-[#c9cbd2]">{c.summary.map(line => <li key={line}>{line}</li>)}</ul>
      {c.plan.notes.length > 0 && c.status === 'proposed' && <p className="whitespace-pre-line rounded-xl bg-glass/[0.04] p-3 text-[13px] text-[#c9cbd2]">{c.plan.notes.join('\n')}</p>}
      {c.status === 'proposed' && <PlanEditor c={c} view={view} setView={setView} notify={notify} />}
      {(c.status === 'active' || c.status === 'paused' || c.status === 'finished') && (
        <div className="space-y-1.5">
          <div className="h-2 overflow-hidden rounded-full bg-glass/[0.06]" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Byudjet sarfi">
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: ACCENT }} />
          </div>
          <p className="text-[13px] tabular-nums text-[#c9cbd2]">Sarf: {c.spent} / {budget} {cur} · {c.plan.destination === 'website' ? 'bosishlar' : 'yozishmalar'}: <b className="text-[#f2f0ea]">{c.results}</b> · ko'rishlar: {c.impressions}{c.results ? ` · bittasi ≈ ${Math.round((c.spent / c.results) * 100) / 100} ${cur}` : ''}</p>
          {c.stopReason && <p className="text-[12.5px] text-[#fde2b0]">{c.stopReason}</p>}
        </div>
      )}
      {c.problems.length > 0 && <ul className="space-y-1 rounded-xl bg-[#f5b454]/10 p-3 text-[13px] text-[#fde2b0]">{c.problems.map(p => <li key={p}>⚠️ {p}</li>)}</ul>}
      {c.error && c.status === 'failed' && <p className="rounded-xl bg-[#f87171]/10 p-3 text-[13px] text-[#fecaca]">{c.error}</p>}
      <div className="flex flex-wrap gap-2">
        {c.status === 'proposed' && <button type="button" disabled={!!busy || c.problems.length > 0} onClick={launch} className={`${button} text-[#07080b]`} style={{ background: ACCENT }}>{busy === 'launch' ? spin : <Rocket className="h-4 w-4" aria-hidden="true" />} Ishga tushirish</button>}
        {c.status === 'active' && <button type="button" disabled={!!busy} onClick={() => void run('pause', () => api.adsPause(c.id), "To'xtatildi")} className={ghost}>{busy === 'pause' ? spin : <Pause className="h-4 w-4" aria-hidden="true" />} To'xtatish</button>}
        {c.status === 'paused' && <button type="button" disabled={!!busy} onClick={() => void run('resume', () => api.adsResume(c.id), 'Davom etyapti')} className={ghost}>{busy === 'resume' ? spin : <Play className="h-4 w-4" aria-hidden="true" />} Davom ettirish</button>}
        {(c.status === 'proposed' || c.status === 'failed') && <button type="button" disabled={!!busy} onClick={() => { if (window.confirm('Reja bekor qilinsinmi?')) void run('cancel', () => api.adsCancel(c.id)); }} className={`${button} text-[#a3a9b5] hover:bg-glass/5`}><X className="h-4 w-4" aria-hidden="true" /> Bekor</button>}
      </div>
    </li>
  );
}

// ─── Kampaniyalar ─────────────────────────────────────────────────────────────

export function AdsCampaigns({ view, setView, notify }: { view: AdsView | null; setView: (v: AdsView) => void; notify: Notify }) {
  const [task, setTask] = useState('');
  const [busy, run] = useRun(notify, setView);
  if (!view) return <Loader2 className="h-5 w-5 animate-spin text-[#7d838f]" aria-label="Yuklanmoqda" />;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run('plan', () => api.adsPlan(task), "Reja tayyor — Telegram'ga ham yuborildi").then(ok => { if (ok) setTask(''); });
  };
  const ready = !!view.account && view.limits.perCampaign > 0 && view.limits.daily > 0 && view.limits.monthly > 0;
  return (
    <div className="space-y-5">
      {!ready && <p className="rounded-2xl bg-[#f5b454]/10 p-4 text-[13.5px] text-[#fde2b0]">Ishga tushirish uchun <a href={hrefOf('marketolog', 'kabinet')} className="font-semibold text-[#fde2b0] underline">Kabinet</a> varag'ida Meta reklama kabinetini ulang va qat'iy limitlarni belgilang. Rejani hozir ham tuzsa bo'ladi.</p>}
      <Panel title="Yangi kampaniya">
        <form onSubmit={submit} className="space-y-2">
          <textarea value={task} onChange={e => setTask(e.target.value)} rows={3} maxLength={2000} className={field}
            placeholder="Masalan: Implant bo'yicha bepul konsultatsiya reklamasi. Jami 50$, 7 kun, Toshkent, 30–60 yosh. Odamlar Instagram Direct'ga yozsin." />
          <button type="submit" disabled={task.trim().length < 10 || !!busy} className={`${button} text-[#07080b]`} style={{ background: ACCENT }}>{busy === 'plan' ? spin : <Sparkles className="h-4 w-4" aria-hidden="true" />} {busy === 'plan' ? 'Reja tuzyapti…' : 'Reja tuzsin'}</button>
          <p className="text-[12.5px] text-[#7d838f]">Byudjetni o'zingiz yozing — Targetolog o'ylab topmaydi. Reja Telegram'ga ham keladi; pul faqat siz «Ishga tushirish»ni bosganda ketadi.</p>
        </form>
      </Panel>
      <Panel title="Kampaniyalar">
        {!view.campaigns.length ? <Quiet>Hali kampaniya yo'q. Yuqorida yozing yoki Yordamchiga ayting: «Implant reklamasini 50$ ga 7 kun Toshkentda ber».</Quiet>
          : <ul className="flex flex-col gap-3">{view.campaigns.map(c => <CampaignCard key={`${c.id}-${c.status}-${JSON.stringify(c.plan).length}`} c={c} view={view} setView={setView} notify={notify} />)}</ul>}
      </Panel>
    </div>
  );
}

// ─── Kabinet va limitlar ──────────────────────────────────────────────────────

export function AdsCabinet({ view, setView, notify }: { view: AdsView | null; setView: (v: AdsView) => void; notify: Notify }) {
  const [form, setForm] = useState({ token: '', adAccountId: '', pageId: '', igActorId: '' });
  const [limits, setLimits] = useState<AdsView['limits'] | null>(null);
  const [busy, run] = useRun(notify, setView);
  if (!view) return <Loader2 className="h-5 w-5 animate-spin text-[#7d838f]" aria-label="Yuklanmoqda" />;
  const a = view.account, l = limits ?? view.limits, cur = a?.currency ?? 'USD';
  const connect = (e: FormEvent) => {
    e.preventDefault();
    void run('connect', () => api.adsConnect({ ...form, igActorId: form.igActorId || null }), 'Kabinet ulandi').then(ok => { if (ok) setForm({ token: '', adAccountId: '', pageId: '', igActorId: '' }); });
  };
  const input = (k: keyof typeof form, label: string, ph: string, type = 'text') => (
    <label className="block"><span className="mb-1 block text-[12.5px] font-semibold text-[#a3a9b5]">{label}</span>
      <input type={type} value={form[k]} onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))} placeholder={ph} autoComplete="off" className={field} /></label>
  );
  return (
    <div className="space-y-5">
      <Panel title="Meta reklama kabineti">
        {a ? (
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-[14px] text-[#e4e3de]">
              <p><b>{a.accountName || `act_${a.adAccountId}`}</b> · {a.currency}</p>
              <p className="text-[13px] text-[#8a909c]">Sahifa: {a.pageName || a.pageId}{a.igActorId ? ` · Instagram: ${a.igActorId}` : ' · Instagram ID yo‘q (Direct reklamasi ishlamaydi)'}</p>
            </div>
            <button type="button" disabled={!!busy} onClick={() => { if (window.confirm('Kabinet uzilsinmi? Token o‘chiriladi.')) void run('off', () => api.adsDisconnect(), 'Uzildi'); }} className={`${ghost} ml-auto`}>Uzish</button>
          </div>
        ) : (
          <form onSubmit={connect} className="space-y-3">
            <ol className="list-decimal space-y-1 pl-5 text-[13px] leading-relaxed text-[#c9cbd2]">
              <li>business.facebook.com → Sozlamalar → <b>Tizim foydalanuvchilari</b> → Qo'shish (Admin).</li>
              <li>Unga <b>Aktivlar qo'shish</b>: reklama kabineti (to'liq boshqaruv) va Facebook sahifa.</li>
              <li><b>Token yaratish</b>: ilovangizni tanlang, ruxsatlar — ads_management, ads_read, pages_read_engagement, pages_manage_ads, pages_show_list. Muddati — «hech qachon» yoki 60 kun.</li>
              <li>Kabinet ID (Ads Manager manzilidagi act=…), sahifa ID va Instagram akkaunt ID'sini quyida yozing.</li>
            </ol>
            <div className="grid gap-3 sm:grid-cols-2">
              {input('token', 'Token', 'EAA…', 'password')}
              {input('adAccountId', 'Reklama kabineti ID', 'act_1234567890')}
              {input('pageId', 'Facebook sahifa ID', '1234567890')}
              {input('igActorId', 'Instagram akkaunt ID (Direct reklamasi uchun)', '1784…')}
            </div>
            <button type="submit" disabled={!form.token || !form.adAccountId || !form.pageId || !!busy} className={`${button} text-[#07080b]`} style={{ background: ACCENT }}>{busy === 'connect' && spin} Tekshirib ulash</button>
            <p className="text-[12.5px] text-[#7d838f]">Token shifrlab saqlanadi va panelda qayta ko'rsatilmaydi.</p>
          </form>
        )}
      </Panel>
      <Panel title="Qat'iy limitlar">
        <div className="space-y-3">
          <p className="text-[13.5px] leading-relaxed text-[#a3a9b5]">Byudjetni har topshiriqda o'zingiz aytasiz; bu limitlar ustidan qat'iy chegara. Oshadigan reja ishga tushmaydi, ishlayotgan reklamalar esa kunlik yoki oylik limitga yetganda (har 10 daqiqada tekshiriladi) o'zi to'xtatiladi. Meta sarfni biroz kechikib ko'rsatgani uchun kunlik limit ozgina oshishi mumkin; har kampaniyaning umumiy byudjetidan esa Meta o'zi chiqmaydi. 0 — o'rnatilmagan: hech narsa ishga tushmaydi, ishlayotganlar to'xtatiladi.</p>
          <div className="flex flex-wrap items-end gap-5 text-[13.5px] text-[#c9cbd2]">
            {([['perCampaign', 'Bir kampaniya'], ['daily', 'Kuniga'], ['monthly', 'Oyiga']] as const).map(([k, label]) => (
              <label key={k} className="flex flex-col gap-1">{label}, {cur}<input type="number" min={0} step="1" value={l[k]} onChange={e => setLimits({ ...l, [k]: Number(e.target.value) || 0 })} className={small} /></label>
            ))}
            {limits && JSON.stringify(limits) !== JSON.stringify(view.limits) && (
              <button type="button" disabled={!!busy} onClick={() => void run('limits', () => api.adsLimits(limits), 'Limitlar saqlandi').then(ok => { if (ok) setLimits(null); })} className={`${button} text-[#07080b]`} style={{ background: ACCENT }}>{busy === 'limits' && spin} Saqlash</button>
            )}
          </div>
          {view.spend && <p className="text-[13px] tabular-nums text-[#8a909c]">Hozir: bugun {view.spend.today} {cur} · shu oy {view.spend.month} {cur} · ishlayotganlarga band {Math.round(view.spend.committed * 100) / 100} {cur} (butun kabinet bo'yicha)</p>}
        </div>
      </Panel>
    </div>
  );
}
