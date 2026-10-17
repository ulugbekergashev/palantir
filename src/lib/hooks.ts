import { useEffect, useState, useSyncExternalStore } from 'react';

/** Joriy vaqt — daqiqa sayin yangilanadi ("Rejada" → "Joylandi") */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

/** Shrift yuklangach qayta chizish: SVG qatorlari Manrope bilan o'lchansin */
export function useFontsReady(): void {
  const [, setReady] = useState(false);
  useEffect(() => {
    const fam = '"Manrope Variable"';
    Promise.all([
      document.fonts.load(`500 20px ${fam}`),
      document.fonts.load(`800 20px ${fam}`),
      document.fonts.load(`800 20px ${fam}`, 'Привет'),
    ]).finally(() => setReady(true));
  }, []);
}

/** Qisqa bildirishnoma (pastda) */
export function useToast() {
  const [toast, setToast] = useState<{ text: string; error?: boolean } | null>(null);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), toast.error ? 5000 : 2600);
    return () => clearTimeout(t);
  }, [toast]);
  return [toast, setToast] as const;
}

/** Keng ekran (Tailwind'ning lg chegarasi — 64rem): bo'limlar yon panelda doim ko'rinadi; torroqda — tugma ortidagi tortma */
const WIDE = '(min-width: 64rem)';
const watchWide = (changed: () => void) => {
  const query = window.matchMedia(WIDE);
  query.addEventListener('change', changed);
  return () => query.removeEventListener('change', changed);
};
export const useWide = (): boolean => useSyncExternalStore(watchWide, () => window.matchMedia(WIDE).matches);
