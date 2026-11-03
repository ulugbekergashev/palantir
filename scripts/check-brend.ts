/**
 * Kontent-meyker: brend-buk, kontent reja va video (ssenariy + ElevenLabs ovozi) — AI'siz va haqiqiy ElevenLabs'siz tekshiruv.
 * AI o'rnida soxta yozuvchi, ElevenLabs o'rnida shu yerda ko'tarilgan soxta server.
 * Ishga tushirish: npm run test:brend
 */
import './isolate';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const { cleanColors, cleanPillars, cleanBook, contrast, makeBrandBook, brandStore, brandNotes } = await import('../server/content/brand');
const { makePlan, planDraft, planStore, cleanPlanItems } = await import('../server/content/plan');
const { cleanScenes, voiceText, sceneTimes, makeVideo, videoStore, videoAudio, editScenes, speakEleven, voiceVideo } = await import('../server/content/video');
const { jsonIn } = await import('../server/content/writer');
const { topicDraft, ContentError } = await import('../server/content/factory');
const { contentStore } = await import('../server/content/store');
const { classifyLine, containsSecret } = await import('../src/lib/secrets');
const { businesses } = await import('../server/db');
const { env } = await import('../server/env');

let failed = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n    ${(e as Error).stack?.split('\n').slice(0, 3).join('\n    ')}`);
  }
}
const rejects = async (p: Promise<unknown>, re: RegExp) => {
  try { await p; } catch (e) {
    assert.ok(e instanceof ContentError, `ContentError kutilgan edi: ${(e as Error).message}`);
    assert.match(e.message, re);
    return;
  }
  assert.fail('xato kutilgan edi');
};
const newBiz = (name: string) => businesses.create(`${name}${Date.now()}${Math.random().toString(36).slice(2, 6)}`, 'x', {
  name, ownerName: "Ulug'bek", industry: 'IT', description: 'Biznesga AI xodim quradi', phone: '', address: '', contentLang: 'uz',
  brand: { primary: '#000', accent: '#111' }, offerings: [], team: [],
} as never);

const BOOK = {
  name: "Ulug'bek Ergashev", positioning: 'Biznesga AI xodim quraman', tagline: 'Biznesga AI xodim', values: ['amaliy', 'halol'],
  voice: ['Qisqa gaplar', '«Siz» bilan'], banned: ['inqilob'], colors: { bg: '#0E6B66', deep: '#0A524E', surface: '#FBF8F1', ink: '#16337A', accent: '#F4B63F', muted: '#9FB8B5' },
  motif: 'Koshin plitkalari', font: 'Unbounded', pillars: [{ name: 'AI amaliyotda', share: 40, about: '' }, { name: 'Qurilish jurnali', share: 30, about: '' }, { name: 'Saboqlar', share: 30, about: '' }], dont: ['robot rasmlari'],
};
const SCRIPT = {
  scenes: [
    { kind: 'point', text: 'Narxi qancha?', voice: 'Mijoz yozdi: narxi qancha?' },
    { kind: 'point', text: 'Javob berdi', voice: 'AI xodim javob berdi.' },
    { kind: 'point', text: 'Qabulga yozdi', voice: 'Keyin qabulga yozib qo\'ydi.' },
    { kind: 'claim', text: 'AI xodim ishlaydi', voice: 'Chatbot gapiradi. AI xodim ishlaydi.' },
  ],
};

console.log('Brend-buk, reja, video');

// ─── Sof funksiyalar ──────────────────────────────────────────────────────────

await check("ranglar: buzuq hex — andoza rang; plitka ustidagi matn o'qilmasa — qora yoki oq", () => {
  const c = cleanColors({ bg: 'qizil', deep: '#0a524e', surface: '#FFFFFF', ink: '#F0F0F0', accent: '#F4B63F', muted: '#123' });
  assert.equal(c.bg, '#0E6B66');
  assert.equal(c.deep, '#0A524E');
  assert.equal(c.muted, '#9FB8B5');
  assert.equal(c.ink, '#111111', 'oq ustida och kulrang o\'qilmaydi');
  assert.ok(contrast(c.surface, c.ink) >= 4.5);
  assert.equal(cleanColors({ surface: '#FBF8F1', ink: '#16337A' }).ink, '#16337A', "o'qiladigan rang o'zgarmaydi");
});

await check('kontent ustunlari: ulushlar 100 ga keltiriladi, nomsizlari tashlanadi', () => {
  const p = cleanPillars([{ name: 'A', share: 40 }, { name: 'B', share: 40 }, { name: '', share: 20 }, { name: 'C', share: 20 }]);
  assert.deepEqual(p.map(x => x.share), [40, 40, 20]);
  assert.deepEqual(cleanPillars([{ name: 'A' }, { name: 'B' }]).map(x => x.share), [50, 50]);
});

await check("brend-buk: pozitsiyasiz javob yaroqsiz; noma'lum shrift — Unbounded; nom bo'lmasa — biznes nomi", () => {
  assert.equal(cleanBook({ name: 'X' }, 'Y'), null);
  const b = cleanBook({ positioning: 'Biznesga <b>AI</b> xodim quraman', font: 'Comic Sans', values: ['a', '', 'b'] }, 'Sinov')!;
  assert.equal(b.name, 'Sinov');
  assert.equal(b.font, 'Unbounded');
  assert.equal(b.positioning, 'Biznesga bAI/b xodim quraman', 'teg belgilari olib tashlanadi');
  assert.deepEqual(b.values, ['a', 'b']);
  assert.ok(b.tagline);
});

await check("AI javobidagi JSON: ```json blokida ham, gap ichida ham; JSON yo'q — tushunarli xato", () => {
  assert.deepEqual(jsonIn('Mana:\n```json\n{"a": 1}\n```\nTayyor'), { a: 1 });
  assert.deepEqual(jsonIn('Natija {"b": [1, 2]} shu'), { b: [1, 2] });
  assert.throws(() => jsonIn('Kechirasiz, qila olmayman'), /tushunarsiz/);
  assert.throws(() => jsonIn('{buzuq: json'), /tushunarsiz/);
});

