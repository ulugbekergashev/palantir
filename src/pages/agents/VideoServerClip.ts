/**
 * Serverda yig'ilgan video (HyperFrames mp4) panel kartasida: muqova (kichik jpg), ko'rish va yuklab olish. Fayllar token bilan
 * olinadi (oddiy <video src> sarlavha yubora olmaydi), shuning uchun blob qilib yuklanadi: mp4 bir marta olinadi va ko'rish
 * ham, yuklab olish ham shuni ishlatadi. Video qayta yig'ila boshlasa karta qayta ochiladi (kalitida renderReady) — eski blob
 * va pleyer o'zi tashlanadi.
 */
import { useEffect, useRef, useState } from 'react';
import type { ContentVideo } from '../../types';
import { api } from '../../data/api';

export const renderBusy = (v: ContentVideo): boolean => v.render?.phase === 'queued' || v.render?.phase === 'rendering';
export const renderReady = (v: ContentVideo): boolean => v.render?.phase === 'done' || v.render?.phase === 'stale';

/** Holat yorlig'i (video ovozli bo'lsa) */
export function renderLabel(v: ContentVideo): { text: string; tone: 'ok' | 'wait' | 'bad' } {
  const r = v.render;
  if (!r?.available || r.phase === 'none') return { text: `Ovoz tayyor · ${Math.round(v.duration)} s`, tone: 'ok' };
  if (r.phase === 'queued') return { text: 'Video navbatda', tone: 'wait' };
  if (r.phase === 'rendering') return { text: `Video yig'ilmoqda · ${r.progress}%`, tone: 'wait' };
  if (r.phase === 'done') return { text: `Video tayyor · ${Math.round(v.duration + 2.3)} s`, tone: 'ok' };
  if (r.phase === 'stale') return { text: "Ssenariy yoki brend o'zgargan — videoni yangilang", tone: 'wait' };
  return { text: "Video yig'ilmadi", tone: 'bad' };
}

export function useServerClip(v: ContentVideo) {
  const [poster, setPoster] = useState<string | null>(null);
  const [clip, setClip] = useState<string | null>(null);
  const mp4 = useRef<Blob | null>(null);
  const ready = renderReady(v);

  // Muqova: video tayyor bo'lsa serverdan olinadi
  useEffect(() => {
    if (!ready) return;
    let url: string | null = null, live = true;
    void api.contentVideoPoster(v.id).then(b => {
      if (!live) return;
      url = URL.createObjectURL(b);
      setPoster(url);
    }).catch(() => undefined);
    return () => { live = false; if (url) URL.revokeObjectURL(url); };
  }, [v.id, ready]);

  useEffect(() => () => { if (clip) URL.revokeObjectURL(clip); }, [clip]);

  const file = async (): Promise<Blob> => (mp4.current ??= await api.contentVideoMp4(v.id));
  return {
    poster: ready ? poster : null,
    clip: ready ? clip : null,
    watch: async () => setClip(URL.createObjectURL(await file())),
    file,
  };
}
