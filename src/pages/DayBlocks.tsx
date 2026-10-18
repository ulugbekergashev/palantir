import type { CameraSummary } from '../types';
import { Card, MoreLink } from '../components/ui';

const LEVEL = { ok: 'bg-emerald-500', warn: 'bg-amber-500', crit: 'bg-rose-500' };
const LEVEL_NAME = { ok: 'joyida', warn: 'diqqat', crit: 'muammo' };
/** Bosh sahifada ko'rsatiladigan kamera xulosalari soni; qolgani «Kameralar» bo'limida */
const MAX_FINDINGS = 3;

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

