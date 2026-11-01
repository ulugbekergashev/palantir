/**
 * Klinika xodimlarining panelga kirishi — faqat egasi beradi (Sozlamalar → Xodimlar). Xodim — «Qabulxona xodimlari» ro'yxatidagi
 * odam (server/requests/store.ts: Telegram'dagi so'rov kartalari ham uniki); bu yerda unga login, parol va huquq beriladi.
 * Parol bir marta ko'rsatiladi (bazada xeshi). Huquqlar — server/access.ts.
 */
import type { Express, Handler, Request, Response } from 'express';
import { z } from 'zod';
import { hashPassword } from './auth';
import { businesses, type BusinessRow } from './db';
import { newOwnerPassword } from './profile';
import { staff, type StaffRow } from './requests/store';

interface Deps {
  asOwner: (fn: (req: Request, res: Response, biz: BusinessRow) => unknown) => Handler;
  bad: (res: Response, error: z.ZodError) => unknown;
}

const LOGIN_RE = /^[a-z0-9._-]{3,32}$/;
const Grant = z.object({ access: z.enum(['reception', 'manager']), login: z.string().trim().toLowerCase().regex(LOGIN_RE, "Login: 3–32 ta lotin harfi, raqam, nuqta yoki chiziqcha").optional() });

const view = (s: StaffRow) => ({ id: s.id, name: s.name, linked: s.linked, login: s.login, access: s.access, seenAt: s.seenAt });
/** Login hech kimda (egalarda ham, boshqa xodimlarda ham) bo'lmasin — bitta kirish sahifasi */
const loginFree = (login: string, self: string) => !businesses.byLogin(login) && (staff.byLogin(login)?.id ?? self) === self;

export function mountTeamAccess(app: Express, { asOwner, bad }: Deps): void {
  app.get('/api/team-access', asOwner((_req, res, biz) => { res.json({ members: staff.list(biz.id).map(view) }); }));

  // Kirish berish (login bilan) yoki huquqni almashtirish (login yuborilmasa va kirishi bor bo'lsa — parol o'sha)
  app.post('/api/team-access/:id', asOwner((req, res, biz) => {
    const p = Grant.safeParse(req.body);
    if (!p.success) return bad(res, p.error);
    const s = staff.byId(biz.id, String(req.params.id));
    if (!s) return res.status(404).json({ error: "Bunday xodim yo'q" });
    if (!p.data.login && s.login) {
      staff.setAccess(biz.id, s.id, p.data.access);
      return res.json({ member: view(staff.byId(biz.id, s.id)!) });
    }
    const login = p.data.login ?? s.login;
    if (!login) return res.status(400).json({ error: 'Login kerak' });
    if (!loginFree(login, s.id)) return res.status(409).json({ error: 'Bu login band — boshqasini yozing' });
    const password = newOwnerPassword(10);
    staff.grant(biz.id, s.id, login, hashPassword(password), p.data.access);
    res.json({ member: view(staff.byId(biz.id, s.id)!), password });
  }));

  // Parolni unutdi: yangi parol, eski kirishlari bekor
  app.post('/api/team-access/:id/reset', asOwner((req, res, biz) => {
    const s = staff.byId(biz.id, String(req.params.id));
    if (!s?.login || !s.access) return res.status(404).json({ error: "Bu xodimning kirishi yo'q" });
    const password = newOwnerPassword(10);
    staff.grant(biz.id, s.id, s.login, hashPassword(password), s.access);
    res.json({ member: view(staff.byId(biz.id, s.id)!), password });
  }));

  // Kirishni yopish: ochiq kirishlari darhol tugaydi (xodim ro'yxatda qoladi, Telegram'dagi kartalar ishlayveradi)
  app.delete('/api/team-access/:id', asOwner((req, res, biz) => {
    const s = staff.byId(biz.id, String(req.params.id));
    if (!s) return res.status(404).json({ error: "Bunday xodim yo'q" });
    staff.revoke(biz.id, s.id);
    res.json({ member: view(staff.byId(biz.id, s.id)!) });
  }));
}
