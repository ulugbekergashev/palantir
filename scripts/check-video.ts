/**
 * Video renderi (HyperFrames): kompozitsiya (sof funksiyalar, xavfsiz matn, HyperFrames lint) va haqiqiy render — soxta ovoz
 * bilan qisqa video Chrome + ffmpeg orqali mp4 bo'ladi, muqova chiqadi, brend o'zgarsa «eskirgan», ssenariy tahrirlansa o'chadi.
 * Qo'shimchalar (media.ts): so'zlarni moslash, musiqa ulanishi, rasm so'rovi, soxta Gemini bilan tayyorlash — rasm va musiqa videoga tushadi.
 * Ishga tushirish: npm run test:video (kompyuterda Chrome yoki Edge va ffmpeg/ffprobe kerak; render ~1 daqiqa).
 */
import './isolate';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.VIDEO_RENDER = 'on';
// Qo'shimchalar faqat Gemini kaliti bo'lsa so'raladi — sinovda kalit soxta, javoblar soxta (setMediaDeps)
process.env.GEMINI_API_KEY = 'sinov-kalit';
const { buildComposition, wordTimes, captionGroups, palette, esc, shortCta, musicTags, LEAD, HOLD, MUSIC_LOOP } = await import('../server/content/composition');
const { alignWords, heardWords, imagePrompt, ensureMedia, wantsImage } = await import('../server/content/media');
const { cleanBook, brandStore } = await import('../server/content/brand');
const { videoStore, voiceVideo, editScenes, videoAssetDir, cleanScenes } = await import('../server/content/video');
const { renderState, videoMp4, renderAvailable, setMediaDeps } = await import('../server/content/render');
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

// ─── Qo'shimchalar ───────────────────────────────────────────────────────────

await check("eshitilgan so'zlar: «0.800s» → soniya; so'z soni teng bo'lsa — tartib bo'yicha, bo'lmasa harf ulushi bo'yicha (sahna oynasida)", () => {
  const heard = heardWords([
    { type: 'word_info', text: 'Salom', start_offset: '0.100s', end_offset: '0.500s' },
    { type: 'word_info', text: 'dunyo.', start_offset: '0.500s', end_offset: '1.000s' },
    { type: 'word_info', text: 'Soat', start_offset: '1.400s', end_offset: '1.700s' },
    { type: 'word_info', text: '18:00', start_offset: '1.700s', end_offset: '2.300s' },
    { type: 'word_info', text: 'keldi.', start_offset: '2.300s', end_offset: '2.700s' },
    { type: 'boshqa', text: 'x' },
  ]);
  assert.equal(heard.length, 5);
  assert.deepEqual(heard[1], { text: 'dunyo.', start: 0.5, end: 1 });
  const w = alignWords(['Salom dunyo.', "Soat o'nda qo'ng'iroq keldi."], [0.1, 1.4], 2.7, heard)!;
  assert.deepEqual(w[0].map(x => [x.start, x.end]), [[0.1, 0.5], [0.5, 1]]);
  assert.equal(w[1].length, 4, "ssenariydagi so'zlar soni saqlanadi");
  assert.equal(w[1][0].start, 1.4);
  assert.ok(Math.abs(w[1][3].end - 2.7) < 0.01);
  for (let k = 1; k < 4; k++) assert.ok(w[1][k].start >= w[1][k - 1].start, 'ketma-ket');
  assert.equal(alignWords(['Salom', 'Yana'], [0, 5], 6, heard.slice(0, 2)), null, "sahnada hech narsa eshitilmasa — taxminiy vaqtga qaytiladi");
});

await check("musiqa: video 30 s dan uzun bo'lsa ikkinchi nusxa yumshoq ulanadi; diktor paytida past, oxirida so'nadi", () => {
  const one = musicTags('music.mp3', 20, 17);
  assert.equal((one.match(/<audio/g) ?? []).length, 1);
  const two = musicTags('music.mp3', 36, 33.7);
  const tags = [...two.matchAll(/data-start="([\d.]+)" data-duration="([\d.]+)" data-volume="1" data-automation='([^']+)'/g)];
  assert.equal(tags.length, 2);
  assert.equal(Number(tags[1][1]), MUSIC_LOOP - 1.5, 'ikkinchisi birinchisi so\'nayotganda kiradi');
  const lanes = tags.map(t => (JSON.parse(t[3]) as { lanes: { points: { t: number; v: number }[] }[] }).lanes[0].points);
  assert.equal(lanes[0][0].v, 0, 'boshida jim');
  assert.equal(lanes[0].at(-1)!.v, 0, "birinchisi so'nib tugaydi");
  assert.equal(lanes[1][0].v, 0, 'ikkinchisi jimdan kiradi');
  assert.equal(lanes[1].at(-1)!.v, 0, 'video oxirida jim');
  assert.ok(lanes.flat().every(p => p.v >= 0 && p.v <= 0.35), 'diktorni bosmaydi');
});