await check('reja mavzulari: sarlavhasizi va takrori tashlanadi, ko\'pi kesiladi', () => {
  const items = cleanPlanItems({ items: [{ title: 'A', pillar: 'P', angle: 'x' }, { title: 'a' }, { title: '' }, { title: 'B' }, { title: 'C' }] }, 2);
  assert.deepEqual(items.map(i => i.title), ['A', 'B']);
  assert.equal(items[1].pillar, '—');
});

await check("ssenariy: birinchi sahna — ilgak, oxirgisi — imzo (brend nomi bilan); sahnasi kam javob — bo'sh", () => {
  const s = cleanScenes(SCRIPT, BOOK);
  assert.equal(s[0].kind, 'hook');
  assert.equal(s.at(-1)!.kind, 'sign');
  assert.equal(s.at(-1)!.text, BOOK.name);
  assert.equal(s.at(-1)!.voice, BOOK.tagline, "imzoda diktor gapi bo'lmasa — shior");
  assert.equal(s.length, 5);
  assert.deepEqual(cleanScenes({ scenes: [{ kind: 'hook', text: 'A', voice: 'a' }] }, BOOK), []);
  assert.deepEqual(cleanScenes('yo\'q', BOOK), []);
});

await check('ssenariy: diktor matni uzun bo\'lsa — oxirgi fikrlar olib tashlanadi, ilgak va imzo qoladi', () => {
  const long = 'x'.repeat(230);
  const s = cleanScenes({ scenes: [{ kind: 'hook', text: 'H', voice: long }, ...Array.from({ length: 5 }, (_, i) => ({ kind: 'point', text: `P${i}`, voice: long })), { kind: 'sign', text: 'S', voice: 'imzo' }] }, BOOK);
  assert.ok(s.reduce((n, x) => n + x.voice.length, 0) <= 900);
  assert.equal(s[0].text, 'H');
  assert.equal(s.at(-1)!.kind, 'sign');
  assert.deepEqual(s.filter(x => x.kind === 'point').map(x => x.text), ['P0', 'P1']);
});

