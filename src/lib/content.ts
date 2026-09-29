import type { Lang } from '../types';

/**
 * Demo uchun tayyor matnlar banki. Haqiqiy versiyada matnni AI klinika
 * ma'lumotidan yozadi; bu yerdagi qoidalar esa o'zgarmaydi: klinika aytmagan
 * chegirma, uskuna yoki natija haqida hech narsa qo'shilmaydi.
 */

type L<T> = Record<Lang, T>;

export interface Tip { title: L<string>; lines: L<string[]> }

export const TIPS: Tip[] = [
  {
    title: { uz: "Tish cho'tkasini qachon almashtirish kerak?", ru: 'Когда менять зубную щётку?' },
    lines: {
      uz: ['Har 3 oyda bir marta', "Shamollash yoki grippdan keyin", "Tuklari yoyilib qolsa — muddatidan oldin"],
      ru: ['Раз в 3 месяца', 'После простуды или гриппа', 'Если щетина растрепалась — раньше срока'],
    },
  },
  {
    title: { uz: "Tishni to'g'ri yuvishning 3 qoidasi", ru: '3 правила правильной чистки зубов' },
    lines: {
      uz: ['Kuniga 2 marta, kamida 2 daqiqa', "Cho'tkani milkka 45° burchak ostida tuting", 'Tilni tozalashni ham unutmang'],
      ru: ['2 раза в день, не меньше 2 минут', 'Держите щётку под углом 45° к десне', 'Не забывайте чистить язык'],
    },
  },
  {
    title: { uz: 'Tish ipi nega kerak?', ru: 'Зачем нужна зубная нить?' },
    lines: {
      uz: ["Cho'tka tishlar orasiga yetib bormaydi", "Karies ko'pincha aynan shu yerda boshlanadi", 'Kuniga bir marta, kechqurun yetarli'],
      ru: ['Щётка не достаёт между зубами', 'Кариес часто начинается именно там', 'Достаточно раз в день, вечером'],
    },
  },
  {
    title: { uz: "Milk qonasa — e'tibor bering", ru: 'Кровоточат дёсны — не игнорируйте' },
    lines: {
      uz: ["Bu milk yallig'lanishining belgisi bo'lishi mumkin", "Yuvishni to'xtatmang, yumshoq cho'tka oling", "Sababini bilish uchun ko'rikdan o'ting"],
      ru: ['Это может быть признаком воспаления', 'Не прекращайте чистку, возьмите мягкую щётку', 'Пройдите осмотр, чтобы узнать причину'],
    },
  },
  {
    title: { uz: "Bolaning birinchi ko'rigi qachon?", ru: 'Когда впервые вести ребёнка к стоматологу?' },
    lines: {
      uz: ['Birinchi tish chiqqanda yoki 1 yoshda', 'Sut tishlari ham davolanishi kerak', "Erta tanishuv — qo'rquv kamroq"],
      ru: ['С первым зубом или в 1 год', 'Молочные зубы тоже нужно лечить', 'Раннее знакомство — меньше страха'],
    },
  },
  {
    title: { uz: 'Shirinlikdan keyin nima qilish kerak?', ru: 'Что делать после сладкого?' },
    lines: {
      uz: ["Og'izni suv bilan chayqang", 'Tishni 30 daqiqadan keyin yuving', "Shakarsiz saqich so'lakni ko'paytiradi"],
      ru: ['Прополощите рот водой', 'Чистите зубы через 30 минут', 'Жвачка без сахара усиливает слюноотделение'],
    },
  },
  {
    title: { uz: 'Professional tozalash nega kerak?', ru: 'Зачем нужна профессиональная чистка?' },
    lines: {
      uz: ["Tish toshi cho'tka bilan ketmaydi", 'Yiliga 2 marta tavsiya etiladi', "Milklarni sog'lom saqlashga yordam beradi"],
      ru: ['Зубной камень щёткой не убрать', 'Рекомендуется 2 раза в год', 'Помогает сохранить здоровье дёсен'],
    },
  },
  {
    title: { uz: 'Tish sovuqdan sezsa', ru: 'Если зубы реагируют на холодное' },
    lines: {
      uz: ['Sezgir tishlar uchun pasta ishlating', "Juda issiq va juda sovuqdan ehtiyot bo'ling", 'Sababini shifokor aniqlaydi'],
      ru: ['Используйте пасту для чувствительных зубов', 'Избегайте слишком горячего и холодного', 'Причину определит врач'],
    },
  },
  {
    title: { uz: "Og'izdan noxush hid kelsa", ru: 'Если неприятный запах изо рта' },
    lines: {
      uz: ["Ko'pincha sabab — tildagi karash", "Tilni har kuni tozalang, ko'proq suv iching", "O'tmasa — ko'rikka keling"],
      ru: ['Часто причина — налёт на языке', 'Чистите язык каждый день, пейте больше воды', 'Если не проходит — приходите на осмотр'],
    },
  },
  {
    title: { uz: "Yiliga necha marta ko'rikka borish kerak?", ru: 'Как часто ходить на осмотр?' },
    lines: {
      uz: ['Kamida 2 marta', 'Muammo kichikligida topiladi', "Davolash osonroq va arzonroq bo'ladi"],
      ru: ['Минимум 2 раза в год', 'Проблему находят, пока она маленькая', 'Лечение проще и дешевле'],
    },
  },
];

