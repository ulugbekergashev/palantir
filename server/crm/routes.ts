/** Panel: DentaCRM'ni ulash va uzish */
import type { Express, Request, Response } from 'express';
import { z } from 'zod';
import { resetConversation } from '../agent';
import { loginBlocked, loginFailed } from '../auth';
import type { BusinessRow } from '../db';
import type { LiveStatus } from '../../src/types';
import { iso } from '../../src/lib/week';
import { CrmError } from './dentacrm';
import { connectCrm, crmConnected, disconnectCrm, withCrm } from './index';
import { daySummary, isRealDate } from './logic';

type Handler = (req: Request, res: Response) => unknown;
interface Deps {
  asBiz: (fn: (req: Request, res: Response, biz: BusinessRow) => unknown) => Handler;
  bad: (res: Response, error: z.ZodError) => unknown;
  fail: (res: Response, e: unknown, code?: number) => unknown;
  statusOf: (bizId: string) => LiveStatus;
}

/** Hozir ulanayotgan bizneslar: ikkinchi urinish birinchisi tugaguncha kutadi */
const connecting = new Set<string>();

const ConnectSchema = z.object({ url: z.string().trim().min(4).max(200), username: z.string().trim().min(1).max(80), password: z.string().min(1).max(200) });

export function mountCrm(app: Express, { asBiz, bad, fail, statusOf }: Deps): void {
  app.post('/api/crm', asBiz(async (req, res, biz) => {
    // Bu yo'l egasi bergan manzilga so'rov yuboradi — urinishlar soni cheklangan (parol tanlash va tarmoqni paypaslashga qarshi)
    const key = `crm:${biz.id}`;
    if (loginBlocked(key)) return res.status(429).json({ error: "Ko'p urinish — 15 daqiqadan keyin qayta urining" });
    if (connecting.has(biz.id)) return res.status(429).json({ error: 'Ulanish davom etyapti — biroz kuting' });
    const p = ConnectSchema.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    // Har bir urinish (muvaffaqiyatlisi ham) oldindan sanaladi: parallel so'rovlar yoki «to'g'ri» javob chegarani aylanib o'tmasin
    loginFailed(key);
    connecting.add(biz.id);
    try {
      await connectCrm(biz, p.data);
    } catch (e) {
      if (e instanceof CrmError) return fail(res, e, 400);
      // Kutilmagan xatoning matni tashqariga chiqmaydi
      console.error('[crm] ulash:', e);
      return fail(res, new Error("DentaCRM'ga ulanib bo'lmadi"), 400);
    } finally {
      connecting.delete(biz.id);
    }
    // Yordamchiga yangi asboblar va klinika nomi — yangi suhbatdan
    resetConversation(biz.id);
    res.json({ status: statusOf(biz.id) });
  }));

  app.delete('/api/crm', asBiz((_req, res, biz) => {
    disconnectCrm(biz.id);
    resetConversation(biz.id);
    res.json({ status: statusOf(biz.id) });
  }));

  /** Panel bosh sahifasi: klinikaning kuni — qabullar shifokorlar bo'yicha, kelgan/kelmagan, tushum (yordamchining clinic_day asbobi bilan bir xil hisob) */
  app.get('/api/crm/day', asBiz(async (req, res, biz) => {
    if (!crmConnected(biz.id)) return res.status(409).json({ error: 'DentaCRM ulanmagan' });
    const date = typeof req.query.date === 'string' && isRealDate(req.query.date) ? req.query.date : iso(new Date());
    try {
      const day = await withCrm(biz.id, async crm => {
        const [appointments, transactions] = await Promise.all([crm.appointments(date), crm.transactions(date)]);
        return daySummary(appointments, transactions);
      });
      res.json({ day: { date, ...day } });
    } catch (e) {
      if (e instanceof CrmError) return fail(res, e, 502);
      throw e;
    }
  }));
}