await check("diktor matni: «AI» o'zbekchada «ey-ay» bo'lib o'qiladi; har sahna boshlanish o'rni to'g'ri", () => {
  const scenes = [{ kind: 'hook' as const, text: 'A', voice: 'AI xodim' }, { kind: 'sign' as const, text: 'B', voice: 'Salom' }];
  const v = voiceText(scenes, 'uz');
  assert.equal(v.text, 'ey-ay xodim Salom');
  assert.deepEqual(v.offsets, [0, 12]);
  assert.equal(voiceText(scenes, 'ru').text, 'AI xodim Salom');
});

await check("sahna vaqtlari: harf vaqtlaridan; vaqtlar bo'lmasa — matn uzunligiga mutanosib", () => {
  const al = { characters: [...'ab cd'], character_start_times_seconds: [0, 0.1, 0.2, 0.5, 0.6], character_end_times_seconds: [0.1, 0.2, 0.5, 0.6, 0.9] };
  assert.deepEqual(sceneTimes([0, 3], 5, al, 99), { starts: [0, 0.5], duration: 0.9 });
  assert.deepEqual(sceneTimes([0, 5], 10, null, 20), { starts: [0, 10], duration: 20 });
});

await check('ElevenLabs kaliti: tanib olinadi, chalasi — sababi bilan; suhbatda maxfiy deb ko\'riladi', () => {
  const k = `sk_${'a1'.repeat(24)}`;
  assert.equal(classifyLine(k)?.key, 'ELEVENLABS_API_KEY');
  assert.equal(classifyLine(k)?.error, undefined);
  assert.match(classifyLine(k.slice(0, 30))?.error ?? '', /51 belgi/);
  assert.ok(containsSecret(`mana kalit ${k} ishlat`));
});

// ─── Zanjir (soxta AI) ────────────────────────────────────────────────────────

const replies: string[] = [];
const prompts: { system: string; user: string }[] = [];
const fakeAi = async (_b: unknown, system: string, user: string) => {
  prompts.push({ system, user });
  const r = replies.shift();
  if (r === undefined) throw new Error('soxta AI: javob tayyorlanmagan');
  return r;
};

await check("brend-buk: anketa va kitob saqlanadi; yaroqsiz javobda eski kitob qoladi va xato aytiladi", async () => {
  const biz = newBiz('Brend');
  replies.push(`\`\`\`json\n${JSON.stringify(BOOK)}\n\`\`\``);
  const b = await makeBrandBook(biz, { whose: 'personal', what: 'AI xodim quraman', tone: '' }, 'uz', fakeAi);
  assert.equal(b.book?.positioning, BOOK.positioning);
  assert.equal(b.answers.whose, 'personal');
  assert.match(prompts.at(-1)!.user, /personal brand/);
  assert.match(prompts.at(-1)!.user, /not answered/, "javobsiz savol — profildan olinadi deb aytiladi");
  replies.push('Kechirasiz');
  await rejects(makeBrandBook(biz, { whose: 'personal', what: 'boshqa' }, 'uz', fakeAi), /tushunarsiz/);
  assert.equal(brandStore.book(biz.id)?.positioning, BOOK.positioning, 'eski kitob o\'chmadi');
  assert.equal(brandStore.get(biz.id)?.answers.what, 'boshqa', 'yangi anketa saqlandi');
});