export const TIP_CLOSERS: L<string[]> = {
  uz: [
    "Savolingiz bo'lsa — izohda yozing, shifokorlarimiz javob beradi.",
    "Postni saqlab qo'ying va yaqinlaringizga ulashing.",
    "Ko'rikka yozilish: {bot}",
  ],
  ru: [
    'Есть вопросы — пишите в комментариях, врачи ответят.',
    'Сохраните пост и поделитесь с близкими.',
    'Записаться на осмотр: {bot}',
  ],
};

export interface Poll { question: L<string>; options: L<[string, string]> }

export const POLLS: Poll[] = [
  { question: { uz: 'Tishingiz sovuqdan sezadimi?', ru: 'Зубы реагируют на холодное?' }, options: { uz: ['Ha', "Yo'q"], ru: ['Да', 'Нет'] } },
  { question: { uz: "Cho'tkangizni qachon almashtirgansiz?", ru: 'Когда вы меняли щётку?' }, options: { uz: ['3 oy ichida', 'Eslay olmayman'], ru: ['За последние 3 месяца', 'Не помню'] } },
  { question: { uz: 'Tish ipidan foydalanasizmi?', ru: 'Пользуетесь зубной нитью?' }, options: { uz: ['Har kuni', "Yo'q"], ru: ['Каждый день', 'Нет'] } },
  { question: { uz: "Oxirgi ko'rikdan beri qancha vaqt o'tdi?", ru: 'Когда был последний осмотр?' }, options: { uz: ['6 oydan kam', "Ancha bo'ldi"], ru: ['Меньше 6 месяцев', 'Давно'] } },
  { question: { uz: 'Tabassumingizdan mamnunmisiz?', ru: 'Нравится ваша улыбка?' }, options: { uz: ['Ha, albatta', 'Yaxshilamoqchiman'], ru: ['Да, конечно', 'Хочу лучше'] } },
  { question: { uz: "Stomatologga borishdan qo'rqasizmi?", ru: 'Боитесь стоматолога?' }, options: { uz: ['Biroz', "Yo'q"], ru: ['Немного', 'Нет'] } },
];

/** Xizmat turi bo'yicha umumiy (har klinikada to'g'ri) afzalliklar va kirish gaplari */
export interface ServiceProfile { keys: string[]; benefits: L<string[]>; hooks: L<string[]>; tags: L<string[]> }

