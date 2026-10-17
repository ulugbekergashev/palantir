/**
 * Odam topuvchi model fayllarini yuklab oladi (bir marta): public/models/ssdlite_mobilenet_v2 — taxminan 18 MB.
 * Model: COCO-SSD (SSDLite MobileNet v2), Apache-2.0. Fayllar git'ga qo'shilmaydi.
 */
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const BASE = 'https://storage.googleapis.com/tfjs-models/savedmodel/ssdlite_mobilenet_v2';
const FILES = ['model.json', ...[1, 2, 3, 4, 5].map(n => `group1-shard${n}of5`)];
const dir = resolve('public/models/ssdlite_mobilenet_v2');

mkdirSync(dir, { recursive: true });
for (const name of FILES) {
  const target = join(dir, name);
  if (existsSync(target) && statSync(target).size > 0) { console.log(`bor: ${name}`); continue; }
  const res = await fetch(`${BASE}/${name}`);
  if (!res.ok) throw new Error(`${name}: yuklab bo'lmadi (${res.status})`);
  writeFileSync(target, Buffer.from(await res.arrayBuffer()));
  console.log(`yuklandi: ${name} (${statSync(target).size} bayt)`);
}
console.log('Model tayyor.');
