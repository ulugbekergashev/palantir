/**
 * Miya sahifasini Obsidian'dagidek o'qish ko'rinishi: xususiyatlar (frontmatter), sarlavhalar, ro'yxatlar va vazifa katakchalari,
 * iqtibos va callout (> [!note]), jadval, kod, [[havola|nom]] — bosilsa o'sha sahifa ochiladi. %%izoh%% va satr oxiridagi ^id
 * Obsidian'dagidek ko'rinmaydi. HTML qo'yilmaydi — faqat React elementlari.
 */
import type { ReactNode } from 'react';

type OnLink = (target: string) => void;

const INLINE = /(\[\[[^\]]+\]\]|\*\*[^*]+\*\*|==[^=]+==|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)\s]+\)|(?<![\w*])\*[^*\s][^*]*\*|(?<![\w/#])#[\p{L}\p{N}_/-]+)/gu;

function inline(text: string, onLink: OnLink, key = 'i'): ReactNode[] {
  const out: ReactNode[] = [];
  const clean = text.replace(/\s\^[A-Za-z0-9-]{3,}$/, '');
  let last = 0;
  let n = 0;
  for (const m of clean.matchAll(INLINE)) {
    if (m.index > last) out.push(clean.slice(last, m.index));
    const t = m[0];
    const k = `${key}-${n++}`;
    if (t.startsWith('[[')) {
      const [target, alias] = t.slice(2, -2).split('|');
      const page = target.split('#')[0].trim();
      out.push(<button key={k} type="button" onClick={() => onLink(page)} className="cursor-pointer rounded font-medium text-[#a9aaff] underline decoration-[#a9aaff]/40 underline-offset-2 hover:decoration-[#a9aaff]">{(alias ?? target).trim()}</button>);
    } else if (t.startsWith('**')) out.push(<strong key={k} className="font-semibold text-[#f2f0ea]">{t.slice(2, -2)}</strong>);
    else if (t.startsWith('==')) out.push(<mark key={k} className="rounded bg-[#f5b454]/25 px-0.5 text-[#fde2b0]">{t.slice(2, -2)}</mark>);
    else if (t.startsWith('`')) out.push(<code key={k} className="rounded bg-glass/[0.07] px-1.5 py-0.5 font-mono text-[0.88em] text-[#e4e3de]">{t.slice(1, -1)}</code>);
    else if (t.startsWith('[')) {
      const [, label, href] = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(t)!;
      out.push(<a key={k} href={href} target="_blank" rel="noreferrer noopener" className="text-[#a9aaff] underline underline-offset-2">{label}</a>);
    } else if (t.startsWith('#')) out.push(<span key={k} className="rounded-full bg-[#8b8cff]/15 px-2 py-0.5 text-[0.85em] text-[#c7c8ff]">{t}</span>);
    else out.push(<em key={k}>{t.slice(1, -1)}</em>);
    last = m.index + t.length;
  }
  if (last < clean.length) out.push(clean.slice(last));
  return out;
}

const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(c => c.trim());
const isDivider = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
const CALLOUT: Record<string, string> = { warning: 'border-[#f5b454]/40 bg-[#f5b454]/[0.07]', danger: 'border-rose-400/40 bg-rose-400/[0.07]', tip: 'border-emerald-400/40 bg-emerald-400/[0.07]' };

/** Frontmatter (--- … ---) → xususiyatlar; matnning qolgani */
function split(text: string): { props: [string, string][]; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!m) return { props: [], body: text };
  const props = m[1].split(/\r?\n/).map(l => /^([\wЀ-ӿ' -]+):\s*(.*)$/.exec(l)).filter(Boolean).map(x => [x![1], x![2].replace(/^"|"$/g, '')] as [string, string]);
  return { props, body: text.slice(m[0].length) };
}

export function NoteView({ text, onLink }: { text: string; onLink: OnLink }) {
  const { props, body } = split(text.replace(/%%[\s\S]*?%%/g, ''));
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) blocks.push(<p key={blocks.length} className="leading-[1.75]">{inline(para.join(' '), onLink, `p${blocks.length}`)}</p>);
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const t = raw.trim();
    if (!t) { flushPara(); continue; }
    if (t.startsWith('```')) {
      flushPara();
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i].trim().startsWith('```'); i++) code.push(lines[i]);
      blocks.push(<pre key={blocks.length} className="overflow-x-auto rounded-xl bg-glass/[0.04] p-4 font-mono text-[13px] leading-relaxed text-[#d9dbe1]">{code.join('\n')}</pre>);
      continue;
    }
    if (t.startsWith('|') && i + 1 < lines.length && isDivider(lines[i + 1])) {
      flushPara();
      const head = cells(t);
      const rows: string[][] = [];
      for (i += 2; i < lines.length && lines[i].trim().startsWith('|'); i++) rows.push(cells(lines[i]));
      i--;
      blocks.push(
        <div key={blocks.length} className="overflow-x-auto rounded-xl border border-glass/10">
          <table className="w-full border-collapse text-[14px]">
            <thead><tr className="bg-glass/[0.04]">{head.map((h, k) => <th key={k} className="px-3 py-2 text-left font-semibold text-[#d9dbe1]">{inline(h, onLink, `h${k}`)}</th>)}</tr></thead>
            <tbody>{rows.map((r, ri) => <tr key={ri} className="border-t border-glass/[0.06]">{head.map((_, k) => <td key={k} className="px-3 py-2 align-top">{inline(r[k] ?? '', onLink, `c${ri}${k}`)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    const h = /^(#{1,6})\s+(.*)$/.exec(t);
    if (h) {
      flushPara();
      const size = ['text-[30px] font-bold', 'text-[21px] font-semibold', 'text-[17px] font-semibold', 'text-[15px] font-semibold', 'text-sm font-semibold', 'text-sm font-semibold'][h[1].length - 1];
      blocks.push(<p key={blocks.length} className={`${size} mt-3 tracking-tight text-[#f2f0ea]`}>{inline(h[2], onLink, `t${i}`)}</p>);
      continue;
    }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { flushPara(); blocks.push(<hr key={blocks.length} className="border-glass/10" />); continue; }
    if (t.startsWith('>')) {
      flushPara();
      const quote: string[] = [];
      for (; i < lines.length && lines[i].trim().startsWith('>'); i++) quote.push(lines[i].trim().replace(/^>\s?/, ''));
      i--;
      const callout = /^\[!(\w+)\][+-]?\s*(.*)$/.exec(quote[0] ?? '');
      const kind = callout?.[1].toLowerCase() ?? '';
      blocks.push(
        <div key={blocks.length} className={`rounded-xl border-l-2 px-4 py-3 ${callout ? CALLOUT[kind] ?? 'border-[#8b8cff]/50 bg-[#8b8cff]/[0.07]' : 'border-glass/20 text-[#c9cbd2]'}`}>
          {callout && <p className="mb-1 font-semibold capitalize text-[#f2f0ea]">{callout[2] || callout[1]}</p>}
          {(callout ? quote.slice(1) : quote).filter(Boolean).map((q, k) => <p key={k} className="leading-relaxed">{inline(q, onLink, `q${i}${k}`)}</p>)}
        </div>,
      );
      continue;
    }
    const item = /^(\s*)(?:[-*+]|\d+[.)])\s+(.*)$/.exec(raw);
    if (item) {
      flushPara();
      const depth = Math.min(4, Math.floor(item[1].replace(/\t/g, '  ').length / 2));
      const task = /^\[([ xX-])\]\s+(.*)$/.exec(item[2]);
      blocks.push(
        <div key={blocks.length} className="flex items-baseline gap-2.5 leading-[1.7]" style={{ paddingLeft: `${depth * 1.4}rem` }}>
          {task
            ? <span aria-hidden="true" className={`relative top-[3px] inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border ${task[1] === ' ' ? 'border-glass/30' : 'border-[#8b8cff] bg-[#8b8cff] text-[#07080b]'} text-[11px] font-bold`}>{task[1] === ' ' ? '' : task[1] === '-' ? '–' : '✓'}</span>
            : <span aria-hidden="true" className="relative top-[-2px] h-1.5 w-1.5 shrink-0 rounded-full bg-[#8a909c]" />}
          <span className={task && task[1] !== ' ' ? 'text-[#8a909c] line-through' : ''}>{inline(task ? task[2] : item[2], onLink, `l${i}`)}</span>
        </div>,
      );
      continue;
    }
    para.push(t);
  }
  flushPara();

  return (
    <div className="flex flex-col gap-3 text-[15.5px] text-[#d9dbe1]">
      {props.length > 0 && (
        <dl className="mb-2 grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)] gap-x-4 gap-y-1.5 rounded-xl border border-glass/[0.08] bg-glass/[0.02] px-4 py-3 text-[13px]">
          {props.map(([k, v]) => [<dt key={`k${k}`} className="text-[#8a909c]">{k}</dt>, <dd key={`v${k}`} className="m-0 text-[#d9dbe1]">{v}</dd>])}
        </dl>
      )}
      {blocks}
    </div>
  );
}