export const SERVICE_PROFILES: ServiceProfile[] = [
  {
    keys: ['implant', 'имплант'],
    benefits: {
      uz: ["Yo'qotilgan tish o'rnini tiklaydi", 'Chaynash va tabassumni qaytaradi', "Reja shifokor ko'rigidan so'ng tuziladi"],
      ru: ['Восстанавливает утраченный зуб', 'Возвращает жевание и улыбку', 'План лечения — после осмотра врача'],
    },
    hooks: {
      uz: ["Bitta tish yo'qligi ham qo'shni tishlarga ta'sir qiladi.", "Yo'qolgan tishni tiklashni keyinga qoldirmang.", 'Tabassum qilishdan uyalmang — yechim bor.'],
      ru: ['Даже один отсутствующий зуб влияет на соседние.', 'Не откладывайте восстановление зуба.', 'Не стесняйтесь улыбаться — решение есть.'],
    },
    tags: { uz: ['#implant', '#implantatsiya'], ru: ['#имплантация'] },
  },
  {
    keys: ['tozala', 'gigiyen', 'чистк', 'гигиен'],
    benefits: {
      uz: ['Tish toshi va karashni ketkazadi', "Milklarni sog'lom saqlaydi", 'Yiliga 2 marta tavsiya etiladi'],
      ru: ['Убирает камень и налёт', 'Помогает сохранить дёсны здоровыми', 'Рекомендуется 2 раза в год'],
    },
    hooks: {
      uz: ["Cho'tka qila olmaydigan ishni biz qilamiz.", "Toza tish — sog'lom milk.", 'Oxirgi marta qachon tish toshini ketkazgansiz?'],
      ru: ['Делаем то, что не под силу щётке.', 'Чистые зубы — здоровые дёсны.', 'Когда вы последний раз убирали зубной камень?'],
    },
    tags: { uz: ['#tishtozalash'], ru: ['#чистказубов'] },
  },
  {
    keys: ['oqart', 'отбел'],
    benefits: {
      uz: ['Emalni asragan holda oqartirish', "Avval ko'rik, keyin muolaja", "Natija tish holatiga bog'liq — shifokor tushuntiradi"],
      ru: ['Отбеливание с заботой об эмали', 'Сначала осмотр, затем процедура', 'Результат зависит от состояния зубов — врач объяснит'],
    },
    hooks: {
      uz: ["Tabassumingiz yanada yorqin bo'lsin.", "To'y yoki muhim kun oldidan — ayni vaqti.", 'Rasmlarda ham ishonch bilan jilmaying.'],
      ru: ['Пусть ваша улыбка станет ярче.', 'Перед свадьбой или важным днём — самое время.', 'Улыбайтесь уверенно и на фото.'],
    },
    tags: { uz: ['#tishoqartirish'], ru: ['#отбеливаниезубов'] },
  },
  {
    keys: ['breket', 'ortodon', 'kapa', 'брекет', 'ортодон', 'элайнер'],
    benefits: {
      uz: ["Tishlar qatorini to'g'rilash", 'Bolalar va kattalar uchun', "Reja ortodont ko'rigidan keyin tuziladi"],
      ru: ['Исправление прикуса и ряда зубов', 'Для детей и взрослых', 'План — после осмотра ортодонта'],
    },
    hooks: {
      uz: ["Tekis tishlar — faqat chiroy emas, sog'liq ham.", "To'g'ri tishlarni parvarishlash osonroq.", 'Tabassumingizni tekislash hech qachon kech emas.'],
      ru: ['Ровные зубы — это не только красиво, но и полезно.', 'За ровными зубами легче ухаживать.', 'Исправить улыбку никогда не поздно.'],
    },
    tags: { uz: ['#breket', '#ortodont'], ru: ['#брекеты'] },
  },
  {
    keys: ['plomba', 'karies', 'пломб', 'кариес'],
    benefits: {
      uz: ['Tish rangiga mos zamonaviy plomba', "Mahalliy og'riqsizlantirish bilan", 'Kariesni vaqtida davolash arzonroq'],
      ru: ['Современная пломба в цвет зуба', 'С местной анестезией', 'Лечить кариес вовремя — дешевле'],
    },
    hooks: {
      uz: ["Kichik qora dog' — katta muammoning boshlanishi bo'lishi mumkin.", "Tish og'rimasa ham, ko'rik kerak.", 'Kariesni kichikligida davolang.'],
      ru: ['Маленькое тёмное пятно может быть началом большой проблемы.', 'Даже если не болит — осмотр нужен.', 'Лечите кариес, пока он маленький.'],
    },
    tags: { uz: ['#plomba', '#karies'], ru: ['#пломба', '#кариес'] },
  },
  {
    keys: ['kanal', 'канал', 'endodon'],
    benefits: {
      uz: ['Tishni saqlab qolishga harakat qilamiz', 'Rentgen nazoratida', "Mahalliy og'riqsizlantirish bilan"],
      ru: ['Стараемся сохранить зуб', 'Под рентген-контролем', 'С местной анестезией'],
    },
    hooks: {
      uz: ["Tish qattiq og'riyaptimi? Kechiktirmang.", "Tishni sug'urishdan oldin uni saqlab qolish imkonini ko'rib chiqamiz.", "Og'riq — tanangiz bergan signal."],
      ru: ['Сильно болит зуб? Не откладывайте.', 'Прежде чем удалять — попробуем сохранить.', 'Боль — это сигнал организма.'],
    },
    tags: { uz: ['#kanaldavolash'], ru: ['#лечениеканалов'] },
  },
  {
    keys: ['bola', 'детск', 'pediat'],
    benefits: {
      uz: ["Bolalar bilan ishlashni biladigan shifokor", 'Birinchi tashrif — tanishuv', 'Sut tishlarini ham davolaymiz'],
      ru: ['Врач, который умеет работать с детьми', 'Первый визит — знакомство', 'Лечим и молочные зубы'],
    },
    hooks: {
      uz: ["Farzandingiz stomatologdan qo'rqmasin.", 'Sut tishlari ham muhim.', 'Bolaning tabassumi — eng qimmatli.'],
      ru: ['Пусть ребёнок не боится стоматолога.', 'Молочные зубы тоже важны.', 'Детская улыбка — самое ценное.'],
    },
    tags: { uz: ['#bolalarstomatologiyasi'], ru: ['#детскаястоматология'] },
  },
  {
    keys: ['konsult', "ko'rik", 'korik', 'консульт', 'осмотр'],
    benefits: {
      uz: ['Tishlaringiz holatini aniqlaymiz', 'Davolash rejasi va narxini tushuntiramiz', 'Qulay vaqtga yoziling'],
      ru: ['Оценим состояние ваших зубов', 'Объясним план и стоимость лечения', 'Запишитесь на удобное время'],
    },
    hooks: {
      uz: ["Oxirgi ko'rikdan beri qancha vaqt o'tdi?", "Muammoni erta topish — davolashni osonlashtiradi.", 'Tishlaringiz holatini bilib oling.'],
      ru: ['Когда вы последний раз были на осмотре?', 'Раннее выявление облегчает лечение.', 'Узнайте, в каком состоянии ваши зубы.'],
    },
    tags: { uz: ['#stomatologkorigi'], ru: ['#осмотрстоматолога'] },
  },
];

