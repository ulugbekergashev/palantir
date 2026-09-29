import type { Clinic, PackState } from '../types';
import { sampleClinic } from '../data/sampleClinic';

/** Demo ma'lumot faqat shu brauzerda saqlanadi */
const KEY = 'cerebro_v1';

export interface Store {
  clinic: Clinic;
  pack: PackState;
}

export const emptyPack = (): PackState => ({ seeds: {}, status: {}, edits: {} });

export const initialStore = (): Store => ({ clinic: sampleClinic(), pack: emptyPack() });

export function loadStore(): Store {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return initialStore();
    const parsed = JSON.parse(raw) as Partial<Store>;
    if (!parsed.clinic?.brand || !parsed.clinic.goal) return initialStore();
    return { clinic: parsed.clinic, pack: { ...emptyPack(), ...parsed.pack } };
  } catch {
    return initialStore();
  }
}

export function saveStore(store: Store): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
    return true;
  } catch {
    // Xotira to'lsa (katta rasmlar) — sessiya davomida baribir ishlaydi
    return false;
  }
}
