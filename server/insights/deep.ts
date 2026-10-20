/**
 * Chuqur tahlil (Tahlilchi → «Kashfiyotlar»): biznesning hamma ma'lumoti (dataset.ts — DentaCRM, kamera, qo'ng'iroq, yozishma, so'rov)
 * CSV bo'lib Claude'ning Python muhitiga yuklanadi va model o'zi tahlil qiladi: o'rtachalar, segmentlar (jins, yosh, soat, kun,
 * shifokor, kanal, yangi/qaytgan), voronka, qaytish, anomaliyalar. Faqat raqam va namuna hajmi bilan isbotlangan topilmalar qoladi;
 * natija — topilmalar, grafiklar va ma'lumot sifati haqida izoh. Fonda ishlaydi (bir necha daqiqa), bazada saqlanadi; yuklangan fayllar o'chiriladi.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type Anthropic from '@anthropic-ai/sdk';
import { toFile } from '@anthropic-ai/sdk';
import { claude, costUsd, thinkStream } from '../claude';
import { newId, sql, type BusinessRow } from '../db';
import { env } from '../env';
import { buildDataset } from './dataset';
import { staleReason } from './rerun';
import type { Dataset } from './tables';

export interface Finding { title: string; metric: string; detail: string; evidence: string; action: string; impact: 'high' | 'medium' | 'low'; chart: string | null }
export interface DeepInsights {
  id: string; createdAt: string; from: string; to: string;
  data: { name: string; rows: number }[]; notes: string[];
  headline: string; findings: Finding[]; quality: string[]; next: string[]; charts: string[];
  /** Taxminiy narx, $ (eski natijalarda yo'q) */
  cost?: number;
}
/** Ma'lumot oxirgi tahlildan beri deyarli o'zgarmagan — model chaqirilmadi */
export class FreshEnough extends Error {}

const MAX_TURNS = 8;
const MAX_FINDINGS = 15;
const CHART = /\.(png|jpe?g|svg)$/i;
export const chartsDir = (bizId: string, run: string) => join(env.dataDir, 'tahlil', bizId.replace(/[^\w-]/g, ''), run.replace(/[^\w-]/g, ''));

sql.exec(`CREATE TABLE IF NOT EXISTS deep_insights (id TEXT PRIMARY KEY, business_id TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS deep_insights_biz ON deep_insights (business_id, created_at);`);
export const deepStore = {
  latest: (bizId: string): DeepInsights | null => sql.one('SELECT data FROM deep_insights WHERE business_id = ? ORDER BY created_at DESC LIMIT 1', r => JSON.parse(String(r.data)) as DeepInsights, bizId) ?? null,
  save: (bizId: string, x: DeepInsights) => sql.run('INSERT INTO deep_insights (id, business_id, data, created_at) VALUES (?, ?, ?, ?)', x.id, bizId, JSON.stringify(x), x.createdAt),
};