await check("post yozuvchisiga brend-buk qoidalari boradi (ovoz, taqiqlangan so'zlar)", async () => {
  const biz = newBiz('Yozuv');
  brandStore.save(biz.id, { whose: 'company', what: '', audience: '', values: '', tone: '', avoid: '', look: '' }, BOOK as never);
  let got = '';
  await topicDraft(biz, 'AI xodim nima', async (_b, s) => { got = s.brand ?? ''; return { text: 'Post', sourceUrl: null }; });
  assert.equal(got, brandNotes(BOOK as never));
  assert.match(got, /Never use these words: inqilob/);
});

await check("reja: brend-buk bo'lmasa — avval u yoziladi; mavzu soni chegarada; yangi reja ishi bor mavzularni saqlaydi", async () => {
  const biz = newBiz('Reja');
  replies.push(JSON.stringify(BOOK), JSON.stringify({ items: Array.from({ length: 40 }, (_, i) => ({ pillar: 'AI amaliyotda', title: `Mavzu ${i + 1}`, angle: 'misol' })) }));
  const r = await makePlan(biz, 100, '', fakeAi);
  assert.equal(r.madeBrand, true);
  assert.equal(r.items.length, 30, 'eng ko\'pi 30');
  assert.ok(brandStore.book(biz.id));
  const first = r.items[0];
  const d = await planDraft(biz, first.id, async () => ({ text: 'Reja posti', sourceUrl: null }));
  assert.equal(planStore.get(biz.id, first.id)?.draftId, d.id);
  assert.equal(contentStore.draft(biz.id, d.id)?.topic?.startsWith('Mavzu 1'), true);
  replies.push(JSON.stringify({ items: [{ pillar: 'Saboqlar', title: 'Yangi mavzu', angle: '' }] }));
  const again = await makePlan(biz, 5, '', fakeAi);
  assert.equal(again.madeBrand, false);
  assert.deepEqual(again.items.map(i => i.title), ['Mavzu 1', 'Yangi mavzu'], 'post yozilgan mavzu qoladi, yangisi keyin');
});

const audio = Buffer.from('ID3-soxta-mp3');
await check("video: brend-buksiz — avval brend-buk deyiladi; ovoz bilan — sahna vaqtlari va ovoz fayli", async () => {
  const biz = newBiz('Video');
  await rejects(makeVideo(biz, 'AI xodim', { write: fakeAi, speak: async () => ({ audio, alignment: null }) }), /brend-buk/);
  brandStore.save(biz.id, { whose: 'company', what: '', audience: '', values: '', tone: '', avoid: '', look: '' }, BOOK as never);
  replies.push(JSON.stringify(SCRIPT));
  let said = '';
  const v = await makeVideo(biz, 'AI xodim — bu chatbot emas', {
    write: fakeAi,
    speak: async text => {
      said = text;
      const n = text.length;
      return { audio, alignment: { characters: [...text], character_start_times_seconds: Array.from({ length: n }, (_, i) => i * 0.05), character_end_times_seconds: Array.from({ length: n }, (_, i) => (i + 1) * 0.05) } };
    },
  });
  assert.equal(v.status, 'voiced');
  assert.match(said, /ey-ay xodim javob berdi/);
  assert.equal(v.starts.length, v.scenes.length);
  assert.equal(v.starts[0], 0);
  assert.ok(v.starts.every((t, i) => i === 0 || t > v.starts[i - 1]), "sahnalar ketma-ket");
  assert.ok(Math.abs(v.duration - said.length * 0.05) < 1e-9);
  assert.deepEqual(videoAudio(biz.id, v.id), audio);
  assert.equal(videoAudio(newBiz('Begona').id, v.id), null, "boshqa biznes ovozni ololmaydi");
  assert.match(prompts.at(-1)!.user, /AI xodim — bu chatbot emas/);
});

