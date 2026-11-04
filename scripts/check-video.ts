/**
 * Video renderi (HyperFrames): kompozitsiya (sof funksiyalar, xavfsiz matn, HyperFrames lint) va haqiqiy render — soxta ovoz
 * bilan qisqa video Chrome + ffmpeg orqali mp4 bo'ladi, muqova chiqadi, brend o'zgarsa «eskirgan», ssenariy tahrirlansa o'chadi.
 * Ishga tushirish: npm run test:video (kompyuterda Chrome yoki Edge va ffmpeg/ffprobe kerak; render ~1 daqiqa).
 */
import './isolate';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

process.env.VIDEO_RENDER = 'on';
const { buildComposition, wordTimes, captionGroups, palette, esc, shortCta, LEAD, HOLD } = await import('../server/content/composition');
const { cleanBook, brandStore } = await import('../server/content/brand');
const { videoStore, voiceVideo, editScenes } = await import('../server/content/video');
const { renderState, videoMp4, renderAvailable } = await import('../server/content/render');
const { joinClips, wavOf, RATE, GAP_S } = await import('../server/content/speech');
const { businesses } = await import('../server/db');
const { lintHyperframeHtml } = await import('@hyperframes/lint');

let failed = 0;
async function check(name: string, fn: () => unknown | Promise<unknown>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).message}`);
  }
}

const BOOK = cleanBook({
  name: "Ulug'bek Ergashev", positioning: 'Biznesga AI xodim quraman', tagline: 'Biznesga AI xodim quraman', values: ['amaliy'], voice: ['Qisqa gaplar'],
  banned: [], colors: { bg: '#1F8A8A', deep: '#13605F', surface: '#F7F4EC', ink: '#1E3A7B', accent: '#E3A21A', muted: '#CDEAE5' }, motif: 'Koshin',
  font: 'Unbounded', pillars: [{ name: 'AI', share: 100, about: '' }], dont: [], ctas: ['Izohda «AI» deb yozing'],
}, "Ulug'bek Ergashev")!;
const SCENES = [
  { kind: 'hook' as const, text: "Kechki qo'ng'iroq javobsiz", voice: "Kechki qo'ng'iroqqa hech kim javob bermadi." },
  { kind: 'point' as const, text: 'AI xodim javob beradi', voice: 'AI xodim darrov javob beradi.' },
  { kind: 'claim' as const, text: 'Ish vaqti tugaydi, qo\'ng\'iroq emas', voice: "Ish vaqti tugaydi, qo'ng'iroq emas." },
  { kind: 'sign' as const, text: "Ulug'bek Ergashev", voice: 'Biznesga AI xodim quraman.' },
];

console.log('Video renderi (HyperFrames)');

await check("so'z vaqtlari: sahna oralig'ini to'liq qoplaydi, ketma-ket, nuqtadan keyin pauza uzunroq", () => {
  const w = wordTimes('Salom, dunyo. Bu sinov', 1, 3);
  assert.equal(w.length, 4);
  assert.equal(w[0].start, 1);
  assert.ok(Math.abs(w[w.length - 1].end - 3) < 0.01);
  for (let i = 1; i < w.length; i++) assert.ok(Math.abs(w[i].start - w[i - 1].end) < 0.002, 'oraliq yo\'q');
  const len = (x: { start: number; end: number }) => x.end - x.start;
  assert.ok(len(w[1]) > len(w[3]), "«dunyo.» (nuqta bilan) «sinov» dan uzunroq");
  assert.deepEqual(wordTimes('', 0, 1), []);
});

await check("subtitr guruhlari: 4 so'zdan oshmaydi, tinish belgisida bo'linadi", () => {
  const g = captionGroups(wordTimes("Bir ikki uch to'rt besh olti. Yetti sakkiz", 0, 4));
  assert.ok(g.every(x => x.length <= 4));
  assert.deepEqual(g.map(x => x.map(w => w.text).join(' ')), ["Bir ikki uch to'rt", 'besh olti.', 'Yetti sakkiz']);
});

await check("ranglar: buzuq hex o'rniga zaxira rang", () => {
  const c = palette({ bg: 'qizil', accent: '#E3A21A' } as never);
  assert.match(c.bg, /^#[0-9a-f]{6}$/i);
  assert.equal(c.accent, '#E3A21A');
});

await check("kompozitsiya: matn HTML'ga xavfsiz tushadi, ma'lumot skriptni yopa olmaydi", () => {
  const evil = '</script><img src=x onerror=alert(1)>';
  const comp = buildComposition({
    book: { ...BOOK, name: evil, tagline: evil }, scenes: SCENES.map(s => ({ ...s, text: evil, voice: `${evil} gap` })),
    starts: [0, 1, 2, 3], duration: 4, gap: GAP_S, files: { voice: 'voice.wav' },
  });
  assert.ok(!comp.html.includes('<img src=x'), 'teg ochilib qoldi');
  assert.ok(comp.html.includes(esc(evil)));
  const data = comp.html.slice(comp.html.indexOf('id="hf-data">'), comp.html.indexOf('</script>', comp.html.indexOf('id="hf-data">')));
  assert.ok(!data.includes('<'), "JSON ichida '<' qolmasin");
});

await check("imzo: ism so'zlarga bo'linadi (harfdan emas), chaqiriq — eng qisqasi, uzuni qo'yilmaydi", () => {
  const html = buildComposition({ book: BOOK, scenes: SCENES, starts: [0, 1, 2, 3], duration: 4, gap: GAP_S, files: { voice: 'voice.wav' } }).html;
  const words = [...html.matchAll(/<span class="nw">(.*?)<\/span><\/span>/g)].map(m => m[1].replace(/<[^>]+>/g, ''));
  assert.deepEqual(words, ['Ulug&#39;bek', 'Ergashev']);
  assert.equal(shortCta({ ctas: ['Juda uzun chaqiriq '.repeat(5), 'Izohda yozing', 'Obuna bo\'ling va izohda yozing'] }), 'Izohda yozing');
  assert.equal(shortCta({ ctas: ['x'.repeat(80)] }), null);
});

await check("kompozitsiya: uzunlik, sahna oynalari uzluksiz, HyperFrames lint xatosiz", async () => {
  const comp = buildComposition({ book: BOOK, scenes: SCENES, starts: [0, 1.6, 3.1, 4.6], duration: 6, gap: GAP_S, files: { voice: 'voice.wav', music: 'music.mp3', images: ['img/a.jpg', null, null, null] } });
  assert.equal(comp.total, LEAD + 6 + HOLD);
  assert.match(comp.html, new RegExp(`data-duration="${comp.total}"`));
  const starts = [...comp.html.matchAll(/id="sc(\d)" class="clip scene \w+" data-start="([\d.]+)" data-duration="([\d.]+)"/g)].map(m => [Number(m[2]), Number(m[3])]);
  assert.equal(starts.length, 4);
  assert.equal(starts[0][0], 0);
  for (let i = 1; i < starts.length; i++) assert.ok(Math.abs(starts[i][0] - (starts[i - 1][0] + starts[i - 1][1])) < 0.002, 'sahnalar orasida bo\'shliq');
  assert.ok(comp.html.includes('id="music"') && comp.html.includes('data-automation'), 'musiqa ovozi pasaytirilgan');
  assert.ok(comp.html.includes('id="shot0"'), 'sahna rasmi');
  const lint = await lintHyperframeHtml(comp.html, { filePath: 'index.html' } as never) as { findings?: { severity: string; code: string; message: string }[] };
  const errors = (lint.findings ?? []).filter(f => f.severity === 'error');
  assert.deepEqual(errors.map(f => `${f.code}: ${f.message}`), []);
});

// ─── Haqiqiy render ───────────────────────────────────────────────────────────

/** Soxta diktor: har sahnaga qisqa ohang (gap uzunligiga qarab), sahnalar orasida jimlik — haqiqiy WAV */
const toneVoicer = async (lines: string[]) => {
  const clips = lines.map((l, i) => {
    const n = Math.round(RATE * (0.8 + l.length / 60));
    const pcm = Buffer.alloc(n * 2);
    for (let k = 0; k < n; k++) pcm.writeInt16LE(Math.round(Math.sin((2 * Math.PI * (300 + i * 80) * k) / RATE) * 8000), k * 2);
    return pcm;
  });
  const j = joinClips(clips);
  return { audio: wavOf(j.pcm), mime: 'audio/wav' as const, starts: j.starts, duration: j.duration };
};

const probe = (file: string) => {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type,width,height,r_frame_rate', '-of', 'json', file], { encoding: 'utf8' });
  return JSON.parse(r.stdout || '{}') as { format?: { duration?: string }; streams?: { codec_type: string; width?: number; height?: number; r_frame_rate?: string }[] };
};

if (!renderAvailable()) {
  console.log("  – haqiqiy render o'tkazib yuborildi: Chrome/Edge topilmadi");
} else {
  const biz = businesses.create(`Video${Date.now()}`, 'x', {
    name: 'Video', ownerName: "Ulug'bek", industry: 'IT', description: '', phone: '', address: '', contentLang: 'uz', brand: { primary: '#000', accent: '#111' }, offerings: [], team: [],
  } as never);
  brandStore.save(biz.id, { whose: 'company', what: '', audience: '', values: '', tone: '', avoid: '', look: '' }, BOOK);
  const v = videoStore.add(biz.id, 'Sinov videosi', SCENES);

  await check("ovoz yozilgach mp4 serverda o'zi yig'iladi: 1080×1920, 30 kadr, ovozli, uzunligi to'g'ri, muqova bor", async () => {
    const voiced = await voiceVideo(biz, v.id, toneVoicer);
    assert.equal(voiced.status, 'voiced');
    const started = Date.now();
    let st = renderState(biz.id, voiced);
    assert.ok(['queued', 'rendering'].includes(st.phase), `render boshlanmadi: ${st.phase}`);
    while (['queued', 'rendering'].includes(st.phase) && Date.now() - started < 8 * 60_000) {
      await new Promise(r => setTimeout(r, 1000));
      st = renderState(biz.id, videoStore.get(biz.id, v.id)!);
    }
    assert.equal(st.phase, 'done', st.error ?? 'vaqt tugadi');
    console.log(`    (render ${((Date.now() - started) / 1000).toFixed(0)} s)`);
    const file = videoMp4(biz.id, v.id);
    assert.ok(file && existsSync(file));
    const p = probe(file);
    const video = p.streams?.find(s => s.codec_type === 'video');
    assert.equal(video?.width, 1080);
    assert.equal(video?.height, 1920);
    assert.equal(video?.r_frame_rate, '30/1');
    assert.ok(p.streams?.some(s => s.codec_type === 'audio'), 'ovoz yo\'q');
    const expected = LEAD + voiced.duration + HOLD;
    assert.ok(Math.abs(Number(p.format?.duration) - expected) < 0.2, `uzunlik ${p.format?.duration} ≠ ${expected}`);
    assert.ok(videoMp4(biz.id, v.id, true), 'muqova yo\'q');
  });

  await check("brend ranglari o'zgarsa video «eskirgan»; boshqa biznes uni ololmaydi", () => {
    const other = businesses.create(`Begona${Date.now()}`, 'x', { name: 'B', ownerName: 'B', industry: 'IT', description: '', phone: '', address: '', contentLang: 'uz', brand: { primary: '#000', accent: '#111' }, offerings: [], team: [] } as never);
    assert.equal(videoMp4(other.id, v.id), null);
    brandStore.save(biz.id, { whose: 'company', what: '', audience: '', values: '', tone: '', avoid: '', look: '' }, { ...BOOK, colors: { ...BOOK.colors, accent: '#D9480F' } });
    assert.equal(renderState(biz.id, videoStore.get(biz.id, v.id)!).phase, 'stale');
  });

  await check("ssenariy tahrirlansa eski mp4 va muqova o'chadi", () => {
    editScenes(biz.id, v.id, SCENES.map((s, i) => (i === 1 ? { ...s, text: 'Yangi fikr' } : s)));
    assert.equal(videoMp4(biz.id, v.id), null);
    assert.equal(videoMp4(biz.id, v.id, true), null);
    assert.equal(renderState(biz.id, videoStore.get(biz.id, v.id)!).phase, 'none');
  });
}

console.log(failed ? `\n${failed} ta tekshiruv yiqildi` : '\nHammasi o\'tdi');
process.exit(failed ? 1 : 0);
