/**
 * Maqsadlar: egasi Direktor ko'rsatkichlariga qo'ygan maqsad (har ko'rsatkichga bitta): «javob berilgan ulush 90%»,
 * «qabulga yozilganlar haftasiga 20». Joriy qiymat — oxirgi 7 to'liq kun (readNumbers); bajarilish foizi kodda hisoblanadi.
 * Direktor maqsaddan eng ko'p ortda qolgan ko'rsatkichni muammo sifatida ko'radi.
 */
import { newId, sql, type Row } from '../db';
import type { Goal, MetricKey } from './logic';

export type { Goal, GoalProgress } from './logic';
export { goalsText, progress } from './logic';

sql.exec(`
CREATE TABLE IF NOT EXISTS goals (
  id TEXT PRIMARY KEY, business_id TEXT NOT NULL, metric TEXT NOT NULL, target REAL NOT NULL, created_at TEXT NOT NULL,
  UNIQUE (business_id, metric)
);
`);

/** Bir biznesda shuncha maqsad (har ko'rsatkichga bittadan ko'p emas) */
export const MAX_GOALS = 6;

const toGoal = (r: Row): Goal => ({ id: String(r.id), metric: String(r.metric) as MetricKey, target: Number(r.target), createdAt: String(r.created_at) });

export const goals = {
  list: (bizId: string) => sql.many('SELECT * FROM goals WHERE business_id = ? ORDER BY created_at', toGoal, bizId),
  /** Shu ko'rsatkichga maqsad bo'lsa — yangilanadi */
  set(bizId: string, metric: MetricKey, target: number): Goal {
    sql.run('INSERT INTO goals (id, business_id, metric, target, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT (business_id, metric) DO UPDATE SET target = excluded.target',
      newId(10), bizId, metric, target, sql.nowIso());
    return goals.list(bizId).find(g => g.metric === metric)!;
  },
  remove: (bizId: string, id: string) => sql.run('DELETE FROM goals WHERE business_id = ? AND id = ?', bizId, id).changes > 0,
};