await check("video: ovoz yozilmasa — ssenariy qoladi, sababi ko'rinadi; tahrir ovozni o'chiradi va qayta yozdirsa bo'ladi", async () => {
  const biz = newBiz('Ovozsiz');
  brandStore.save(biz.id, { whose: 'company', what: '', audience: '', values: '', tone: '', avoid: '', look: '' }, BOOK as never);
  replies.push(JSON.stringify(SCRIPT));
  const v = await makeVideo(biz, 'Mavzu', { write: fakeAi, speak: async () => { throw new ContentError("ElevenLabs hisobida kredit tugadi"); } });
  assert.equal(v.status, 'failed');
  assert.match(v.error ?? '', /kredit/);
  assert.equal(v.scenes.length, 5);
  const ok = await voiceVideo(biz, v.id, async () => ({ audio, alignment: null }));
  assert.equal(ok.status, 'voiced');
  assert.ok(ok.duration > 0, "harf vaqtlari bo'lmasa — fayl hajmidan");
  const edited = editScenes(biz.id, v.id, ok.scenes.map((s, i) => (i === 0 ? { ...s, text: 'Yangi ilgak' } : s)));
  assert.equal(edited.status, 'script');
  assert.equal(edited.scenes[0].text, 'Yangi ilgak');
  assert.equal(videoAudio(biz.id, v.id), null, 'eski ovoz o\'chdi');
  assert.throws(() => editScenes(biz.id, v.id, ok.scenes.slice(0, 2)), /Kamida 3/);
  assert.equal(videoStore.remove(biz.id, v.id), true);
});

