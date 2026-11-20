/**
 * SMM-menejer dizayneri: post, storis va Telegram muqovasi — shablon bo'yicha. AI faqat fon/suratni chizadi (yozuvsiz), matnni esa
 * Palantir o'zi brend shrifti va ranglarida ustiga qo'yadi (AI o'zbekcha harflarni buzib chizadi). Chrome'da HTML → JPEG.
 * Matn qutisiga sig'masa — shrift o'zi kichrayadi (data-fit).
 */
import { existsSync, readFileSync } from 'node:fs';
import type { BrandBook } from '../../src/types';
import { installedBrowser } from '../browserPath';
import type { BusinessRow } from '../db';
import { assetPath } from '../entry';

export const FORMATS = {
  post: { w: 1080, h: 1350, label: 'Instagram post (4:5)' },
  square: { w: 1080, h: 1080, label: 'Kvadrat post (1:1)' },
  story: { w: 1080, h: 1920, label: 'Storis (9:16)' },
  cover: { w: 1280, h: 720, label: 'Telegram muqova (16:9)' },
} as const;
export type DesignFormat = keyof typeof FORMATS;

/** announce — e'lon; promo — aksiya/chegirma; doctor — mutaxassis; tip — maslahat (karusel sahifasi ham); holiday — bayram; review — mijoz fikri */
export const TEMPLATES = ['announce', 'promo', 'doctor', 'tip', 'holiday', 'review'] as const;
export type DesignTemplate = (typeof TEMPLATES)[number];

export interface DesignSpec {
  template: DesignTemplate;
  format: DesignFormat;
  headline: string;
  sub?: string | null;
  /** Kichik yorliq: «-30%», «Faqat noyabr», «01», sana */
  badge?: string | null;
  bullets?: string[];
  cta?: string | null;
  /** Fon yoki asosiy surat (JPEG/PNG); yo'q — brend rangidagi fon */
  photo?: Buffer | null;
}

export class DesignError extends Error {}

export interface DesignBrand {
  name: string;
  colors: { bg: string; deep: string; surface: string; ink: string; accent: string; muted: string };
  font: 'Unbounded' | 'Manrope';
  logo: string | null;
  contact: string;
}

