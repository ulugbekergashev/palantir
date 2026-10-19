/**
 * Panel tuzilishi — AI jamoa: bosh ekran (Cerebro, ovoz), to'rt xodim, Miya va Sozlamalar. Manzil: #/<bo'lim>/<varaq>.
 * Eski manzillar (#/requests, #/journal…) ham ishlayveradi — o'z xodimiga olib boradi; sahifa o'z manzilini o'zi o'qisa
 * (#/inbox/<mijoz>), u buzilmaydi: manzil qayta yozilmaydi.
 */

export type Area = 'ai' | 'qabulxona' | 'yordamchi' | 'kuzatuvchi' | 'tahlilchi' | 'miya' | 'sozlamalar';
export interface Route { area: Area; tab: string | null }

export const AREAS: Area[] = ['ai', 'qabulxona', 'yordamchi', 'kuzatuvchi', 'tahlilchi', 'miya', 'sozlamalar'];

/** Eski bo'limlar — qaysi xodimning qaysi varag'i */
const OLD: Record<string, Route> = {
  home: { area: 'ai', tab: null },
  chat: { area: 'yordamchi', tab: 'suhbat' },
  posts: { area: 'yordamchi', tab: 'suhbat' },
  journal: { area: 'yordamchi', tab: 'jurnal' },
  tasks: { area: 'yordamchi', tab: 'jurnal' },
  requests: { area: 'qabulxona', tab: 'sorovlar' },
  calls: { area: 'qabulxona', tab: 'qongiroqlar' },
  inbox: { area: 'qabulxona', tab: 'yozishmalar' },
  leads: { area: 'qabulxona', tab: 'yozishmalar' },
  cameras: { area: 'kuzatuvchi', tab: null },
  brain: { area: 'miya', tab: 'savollar' },
  documents: { area: 'miya', tab: null },
  telegram: { area: 'sozlamalar', tab: 'telegram' },
  business: { area: 'sozlamalar', tab: null },
};

export function routeFromHash(hash = window.location.hash): Route {
  const [head = '', tab = null] = hash.replace(/^#\/?/, '').split(/[?]/)[0].split('/');
  if ((AREAS as string[]).includes(head)) return { area: head as Area, tab: tab || null };
  return Object.hasOwn(OLD, head) ? OLD[head] : { area: 'ai', tab: null };
}

export const hrefOf = (area: Area, tab?: string | null): string => `#/${area}${tab ? `/${tab}` : ''}`;