await check("rasm so'rovi: sahna tavsifi, brend ranglari, matnsiz va yuzsiz; da'vo va imzoga rasm chizilmaydi", () => {
  const p = imagePrompt('a phone glowing on an empty clinic desk at dusk', { ...BOOK, dont: ['robot rasmlari'] });
  assert.ok(p.includes('phone glowing') && p.includes(BOOK.colors.bg) && p.includes(BOOK.colors.accent));
  assert.match(p, /No text/);
  assert.match(p, /No recognizable faces/);
  assert.match(p, /Avoid: robot rasmlari/);
  assert.deepEqual(['hook', 'point', 'claim', 'sign'].map(wantsImage), [true, true, false, false]);
});

await check("ssenariy: rasm tavsifi saqlanadi; tahrirda tavsifi o'zgarmagan sahna rasmi qoladi, o'zgargani o'chadi", () => {
  const sc = cleanScenes({ scenes: [{ kind: 'hook', text: 'A', voice: 'A gap', visual: 'desk at dusk' }, { kind: 'point', text: 'B', voice: 'B gap', visual: 'hands on phone' }, { kind: 'claim', text: 'C', voice: 'C gap' }] }, BOOK);
  assert.equal(sc[0].visual, 'desk at dusk');
  const biz = businesses.create(`Tahrir${Date.now()}`, 'x', { name: 'T', ownerName: 'T', industry: 'IT', description: '', phone: '', address: '', contentLang: 'uz', brand: { primary: '#000', accent: '#111' }, offerings: [], team: [] } as never);
  const v = videoStore.add(biz.id, 'Tahrir', sc);
  const dir = videoAssetDir(v.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'scene-0.jpg'), 'a');
  writeFileSync(join(dir, 'scene-1.jpg'), 'b');
  writeFileSync(join(dir, 'music.mp3'), 'm');
  // Panel tahrirlagichi tavsifni yubormaydi — avvalgisi saqlanadi; 2-sahna turi o'zgardi (fikr → da'vo) — uning rasmi o'chadi
  editScenes(biz.id, v.id, [{ kind: 'hook', text: 'A2', voice: 'A gap 2' }, { kind: 'claim', text: 'B', voice: 'B gap' }, { kind: 'claim', text: 'C', voice: 'C gap' }, { kind: 'sign', text: 'D', voice: 'D gap' }]);
  assert.equal(videoStore.get(biz.id, v.id)!.scenes[0].visual, 'desk at dusk');
  assert.deepEqual(readdirSync(dir).sort(), ['music.mp3', 'scene-0.jpg']);
});

/** Soxta Gemini: rasm — ffmpeg chizgan jpg, musiqa — 30 s ohang (mp3), transcribe — har sahna so'zlari ovoz vaqtlari bilan */
const scratch = mkdtempSync(join(tmpdir(), 'palantir-media-'));
const ff = (args: string[]) => { const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); };
ff(['-f', 'lavfi', '-i', 'gradients=s=768x1376:c0=0x1F8A8A:c1=0xE3A21A:d=1', '-frames:v', '1', join(scratch, 'img.jpg')]);
ff(['-f', 'lavfi', '-i', 'sine=frequency=220:duration=30', '-c:a', 'libmp3lame', '-b:a', '96k', join(scratch, 'music.mp3')]);
const calls = { image: 0, music: 0, transcribe: 0 };
const fakeMedia = {
  image: async (prompt: string) => { calls.image++; if (prompt.includes('YIQIL')) throw new Error('soxta xato'); return readFileSync(join(scratch, 'img.jpg')); },
  music: async () => { calls.music++; return readFileSync(join(scratch, 'music.mp3')); },
  transcribe: async () => { calls.transcribe++; return [] as { text: string; start: number; end: number }[]; },
};