/** Brend-buk bo'lmasa — profil ranglaridan */
export function designBrand(biz: BusinessRow, book: BrandBook | null): DesignBrand {
  const p = biz.profile;
  const colors = book?.colors ?? { bg: '#0f1115', deep: p.brand?.primary || '#1f3a5f', surface: '#1a1d24', ink: '#ffffff', accent: p.brand?.accent || '#e8b04b', muted: '#a3a9b5' };
  return { name: book?.name || p.name, colors, font: book?.font ?? 'Manrope', logo: p.brand?.logo?.startsWith('data:image/') ? p.brand.logo : null, contact: [p.phone, p.instagram ? `@${p.instagram.replace(/^@/, '')}` : ''].filter(Boolean).join(' · ') };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const HEX = /^#[0-9a-f]{6}$/i;
const safeColor = (c: string, fallback: string) => (HEX.test(c) ? c : fallback);

/** Yorug'lik (WCAG): tugma matni — fonga qarab oq yoki qora */
function luminance(hex: string): number {
  const ch = [1, 3, 5].map(i => Number.parseInt(hex.slice(i, i + 2), 16) / 255).map(v => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
}
const onColor = (hex: string) => (luminance(hex) > 0.45 ? '#111111' : '#ffffff');

const fontFile = (name: string): string | null => [assetPath('public', 'fonts', name), assetPath('dist', 'fonts', name)].find(p => existsSync(p)) ?? null;
const fontFace = (family: string, file: string): string => {
  const path = fontFile(file);
  return path ? `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${readFileSync(path).toString('base64')}) format('woff2');font-weight:100 900;}` : '';
};

const mime = (b: Buffer) => (b[0] === 0x89 ? 'image/png' : 'image/jpeg');
const dataUrl = (b: Buffer) => `data:${mime(b)};base64,${b.toString('base64')}`;

/** Shablon tanasi: har biri kadrni to'liq egallaydi; asosiy matn .mid ichida (bo'sh joy o'rtasida), imzo — pastda */
function body(s: DesignSpec, b: DesignBrand, photo: string | null): string {
  const c = b.colors;
  const head = `<div class="head" data-fit>${esc(s.headline)}</div>`;
  const sub = s.sub ? `<div class="sub" data-fit>${esc(s.sub)}</div>` : '';
  const badge = s.badge ? `<div class="badge">${esc(s.badge)}</div>` : '';
  const cta = s.cta ? `<div class="cta">${esc(s.cta)}</div>` : '';
  const bullets = s.bullets?.length ? `<ul class="list" data-fit>${s.bullets.slice(0, 6).map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '';
  const foot = `<div class="foot">${b.logo ? `<img class="logo" src="${b.logo}">` : `<div class="mono">${esc(b.name.slice(0, 1).toUpperCase())}</div>`}<div><b>${esc(b.name)}</b>${b.contact ? `<span>${esc(b.contact)}</span>` : ''}</div></div>`;
  const bg = photo ? `<img class="photo" src="${photo}">` : `<div class="photo plain"></div>`;
  const mid = (...parts: string[]) => `<div class="mid">${parts.join('')}</div>`;
  switch (s.template) {
    case 'promo':
      return `<div class="split">${bg}</div><div class="panel accent">${mid(s.badge ? `<div class="badge big">${esc(s.badge)}</div>` : '', head, sub, cta)}${foot}</div>`;
    case 'doctor':
      return `<div class="fill" style="background:${c.surface}"></div><div class="portrait">${bg}</div><div class="panel low">${mid(badge, head, sub, bullets, cta)}${foot}</div>`;
    case 'tip':
      return `<div class="fill" style="background:${c.deep}"></div>${photo ? `<img class="photo faint" src="${photo}">` : '<div class="orb"></div>'}<div class="panel full">${mid(s.badge ? `<div class="num">${esc(s.badge)}</div>` : '', head, sub, bullets, cta)}${foot}</div>`;
    case 'holiday':
      return `${bg}<div class="shade center"></div><div class="panel full centered">${mid(badge, head, sub)}${foot}</div>`;
    case 'review':
      return `<div class="fill" style="background:${c.surface}"></div><div class="panel full">${mid('<div class="quote">“</div><div class="stars">★★★★★</div>', `<div class="head q" data-fit>${esc(s.headline)}</div>`, sub)}${foot}</div>`;
    default:
      return `${bg}<div class="shade"></div><div class="panel bottom">${badge}${head}${sub}${bullets}${cta}${foot}</div>`;
  }
}

/** Yorug' fonli shablon (surface ustida): matn qorong'i */
const LIGHT_TEMPLATES = new Set<DesignTemplate>(['doctor', 'review']);

export function designHtml(s: DesignSpec, b: DesignBrand): string {
  const { w, h } = FORMATS[s.format];
  const c = {
    bg: safeColor(b.colors.bg, '#0f1115'), deep: safeColor(b.colors.deep, '#1f3a5f'), surface: safeColor(b.colors.surface, '#1a1d24'),
    ink: safeColor(b.colors.ink, '#ffffff'), accent: safeColor(b.colors.accent, '#e8b04b'), muted: safeColor(b.colors.muted, '#a3a9b5'),
  };
  const wide = s.format === 'cover', tall = s.format === 'story';
  // Masshtab: 1080 kenglikdagi post o'lchamlari; muqovada balandlik kichik — alohida
  const u = wide ? 0.82 : 1;
  const light = LIGHT_TEMPLATES.has(s.template) && luminance(c.surface) > 0.45;
  const ink = light ? (luminance(c.bg) < 0.2 ? c.bg : '#141414') : c.ink;
  const paper = light ? c.surface : c.bg;
  const photo = s.photo ? dataUrl(s.photo) : null;
  const H = (tall ? 100 : 84) * u;
  const css = `${fontFace('Display', `${b.font}.woff2`)}${fontFace('Text', 'Manrope.woff2')}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:${w}px;height:${h}px;overflow:hidden;background:${c.bg};font-family:'Text',system-ui,sans-serif}
.frame{position:relative;width:${w}px;height:${h}px;overflow:hidden;color:${ink}}
.fill,.photo,.shade{position:absolute;inset:0;width:100%;height:100%}
.photo{object-fit:cover}.photo.plain{background:radial-gradient(120% 90% at 80% 10%,${c.accent}33,transparent 60%),linear-gradient(160deg,${c.deep},${c.bg})}
.photo.faint{opacity:.18;filter:grayscale(.3)}
.orb{position:absolute;width:${w * 0.9}px;height:${w * 0.9}px;right:${-w * 0.35}px;bottom:${-w * 0.3}px;border-radius:50%;background:radial-gradient(circle,${c.accent}40,${c.accent}00 70%)}
.shade{background:linear-gradient(180deg,${c.bg}00 25%,${c.bg}cc 62%,${c.bg}f2 100%)}.shade.center{background:${c.bg}a6}
.panel{position:absolute;left:${72 * u}px;right:${72 * u}px;display:flex;flex-direction:column;gap:${22 * u}px}
.mid>*,.panel>*{flex-shrink:0}
.mid{flex:1;display:flex;flex-direction:column;justify-content:center;gap:${22 * u}px;min-height:0}
.panel.bottom{bottom:${64 * u}px;max-height:${wide ? 86 : 66}%}.panel.full{top:${84 * u}px;bottom:${72 * u}px}
.panel.centered{align-items:center;text-align:center}.panel.centered .mid{align-items:center}
.panel.low{top:${tall ? 58 : 56}%;bottom:${64 * u}px}
.split{position:absolute;left:0;top:0;${wide ? 'bottom:0;width:46%' : 'right:0;height:50%'};overflow:hidden}.split .photo{position:absolute}
.panel.accent{${wide ? `left:51%;top:${56 * u}px;bottom:${56 * u}px` : `top:52%;bottom:${64 * u}px`}}
.portrait{position:absolute;left:${72 * u}px;right:${72 * u}px;top:${72 * u}px;height:${tall ? 50 : 48}%;border-radius:${36 * u}px;overflow:hidden}.portrait .photo{position:absolute}
.head{font-family:'Display','Text',sans-serif;font-weight:800;overflow-wrap:anywhere;font-size:${H}px;line-height:1.05;letter-spacing:-.01em}
.panel.centered .head{font-size:${H * 1.2}px}
.head.q{font-family:'Text';font-weight:600;font-size:${(tall ? 76 : 64) * u}px;line-height:1.25}
.sub{font-size:${(tall ? 42 : 36) * u}px;line-height:1.3;opacity:.85}
.badge{align-self:flex-start;background:${c.accent};color:${onColor(c.accent)};font-weight:800;font-size:${30 * u}px;padding:${12 * u}px ${24 * u}px;border-radius:999px}
.panel.centered .badge{align-self:center}
.badge.big{font-family:'Display';font-size:${(wide ? 120 : tall ? 190 : 150) * u}px;line-height:1;padding:0;background:none;color:${c.accent};border-radius:0}
.num{font-family:'Display';font-size:${(tall ? 200 : 150) * u}px;font-weight:800;color:${c.accent};line-height:1}
.list{list-style:none;display:flex;flex-direction:column;gap:${18 * u}px;font-size:${(tall ? 46 : 40) * u}px;line-height:1.3}
.list li{padding-left:${44 * u}px;position:relative}.list li:before{content:'';position:absolute;left:0;top:.45em;width:${20 * u}px;height:${20 * u}px;border-radius:50%;background:${c.accent}}
.cta{align-self:flex-start;background:${ink};color:${paper};font-weight:800;font-size:${32 * u}px;padding:${18 * u}px ${34 * u}px;border-radius:${18 * u}px}
.panel.centered .cta{align-self:center}
.quote{font-family:'Display';font-size:${180 * u}px;line-height:1;height:${110 * u}px;overflow:hidden;color:${c.accent}}
.stars{color:${c.accent};font-size:${44 * u}px;letter-spacing:.15em}
.foot{display:flex;align-items:center;gap:${18 * u}px;font-size:${26 * u}px;opacity:.9}
.panel.centered .foot{text-align:left}
.foot b{display:block;font-size:${30 * u}px}.foot span{display:block;opacity:.75}
.logo{width:${72 * u}px;height:${72 * u}px;object-fit:contain;border-radius:${16 * u}px;background:#fff}
.mono{width:${72 * u}px;height:${72 * u}px;border-radius:${16 * u}px;background:${c.accent};color:${onColor(c.accent)};display:grid;place-items:center;font-family:'Display';font-weight:800;font-size:${38 * u}px}`;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body><div class="frame">${body(s, b, photo)}</div></body></html>`;
}

/** Sahifa ichida: blok (.mid yoki pastki panel) sig'masa — undagi matnlar birga kichrayadi (eng kami ~36%) */
const FIT_SCRIPT = `(() => {
  for (const box of document.querySelectorAll('.mid, .panel.bottom')) {
    const fits = [...box.querySelectorAll('[data-fit]')];
    for (let i = 0; i < 14 && (box.scrollHeight > box.clientHeight + 1 || fits.some(el => el.scrollWidth > el.clientWidth + 1)); i++)
      for (const el of fits) el.style.fontSize = (parseFloat(getComputedStyle(el).fontSize) * 0.93) + 'px';
  }
})()`;

const RENDER_MS = 45_000;

/** HTML → JPEG (Chrome yoki Edge). Brauzer yo'q — DesignError */
export async function renderDesign(s: DesignSpec, b: DesignBrand): Promise<Buffer> {
  const exe = installedBrowser();
  if (!exe) throw new DesignError("Rasm yig'ish uchun kompyuterda Chrome yoki Edge kerak");
  const { chromium } = await import('playwright-core');
  const { w, h } = FORMATS[s.format];
  const browser = await chromium.launch({ executablePath: exe, headless: true, timeout: RENDER_MS });
  try {
    const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
    // Sahifa tashqariga chiqmaydi: hamma narsa ichida (shrift, surat — data URL)
    await page.route('**/*', r => (r.request().url().startsWith('data:') ? r.continue() : r.abort()));
    await page.setContent(designHtml(s, b), { waitUntil: 'load', timeout: RENDER_MS });
    // Shrift yoki skript osilib qolsa — post «tayyorlanmoqda»da qotib qolmasin
    const step = <T>(p: Promise<T>) => Promise.race([p, new Promise<never>((_, no) => { setTimeout(() => no(new DesignError("Rasm yig'ilmadi (brauzer javob bermadi)")), 20_000).unref?.(); })]);
    await step(page.evaluate(() => document.fonts.ready.then(() => true)));
    await step(page.evaluate(FIT_SCRIPT));
    return await page.screenshot({ type: 'jpeg', quality: 90, clip: { x: 0, y: 0, width: w, height: h } });
  } finally {
    await browser.close().catch(() => {});
  }
}
