/**
 * Kirish nuqtasi. Avval — jurnal va «bitta papka — bitta nusxa» qulfi; qolgan hamma narsa (baza, bot, panel) shundan KEYIN yuklanadi:
 * ikkinchi nusxa ishlab turgan bazani ochmasin va uning chala yozuvlarini «to'xtab qolgan» deb belgilamasin.
 */
import './tz';
import './log';
import { guardProcess, singleInstance } from './guard';

guardProcess();
await singleInstance();
await import('./main');
