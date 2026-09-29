import { useRef, type ChangeEvent } from 'react';
import { ImagePlus, Plus, RotateCcw, Trash2, Upload } from 'lucide-react';
import type { Clinic, Doctor, FreeSlot, Service, WeeklyGoal } from '../types';
import { Artboard } from '../templates/Artboard';
import { Button, Card, Field, IconButton, TextInput, inputClass } from '../components/ui';
import { buildWeek } from '../lib/generator';
import { fileToDataUrl } from '../lib/image';
import { DAYS, mondayOf } from '../lib/week';

/** Brend ranglari uchun tayyor juftliklar: asosiy + urg'u */
const PRESETS: [string, string][] = [
  ['#0F766E', '#F59E0B'],
  ['#1D4ED8', '#38BDF8'],
  ['#7C3AED', '#F472B6'],
  ['#BE185D', '#FBBF24'],
  ['#0E7490', '#A3E635'],
  ['#111827', '#D4AF37'],
];

const newId = (prefix: string) => `${prefix}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;

function Upload1({ label, onFile }: { label: string; onFile: (f: File) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <input ref={ref} type="file" accept="image/*" hidden onChange={(e: ChangeEvent<HTMLInputElement>) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} />
      <Button size="sm" onClick={() => ref.current?.click()}><Upload className="h-3.5 w-3.5" /> {label}</Button>
    </>
  );
}

/**
 * Onboarding: klinika haqida bir marta kiritiladigan ma'lumot. AI postlarni faqat
 * shu yerdagi faktlardan yozadi (xizmat, narx, shifokor, aksiya) — o'zidan qo'shmaydi.
 */
export function SetupPage({ clinic, onChange, onReset, now }: { clinic: Clinic; onChange: (c: Clinic) => void; onReset: () => void; now: Date }) {
  const up = (patch: Partial<Clinic>) => onChange({ ...clinic, ...patch });
  const upGoal = (patch: Partial<WeeklyGoal>) => up({ goal: { ...clinic.goal, ...patch } });
  const upService = (id: string, patch: Partial<Service>) => up({ services: clinic.services.map(s => (s.id === id ? { ...s, ...patch } : s)) });
  const upDoctor = (id: string, patch: Partial<Doctor>) => up({ doctors: clinic.doctors.map(d => (d.id === id ? { ...d, ...patch } : d)) });
  const upSlot = (i: number, patch: Partial<FreeSlot>) => upGoal({ freeSlots: clinic.goal.freeSlots.map((s, k) => (k === i ? { ...s, ...patch } : s)) });

  const preview = buildWeek(clinic, mondayOf(now), {})[0];

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h1 className="text-2xl font-extrabold tracking-tight">Klinika va brend</h1>
          <p className="text-sm text-slate-500">Bir marta to'ldiriladi (~15 daqiqa). Postlar faqat shu ma'lumotdan yoziladi — o'zidan chegirma yoki da'vo qo'shilmaydi.</p>
        </div>
        <Button onClick={onReset}><RotateCcw className="h-4 w-4" /> Namuna klinikani tiklash</Button>
      </header>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card title="Klinika" description="Postlar pastidagi aloqa ma'lumoti">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Klinika nomi"><TextInput value={clinic.name} onChange={e => up({ name: e.target.value })} /></Field>
            <Field label="Egasi (bot shunday murojaat qiladi)"><TextInput value={clinic.ownerName} onChange={e => up({ ownerName: e.target.value })} /></Field>
            <Field label="Telefon"><TextInput value={clinic.phone} onChange={e => up({ phone: e.target.value })} /></Field>
            <Field label="Instagram"><TextInput value={clinic.instagram || ''} placeholder="@klinika" onChange={e => up({ instagram: e.target.value })} /></Field>
            <Field label="Manzil"><TextInput value={clinic.address} onChange={e => up({ address: e.target.value })} /></Field>
            <Field label="Manzil (ruscha)"><TextInput value={clinic.addressRu || ''} onChange={e => up({ addressRu: e.target.value })} /></Field>
            <Field label="Yozilish boti" hint="Postdagi havola — lid shu orqali o'lchanadi"><TextInput value={clinic.telegramBot || ''} placeholder="@klinika_bot" onChange={e => up({ telegramBot: e.target.value })} /></Field>
            <Field label="Telegram kanal"><TextInput value={clinic.telegramChannel || ''} placeholder="@klinika" onChange={e => up({ telegramChannel: e.target.value })} /></Field>
            <Field label="Obunachilar (Instagram + kanal)" hint="Natijani taxmin qilish uchun">
              <TextInput type="number" min={0} step={100} value={clinic.followers} onChange={e => up({ followers: Math.max(0, Number(e.target.value) || 0) })} />
            </Field>
          </div>
        </Card>

        <Card title="Brend" description="Logo va ranglar — hamma rasm bir uslubda chiqadi">
          <div className="grid gap-5 sm:grid-cols-[1fr_220px]">
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
                  {clinic.brand.logo ? <img src={clinic.brand.logo} alt="Logo" className="h-full w-full object-contain" /> : <ImagePlus className="h-6 w-6 text-slate-300" />}
                </div>
                <div className="flex flex-wrap gap-2">
                  <Upload1 label="Logo yuklash" onFile={async f => up({ brand: { ...clinic.brand, logo: await fileToDataUrl(f, 400) } })} />
                  {clinic.brand.logo && <Button size="sm" variant="ghost" onClick={() => up({ brand: { ...clinic.brand, logo: undefined } })}>Olib tashlash</Button>}
                </div>
              </div>
              <div>
                <span className="mb-1.5 block text-xs font-semibold text-slate-600">Tayyor ranglar</span>
                <div className="flex flex-wrap gap-2">
                  {PRESETS.map(([p, a]) => (
                    <button
                      key={p}
                      type="button"
                      title={`${p} + ${a}`}
                      aria-label={`Rang: ${p}`}
                      aria-pressed={clinic.brand.primary.toLowerCase() === p.toLowerCase()}
                      onClick={() => up({ brand: { ...clinic.brand, primary: p, accent: a } })}
                      className={`flex h-10 w-14 overflow-hidden rounded-xl border-2 ${clinic.brand.primary.toLowerCase() === p.toLowerCase() ? 'border-slate-900' : 'border-transparent'}`}
                    >
                      <span className="flex-[2]" style={{ background: p }} />
                      <span className="flex-1" style={{ background: a }} />
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Asosiy rang">
                  <input type="color" className={`${inputClass} p-1`} value={clinic.brand.primary} onChange={e => up({ brand: { ...clinic.brand, primary: e.target.value } })} />
                </Field>
                <Field label="Urg'u rangi">
                  <input type="color" className={`${inputClass} p-1`} value={clinic.brand.accent} onChange={e => up({ brand: { ...clinic.brand, accent: e.target.value } })} />
                </Field>
              </div>
            </div>
            <div className="overflow-hidden rounded-xl border border-slate-200">
              <Artboard item={preview} lang="uz" clinic={clinic} className="block h-auto w-full" />
            </div>
          </div>
        </Card>

        <Card title="Haftalik maqsad" description="Nimani ko'proq sotmoqchisiz — birinchi post shu haqida bo'ladi">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Urg'u beriladigan xizmat">
              <select className={inputClass} value={clinic.goal.focusServiceId || ''} onChange={e => upGoal({ focusServiceId: e.target.value || undefined })}>
                <option value="">Har hafta boshqasi</option>
                {clinic.services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Aksiya tugash sanasi">
              <input type="date" className={inputClass} value={clinic.goal.promoUntil || ''} onChange={e => upGoal({ promoUntil: e.target.value || undefined })} />
            </Field>
            <Field label="Aksiya (bo'sh qolsa — oddiy xizmat posti)" hint="Masalan: «Konsultatsiya bepul» yoki «20% chegirma»">
              <TextInput value={clinic.goal.promo || ''} onChange={e => upGoal({ promo: e.target.value })} />
            </Field>
            <Field label="Aksiya (ruscha)"><TextInput value={clinic.goal.promoRu || ''} onChange={e => upGoal({ promoRu: e.target.value })} /></Field>
          </div>
          <div className="mt-4">
            <span className="mb-1.5 block text-xs font-semibold text-slate-600">Bu haftaning bo'sh vaqtlari (storisga chiqadi)</span>
            <div className="space-y-2">
              {clinic.goal.freeSlots.map((slot, i) => (
                <div key={i} className="grid grid-cols-[1fr_120px_32px] items-center gap-2">
                  <select className={inputClass} value={slot.day} onChange={e => upSlot(i, { day: Number(e.target.value) })}>
                    {DAYS.uz.map((d, k) => <option key={d} value={k}>{d}</option>)}
                  </select>
                  <input type="time" className={inputClass} value={slot.time} onChange={e => upSlot(i, { time: e.target.value })} />
                  <IconButton label="O'chirish" onClick={() => upGoal({ freeSlots: clinic.goal.freeSlots.filter((_, k) => k !== i) })}><Trash2 className="h-4 w-4" /></IconButton>
                </div>
              ))}
              {clinic.goal.freeSlots.length < 5 && (
                <Button size="sm" variant="ghost" onClick={() => upGoal({ freeSlots: [...clinic.goal.freeSlots, { day: 0, time: '10:00' }] })}>
                  <Plus className="h-3.5 w-3.5" /> Vaqt qo'shish
                </Button>
              )}
            </div>
          </div>
        </Card>

        <Card title="Xizmatlar va narxlar" action={
          <Button size="sm" variant="ghost" onClick={() => up({ services: [...clinic.services, { id: newId('s'), name: '', price: 0 }] })}><Plus className="h-3.5 w-3.5" /> Qo'shish</Button>
        }>
          <div className="space-y-2">
            <div className="grid grid-cols-[1fr_1fr_120px_32px] gap-2 px-1 text-[11px] font-semibold text-slate-400">
              <span>Nomi</span><span>Ruscha</span><span>Narxi, so'm</span><span />
            </div>
            {clinic.services.map(s => (
              <div key={s.id} className="grid grid-cols-[1fr_1fr_120px_32px] items-center gap-2">
                <TextInput value={s.name} onChange={e => upService(s.id, { name: e.target.value })} aria-label="Xizmat nomi" />
                <TextInput value={s.nameRu || ''} onChange={e => upService(s.id, { nameRu: e.target.value })} aria-label="Ruscha nomi" />
                <TextInput type="number" min={0} step={10000} value={s.price} onChange={e => upService(s.id, { price: Math.max(0, Number(e.target.value) || 0) })} aria-label="Narxi" />
                <IconButton label="O'chirish" onClick={() => up({
                  services: clinic.services.filter(x => x.id !== s.id),
                  goal: clinic.goal.focusServiceId === s.id ? { ...clinic.goal, focusServiceId: undefined } : clinic.goal,
                })}><Trash2 className="h-4 w-4" /></IconButton>
              </div>
            ))}
          </div>
        </Card>

        <Card title="Shifokorlar" description="Har hafta bittasi bilan tanishtiruvchi post chiqadi" className="xl:col-span-2" action={
          <Button size="sm" variant="ghost" onClick={() => up({ doctors: [...clinic.doctors, { id: newId('d'), name: 'Dr. ', specialty: '' }] })}><Plus className="h-3.5 w-3.5" /> Qo'shish</Button>
        }>
          <div className="grid gap-3 lg:grid-cols-2">
            {clinic.doctors.map(d => (
              <div key={d.id} className="flex gap-3 rounded-xl border border-slate-200 p-3">
                <div className="flex w-20 shrink-0 flex-col items-center gap-2">
                  <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-full bg-slate-100">
                    {d.photo ? <img src={d.photo} alt={d.name} className="h-full w-full object-cover" /> : <ImagePlus className="h-6 w-6 text-slate-300" />}
                  </div>
                  <Upload1 label="Surat" onFile={async f => upDoctor(d.id, { photo: await fileToDataUrl(f, 700) })} />
                </div>
                <div className="grid min-w-0 flex-1 grid-cols-2 gap-2">
                  <div className="col-span-2 flex gap-2">
                    <TextInput value={d.name} onChange={e => upDoctor(d.id, { name: e.target.value })} aria-label="Ism" />
                    <IconButton label="O'chirish" className="h-10 w-10 shrink-0" onClick={() => up({ doctors: clinic.doctors.filter(x => x.id !== d.id) })}><Trash2 className="h-4 w-4" /></IconButton>
                  </div>
                  <TextInput value={d.specialty} placeholder="Mutaxassisligi" onChange={e => upDoctor(d.id, { specialty: e.target.value })} aria-label="Mutaxassisligi" />
                  <TextInput value={d.specialtyRu || ''} placeholder="Ruscha" onChange={e => upDoctor(d.id, { specialtyRu: e.target.value })} aria-label="Mutaxassisligi (ruscha)" />
                  <TextInput type="number" min={0} max={60} value={d.years ?? ''} placeholder="Tajriba, yil" onChange={e => upDoctor(d.id, { years: e.target.value ? Number(e.target.value) : undefined })} aria-label="Tajriba, yil" />
                  {d.photo && <Button size="sm" variant="ghost" onClick={() => upDoctor(d.id, { photo: undefined })}>Suratni olib tashlash</Button>}
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}
