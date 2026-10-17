import type { AnchorHTMLAttributes, ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';
import { ArrowRight, type LucideIcon } from 'lucide-react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-indigo-600 text-white shadow-[inset_0_1px_0_rgb(255_255_255/0.18),0_1px_2px_rgb(49_46_129/0.35)] hover:bg-indigo-700 active:bg-indigo-800',
  secondary: 'border border-slate-300 bg-white text-slate-800 shadow-[0_1px_0_rgb(19_22_29/0.04)] hover:border-slate-400 hover:bg-slate-50 active:bg-slate-100',
  ghost: 'text-slate-600 hover:bg-slate-200/70 hover:text-slate-900 active:bg-slate-200',
  danger: 'text-rose-700 hover:bg-rose-50 active:bg-rose-100',
};

type Size = 'sm' | 'md';
const SIZES: Record<Size, string> = { sm: 'h-8 px-3 text-xs gap-1.5', md: 'h-10 px-4 text-sm gap-2' };
const BUTTON = 'inline-flex items-center justify-center whitespace-nowrap rounded-xl font-semibold transition-colors';

export function Button({ variant = 'secondary', size = 'md', className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant; size?: Size; children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`${BUTTON} enabled:active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 ${SIZES[size]} ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Tugma ko'rinishidagi havola: boshqa bo'limga yoki tashqi manzilga olib boradi */
export function ButtonLink({ variant = 'secondary', size = 'md', className = '', children, ...rest }: AnchorHTMLAttributes<HTMLAnchorElement> & {
  variant?: Variant; size?: Size; children: ReactNode;
}) {
  return <a className={`${BUTTON} active:translate-y-px ${SIZES[size]} ${VARIANTS[variant]} ${className}`} {...rest}>{children}</a>;
}

/** Karta burchagidagi kichik havola: batafsili qaysi bo'limda */
export function MoreLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} className="group inline-flex shrink-0 items-center gap-1 rounded text-xs font-semibold text-indigo-700 hover:text-indigo-900">
      {children} <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </a>
  );
}

/** Faqat belgili kichik tugma (sarlavhasi — title) */
export function IconButton({ label, children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition-colors hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 active:bg-slate-100 disabled:opacity-50 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Varaq: qog'oz fon ustidagi oq yuza. Sarlavhasi bo'lsa — tepada, amal (tugma) o'ngda */
export function Card({ title, description, action, children, className = '' }: {
  title?: string; description?: string; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sheet sm:p-6 ${className}`}>
      {(title || action) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {title && <h2 className="text-base font-bold tracking-tight text-slate-900">{title}</h2>}
            {description && <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-500">{description}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

/** Sahifa boshi: nom, bir-ikki jumla izoh va (bo'lsa) o'ngda amallar. Ostidagi qalin bo'lak — daftar sahifasining belgisi */
export function PageHeader({ title, description, children }: { title: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <header className="relative flex flex-wrap items-end gap-x-6 gap-y-3 border-b border-slate-200 pb-5 after:absolute after:-bottom-px after:left-0 after:h-0.5 after:w-10 after:bg-slate-900">
      <div className="min-w-0 flex-1 basis-80">
        <h1 className="text-[1.75rem] font-extrabold leading-tight tracking-tight">{title}</h1>
        {description && <div className="mt-1.5 max-w-3xl space-y-1 text-sm leading-relaxed text-slate-500">{description}</div>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </header>
  );
}

/** Bo'sh holat: nima yo'qligi va u qanday paydo bo'lishi. compact — karta ichidagi kichik ko'rinish */
export function EmptyState({ icon: Icon, title, children, action, compact = false }: {
  icon: LucideIcon; title: string; children?: ReactNode; action?: ReactNode; compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center px-4 text-center ${compact ? 'py-5' : 'py-10'}`}>
      <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-slate-100 text-slate-500 ring-1 ring-inset ring-slate-200">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </div>
      <p className="mt-3 text-sm font-bold text-slate-900">{title}</p>
      {children && <p className="mt-1 max-w-md text-sm leading-relaxed text-slate-500">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
    </label>
  );
}

/** Kengligi o'zi belgilanadigan maydon (sana, saralash) */
export const controlClass =
  'h-10 rounded-xl border border-slate-300 bg-white px-3 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 hover:border-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/20 disabled:bg-slate-50 disabled:text-slate-500';

export const inputClass = `w-full ${controlClass}`;

export function TextInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={`${inputClass} ${props.className || ''}`} />;
}

/** UZ | RU almashtirgich */
export function LangSwitch<T extends string>({ value, options, onChange, label }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string;
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex rounded-xl bg-slate-100 p-1">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`h-8 rounded-lg px-3 text-xs font-bold transition ${value === o.value ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
