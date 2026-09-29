import { useId, type ReactNode, type Ref } from 'react';
import type { Clinic, ContentItem, Lang, TemplateId } from '../types';
import { FONT_FAMILY } from '../lib/text';
import { DoctorArt } from './doctor';
import { HolidayArt } from './holiday';
import { W, type TplProps } from './parts';
import { PromoArt } from './promo';
import { PollArt, SlotsArt } from './stories';
import { TipArt } from './tip';

const TEMPLATES: Record<TemplateId, (p: TplProps) => ReactNode> = {
  promo: PromoArt,
  tip: TipArt,
  doctor: DoctorArt,
  holiday: HolidayArt,
  slots: SlotsArt,
  poll: PollArt,
};

export const heightOf = (item: ContentItem) => (item.kind === 'story' ? 1920 : 1080);

/**
 * Post yoki storis rasmi. Ko'rish uchun ham, PNG uchun ham shu SVG ishlatiladi —
 * ekrandagi va yuklab olingan rasm bir xil bo'ladi.
 */
export function Artboard({ item, lang, clinic, className, ref }: {
  item: ContentItem; lang: Lang; clinic: Clinic; className?: string; ref?: Ref<SVGSVGElement>;
}) {
  const uid = `a${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const H = heightOf(item);
  const Template = TEMPLATES[item.template];
  return (
    <svg ref={ref} viewBox={`0 0 ${W} ${H}`} className={className} role="img" aria-label={item.design[lang].title} xmlns="http://www.w3.org/2000/svg">
      <g fontFamily={FONT_FAMILY}>
        <Template
          d={item.design[lang]}
          clinic={clinic}
          style={item.style}
          H={H}
          uid={uid}
          seed={item.seed}
          solemn={item.solemn}
          doctor={clinic.doctors.find(doc => doc.id === item.doctorId)}
        />
      </g>
    </svg>
  );
}