export const ANALYST = `You are the business's senior data analyst. The owner wants to understand the business from its data and act on it — find what a manager would never think to check, but prove every claim.
The data files are CSVs in your working directory (described in the message). Customer and patient codes are pseudonymous; there are no names or message texts.
Work like this:
1. Load every file with pandas; check rows, date ranges, missing values and obvious errors. Note data-quality problems.
2. Explore broadly before concluding. Do it systematically in code, not one combination at a time: for each key metric (no-show, waiting, chair minutes, check size, rating, coming back) compare every segment of every dimension and of every pair of dimensions with the rest, keep those with n ≥ 20 and a large effect, then verify the strongest. Cover: averages and distributions (visit length, waiting time, check size, revenue per patient, reply time); time patterns (hour × weekday, week-over-week trend); segments (gender, age bands, new vs returning, doctor, service type, channel, VIP); the funnel (inquiry → visit → payment, no-shows, cancellations, reminder-call results); returning (share of patients who come back within 30/90/180 days); doctors (load, chair minutes, average check, rating, no-show rate); anomalies (days, hours or doctors far from normal — IQR or z-score; sudden drops or spikes; camera chair time vs visits in the CRM; payments without visits and visits without payments); combinations of factors (e.g. gender × hour × service).
3. Prove, don't guess: keep a pattern only with its sample size and effect size; with fewer than 20 cases say it is tentative or drop it; prefer medians and IQR; for every comparison give both numbers. Correlation is not cause — say so where it matters.
4. Work economically — every printed line is re-read at each later step: batch many checks into one code run, print only compact aggregate tables (no raw rows or whole dataframes, about 40 lines per run at most), never re-print what you already know.
5. Save 3–6 clear charts as PNG files (matplotlib, readable labels) in /tmp/outputs/.
Finally reply with only a JSON object in a \`\`\`json block:
{"headline": "two sentences — the most important thing", "findings": [{"title": "short", "metric": "the key number, e.g. 38% / 2.4x / −1.2 mln so'm", "detail": "what exactly, with numbers and sample size", "evidence": "how it was computed", "action": "what the owner should do", "impact": "high|medium|low", "chart": "file name or null"}], "quality": ["data problems worth fixing"], "next": ["questions worth checking once more data exists"]}
8–15 findings ranked by business impact (money or patients). Write everything in Uzbek (Latin script); keep numbers as numbers. No patient-level details.`;

const textOf = (content: Anthropic.Beta.BetaContentBlock[]) => content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('\n');
/** Model javobidan JSON (```json bloki yoki oxirgi {…}) */
export function parseFindings(text: string): Pick<DeepInsights, 'headline' | 'findings' | 'quality' | 'next'> | null {
  const raw = /```json\s*([\s\S]*?)```/.exec(text)?.[1] ?? /\{[\s\S]*\}/.exec(text)?.[0];
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as { headline?: unknown; findings?: unknown[]; quality?: unknown[]; next?: unknown[] };
    const s = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n);
    const findings = (j.findings ?? []).map(f => f as Record<string, unknown>).map(f => ({
      title: s(f.title, 160), metric: s(f.metric, 60), detail: s(f.detail, 900), evidence: s(f.evidence, 500), action: s(f.action, 400),
      impact: (['high', 'medium', 'low'].includes(String(f.impact)) ? f.impact : 'medium') as Finding['impact'],
      chart: f.chart ? basename(String(f.chart)) : null,
    })).filter(f => f.title && f.detail).slice(0, MAX_FINDINGS);
    return { headline: s(j.headline, 500), findings, quality: (j.quality ?? []).map(x => s(x, 300)).filter(Boolean).slice(0, 10), next: (j.next ?? []).map(x => s(x, 300)).filter(Boolean).slice(0, 10) };
  } catch {
    return null;
  }
}

/** Python muhitida yaratilgan fayllar (grafiklar) id'lari */
function outputFiles(content: Anthropic.Beta.BetaContentBlock[]): string[] {
  const ids: string[] = [];
  for (const b of content) {
    if (b.type !== 'bash_code_execution_tool_result') continue;
    const r = b.content;
    if (r.type === 'bash_code_execution_result') for (const f of r.content) if (f.type === 'bash_code_execution_output') ids.push(f.file_id);
  }
  return ids;
}

const describe = (d: Dataset) => [
  `Business data from ${d.from} to ${d.to}. Files:`,
  ...d.files.map(f => `- ${f.name} (${f.rows} rows): ${f.about}`),
  ...(d.notes.length ? ['Not available:', ...d.notes.map(n => `- ${n}`)] : []),
].join('\n');

/**
 * prepared — tayyor to'plam (namoyish va sinov uchun); bo'lmasa biznesning o'z ma'lumotidan yig'iladi.
 * force — ma'lumot deyarli o'zgarmagan bo'lsa ham qayta tahlil (aks holda FreshEnough, pul ketmaydi)
 */
