import type { ReactNode } from 'react';

/**
 * Yordamchi javobi va hujjat ko'rinishi uchun oddiy Markdown: sarlavha, ro'yxat,
 * **qalin**, *qiya*, havola, jadval. HTML qo'yilmaydi — faqat React elementlari.
 */

function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*\s][^*]*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\))/g;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${i++}`;
    if (t.startsWith('**')) out.push(<strong key={k}>{t.slice(2, -2)}</strong>);
    else if (t.startsWith('`')) out.push(<code key={k} className="rounded bg-slate-100 px-1 text-[0.9em]">{t.slice(1, -1)}</code>);
    else if (t.startsWith('[')) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t)!;
      out.push(<a key={k} href={href} target="_blank" rel="noreferrer noopener" className="font-semibold text-indigo-700 underline">{label}</a>);
    } else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
const isDivider = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);

export function Markdown({ text, className = '' }: { text: string; className?: string }) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? 'ol' : 'ul';
    blocks.push(
      <Tag key={blocks.length} className={`${list.ordered ? 'list-decimal' : 'list-disc'} space-y-0.5 pl-5`}>
        {list.items.map((it, i) => <li key={i}>{inline(it, i)}</li>)}
      </Tag>,
    );
    list = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].trim();
    if (!t) { flush(); continue; }
    if (t.startsWith('|') && i + 1 < lines.length && isDivider(lines[i + 1])) {
      flush();
      const head = cells(t);
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(cells(lines[i++]));
      i--;
      blocks.push(
        <div key={blocks.length} className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead><tr>{head.map((h, k) => <th key={k} className="border border-slate-200 bg-slate-50 px-2 py-1 text-left font-bold">{inline(h, k)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri}>{head.map((_, k) => <td key={k} className="border border-slate-200 px-2 py-1 align-top">{inline(r[k] ?? '', k)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(t);
    if (h) {
      flush();
      const size = h[1].length === 1 ? 'text-lg' : h[1].length === 2 ? 'text-base' : 'text-sm';
      blocks.push(<p key={blocks.length} className={`${size} font-extrabold`}>{inline(h[2].replace(/\*\*/g, ''))}</p>);
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { flush(); blocks.push(<hr key={blocks.length} className="border-slate-200" />); continue; }
    const bullet = /^[-*•]\s+(.*)$/.exec(t);
    const num = /^\d+[.)]\s+(.*)$/.exec(t);
    if (bullet || num) {
      const ordered = !!num;
      if (list && list.ordered !== ordered) flush();
      list ??= { ordered, items: [] };
      list.items.push((bullet ?? num)![1]);
      continue;
    }
    flush();
    blocks.push(<p key={blocks.length}>{inline(t)}</p>);
  }
  flush();
  return <div className={`space-y-2 break-words ${className}`}>{blocks}</div>;
}
