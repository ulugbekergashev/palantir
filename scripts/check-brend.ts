/**
 * Kontent-meyker: brend-buk, kontent reja va video (ssenariy + diktor: Gemini TTS, zaxira — ElevenLabs) — AI'siz tekshiruv.
 * AI o'rnida soxta yozuvchi, Gemini va ElevenLabs o'rnida shu yerda ko'tarilgan soxta serverlar.
 * Ishga tushirish: npm run test:brend
 */
import './isolate';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const { cleanColors, cleanPillars, cleanBook, contrast, makeBrandBook, brandStore, brandNotes, isFullBook, setNarrator } = await import('../server/content/brand');
const { makePlan, planDraft, planStore, cleanPlanItems } = await import('../server/content/plan');
const { cleanScenes, voiceText, makeVideo, videoStore, videoAudio, editScenes, voiceVideo } = await import('../server/content/video');
const { sceneTimes, speakEleven, elevenVoicer, geminiVoicer, liveVoicer, pcmOf, trimSilence, joinClips, wavOf, RATE } = await import('../server/content/speech');
const { sql } = await import('../server/db');
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
  assert.ok(s.reduce((n, x) => n + x.voice.length, 0) <= 700);
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
  assert.equal(got, brandNotes(brandStore.book(biz.id)!));
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
const heard: { lines: string[]; narrator: string }[] = [];
const fakeVoice = async (lines: string[], narrator: string) => {
  heard.push({ lines, narrator });
  return { audio, mime: 'audio/mpeg' as const, starts: lines.map((_, i) => i), duration: lines.length };
};
const noVoice = (why: string) => async () => { throw new ContentError(why); };
await check("video: brend-buksiz — avval brend-buk deyiladi; ovoz bilan — sahna vaqtlari va ovoz fayli", async () => {
  const biz = newBiz('Video');
  await rejects(makeVideo(biz, 'AI xodim', { write: fakeAi, voice: fakeVoice }), /brend-buk/);
  brandStore.save(biz.id, { whose: 'company', what: '', audience: '', values: '', tone: '', avoid: '', look: '' }, BOOK as never);
  replies.push(JSON.stringify(SCRIPT));
  let said = '';
  const v = await makeVideo(biz, 'AI xodim — bu chatbot emas', {
    write: fakeAi,
    voice: elevenVoicer(async text => {
      said = text;
      const n = text.length;
      return { audio, alignment: { characters: [...text], character_start_times_seconds: Array.from({ length: n }, (_, i) => i * 0.05), character_end_times_seconds: Array.from({ length: n }, (_, i) => (i + 1) * 0.05) } };
    }),
  });
  assert.equal(v.status, 'voiced');
  assert.match(said, /ey-ay xodim javob berdi/);
  assert.equal(v.starts.length, v.scenes.length);
  assert.equal(v.starts[0], 0);
  assert.ok(v.starts.every((t, i) => i === 0 || t > v.starts[i - 1]), "sahnalar ketma-ket");
  assert.ok(Math.abs(v.duration - said.length * 0.05) < 1e-9);
  assert.deepEqual(videoAudio(biz.id, v.id), { data: audio, mime: 'audio/mpeg' });
  assert.equal(videoAudio(newBiz('Begona').id, v.id), null, "boshqa biznes ovozni ololmaydi");
  assert.match(prompts.at(-1)!.user, /AI xodim — bu chatbot emas/);
});

