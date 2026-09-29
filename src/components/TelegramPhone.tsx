import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, Brain, MoreVertical, SendHorizontal } from 'lucide-react';
import type { Clinic, ContentItem, ItemStatus, Lang } from '../types';
import { Artboard } from '../templates/Artboard';
import { isPast } from '../lib/generator';
import { whenLabel } from '../lib/week';
import type { ItemAction } from './ItemCard';

export interface ChatMsg {
  id: number;
  from: 'owner' | 'bot';
  text: string;
  time: string;
}

export const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

const QUICK = ['Nechta lid keldi?', 'Qaysi post yaxshi ishladi?', 'Hammasini joylash'];

/** Inline tugma (Telegram uslubida: xabar ostida shaffof tugmalar) */
function InlineButton({ children, onClick }: { children: string; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="flex-1 rounded-lg bg-black/25 px-2 py-1.5 text-[11px] font-semibold text-white backdrop-blur transition hover:bg-black/35">
      {children}
    </button>
  );
}

function Bubble({ from, children, time }: { from: 'owner' | 'bot'; children: ReactNode; time?: string }) {
  const owner = from === 'owner';
  return (
    <div className={`flex ${owner ? 'justify-end' : 'justify-start'}`}>
      <div className={`animate-pop max-w-[86%] rounded-2xl px-3 py-2 text-[13px] leading-snug shadow-sm ${owner ? 'rounded-br-md bg-[#EFFDDE] text-slate-900' : 'rounded-bl-md bg-white text-slate-900'}`}>
        {children}
        {time && <div className="mt-0.5 text-right text-[10px] text-slate-400">{time}</div>}
      </div>
    </div>
  );
}

/**
 * Egasining Telegramidagi bot (maket). Har dushanba paket shu yerga keladi:
 * har bir post — rasm, matn boshi va tugmalar. Bosilgan tugma xabarni
 * yangilaydi (Telegram'da xabar tahrirlanganidek).
 */
export function TelegramPhone({ items, statusOf, lang, clinic, now, weekLabel, chat, onAction, onAsk, className = '' }: {
  items: ContentItem[]; statusOf: (item: ContentItem) => ItemStatus; lang: Lang; clinic: Clinic; now: Date; weekLabel: string;
  chat: ChatMsg[]; onAction: (id: string, action: ItemAction) => void; onAsk: (text: string) => void; className?: string;
}) {
  const [text, setText] = useState('');
  const scroller = useRef<HTMLDivElement>(null);
  const posts = items.filter(i => i.kind === 'post').length;

  useEffect(() => {
    const el = scroller.current;
    if (el && chat.length) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [chat.length]);

  const send = (value: string) => {
    const v = value.trim();
    if (!v) return;
    onAsk(v);
    setText('');
  };

  return (
    <div className={`mx-auto flex w-[360px] max-w-full flex-col overflow-hidden rounded-[44px] border-[10px] border-slate-900 bg-slate-900 shadow-2xl ${className}`}>
      <div className="flex items-center gap-3 bg-[#517DA2] px-3 py-2.5 text-white">
        <ArrowLeft className="h-5 w-5 opacity-80" />
        <div className="flex h-9 w-9 items-center justify-center rounded-full bg-teal-600"><Brain className="h-5 w-5" /></div>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-bold">Cerebro</div>
          <div className="text-[11px] opacity-80">bot</div>
        </div>
        <MoreVertical className="h-5 w-5 opacity-80" />
      </div>

      <div ref={scroller} className="tg-wallpaper flex-1 space-y-2.5 overflow-y-auto px-2.5 py-3">
        <Bubble from="bot" time="09:00">
          Assalomu alaykum, {clinic.ownerName}! 👋<br />
          <b>{weekLabel}</b> uchun paket tayyor: {posts} ta post, {items.length - posts} ta storis.
          Har birini ko'rib chiqing — tasdiqlaganingiz belgilangan vaqtda o'zi joylanadi.
        </Bubble>

        {items.map(item => {
          const status = statusOf(item);
          const caption = item.caption[lang].split('\n').filter(Boolean).slice(0, 3).join('\n');
          return (
            <div key={item.id} className="space-y-1">
              <div className="flex justify-start">
                <div className="animate-pop w-[86%] overflow-hidden rounded-2xl rounded-bl-md bg-white shadow-sm">
                  <div className="flex justify-center bg-slate-100">
                    <Artboard item={item} lang={lang} clinic={clinic} className={item.kind === 'story' ? 'h-[300px] w-auto' : 'h-auto w-full'} />
                  </div>
                  <div className="px-3 py-2 text-[12.5px] leading-snug text-slate-800">
                    <div className="mb-1 text-[11px] font-bold text-[#3A6D99]">
                      {item.kind === 'story' ? '📲 Storis' : '🖼 Post'} · {whenLabel('uz', item.date, item.time)}
                    </div>
                    <p className="line-clamp-3 whitespace-pre-line">{caption}</p>
                    {status !== 'pending' && (
                      <div className={`mt-1.5 text-[11.5px] font-semibold ${status === 'rejected' ? 'text-slate-400' : 'text-emerald-700'}`}>
                        {status === 'rejected'
                          ? '❌ Chiqmaydi'
                          : isPast(item, now)
                            ? `✅ Joylandi: ${clinic.telegramChannel || 'kanal'}${clinic.instagram ? ` + ${clinic.instagram}` : ''}`
                            : `⏰ Rejaga qo'yildi: ${whenLabel('uz', item.date, item.time)}`}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="w-[86%] space-y-1">
                {status === 'pending' ? (
                  <>
                    <div className="flex gap-1">
                      <InlineButton onClick={() => onAction(item.id, 'publish')}>✅ Joylash</InlineButton>
                      <InlineButton onClick={() => onAction(item.id, 'variant')}>🔄 Boshqa variant</InlineButton>
                    </div>
                    <div className="flex gap-1">
                      <InlineButton onClick={() => onAction(item.id, 'edit')}>✏️ Tahrirlash</InlineButton>
                      <InlineButton onClick={() => onAction(item.id, 'reject')}>❌ Kerak emas</InlineButton>
                    </div>
                  </>
                ) : (
                  <div className="flex gap-1">
                    <InlineButton onClick={() => onAction(item.id, 'undo')}>↩️ Qaytarish</InlineButton>
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {chat.map(m => (
          <Bubble key={m.id} from={m.from} time={m.time}>
            <span className="whitespace-pre-line">{m.text}</span>
          </Bubble>
        ))}
      </div>

      <div className="space-y-2 bg-white px-2.5 pb-3 pt-2">
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {QUICK.map(q => (
            <button key={q} type="button" onClick={() => send(q)} className="shrink-0 rounded-full border border-[#517DA2]/30 px-2.5 py-1 text-[11px] font-semibold text-[#3A6D99] hover:bg-sky-50">
              {q}
            </button>
          ))}
        </div>
        <form className="flex items-center gap-2" onSubmit={e => { e.preventDefault(); send(text); }}>
          <input
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Xabar yozing…"
            aria-label="Botga savol"
            className="h-9 min-w-0 flex-1 rounded-full bg-slate-100 px-3.5 text-[13px] outline-none focus:ring-2 focus:ring-sky-300"
          />
          <button type="submit" aria-label="Yuborish" className="flex h-9 w-9 items-center justify-center rounded-full bg-[#517DA2] text-white hover:bg-[#446a8a]">
            <SendHorizontal className="h-4 w-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
