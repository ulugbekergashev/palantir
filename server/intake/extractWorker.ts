/** Ishchi oqim: bitta faylni o'qiydi va natijani asosiy oqimga qaytaradi (sandbox.ts shu faylni ishga tushiradi va kuzatib turadi) */
import { parentPort, workerData } from 'node:worker_threads';
import { FileError, extract } from './extract';
import type { WorkerReply } from './sandbox';

const { name, bytes } = workerData as { name: string; bytes: Uint8Array };
const reply = (r: WorkerReply) => parentPort?.postMessage(r);

extract(name, Buffer.from(bytes)).then(
  file => reply({ ok: true, file }),
  (err: unknown) => reply({ ok: false, message: err instanceof Error ? err.message : String(err), expected: err instanceof FileError }),
);
