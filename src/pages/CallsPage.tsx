import { useEffect, useState } from 'react';
import { Loader2, PhoneCall, PhoneIncoming, PhoneMissed, PhoneOutgoing } from 'lucide-react';
import type { Call } from '../types';
import { api, type PhoneStation, type PhoneStatus, type StationServers } from '../data/api';
import type { Notify } from '../components/Artifacts';
import { Button, Card, EmptyState, PageHeader } from '../components/ui';
import { prettyPhone } from '../lib/phone';

const when = (isoTime: string) => new Date(isoTime).toLocaleString('uz', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const length = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
const STATUS: Record<NonNullable<Call['status']>, string> = {
  ringing: 'jiringlayapti', dialing: 'terilmoqda', talking: 'gaplashilmoqda', ended: 'gaplashildi', missed: "o'tkazib yuborildi", no_answer: "ko'tarmadi",
};
const OUTCOME: Record<string, string> = { booked: '✅ Kelishildi', callback: "🔁 Qayta bog'lanish kerak", info: "ℹ️ Ma'lumot oldi", lost: '❌ Qiziqmadi', complaint: '⚠️ Shikoyat', other: '' };

function CallIcon({ c }: { c: Call }) {
  const Icon = c.status === 'missed' || c.status === 'no_answer' ? PhoneMissed : c.direction === 'out' ? PhoneOutgoing : c.direction === 'in' ? PhoneIncoming : PhoneCall;
  return <Icon className={`h-4 w-4 shrink-0 ${c.status === 'missed' ? 'text-rose-600' : 'text-slate-400'}`} aria-hidden="true" />;
}

/** Qo'ng'iroqlar: MicroSIP orqali (yozuvi va tahlili bilan) va ovozli agent qabul qilganlari. Chapda ro'yxat, o'ngda tafsilot */
export function CallsPage({ notify }: { notify: Notify }) {
  const [list, setList] = useState<Call[] | null>(null);
  const [picked, setPicked] = useState<string | null>(null);
  const fail = (e: unknown) => notify((e as Error).message, true);
  const load = () => api.calls().then(r => setList(r.calls)).catch(fail);
  useEffect(() => { void load(); const t = setInterval(() => { void load(); }, 10_000); return () => clearInterval(t); }, []);
  const call = list?.find(c => c.id === picked) ?? list?.[0] ?? null;

  return (
    <div className="space-y-5">
      <PageHeader title="Qo'ng'iroqlar" description="Klinika telefoni (MicroSIP) orqali bo'lgan har bir qo'ng'iroq: kim, qachon, ko'tarildimi; suhbat yozib olinadi, matnga aylanadi va tahlil qilinadi. O'tkazib yuborilgan qo'ng'iroq — qabulxonaga «qayta qo'ng'iroq qiling» so'rovi." />

      <PhoneCard notify={notify} />
      <StationsCard notify={notify} />

      {list === null ? <Loader2 className="mx-auto h-6 w-6 animate-spin text-slate-400" /> : !list.length ? (
        <Card><EmptyState icon={PhoneCall} title="Hali qo'ng'iroq yo'q">MicroSIP ulangach, har bir kiruvchi va chiquvchi qo'ng'iroq shu yerda paydo bo'ladi.</EmptyState></Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-1">
            {list.map(c => (
              <button key={c.id} type="button" onClick={() => setPicked(c.id)} aria-current={c.id === call?.id} className={`w-full rounded-xl px-3 py-2 text-left transition-colors ${c.id === call?.id ? 'bg-white shadow-sheet ring-1 ring-slate-200' : 'hover:bg-slate-200/60'}`}>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-1.5"><CallIcon c={c} /><span className="truncate font-semibold">{c.name ?? prettyPhone(c.phone)}</span></span>
                  <span className="shrink-0 text-xs tabular-nums text-slate-400">{when(c.startedAt)}</span>
                </div>
                <div className="truncate text-sm text-slate-500">{c.source === 'microsip' ? `${c.status ? STATUS[c.status] : ''}${c.durationSec ? ` · ${length(c.durationSec)}` : ''}${c.outcome ? ` · ${c.outcome}` : ''}` : c.outcome}</div>
              </button>
            ))}
          </div>
          {call && <CallDetail key={call.id} call={call} notify={notify} />}
        </div>
      )}

      <VoiceAgentCard notify={notify} />
    </div>
  );
}

function CallDetail({ call, notify }: { call: Call; notify: Notify }) {
  const [audio, setAudio] = useState<string | null>(null);
  useEffect(() => () => { if (audio) URL.revokeObjectURL(audio); }, [audio]);
  const listen = () => api.callAudio(call.id).then(b => setAudio(URL.createObjectURL(b))).catch(e => notify((e as Error).message, true));
  const a = call.analysis;
  const lines = a?.transcript ? a.transcript.split('\n').filter(Boolean) : [];
  return (
    <Card title={call.name ?? prettyPhone(call.phone)} description={`${prettyPhone(call.phone)} · ${when(call.startedAt)}${call.durationSec ? ` · ${length(call.durationSec)}` : ''}${call.source === 'microsip' && call.status ? ` · ${STATUS[call.status]}` : ''}`}>
      {call.booked && <p className="mb-3 rounded-xl bg-emerald-50 p-3 text-sm font-semibold text-emerald-800">Qabulga yozildi: {call.booked}</p>}
      {call.hasRecording && (audio ? <audio controls src={audio} className="mb-3 w-full" autoPlay /> : <Button size="sm" className="mb-3" onClick={listen}>▶ Yozuvni tinglash</Button>)}
      {call.review === 'pending' && <p className="mb-3 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" /> Matn va tahlil tayyorlanmoqda…</p>}
      {call.review === 'failed' && <p className="mb-3 text-sm text-amber-700">Yozuvni tahlil qilib bo'lmadi (ovoz xizmati yoki AI javob bermadi).</p>}
      {a && (
        <div className="mb-4 space-y-1.5 rounded-xl bg-slate-50 p-3 text-sm">
          <p className="font-semibold text-slate-900">{a.summary}</p>
          {a.wants && <p><span className="text-slate-500">Mijoz nima xohladi:</span> {a.wants}</p>}
          {(a.agreed || OUTCOME[a.outcome]) && <p>{OUTCOME[a.outcome]}{a.agreed ? `: ${a.agreed}` : ''}</p>}
          {a.nextStep && <p>➡️ {a.nextStep}</p>}
          {a.score > 0 && <p className="text-slate-600">🗣 Xodim: <b>{a.score}/10</b>{a.staffNote ? ` — ${a.staffNote}` : ''}</p>}
        </div>
      )}
      <div className="space-y-2">
        {call.source !== 'microsip' && call.transcript.map((l, i) => (
          <div key={i} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${l.who === 'ai' ? 'ml-auto bg-indigo-50' : 'bg-slate-100'}`}>
            <div className="text-[11px] font-bold text-slate-500">{l.who === 'ai' ? 'Agent' : 'Mijoz'}</div>{l.text}
          </div>
        ))}
        {lines.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer font-semibold text-slate-700">Suhbat matni{a?.speakers ? ' (gapiruvchilar ajratilgan)' : ''}</summary>
            <div className="mt-2 space-y-1 whitespace-pre-wrap text-slate-700">{lines.map((l, i) => <p key={i}>{l}</p>)}</div>
          </details>
        )}
        {call.source !== 'microsip' && !call.transcript.length && <p className="text-sm text-slate-500">Bu qo'ng'iroqning matni kelmagan.</p>}
      </div>
    </Card>
  );
}

/** Klinika telefoni: shu kompyuterdagi MicroSIP (istalgan SIP operator — UTEL, Uztelecom, Sipuni…) */
function PhoneCard({ notify }: { notify: Notify }) {
  const [s, setS] = useState<PhoneStatus | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.phone().then(r => setS(r.phone)).catch(() => {}); }, []);
  const act = (work: () => Promise<{ phone: PhoneStatus }>, done: string) => {
    setBusy(true);
    work().then(r => { setS(r.phone); notify(done); }).catch(e => {
      const msg = (e as Error).message;
      // Boshqa dastur (DentaCRM) ulagan bo'lsa — egasi so'rab, keyin o'tkazadi
      if (/boshqa dasturga ulangan/.test(msg) && window.confirm(`${msg}\n\nPalantir'ga o'tkazilsinmi?`)) return act(() => api.connectPhone(true), done);
      notify(msg, true);
    }).finally(() => setBusy(false));
  };
  if (!s) return null;
  return (
    <Card title="Klinika telefoni (MicroSIP)" description="MicroSIP — kompyuterdagi bepul softfon; istalgan SIP operator bilan ishlaydi (UTEL, Uztelecom, Sipuni, OnlinePBX). Ulanganda Palantir har bir qo'ng'iroqni ko'radi, suhbatni yozib oladi va so'rov kartasidagi «📞 Kompyuterdan» tugmasi bilan raqam teradi.">
      {!s.available ? <p className="text-sm text-slate-500">MicroSIP faqat Windows kompyuterda ishlaydi.</p>
        : !s.exePath ? <p className="text-sm text-slate-600">MicroSIP topilmadi. microsip.org'dan o'rnating, operator bergan SIP login bilan hisob qo'shing, keyin shu yerda «Ulash»ni bosing.</p>
        : s.otherBusiness ? <p className="text-sm text-amber-700">Bu kompyuterdagi MicroSIP boshqa biznesga ulangan.</p>
        : (
          <div className="space-y-3">
            <p className="text-sm">{s.mine ? <span className="font-semibold text-emerald-700">✓ Ulangan</span> : <span className="text-slate-600">Topildi, hali ulanmagan</span>} <span className="break-all text-slate-400">· {s.exePath}</span></p>
            {s.mine && <p className="text-sm text-slate-600">{s.recording ? `🎙 Suhbatlar yozib olinadi (${s.recordFormat === 'mp3' ? 'MP3' : 'WAV'})` : 'Yozib olish o\'chiq'}</p>}
            {s.mine && s.noAccount && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">MicroSIP'da operator hisobi (SIP login) topilmadi — qo'ng'iroqlar ketmaydi. MicroSIP → «Add account»da operator bergan server, login va parolni kiriting.</p>}
            <div className="flex gap-2">
              {s.mine
                ? <Button disabled={busy} onClick={() => act(api.disconnectPhone, 'MicroSIP uzildi')}>Uzish</Button>
                : <Button variant="primary" disabled={busy} onClick={() => act(() => api.connectPhone(), "MicroSIP ulandi — qo'ng'iroqlar yozib olinadi")}>{busy ? 'Ulanmoqda…' : 'Ulash'}</Button>}
            </div>
            <p className="text-xs text-slate-500">Ulash va uzishda MicroSIP bir necha soniyaga yopilib, qayta ochiladi (sozlamasini o'zgartirish uchun). Qo'ng'iroq paytida bosmang.</p>
          </div>
        )}
    </Card>
  );
}

/**
 * Qabulxonadagi boshqa kompyuterlar: har birida MicroSIP. Kompyuter qo'shiladi → bir martalik kod → o'sha kompyuterda Stansiya.cmd.
 * Xodim biriktirilsa — u Telegram'da «📞 Kompyuterdan» bosganda raqam aynan o'zining kompyuterida teriladi
 */
function StationsCard({ notify }: { notify: Notify }) {
  const [data, setData] = useState<{ stations: PhoneStation[]; servers: StationServers } | null>(null);
  const [staff, setStaff] = useState<{ id: string; name: string }[]>([]);
  const [name, setName] = useState('');
  const [who, setWho] = useState('');
  const [made, setMade] = useState<{ name: string; code: string; until: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const fail = (e: unknown) => notify((e as Error).message, true);
  const load = () => api.stations().then(setData).catch(() => {});
  useEffect(() => {
    void load();
    api.staff().then(r => setStaff(r.staff)).catch(() => {});
    const t = setInterval(() => { void load(); }, 10_000);
    return () => clearInterval(t);
  }, []);
  if (!data) return null;
  const server = data.servers.lan[0] ?? data.servers.hub;
  const add = () => {
    if (!name.trim()) return notify('Kompyuter nomini yozing (masalan, «Qabulxona 2»)', true);
    setBusy(true);
    api.addStation(name.trim(), who || null).then(r => { setMade({ name: r.station.name, code: r.code, until: r.until }); setName(''); setWho(''); void load(); })
      .catch(fail).finally(() => setBusy(false));
  };
  const remove = (st: PhoneStation) => {
    if (!window.confirm(`«${st.name}» olib tashlansinmi? Uning qo'ng'iroqlari endi kelmaydi.`)) return;
    api.removeStation(st.id).then(() => { notify('Olib tashlandi'); void load(); }).catch(fail);
  };
  return (
    <Card title="Qabulxonadagi boshqa kompyuterlar" description="Har bir administrator kompyuteridagi MicroSIP: qo'ng'iroqlar, yozuvlar va «📞 Kompyuterdan» shu yerga ulanadi. Bitta qo'ng'iroq bir nechta kompyuterda jiringlasa — kim ko'targani yoziladi, hech kim ko'tarmasagina «o'tkazib yuborildi».">
      <div className="space-y-3">
        {data.stations.length > 0 && (
          <ul className="divide-y divide-slate-100">
            {data.stations.map(st => (
              <li key={st.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                <span className="font-semibold">{st.name}</span>
                <span className={`rounded-md px-1.5 py-0.5 text-[11px] font-bold ${st.online ? 'bg-emerald-50 text-emerald-700' : st.paired ? 'bg-amber-50 text-amber-800' : 'bg-slate-100 text-slate-600'}`}>
                  {st.online ? 'aloqada' : st.paired ? 'aloqada emas' : 'hali ulanmagan'}
                </span>
                <select aria-label={`${st.name} — xodim`} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs" value={st.staffId ?? ''}
                  onChange={e => { api.setStationStaff(st.id, e.target.value || null).then(() => load()).catch(fail); }}>
                  <option value="">xodim biriktirilmagan</option>
                  {staff.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
                </select>
                <Button size="sm" variant="ghost" className="ml-auto" onClick={() => remove(st)}>Olib tashlash</Button>
              </li>
            ))}
          </ul>
        )}
        {made && (
          <div role="status" className="rounded-xl bg-indigo-50 p-3 text-sm text-indigo-900">
            <p className="font-semibold">«{made.name}» kompyuterida (MicroSIP ishlatadigan foydalanuvchi nomidan) Palantir papkasida ishga tushiring:</p>
            <code className="mt-2 block break-all rounded-lg bg-white px-2 py-1.5 text-xs">install\Stansiya.cmd -Server {server ?? '<server manzili>'} -Code {made.code}</code>
            <p className="mt-1 text-xs">Kod bir marta ishlaydi, {new Date(made.until).toLocaleTimeString('uz', { hour: '2-digit', minute: '2-digit' })} gacha.
              {data.servers.lan.length > 0 && data.servers.hub ? ` Klinika tarmog'idan tashqarida — ${data.servers.hub}` : ''}
              {!server ? " Server manzili: server klinika tarmog'ida ko'rinishi kerak (.env: LISTEN_HOST=0.0.0.0) yoki Palantir Hub kodi kiritilsin." : ''}</p>
          </div>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1"><span className="mb-1 block text-xs font-semibold text-slate-600">Kompyuter nomi</span>
            <input className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm" value={name} onChange={e => setName(e.target.value)} placeholder="Qabulxona 2" maxLength={60} /></label>
          <label><span className="mb-1 block text-xs font-semibold text-slate-600">Xodim (ixtiyoriy)</span>
            <select className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" value={who} onChange={e => setWho(e.target.value)}>
              <option value="">—</option>
              {staff.map(x => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select></label>
          <Button variant="primary" disabled={busy} onClick={add}>Kompyuter qo'shish</Button>
        </div>
        {data.stations.length > 0 && <p className="text-xs text-slate-500">«📞 Kompyuterdan» — bosgan xodimga biriktirilgan kompyuterda; biriktirilmagan bo'lsa — shu kompyuterdagi MicroSIP yoki aloqadagi yagona kompyuterda.</p>}
      </div>
    </Card>
  );
}

function VoiceAgentCard({ notify }: { notify: Notify }) {
  const [key, setKey] = useState<string | null>(null);
  const [hasKey, setHasKey] = useState(false);
  const fail = (e: unknown) => notify((e as Error).message, true);
  useEffect(() => { api.voiceKey().then(r => setHasKey(r.exists)).catch(fail); }, []);
  const makeKey = () => {
    if (hasKey && !window.confirm('Yangi kalit yaratilsa, eskisi shu zahoti ishlamay qoladi. Davom etilsinmi?')) return;
    api.newVoiceKey().then(r => { setKey(r.key); setHasKey(true); }).catch(fail);
  };
  return (
    <Card title="Ovozli agentni ulash" description="Agent suhbat paytida shu manzilga murojaat qiladi: bo'sh vaqtni so'raydi, qabulga yozadi, administratorga so'rov qoldiradi va tugagan suhbatni topshiradi.">
      <dl className="space-y-2 text-sm">
        <div><dt className="text-slate-500">Manzil</dt><dd className="break-all font-mono">{window.location.origin}/api/voice</dd></div>
        <div><dt className="text-slate-500">Kalit</dt><dd className="break-all font-mono">{key ?? (hasKey ? '•••••••• (yaratilgan)' : 'hali yaratilmagan')}</dd></div>
      </dl>
      <Button size="sm" className="mt-3" onClick={makeKey}>{hasKey ? 'Yangi kalit yaratish' : 'Kalit yaratish'}</Button>
      <p className="mt-3 text-sm text-slate-500">{key ? "Kalitni hozir nusxalab oling — u boshqa ko'rsatilmaydi. " : ''}Kalitni faqat ovozli agent xizmatiga bering: u bilan klinika jadvalini ko'rish va qabulga yozish mumkin.</p>
    </Card>
  );
}
