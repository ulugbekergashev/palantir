/**
 * Odam topuvchi model fayllarini yuklab oladi (bir marta): public/models/ssdlite_mobilenet_v2 — taxminan 18 MB.
 * Model: COCO-SSD (SSDLite MobileNet v2), Apache-2.0. Fayllar git'ga qo'shilmaydi.
 * Har fayl SHA256 bilan tekshiriladi (bor fayl ham): yarim yuklangan yoki almashtirilgan fayl kamera dvigateliga tushmasin.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BASE = 'https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2';
const FILES: Record<string, string> = {
  'model.json': '3770b2528339b1e3340cb74360e1e40401816b009779aeb8d0cce3a4353ea3a9',
  'group1-shard1of5': '0e7af0f713e98521252321f7f84892c31cefccccec3ac64c84e5065b75ed5646',
  'group1-shard2of5': '74cc6cfc2c4510c9cd81b8ad4cebf6f6a8f305119bb365ce0eb96276da38519a',
  'group1-shard3of5': '50383033f893eae136392a403e8f70ade5efd90867df5695c4ca5ac640e14f38',
  'group1-shard4of5': 'd856dc534c780068bbf6c666ce1516df2c8433d87578aa31fcdf197de7058cc2',
  'group1-shard5of5': '3d356f1fb6dfca6af78c56db34d9326706d0196e303f9de6b04f236ca79ed309',
};
const dir = resolve('public/models/ssdlite_mobilenet_v2');
const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

mkdirSync(dir, { recursive: true });
for (const [name, hash] of Object.entries(FILES)) {
  const target = join(dir, name);
  if (existsSync(target) && sha256(readFileSync(target)) === hash) { console.log(`bor: ${name}`); continue; }
  const res = await fetch(`${BASE}/${name}`);
  if (!res.ok) throw new Error(`${name}: yuklab bo'lmadi (${res.status})`);
  const data = Buffer.from(await res.arrayBuffer());
  if (sha256(data) !== hash) {
    rmSync(target, { force: true });
    throw new Error(`${name}: yuklangan fayl kutilganidan boshqa (SHA256 mos emas) — saqlanmadi`);
  }
  writeFileSync(target, data);
  console.log(`yuklandi: ${name} (${data.length} bayt)`);
}
console.log('Model tayyor.');
