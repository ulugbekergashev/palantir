/** Shu kompyuterdagi Chrome yoki Edge (Instagram brauzeri va brauzer sinovlari uchun): odatiy o'rnatish joylaridan birinchi topilgani */
import { existsSync } from 'node:fs';

export function installedBrowser(): string | null {
  const e = process.env;
  const list = process.platform === 'darwin'
    ? ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge']
    : process.platform === 'win32'
      ? [
        ...[e.PROGRAMFILES, e['PROGRAMFILES(X86)'], e.LOCALAPPDATA].filter(Boolean).map(d => `${d}\\Google\\Chrome\\Application\\chrome.exe`),
        ...[e['PROGRAMFILES(X86)'], e.PROGRAMFILES].filter(Boolean).map(d => `${d}\\Microsoft\\Edge\\Application\\msedge.exe`),
      ]
      : ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'];
  return list.find(p => existsSync(p)) ?? null;
}