export const DEFAULT_PROFILE: ServiceProfile = {
  keys: [],
  benefits: {
    uz: ["Ko'rik va davolash rejasi", 'Qulay vaqtga yozilish', 'Savollaringizga javob beramiz'],
    ru: ['Осмотр и план лечения', 'Запись на удобное время', 'Ответим на ваши вопросы'],
  },
  hooks: {
    uz: ["Tishlaringiz sog'lig'ini ishonchli qo'llarga topshiring.", 'Tabassumingizni biz bilan asrang.', "Sog'lom tish — ishonchli tabassum."],
    ru: ['Доверьте здоровье зубов профессионалам.', 'Берегите улыбку вместе с нами.', 'Здоровые зубы — уверенная улыбка.'],
  },
  tags: { uz: [], ru: [] },
};

export const profileOf = (name: string): ServiceProfile => {
  const n = name.toLowerCase().replace(/[‘’ʻʼ`]/g, "'");
  return SERVICE_PROFILES.find(p => p.keys.some(k => n.includes(k))) || DEFAULT_PROFILE;
};

export const PROMO_KICKERS: L<string[]> = { uz: ['Aksiya', 'Maxsus taklif'], ru: ['Акция', 'Спецпредложение'] };
export const SERVICE_KICKERS: L<string[]> = { uz: ['Xizmatimiz', 'Tavsiya qilamiz'], ru: ['Наша услуга', 'Рекомендуем'] };

export const DOCTOR_INTROS: L<string[]> = {
  uz: [
    "Qabulga yozilib, savollaringizni shifokorning o'ziga bering.",
    'Shifokorimiz bilan tanishing — qabulga oldindan yoziling.',
    'Maslahat kerakmi? Shifokorimiz qabulida kutadi.',
  ],
  ru: [
    'Запишитесь на приём и задайте вопросы врачу лично.',
    'Познакомьтесь с нашим врачом — запишитесь заранее.',
    'Нужна консультация? Врач ждёт вас на приёме.',
  ],
};

export const BASE_TAGS: L<string[]> = { uz: ['#stomatologiya', '#tishsalomatligi'], ru: ['#стоматология', '#здоровыезубы'] };

/** Tibbiy reklamada standart ogohlantirish */
export const MEDICAL_NOTE: L<string> = {
  uz: "Muolaja oldidan shifokor ko'rigi zarur.",
  ru: 'Перед лечением необходима консультация врача.',
};
