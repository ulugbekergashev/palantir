/**
 * Yordamchi asbobi: kameraga qarash. Egasi «hozir qabulxonada kim bor?», «kutish zalida nechta odam?» deganda — hozirgi kadr
 * egasiga rasm bo'lib boradi (Telegram va panel), odamlar soni va savolga kadrdan javob bilan. Kadr Kuzatuvchi jurnalida qoladi.
 */
import { z } from 'zod';
import { cameras } from '../db';
import { events } from '../orders/store';
import { ToolError, def } from '../toolkit';
import { iso } from '../../src/lib/week';
import { isRealDate } from '../crm/logic';
import { MAX_LOOK_CAMERAS, lookAt, pickCameras } from './ask';
import { cameraReport } from './report';

/** Bir javobda kameraga ko'pi bilan shuncha marta (har biri — kadr va pulli AI so'rovi) */
const MAX_LOOKS_PER_TURN = 3;

const plain = (html: string) => html.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

export const CAMERA_DEFS = {
  camera_day: def({
    description: "What the cameras counted on one day, as a ready Uzbek report: patients who sat in a chair, people at the cash desk, how busy each chair was, waiting area (how many waited, average and longest wait), staff seats (when someone came and left), discrepancies with DentaCRM if it is connected, and how many camera alerts there were today. Works without DentaCRM. Use for \"kameralar bugun nima ko'rdi\", \"bugun nechta odam kutdi\", \"administrator qachon keldi\". The camera does not know who a person is. Relay the report briefly; do not invent numbers.",
    input: z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(isRealDate, "taqvimda bunday sana yo'q").optional().describe('YYYY-MM-DD, default today') }),
    run: async (i, ctx) => {
      if (!cameras.list(ctx.biz.id).length) throw new ToolError("Kamera ulanmagan — egasi panel → «Kameralar» bo'limida qo'shadi");
      const date = i.date ?? iso(new Date());
      if (date > iso(new Date())) throw new ToolError("Kelajak kun uchun kamera hisobi yo'q");
      const html = await cameraReport(ctx.biz, date);
      return { date, report: html ? plain(html) : "Shu kuni kameralar hech narsa sanamadi (zonalar belgilanmagan yoki kamera ishlamagan)." };
    },
  }),


  look_camera: def({
    description: `Look at the business's cameras right now, when the owner asks what is happening on a camera ("hozir qabulxonada kim bor?", "kutish zalida nechta odam?", "kameraga qara"). The current frame goes to the owner as a photo (Telegram and the panel) with the person detector's count and, when a question is given, an answer from the frame. Up to ${MAX_LOOK_CAMERAS} cameras. It does not recognise faces or know who a person is. Do not repeat the answer at length — the photo carries it.`,
    input: z.object({
      camera: z.string().trim().max(60).optional().describe('Camera name or id; omit for all cameras'),
      question: z.string().trim().max(300).optional().describe("What the owner wants to know from the frame, in Uzbek; omit to just show the frame"),
    }),
    run: async (i, ctx) => {
      if (!cameras.list(ctx.biz.id).length) throw new ToolError("Kamera ulanmagan — egasi panel → «Kameralar» bo'limida qo'shadi");
      const list = pickCameras(ctx.biz.id, i.camera);
      if (!list.length) throw new ToolError(`Bunday kamera yo'q. Kameralar: ${cameras.list(ctx.biz.id).map(c => c.name).join(', ')}`);
      ctx.cameraLooks = (ctx.cameraLooks ?? 0) + 1;
      if (ctx.cameraLooks > MAX_LOOKS_PER_TURN) throw new ToolError("Bu javobda kameraga yetarlicha qaraldi — egasiga ko'rganingizni ayting");
      const looks = await lookAt(ctx.biz, list, i.question || null);
      // Kadrdagi yozuv (lavha, ekran) — begona matn: shu javobda bilimga yozadigan asboblar ishlamaydi
      if (looks.some(l => l.shot.answer)) ctx.readStrangers = true;
      return {
        cameras: looks.map(l => {
          const saved = l.image ? events.add(ctx.biz.id, {
            member: 'kuzatuvchi', orderId: null, level: 'info', title: `${l.camera.name}: egasi qaradi`,
            body: l.shot.answer ?? (l.shot.people === null ? 'Hozirgi kadr' : `Hozir ${l.shot.people} kishi`), cameraId: l.camera.id,
          }, l.image) : null;
          ctx.artifacts.push({ type: 'camera', shot: { ...l.shot, eventId: saved?.id ?? null } });
          return { camera: l.camera.name, photo_sent: !!l.image, people_now: l.shot.people, ...(l.shot.answer ? { answer: l.shot.answer } : {}), ...(l.shot.problem ? { problem: l.shot.problem } : {}) };
        }),
        ...(list.length > MAX_LOOK_CAMERAS ? { note: `Faqat birinchi ${MAX_LOOK_CAMERAS} ta kamera ko'rildi` } : {}),
      };
    },
  }),
};
