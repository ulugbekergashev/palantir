/**
 * Yordamchi asbobi: kameraga qarash. Egasi «hozir qabulxonada kim bor?», «kutish zalida nechta odam?» deganda — hozirgi kadr
 * egasiga rasm bo'lib boradi (Telegram va panel), odamlar soni va savolga kadrdan javob bilan. Kadr Kuzatuvchi jurnalida qoladi.
 */
import { z } from 'zod';
import { cameras } from '../db';
import { events } from '../orders/store';
import { ToolError, def } from '../toolkit';
import { MAX_LOOK_CAMERAS, lookAt, pickCameras } from './ask';

/** Bir javobda kameraga ko'pi bilan shuncha marta (har biri — kadr va pulli AI so'rovi) */
const MAX_LOOKS_PER_TURN = 3;

export const CAMERA_DEFS = {
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
