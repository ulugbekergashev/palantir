import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-sm',
  secondary: 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50',
  ghost: 'text-slate-600 hover:bg-slate-100',
  danger: 'text-rose-600 hover:bg-rose-50',
};

export function Button({ variant = 'secondary', size = 'md', className = '', children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant; size?: 'sm' | 'md'; children: ReactNode;
}) {
  const sizes = size === 'sm' ? 'h-8 px-3 text-xs gap-1.5' : 'h-10 px-4 text-sm gap-2';
  return (
    <button
      type="button"
      className={`inline-flex items-center justify-center whitespace-nowrap rounded-xl font-semibold transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${sizes} ${VARIANTS[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

/** Faqat belgili kichik tugma (sarlavhasi — title) */
export function IconButton({ label, children, className = '', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; children: ReactNode }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 disabled:opacity-50 ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Card({ title, description, action, children, className = '' }: {
  title?: string; description?: string; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`rounded-2xl border border-slate-200 bg-white p-5 shadow-sm ${className}`}>
      {(title || action) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-base font-bold text-slate-900">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-slate-500">{description}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
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
  'h-10 rounded-xl border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-500/15';

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