export async function runDeepAnalysis(biz: BusinessRow, { days = 365, prepared, force = false }: { days?: number; prepared?: Dataset; force?: boolean } = {}): Promise<DeepInsights> {
  const data = prepared ?? await buildDataset(biz, days);
  if (!data.files.some(f => f.rows >= 10)) throw new Error("Tahlil uchun ma'lumot hali kam — DentaCRM'ni ulang yoki mijozlar yozib, qo'ng'iroq qilgan sari qayta urining");
  const stale = force ? null : staleReason(deepStore.latest(biz.id), data.files);
  if (stale) throw new FreshEnough(stale);
  const client = claude();
  const uploaded: string[] = [];
  const run = newId(10);
  try {
    for (const f of data.files.filter(x => x.rows)) uploaded.push((await client.files.upload({ file: await toFile(Buffer.from(f.csv, 'utf8'), f.name, { type: 'text/csv' }) })).id);
    const messages: Anthropic.Beta.BetaMessageParam[] = [{
      role: 'user',
      content: [{ type: 'text', text: `${describe(data)}\n\nBusiness: ${biz.profile.name} (${biz.profile.industry || 'industry not set'}).` }, ...uploaded.map(id => ({ type: 'container_upload' as const, file_id: id }))],
    }];
    let container: string | undefined, final = '';
    const outputs: string[] = [];
    const used = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const res = await thinkStream(biz.id, 'owner', {
        model: env.aiModel, max_tokens: 32_000, system: ANALYST, messages,
        tools: [{ type: 'code_execution_20260521', name: 'code_execution' }],
        thinking: { type: 'adaptive', display: 'omitted' }, output_config: { effort: 'high' },
        // Python'ning har qadamida oldingi suhbat qayta o'qiladi — keshdan 20 baravar arzon
        cache_control: { type: 'ephemeral' },
        ...(container ? { container } : {}),
      });
      const u = res.usage;
      used.input += u.input_tokens; used.output += u.output_tokens; used.cacheRead += u.cache_read_input_tokens ?? 0; used.cacheWrite += u.cache_creation_input_tokens ?? 0;
      container = res.container?.id ?? container;
      outputs.push(...outputFiles(res.content));
      // Uzoq ish: server to'xtab turdi — javobni qaytarib davom ettiramiz
      if (res.stop_reason === 'pause_turn') { messages.push({ role: 'assistant', content: res.content }); continue; }
      if (res.stop_reason === 'refusal') throw new Error('Tahlil qilinmadi (model rad etdi)');
      final = textOf(res.content);
      break;
    }
    const cost = Math.round(costUsd(used) * 1000) / 1000;
    console.log(`[tahlil] ${biz.id}: $${cost} (kirish ${used.input}, keshdan ${used.cacheRead}, keshga ${used.cacheWrite}, chiqish ${used.output})`);
    const parsed = parseFindings(final);
    if (!parsed) throw new Error("Tahlil natijasini o'qib bo'lmadi — qayta urinib ko'ring");
    // Grafiklar: faqat rasm fayllari, xavfsiz nom bilan
    const dir = chartsDir(biz.id, run), charts: string[] = [];
    for (const id of outputs.slice(0, 12)) {
      try {
        const meta = await client.files.retrieveMetadata(id);
        const name = basename(meta.filename).replace(/[^\w.-]/g, '_');
        if (!CHART.test(name)) continue;
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, name), Buffer.from(await (await client.files.download(id)).arrayBuffer()));
        charts.push(name);
        await client.files.delete(id).catch(() => {});
      } catch (e) {
        console.error('[tahlil] grafik:', (e as Error).message);
      }
    }
    const result: DeepInsights = {
      id: run, createdAt: new Date().toISOString(), from: data.from, to: data.to,
      data: data.files.map(f => ({ name: f.name, rows: f.rows })), notes: data.notes, ...parsed,
      findings: parsed.findings.map(f => ({ ...f, chart: f.chart && charts.includes(f.chart) ? f.chart : null })), charts, cost,
    };
    deepStore.save(biz.id, result);
    return result;
  } finally {
    // Yuklangan ma'lumot Anthropic'da qolmasin
    for (const id of uploaded) await client.files.delete(id).catch(() => {});
  }
}
