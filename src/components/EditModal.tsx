import { useEffect, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import type { Clinic, ContentItem, ItemEdit, Lang } from '../types';
import { Artboard } from '../templates/Artboard';
import { ComplianceNote } from './ItemCard';
import { Button, Field, LangSwitch, inputClass } from './ui';

/** Egasi AI variantini o'zi to'g'rilaydi: sarlavha (rasmdagi) va post matni */
export function EditModal({ item, original, clinic, lang: initialLang, onSave, onReset, onClose }: {
  item: ContentItem; original: ContentItem; clinic: Clinic; lang: Lang;
  onSave: (edit: Partial<Record<Lang, ItemEdit>>) => void; onReset: () => void; onClose: () => void;
}) {
  const [lang, setLang] = useState<Lang>(initialLang);
  const [draft, setDraft] = useState<Record<Lang, { title: string; caption: string }>>({
    uz: { title: item.design.uz.title, caption: item.caption.uz },
    ru: { title: item.design.ru.title, caption: item.caption.ru },
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const preview: ContentItem = {
    ...item,
    design: { uz: { ...item.design.uz, title: draft.uz.title }, ru: { ...item.design.ru, title: draft.ru.title } },
    caption: { uz: draft.uz.caption, ru: draft.ru.caption },
  };
  const set = (field: 'title' | 'caption', value: string) => setDraft(d => ({ ...d, [lang]: { ...d[lang], [field]: value } }));

  const save = () => {
    // Faqat AI variantidan farq qilgan maydonlar saqlanadi
    const edit: Partial<Record<Lang, ItemEdit>> = {};
    for (const l of ['uz', 'ru'] as Lang[]) {
      const e: ItemEdit = {};
      if (draft[l].title.trim() && draft[l].title !== original.design[l].title) e.title = draft[l].title.trim();
      if (draft[l].caption !== original.caption[l]) e.caption = draft[l].caption;
      if (e.title !== undefined || e.caption !== undefined) edit[l] = e;
    }
    onSave(edit);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div role="dialog" aria-modal="true" aria-label="Matnni tahrirlash" className="animate-pop flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onMouseDown={e => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="text-base font-bold">Matnni tahrirlash</h2>
          <div className="flex items-center gap-3">
            <LangSwitch label="Til" value={lang} onChange={setLang} options={[{ value: 'uz', label: "O'zbekcha" }, { value: 'ru', label: 'Русский' }]} />
            <button type="button" aria-label="Yopish" onClick={onClose} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button>
          </div>
        </header>
        <div className="grid min-h-0 flex-1 gap-5 overflow-y-auto p-5 md:grid-cols-[1fr_280px]">
          <div className="space-y-4">
            <Field label="Rasmdagi sarlavha">
              <input className={inputClass} value={draft[lang].title} onChange={e => set('title', e.target.value)} />
            </Field>
            <Field label="Post matni" hint="Instagram va Telegram kanalga shu matn chiqadi">
              <textarea className={`${inputClass} h-72 resize-y py-2.5 leading-relaxed`} value={draft[lang].caption} onChange={e => set('caption', e.target.value)} />
            </Field>
            <ComplianceNote text={`${draft[lang].title}\n${draft[lang].caption}`} />
          </div>
          <div className="flex items-start justify-center rounded-xl bg-slate-100 p-3">
            <Artboard item={preview} lang={lang} clinic={clinic} className={item.kind === 'story' ? 'h-[440px] w-auto' : 'h-auto w-full'} />
          </div>
        </div>
        <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-5 py-3">
          <Button variant="ghost" size="sm" onClick={onReset}><RotateCcw className="h-3.5 w-3.5" /> AI variantiga qaytarish</Button>
          <div className="flex gap-2">
            <Button onClick={onClose}>Bekor qilish</Button>
            <Button variant="primary" onClick={save}>Saqlash</Button>
          </div>
        </footer>
      </div>
    </div>
  );
}
