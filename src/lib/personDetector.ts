/**
 * Brauzerdagi odam topuvchi — sinov rejimi uchun: shu kompyuter kamerasidagi odamlarni topadi.
 * Kadr kompyuterdan chiqmaydi: serverga faqat odamlarning kadrdagi joyi (to'rtburchaklar) yuboriladi.
 * Klinikada xuddi shu natijani qutidagi dvigatel beradi; seanslarni sanash ikkala holda ham serverda, bir xil.
 * Kutubxona katta, shuning uchun faqat sanash yoqilganda yuklanadi.
 */
export interface PersonBox { x: number; y: number; w: number; h: number }
export interface PersonDetector { detect(video: HTMLVideoElement): Promise<PersonBox[]> }

/** Bundan past ishonch bilan topilgan "odam" hisobga olinmaydi */
const MIN_SCORE = 0.5;
const MAX_PEOPLE = 20;
const MODEL_URL = `${import.meta.env.BASE_URL}models/ssdlite_mobilenet_v2/model.json`;
const unit = (n: number) => Math.min(1, Math.max(0, n));

let cached: Promise<PersonDetector> | null = null;
/** Model bir marta yuklanadi va sahifa ochiq turguncha xotirada qoladi; yuklash xato bo'lsa keyingi safar qayta uriniladi */
export function loadPersonDetector(): Promise<PersonDetector> {
  cached ??= load().catch(e => { cached = null; throw e; });
  return cached;
}

async function load(): Promise<PersonDetector> {
  const [tf, cocoSsd] = await Promise.all([import('@tensorflow/tfjs'), import('@tensorflow-models/coco-ssd')]);
  await tf.ready();
  // Model shu serverning o'zidan olinadi (public/models): internetga bog'liq emas va tez ochiladi. Fayllar: npm run camera:model
  const model = await cocoSsd.load({ base: 'lite_mobilenet_v2', modelUrl: MODEL_URL });
  return {
    async detect(video) {
      const width = video.videoWidth, height = video.videoHeight;
      if (!width || !height) return [];
      const found = await model.detect(video, MAX_PEOPLE, MIN_SCORE);
      return found.filter(f => f.class === 'person').map(f => {
        const x = unit(f.bbox[0] / width), y = unit(f.bbox[1] / height);
        return { x, y, w: Math.min(1 - x, f.bbox[2] / width), h: Math.min(1 - y, f.bbox[3] / height) };
      }).filter(b => b.w > 0 && b.h > 0);
    },
  };
}