await check("qo'shimchalar: faqat yetishmagani so'raladi, rasm faqat ilgak va fikrlarga, bitta rasm xatosi boshqalarni to'xtatmaydi", async () => {
  const dir = join(scratch, 'v1');
  const v = { id: 'v1', topic: 'Sinov', status: 'voiced', error: null, starts: [0, 1, 2, 3], duration: 4, createdAt: '', music: 'calm pads',
    scenes: [{ kind: 'hook', text: 'A', voice: 'a', visual: 'desk' }, { kind: 'point', text: 'B', voice: 'b', visual: 'YIQIL' }, { kind: 'claim', text: 'C', voice: 'c' }, { kind: 'sign', text: 'D', voice: 'd' }] } as never;
  writeFileSync(join(scratch, 'voice.wav'), 'w');
  const steps: string[] = [];
  await ensureMedia(v, BOOK, 'uz', dir, { file: join(scratch, 'voice.wav'), mime: 'audio/wav' }, s => steps.push(s), fakeMedia);
  assert.deepEqual(readdirSync(dir).sort(), ['music.mp3', 'scene-0.jpg'], "xato bergan rasm yo'q, qolgani bor; so'z vaqtlari bo'sh bo'lsa yozilmaydi");
  assert.deepEqual(calls, { image: 2, music: 1, transcribe: 1 });
  assert.ok(steps.length > 0);
  await ensureMedia(v, BOOK, 'uz', dir, { file: join(scratch, 'voice.wav'), mime: 'audio/wav' }, () => undefined, fakeMedia);
  assert.deepEqual(calls, { image: 3, music: 1, transcribe: 2 }, 'bor rasm va musiqa qayta so\'ralmaydi (faqat yetishmagan rasm va vaqtlar)');
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
  const v = videoStore.add(biz.id, 'Sinov videosi', SCENES.map(s => (s.kind === 'hook' || s.kind === 'point' ? { ...s, visual: 'a calm clinic desk at dusk' } : s)), 'calm pads');
  setMediaDeps(fakeMedia);

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
    const assets = readdirSync(videoAssetDir(v.id)).sort();
    assert.deepEqual(assets, ['music.mp3', 'scene-0.jpg', 'scene-1.jpg'], 'rasmlar va musiqa tayyorlangan');
  });

  await check("tayyor video — Telegram kanaliga (mp4 va izoh, bir marta) va Targetolog tanloviga («video:<id>»)", async () => {
    const { videoToChannel, readyVideos } = await import('../server/content/publish');
    const { setChannelOutlet, ContentError } = await import('../server/content/factory');
    const { contentStore } = await import('../server/content/store');
    const { availableImages } = await import('../server/ads/planner');
    const { events } = await import('../server/orders/store');
    const sentVideos: { chat: string; file: string; caption: string }[] = [];
    setChannelOutlet({ resolve: async () => ({ id: '-100777', title: 'Kanal' }), post: async () => 1, postVideo: async (chat, file, caption) => { sentVideos.push({ chat, file, caption }); return 42; } });
    await assert.rejects(videoToChannel(biz, v.id, 'Izoh'), (e: Error) => e instanceof ContentError && /Kanal ulanmagan/.test(e.message));
    contentStore.saveSettings(biz.id, { channelId: '-100777', channelTitle: 'Kanal' });
    await assert.rejects(videoToChannel(biz, v.id, 'x'.repeat(1025)), /1024/);
    const out = await videoToChannel(biz, v.id, 'Implant haqida 30 soniya');
    assert.ok(out.channelAt, 'kanalga chiqqan vaqti yozildi');
    assert.deepEqual(sentVideos.map(x => [x.chat, x.file.endsWith('.mp4'), x.caption]), [['-100777', true, 'Implant haqida 30 soniya']]);
    await assert.rejects(videoToChannel(biz, v.id, 'yana'), /allaqachon/);
    assert.equal(sentVideos.length, 1, 'ikkinchi nusxa chiqmadi');
    assert.ok(events.since(biz.id, new Date(Date.now() - 60_000).toISOString()).some(e => e.member === 'kontent' && e.title.startsWith('Kanalga video joylandi')));
    assert.deepEqual(readyVideos(biz.id).map(x => x.id), [v.id]);
    assert.ok(availableImages(biz.id).some(i => i.ref === `video:${v.id}` && i.label.startsWith('Video (')), 'Targetolog videoni tanlay oladi');
    setChannelOutlet(null);
  });

  await check("brend ranglari o'zgarsa video «eskirgan»; boshqa biznes uni ololmaydi", () => {
    const other = businesses.create(`Begona${Date.now()}`, 'x', { name: 'B', ownerName: 'B', industry: 'IT', description: '', phone: '', address: '', contentLang: 'uz', brand: { primary: '#000', accent: '#111' }, offerings: [], team: [] } as never);
    assert.equal(videoMp4(other.id, v.id), null);
    brandStore.save(biz.id, { whose: 'company', what: '', audience: '', values: '', tone: '', avoid: '', look: '' }, { ...BOOK, colors: { ...BOOK.colors, accent: '#D9480F' } });
    assert.equal(renderState(biz.id, videoStore.get(biz.id, v.id)!).phase, 'stale');
  });

  await check("eskirgan video reklamaga taklif qilinmaydi va kanalga yuborilmaydi", async () => {
    const { readyVideos, videoToChannel } = await import('../server/content/publish');
    assert.deepEqual(readyVideos(biz.id), []);
    const fresh = videoStore.add(biz.id, 'Boshqa', SCENES);
    await assert.rejects(videoToChannel(biz, fresh.id, 'x'), /yig'ilmagan/);
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