await check("video: ovoz yozilmasa — ssenariy qoladi, sababi ko'rinadi; tahrir ovozni o'chiradi va qayta yozdirsa bo'ladi", async () => {
  const biz = newBiz('Ovozsiz');
  brandStore.save(biz.id, { whose: 'company', what: '', audience: '', values: '', tone: '', avoid: '', look: '' }, BOOK as never);
  replies.push(JSON.stringify(SCRIPT));
  const v = await makeVideo(biz, 'Mavzu', { write: fakeAi, voice: noVoice("Gemini limiti tugadi") });
  assert.equal(v.status, 'failed');
  assert.match(v.error ?? '', /limiti tugadi/);
  assert.equal(v.scenes.length, 5);
  const ok = await voiceVideo(biz, v.id, elevenVoicer(async () => ({ audio, alignment: null })));
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
  const v = await makeVideo(biz, 'Mavzu', { write: fakeAi, voice: noVoice("kalit yo'q") });
  const r = await voiceVideo(biz, v.id, async (lines, narrator) => {
    editScenes(biz.id, v.id, v.scenes.map((s, i) => (i === 1 ? { ...s, voice: 'Boshqa gap' } : s)));
    return fakeVoice(lines, narrator);
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
  assert.ok(many.reduce((n, x) => n + x.voice.length, 0) <= 700, 'jami 700 dan oshmaydi');
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
  const v = await makeVideo(biz, b.title, { write: fakeAi, voice: fakeVoice });
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

// ─── To'liq brend-buk ─────────────────────────────────────────────────────────

const FULL = {
  ...BOOK, essence: 'Halol AI xodim', promise: 'Takroriy ishni AI xodim qiladi, siz mijozga vaqt ajratasiz',
  archetype: { name: 'Donishmand', why: 'Sinab, ochiq tushuntiradi' }, story: "O'zim uchun qurdim, keyin klinikalarga berdim.",
  personas: [{ name: 'Band klinika egasi', who: '2 filial, qabulxona yetishmaydi', pains: ['Kechqurun qo\'ng\'iroqqa hech kim javob bermaydi'], wants: ['Bemor yo\'qolmasin'], objections: ['AI o\'zbekcha tushunmaydi'] },
    { name: '' }, 'buzuq'],
  messages: [{ message: 'AI xodim ishlaydi, chatbot gapiradi', proof: 'Jonli namoyish' }],
  difference: ["Chatbot o'rniga — qabulga yozadigan xodim"], traits: [{ trait: 'Halol', is: 'sinalmaganini aytadi', isNot: "va'da bermaydi" }],
  examples: [{ bad: 'Inqilobiy AI yechim!', good: 'AI xodim kechki qo\'ng\'iroqqa javob beradi.' }, { bad: 'faqat yomon' }],
  words: ['AI xodim', 'sinab ko\'rdim'], hooks: Array.from({ length: 14 }, (_, i) => `Ilgak ${i + 1}`), ctas: ['Telegram\'ga «demo» deb yozing'],
  formats: [{ name: "O'zimda sinadim", how: 'Muammo → sinov → natija' }], bio: "Biznesga AI xodim quraman. O'zbek tilida.",
  visualRules: ['Matn faqat plitkada'], motion: 'Plitkalar tushadi', narrator: 'Sulafat',
};

await check("to'liq brend-buk: portretlar, namunalar, ilgaklar tozalanadi; noma'lum diktor — andoza; eski kitob to'ldirib o'qiladi", () => {
  const b = cleanBook(FULL, 'X')!;
  assert.equal(b.personas.length, 1, 'nomsiz va buzuq portret tashlanadi');
  assert.deepEqual(b.personas[0].objections, ["AI o'zbekcha tushunmaydi"]);
  assert.equal(b.examples.length, 1, "yaxshi varianti yo'q namuna tashlanadi");
  assert.equal(b.hooks.length, 10, "ilgaklar 10 tadan oshmaydi");
  assert.equal(b.narrator, 'Sulafat');
  assert.equal(isFullBook(b), true);
  assert.equal(cleanBook({ ...FULL, narrator: 'Robot' }, 'X')!.narrator, 'Charon');
  // Eski andozadagi kitob bazada — o'qilganda yangi maydonlar bo'sh, diktor andoza
  const biz = newBiz('Eski');
  sql.run('INSERT INTO content_brand (business_id, answers, book, updated_at) VALUES (?, ?, ?, ?)', biz.id, '{}', JSON.stringify(BOOK), sql.nowIso());
  const old = brandStore.book(biz.id)!;
  assert.equal(old.positioning, BOOK.positioning);
  assert.deepEqual([old.personas, old.hooks, old.essence, old.narrator], [[], [], '', 'Charon']);
  assert.equal(isFullBook(old), false);
});

await check("diktorni egasi almashtiradi (kitobning qolgani o'zgarmaydi); ro'yxatda yo'q ovoz — rad", () => {
  const biz = newBiz('Diktor');
  assert.throws(() => setNarrator(biz.id, 'Orus'), /brend-buk/);
  brandStore.save(biz.id, { whose: 'personal', what: '', audience: '', values: '', tone: '', avoid: '', look: '' }, cleanBook(FULL, 'X'));
  assert.equal(setNarrator(biz.id, 'Orus').book?.narrator, 'Orus');
  assert.equal(brandStore.book(biz.id)?.essence, FULL.essence);
  assert.throws(() => setNarrator(biz.id, 'Robot'), /ovoz yo'q/);
});

await check("yozuvchiga to'liq kitobdan: va'da, auditoriya, ovoz namunalari, lug'at, ilgaklar va chaqiriqlar boradi", () => {
  const notes = brandNotes(cleanBook(FULL, 'X')!);
  for (const want of [/Promise: Takroriy/, /Band klinika egasi/, /«Inqilobiy AI yechim!» → «AI xodim/, /Words we use: AI xodim/, /Hook patterns: «Ilgak 1»/, /Calls to action: Telegram/, /Never use these words: inqilob/]) {
    assert.match(notes, want);
  }
  assert.doesNotMatch(notes, /Ilgak 6/, 'ilgaklardan faqat 5 tasi');
});

await check("brend-buk so'rovi: diktorlar ro'yxati va to'liq JSON shakli tizim ko'rsatmasida", async () => {
  const biz = newBiz('Sorov');
  replies.push(JSON.stringify(FULL));
  const b = await makeBrandBook(biz, { whose: 'personal' }, 'uz', fakeAi);
  assert.match(prompts.at(-1)!.system, /Charon \(male/);
  assert.match(prompts.at(-1)!.system, /Sulafat \(female/);
  assert.match(prompts.at(-1)!.system, /"personas":/);
  assert.equal(b.book?.narrator, 'Sulafat');
});

// ─── Diktor: PCM ──────────────────────────────────────────────────────────────

const tone = (seconds: number, amp = 8000) => {
  const n = Math.round(seconds * RATE), b = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.sin(i / 3) * amp), i * 2);
  return b;
};
const quiet = (seconds: number) => Buffer.alloc(Math.round(seconds * RATE) * 2);

await check("PCM: WAV sarlavhasi olib tashlanadi; jimlik kesiladi (zaxira bilan); sahnalar pauza bilan, boshlar aniq", () => {
  const clip = Buffer.concat([quiet(1), tone(0.5), quiet(1)]);
  assert.deepEqual(pcmOf(wavOf(clip)), clip, 'WAV → PCM');
  assert.deepEqual(pcmOf(clip), clip, 'xom PCM o\'zi');
  const cut = trimSilence(clip);
  const sec = cut.length / 2 / RATE;
  assert.ok(sec > 0.5 && sec < 0.75, `kesilgani ${sec.toFixed(2)} s`);
  assert.equal(trimSilence(quiet(1)).length, 0, 'butunlay jim — bo\'sh');
  const j = joinClips([tone(1), tone(2), tone(0.5)]);
  assert.deepEqual(j.starts.map(x => +x.toFixed(2)), [0, 1.35, 3.7]);
  assert.equal(+j.duration.toFixed(2), 4.2);
  const w = wavOf(j.pcm);
  assert.equal(w.toString('latin1', 0, 4), 'RIFF');
  assert.equal(w.readUInt32LE(24), RATE);
  assert.equal(w.readUInt32LE(40), j.pcm.length);
});

// ─── Diktor: Gemini (soxta server) ────────────────────────────────────────────

await check("Gemini diktori: har sahna alohida so'rov (ovoz, xom PCM, kalit sarlavhada); band bo'lsa Flash-Lite; xatolar tushunarli; zaxira — ElevenLabs", async () => {
  const seen: { model: string; voice: string; text: string; format: unknown; key: string }[] = [];
  let mode: 'ok' | 'busy-main' | 'gone-main' | 'bad-key' | 'down' = 'ok';
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', c => { raw += c; });
    req.on('end', () => {
      const b = JSON.parse(raw || '{}');
      seen.push({ model: b.model, voice: b.generation_config?.speech_config?.[0]?.voice, text: b.input?.[0]?.content?.[0]?.text, format: b.response_format, key: String(req.headers['x-goog-api-key']) });
      res.setHeader('content-type', 'application/json');
      res.setHeader('connection', 'close');
      if (mode === 'bad-key') { res.statusCode = 400; res.end(JSON.stringify({ error: { message: 'API key not valid. Please pass a valid API key.' } })); return; }
      if (mode === 'down' || (mode === 'busy-main' && b.model === env.geminiTtsModel)) { res.statusCode = 503; res.end(JSON.stringify({ error: { message: 'overloaded' } })); return; }
      if (mode === 'gone-main' && b.model === env.geminiTtsModel) { res.statusCode = 404; res.end(JSON.stringify({ error: { message: 'model not found' } })); return; }
      // Sahna uzunligi matnga qarab: 0,05 s jim + harf boshiga 0,04 s ovoz + 0,3 s jim
      const pcm = Buffer.concat([quiet(0.05), tone(String(b.input[0].content[0].text).length * 0.04), quiet(0.3)]);
      res.end(JSON.stringify({ steps: [{ content: [{ type: 'audio', data: pcm.toString('base64'), mime_type: 'audio/l16' }] }] }));
    });
  });
  await new Promise<void>(r => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  const saved = { root: env.geminiApiRoot, key: env.geminiKey, eleven: env.elevenKey };
  try {
    env.geminiKey = '';
    env.elevenKey = '';
    await rejects(geminiVoicer(['salom'], 'Charon'), /Gemini kaliti yo'q/);
    await rejects(liveVoicer(['salom'], 'Charon'), /Gemini kaliti/);
    env.geminiApiRoot = `http://127.0.0.1:${port}`;
    env.geminiKey = 'AIza-sinov';
    const lines = ['Birinchi gap', 'Ikkinchi, uzunroq gap shu yerda', 'Uch'];
    const v = await geminiVoicer(lines, 'Sulafat');
    assert.equal(seen.length, 3, 'har sahna — bitta so\'rov');
    assert.deepEqual(seen.map(s => s.text).sort(), [...lines].sort());
    assert.ok(seen.every(s => s.voice === 'Sulafat' && s.key === 'AIza-sinov' && s.model === env.geminiTtsModel));
    assert.deepEqual(seen[0].format, { type: 'audio', mime_type: 'audio/l16', sample_rate: RATE });
    assert.equal(v.mime, 'audio/wav');
    assert.equal(v.audio.toString('latin1', 0, 4), 'RIFF');
    assert.equal(v.starts[0], 0);
    // Har sahna: kesilgan ovoz (+0,06 va +0,12 s zaxira) + 0,35 s pauza
    const len = (t: string) => t.length * 0.04 + 0.06 + 0.12;
    assert.ok(Math.abs(v.starts[1] - (len(lines[0]) + 0.35)) < 0.02, `2-sahna ${v.starts[1]}`);
    assert.ok(Math.abs(v.starts[2] - (len(lines[0]) + len(lines[1]) + 0.7)) < 0.03, `3-sahna ${v.starts[2]}`);
    assert.ok(Math.abs(v.duration - (pcmOf(v.audio).length / 2 / RATE)) < 1e-9);
    seen.length = 0;
    mode = 'busy-main';
    await geminiVoicer(['Bitta'], 'Orus');
    assert.deepEqual(seen.map(s => s.model), [env.geminiTtsModel, 'gemini-3.8-flash-lite-tts'], 'asosiy band — Flash-Lite');
    seen.length = 0;
    mode = 'gone-main';
    await geminiVoicer(['Bitta'], 'Orus');
    assert.deepEqual(seen.map(s => s.model), [env.geminiTtsModel, 'gemini-3.8-flash-lite-tts'], 'asosiy model topilmasa (404) — Flash-Lite');
    seen.length = 0;
    mode = 'bad-key';
    await rejects(geminiVoicer(['x'], 'Orus'), /kalitni qabul qilmadi/);
    await rejects(geminiVoicer(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 'Orus'), /kalitni qabul qilmadi/);
    assert.ok(seen.length <= 4, `xatodan keyin qolgan sahnalar yuborilmaydi (${seen.length} so'rov)`);
    mode = 'down';
    await rejects(geminiVoicer(['x'], 'Orus'), /Gemini band \(503\)/);
    // Gemini ovoz bermasa va ElevenLabs kaliti bo'lsa — ElevenLabs (bu yerda u ham yo'q manzil: xato ElevenLabs'niki)
    env.elevenKey = 'sk_test';
    const savedUrl = env.elevenUrl;
    env.elevenUrl = 'http://127.0.0.1:9';
    try { await rejects(liveVoicer(['x'], 'Orus'), /ElevenLabs/); } finally { env.elevenUrl = savedUrl; }
  } finally {
    env.geminiApiRoot = saved.root;
    env.geminiKey = saved.key;
    env.elevenKey = saved.eleven;
    await new Promise<void>(r => server.close(() => r()));
  }
});

await check("video ovozi: diktor brend-bukdan; WAV ovoz to'g'ri turi bilan beriladi", async () => {
  const biz = newBiz('Wav');
  brandStore.save(biz.id, { whose: 'company', what: '', audience: '', values: '', tone: '', avoid: '', look: '' }, cleanBook(FULL, 'X'));
  replies.push(JSON.stringify(SCRIPT));
  const wav = wavOf(tone(1));
  const v = await makeVideo(biz, 'Mavzu', { write: fakeAi, voice: async (lines, narrator) => { heard.push({ lines, narrator }); return { audio: wav, mime: 'audio/wav', starts: lines.map((_, i) => i * 2), duration: lines.length * 2 }; } });
  assert.equal(heard.at(-1)?.narrator, 'Sulafat');
  assert.equal(heard.at(-1)?.lines.length, v.scenes.length);
  assert.deepEqual(videoAudio(biz.id, v.id), { data: wav, mime: 'audio/wav' });
  // Qayta yozdirilsa (endi ElevenLabs mp3) — eski WAV qolmaydi
  await voiceVideo(biz, v.id, fakeVoice);
  assert.deepEqual(videoAudio(biz.id, v.id), { data: audio, mime: 'audio/mpeg' });
  // Tayyor videoni qayta o'qitish yiqilsa — video buzilmaydi, eski ovoz qoladi, sababi aytiladi
  await rejects(voiceVideo(biz, v.id, noVoice('Gemini limiti tugadi')), /limiti tugadi — avvalgi ovoz saqlandi/);
  assert.equal(videoStore.get(biz.id, v.id)?.status, 'voiced');
  assert.deepEqual(videoAudio(biz.id, v.id), { data: audio, mime: 'audio/mpeg' });
});

console.log(failed ? `\n${failed} ta tekshiruv yiqildi` : '\nHammasi o\'tdi');
// process.exit emas: Windows'da fetch ulanishi yopilayotganda chiqilsa Node yiqiladi (UV_HANDLE_CLOSING) — jarayon o'zi tugaydi
process.exitCode = failed ? 1 : 0;
setTimeout(() => process.exit(), 5000).unref();
