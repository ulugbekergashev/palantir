import type { Call, CameraSummary } from '../types';
import { Card, MoreLink } from '../components/ui';
import { iso, shortDate } from '../lib/week';

const LEVEL = { ok: 'bg-emerald-500', warn: 'bg-amber-500', crit: 'bg-rose-500' };
const LEVEL_NAME = { ok: 'joyida', warn: 'diqqat', crit: 'muammo' };
/** Bosh sahifada ko'rsatiladigan kamera xulosalari soni; qolgani «Kameralar» bo'limida */
const MAX_FINDINGS = 3;
const clock = (isoTime: string) => new Date(isoTime).toLocaleTimeString('uz', { hour: '2-digit', minute: '2-digit' });

function Seen({ n, label, crm }: { n: number; label: string; crm: string | null }) {
  return (
    <div className="flex flex-col-reverse gap-1">
      <dt className="text-sm text-slate-600">{label}{crm && <span className="block text-xs text-slate-500">{crm}</span>}</dt>
      <dd className="text-3xl font-extrabold leading-none tracking-tight tabular-nums">{n}</dd>
    </div>
  );
}

/** Kameralar bugun nima ko'rdi: kresloga o'tirganlar, kassa oldida turganlar va DentaCRM bilan farqlar */
export function CamerasBlock({ summary }: { summary: CameraSummary }) {
  const findings = summary.findings.slice(0, MAX_FINDINGS);
  return (
    <Card title="Kameralar" action={<MoreLink href="#/cameras">Batafsil</MoreLink>}>
      <dl className="grid grid-cols-2 gap-4">
        <Seen n={summary.seated} label="bemor kresloga o'tirdi" crm={summary.crm && `CRM'da ${summary.crm.visits} ta «keldi»`} />
        <Seen n={summary.deskVisits} label="kishi kassa oldida turdi" crm={summary.crm && `CRM'da ${summary.crm.payments} ta to'lov`} />
      </dl>
      {findings.length > 0 && (
        <ul className="mt-4 space-y-2 border-t border-slate-100 pt-4 text-sm">
          {findings.map((f, i) => (
            <li key={i} className="flex gap-2.5">
              <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${LEVEL[f.level]}`} aria-hidden="true" />
              <span><span className="sr-only">{LEVEL_NAME[f.level]}: </span>{f.text}</span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** So'nggi qo'ng'iroqlar: kim, qachon, nima bilan tugadi. Bugungisida — soat, eskirog'ida — sana. Keng joyda qo'ng'iroqlar yonma-yon turadi */
export function CallsBlock({ calls, now }: { calls: Call[]; now: Date }) {
  const today = iso(now);
  return (
    <Card title="So'nggi qo'ng'iroqlar" action={<MoreLink href="#/calls">Hammasi</MoreLink>}>
      <div className="@container">
        <ul className="grid divide-y divide-slate-100 @3xl:grid-cols-3 @3xl:divide-x @3xl:divide-y-0">
          {calls.map(c => (
            <li key={c.id} className="flex min-w-0 items-center gap-3 py-2.5 text-sm @3xl:px-5 @3xl:py-1 @3xl:first:pl-0 @3xl:last:pr-0">
              <span className="min-w-11 shrink-0 tabular-nums text-slate-500">{iso(new Date(c.startedAt)) === today ? clock(c.startedAt) : shortDate(c.startedAt)}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold">{c.name ?? c.phone}</p>
                <p className="truncate text-slate-500">{c.outcome}</p>
              </div>
              {c.booked && <span className="shrink-0 rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800 ring-1 ring-inset ring-emerald-200">qabulga yozildi</span>}
            </li>
          ))}
        </ul>
      </div>
    </Card>
  );
}
