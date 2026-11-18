/**
 * Palantir yangilansa (avto-yangilash yoki o'rnatuvchi) — ochiq panel o'zini yangilaydi: aks holda egasi eski panelni ko'rib turadi
 * (yangi bo'lim yo'q, «F5 ni bosing» deyish kerak bo'lardi — 2026-11-18). Panel ochilgandagi server nashri eslab qolinadi va har daqiqada
 * solishtiriladi. Egasi shu payt nimadir yozayotgan bo'lsa (matn maydonida) — yozgani yo'qolmasin: keyingi tekshiruvda.
 */
import { useEffect } from 'react';
import { apiBase } from '../data/api';

const CHECK_MS = 60_000;

async function serverVersion(): Promise<string | null> {
  try {
    const r = await fetch(`${apiBase}/api/health`, { cache: 'no-store' });
    if (!r.ok) return null;
    const v = (await r.json() as { version?: unknown }).version;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

/** Egasi hozir matn yozyaptimi (yangilash yozganini o'chirib yubormasin) */
function typing(): boolean {
  const el = document.activeElement;
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  return (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) && el.value.trim() !== '';
}

export function useVersionReload(): void {
  useEffect(() => {
    let first: string | null = null;
    let stopped = false;
    const check = async () => {
      const now = await serverVersion();
      if (stopped || !now) return;
      if (first === null) { first = now; return; }
      if (now !== first && (document.visibilityState === 'hidden' || !typing())) window.location.reload();
    };
    void check();
    const timer = setInterval(() => { void check(); }, CHECK_MS);
    return () => { stopped = true; clearInterval(timer); };
  }, []);
}
