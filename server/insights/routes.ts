/**
 * Panel: Tahlilchi → «Talab» (oxirgi tahlil — bepul, qayta tahlil — model, bir biznesda bir vaqtda bittasi) va «Kashfiyotlar»
 * (chuqur tahlil: fonda bir necha daqiqa ishlaydi, panel holatni so'rab turadi; grafiklar — shu biznesning papkasidan)
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Express, Request, Response } from 'express';
import type { BusinessRow } from '../db';
import { analyzeDemand, insightsStore } from './analyze';
import { chartsDir, deepStore, FreshEnough, runDeepAnalysis } from './deep';

type Handler = (req: Request, res: Response) => unknown;
interface Deps { asBiz: (fn: (req: Request, res: Response, biz: BusinessRow) => unknown) => Handler }

const PERIODS = [7, 30];
const running = new Set<string>();
const daysOf = (v: unknown) => (PERIODS.includes(Number(v)) ? Number(v) : 7);
/** Chuqur tahlil: biznes → boshlangan payt; oxirgi xato (panel ko'rsatadi) */
const deepRunning = new Map<string, string>();
const deepError = new Map<string, string>();
/** Qayta tahlil kerak bo'lmadi (ma'lumot deyarli o'zgarmagan) — sababi */
const deepNotice = new Map<string, string>();
const SAFE = /^[\w-]{1,40}$/, CHART_FILE = /^[\w.-]{1,80}\.(png|jpe?g|svg)$/i;

export function mountInsights(app: Express, { asBiz }: Deps): void {
  app.get('/api/insights', asBiz((req, res, biz) => {
    const days = daysOf(req.query.days);
    res.json({ insights: insightsStore.latest(biz.id, days), running: running.has(`${biz.id}:${days}`) });
  }));
  app.post('/api/insights', asBiz(async (req, res, biz) => {
    const days = daysOf((req.body as { days?: unknown } | undefined)?.days);
    const key = `${biz.id}:${days}`;
    if (running.has(key)) return res.status(429).json({ error: 'Tahlil davom etyapti — biroz kuting' });
    running.add(key);
    try {
      res.json({ insights: await analyzeDemand(biz, days) });
    } catch (e) {
      console.error('[talab] tahlil:', (e as Error).message);
      res.status(502).json({ error: "Tahlil qilib bo'lmadi — birozdan keyin qayta urining" });
    } finally {
      running.delete(key);
    }
  }));

  app.get('/api/insights/deep', asBiz((_req, res, biz) => {
    res.json({ result: deepStore.latest(biz.id), running: deepRunning.get(biz.id) ?? null, error: deepError.get(biz.id) ?? null, notice: deepNotice.get(biz.id) ?? null });
  }));
  /** { force: true } — ma'lumot deyarli o'zgarmagan bo'lsa ham qayta tahlil (egasi «baribir» desa) */
  app.post('/api/insights/deep', asBiz((req, res, biz) => {
    if (deepRunning.has(biz.id)) return res.status(429).json({ error: 'Tahlil davom etyapti — tugashini kuting' });
    const startedAt = new Date().toISOString();
    deepRunning.set(biz.id, startedAt);
    deepError.delete(biz.id);
    deepNotice.delete(biz.id);
    void runDeepAnalysis(biz, { force: (req.body as { force?: unknown } | undefined)?.force === true })
      .catch(e => {
        if (e instanceof FreshEnough) return void deepNotice.set(biz.id, e.message);
        deepError.set(biz.id, (e as Error).message);
        console.error('[tahlil] chuqur:', (e as Error).message);
      })
      .finally(() => deepRunning.delete(biz.id));
    res.status(202).json({ running: startedAt });
  }));
  app.get('/api/insights/deep/chart/:run/:file', asBiz((req, res, biz) => {
    const run = String(req.params.run), file = String(req.params.file);
    if (!SAFE.test(run) || !CHART_FILE.test(file)) return res.status(404).end();
    const path = join(chartsDir(biz.id, run), file);
    if (!existsSync(path)) return res.status(404).end();
    res.sendFile(path);
  }));
}