await check("ovoz yozilayotganda ssenariy tahrirlansa — eski matn ovozi yangi ssenariyga yopishmaydi", async () => {
  const biz = newBiz('Poyga');
  brandStore.save(biz.id, { whose: 'company', what: '', audience: '', values: '', tone: '', avoid: '', look: '' }, BOOK as never);
  replies.push(JSON.stringify(SCRIPT));
  const v = await makeVideo(biz, 'Mavzu', { write: fakeAi, speak: async () => { throw new ContentError('kalit yo\'q'); } });
  const r = await voiceVideo(biz, v.id, async () => {
    editScenes(biz.id, v.id, v.scenes.map((s, i) => (i === 1 ? { ...s, voice: 'Boshqa gap' } : s)));
    return { audio, alignment: null };
  });
  assert.equal(r.status, 'failed');
  assert.match(r.error ?? '', /ssenariy o'zgardi/);
  assert.equal(videoAudio(biz.id, v.id), null);
});

await check("ssenariy: bo'sh diktor gapi — ekrandagi yozuv o'qiladi; fikrsiz uzun ssenariy ham chegaraga tushadi", () => {
  const s = cleanScenes({ scenes: [{ kind: 'hook', text: 'Ilgak', voice: '' }, { kind: 'point', text: 'Bir', voice: 'bir' }, { kind: 'claim', text: 'Da\'vo', voice: 'davo' }] }, BOOK);
  assert.equal(s[0].voice, 'Ilgak');
  const long = 'y'.repeat(240);
  const many = cleanScenes({ scenes: [{ kind: 'hook', text: 'H', voice: long }, ...Array.from({ length: 5 }, () => ({ kind: 'claim', text: 'C', voice: long }))] }, BOOK);
  assert.ok(many.reduce((n, x) => n + x.voice.length, 0) <= 900, 'jami 900 dan oshmaydi');
  assert.equal(many[0].text, 'H');
  assert.equal(many.at(-1)!.kind, 'sign');
});

await check("video o'chirilsa yoki post bekor qilinsa — mavzu yana bo'sh («Video» / «Post» tugmasi qaytadi), yangi rejada almashadi", async () => {
  const biz = newBiz('Bog');
  brandStore.save(biz.id, { whose: 'company', what: '', audience: '', values: '', tone: '', avoid: '', look: '' }, BOOK as never);
  replies.push(JSON.stringify({ items: [{ pillar: 'P', title: 'Bir', angle: '' }, { pillar: 'P', title: 'Ikki', angle: '' }] }));
  const [a, b] = (await makePlan(biz, 5, '', fakeAi)).items;
  const d = await planDraft(biz, a.id, async () => ({ text: 'Post', sourceUrl: null }));
  replies.push(JSON.stringify(SCRIPT));
  const v = await makeVideo(biz, b.title, { write: fakeAi, speak: async () => ({ audio, alignment: null }) });
  planStore.link(biz.id, b.id, 'video_id', v.id);
  assert.equal(planStore.get(biz.id, b.id)?.videoId, v.id);
  videoStore.remove(biz.id, v.id);
  assert.equal(planStore.get(biz.id, b.id)?.videoId, null, "o'chgan videoga bog'lanish qolmadi");
  contentStore.move(biz.id, d.id, ['draft'], 'cancelled');
  assert.equal(planStore.get(biz.id, a.id)?.draftId, null, 'bekor qilingan post mavzuni band qilmaydi');
  replies.push(JSON.stringify({ items: [{ pillar: 'P', title: 'Yangi', angle: '' }] }));
  assert.deepEqual((await makePlan(biz, 5, '', fakeAi)).items.map(i => i.title), ['Yangi'], 'ishsiz qolgan mavzular yangi reja bilan almashdi');
});

// ─── ElevenLabs (soxta server) ────────────────────────────────────────────────

await check("ElevenLabs so'rovi: kalit sarlavhada, model va matn tanada, javob — mp3 va harf vaqtlari; xatolar tushunarli", async () => {
  const seen: { url: string; key: string; body: { text?: string; model_id?: string } }[] = [];
  let mode: 'ok' | 'auth' | 'credits' = 'ok';
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      seen.push({ url: req.url ?? '', key: String(req.headers['xi-api-key']), body: JSON.parse(raw || '{}') });
      res.setHeader('content-type', 'application/json');
      res.setHeader('connection', 'close');
      if (mode === 'auth') { res.statusCode = 401; res.end(JSON.stringify({ detail: { status: 'invalid_api_key', message: 'Invalid API key' } })); return; }
      if (mode === 'credits') { res.statusCode = 400; res.end(JSON.stringify({ detail: { status: 'quota_exceeded', message: 'You have 3 credits remaining' } })); return; }
      res.end(JSON.stringify({ audio_base64: audio.toString('base64'), alignment: { characters: ['a'], character_start_times_seconds: [0], character_end_times_seconds: [0.4] } }));
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  const saved = { url: env.elevenUrl, key: env.elevenKey };
  try {
    env.elevenKey = '';
    await rejects(speakEleven('salom'), /kaliti yo'q/);
    env.elevenUrl = `http://127.0.0.1:${port}`;
    env.elevenKey = 'sk_test';
    const s = await speakEleven('salom dunyo');
    assert.deepEqual(s.audio, audio);
    assert.equal(s.alignment?.character_end_times_seconds[0], 0.4);
    assert.match(seen[0].url, new RegExp(`^/v1/text-to-speech/${env.elevenVoice}/with-timestamps\\?output_format=mp3_44100_128$`));
    assert.equal(seen[0].key, 'sk_test');
    assert.deepEqual(seen[0].body, { text: 'salom dunyo', model_id: env.elevenModel });
    mode = 'auth';
    await rejects(speakEleven('x'), /kalitni qabul qilmadi: Invalid API key/);
    mode = 'credits';
    await rejects(speakEleven('x'), /kredit tugadi/);
  } finally {
    env.elevenUrl = saved.url;
    env.elevenKey = saved.key;
    await new Promise<void>(r => server.close(() => r()));
  }
});

console.log(failed ? `\n${failed} ta tekshiruv yiqildi` : '\nHammasi o\'tdi');
// process.exit emas: Windows'da fetch ulanishi yopilayotganda chiqilsa Node yiqiladi (UV_HANDLE_CLOSING) — jarayon o'zi tugaydi
process.exitCode = failed ? 1 : 0;
setTimeout(() => process.exit(), 5000).unref();
