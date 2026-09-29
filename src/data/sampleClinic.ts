import type { Clinic } from '../types';

/**
 * Sotuv demosi uchun o'ylab topilgan klinika. Telefon raqami mavjud bo'lmagan
 * "+998 00" kodida, Telegram va Instagram manzillari namunaviy.
 */
export const sampleClinic = (): Clinic => ({
  name: 'Marvarid Dent',
  ownerName: 'Aziz aka',
  phone: '+998 00 123 45 67',
  address: "Toshkent, Chilonzor tumani, Bunyodkor ko'chasi 12",
  addressRu: 'Ташкент, Чиланзарский район, ул. Бунёдкор, 12',
  instagram: '@marvarid.dent',
  telegramBot: '@marvarid_dent_bot',
  telegramChannel: '@marvarid_dent',
  followers: 4800,
  brand: { primary: '#0F766E', accent: '#F59E0B' },
  services: [
    { id: 's-consult', name: "Ko'rik va konsultatsiya", nameRu: 'Осмотр и консультация', price: 50000 },
    { id: 's-clean', name: 'Professional tozalash', nameRu: 'Профессиональная чистка', price: 350000 },
    { id: 's-white', name: 'Tish oqartirish', nameRu: 'Отбеливание зубов', price: 1800000 },
    { id: 's-fill', name: 'Plomba', nameRu: 'Пломба', price: 400000 },
    { id: 's-canal', name: 'Kanal davolash', nameRu: 'Лечение каналов', price: 1200000 },
    { id: 's-implant', name: 'Implant', nameRu: 'Имплантация', price: 5500000 },
    { id: 's-braces', name: 'Breket tizimi', nameRu: 'Брекет-система', price: 9000000 },
    { id: 's-kids', name: 'Bolalar stomatologiyasi', nameRu: 'Детская стоматология', price: 250000 },
  ],
  doctors: [
    { id: 'd-1', name: 'Dr. Nigora Karimova', specialty: 'Terapevt', specialtyRu: 'Терапевт', years: 12 },
    { id: 'd-2', name: 'Dr. Jasur Rahimov', specialty: 'Implantolog', specialtyRu: 'Имплантолог', years: 9 },
    { id: 'd-3', name: 'Dr. Dilnoza Yusupova', specialty: 'Bolalar stomatologi', specialtyRu: 'Детский стоматолог', years: 7 },
    { id: 'd-4', name: 'Dr. Bekzod Toshmatov', specialty: 'Ortodont', specialtyRu: 'Ортодонт', years: 10 },
  ],
  goal: {
    focusServiceId: 's-implant',
    promo: "Konsultatsiya va 3D-rentgen bepul",
    promoRu: 'Консультация и 3D-снимок бесплатно',
    promoUntil: '2026-10-31',
    freeSlots: [
      { day: 1, time: '15:00' },
      { day: 2, time: '11:30' },
      { day: 3, time: '17:00' },
      { day: 5, time: '10:00' },
    ],
  },
});
