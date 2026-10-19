/** Panel: Tahlilchi → «Talab» — oxirgi tahlil (bepul) va qayta tahlil qilish (model, bir biznesda bir vaqtda bittasi) */
import type { Express, Request, Response } from 'express';
import type { BusinessRow } from '../db';
import { analyzeDemand, insightsStore } from './analyze';

type Handler = (req: Request, res: Response) => unknown;
interface Deps { asBiz: (fn: (req: Request, res: Response, biz: BusinessRow) => unknown) => Handler }

const PERIODS = [7, 30];
const running = new Set<string>();
const daysOf = (v: unknown) => (PERIODS.includes(Number(v)) ? Number(v) : 7);

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
}
