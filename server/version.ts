/** Dastur nashri (package.json): /api/health va hub holatida — yangilovchi yangi nashr haqiqatan ishga tushganini shundan biladi */
import { readFileSync } from 'node:fs';

export const APP_VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
