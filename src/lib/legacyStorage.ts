/**
 * Dastur avval Cerebro deb atalgan (eski nom): brauzerda «cerebro_…» kalitlari bilan saqlangan kirish va sozlamalar
 * «palantir_…» ga ko'chiriladi — egasi qayta kirishi shart bo'lmasin. main.tsx eng birinchi import qiladi.
 */
const OLD = 'cerebro_'; // eski nom

try {
  for (const key of Object.keys(localStorage)) {
    if (!key.startsWith(OLD)) continue;
    const next = `palantir_${key.slice(OLD.length)}`;
    const value = localStorage.getItem(key);
    if (value !== null && localStorage.getItem(next) === null) localStorage.setItem(next, value);
    localStorage.removeItem(key);
  }
} catch { /* yopiq xotira (maxfiy oyna) — ko'chiradigan narsa yo'q */ }
