/**
 * Tayyor savollar: mijozlar eng ko'p so'raydigan, lekin javobi faqat egasining o'zida bo'lgan narsalar.
 * Bu yerda javob yo'q va bo'lmaydi ham — har biznes o'zinikini bir marta yozadi, keyin Cerebro o'zi javob beradi.
 * Narxlar jadvalda, manzil va ish vaqti «Biznes haqida» sahifasida turadi, shuning uchun ular bu ro'yxatda yo'q.
 */
export interface PackQuestion { id: string; question: string; hint: string }

export const CLINIC_PACK: PackQuestion[] = [
  { id: 'consult', question: "Birinchi ko'rik (konsultatsiya) pullikmi?", hint: "Masalan: bepul. Yoki: 50 000 so'm, davolansa hisobdan chiqariladi" },
  { id: 'payment', question: "Qanday to'lash mumkin?", hint: 'Masalan: naqd, karta, Click, Payme' },
  { id: 'installment', question: "Bo'lib to'lash bormi?", hint: "Masalan: 3 oygacha, foizsiz, 2 000 000 so'mdan yuqori davolashda" },
  { id: 'pain', question: "Davolash og'riqlimi, og'riqsizlantirish qilinadimi?", hint: "Masalan: hamma muolaja mahalliy og'riqsizlantirish bilan, narxga kiradi" },
  { id: 'children', question: 'Bolalarni qabul qilasizmi?', hint: 'Masalan: ha, 3 yoshdan; bolalar shifokori dushanba va payshanba kunlari' },
  { id: 'xray', question: "Rentgen o'zingizda bormi?", hint: "Masalan: ha, panoram va 3D tomografiya shu yerda" },
  { id: 'urgent', question: "O'tkir og'riq bilan navbatsiz qabul qilasizmi?", hint: "Masalan: ha, shu kuni; kechasi qo'ng'iroq qilinsa navbatchi shifokor chiqadi" },
  { id: 'materials', question: 'Qaysi implant va materiallar bilan ishlaysiz?', hint: 'Masalan: Osstem va Straumann implantlari, nemis plomba materiallari' },
  { id: 'discount', question: 'Chegirma yoki aksiya bormi?', hint: "Masalan: oilaviy 10%, pensionerlarga 5%; hozir aksiya yo'q" },
  { id: 'doctor', question: "Shifokorni o'zim tanlasam bo'ladimi, ayol shifokor bormi?", hint: "Masalan: ha, yozilayotganda aytiladi; ikki ayol shifokor bor" },
  { id: 'cancel', question: "Qabulga kelolmasam yoki kechiksam nima bo'ladi?", hint: "Masalan: oldindan aytsangiz boshqa vaqtga ko'chiramiz; 15 daqiqadan ko'p kechiksa navbat o'tadi" },
  { id: 'sterile', question: 'Asboblar qanday sterilizatsiya qilinadi?', hint: 'Masalan: har bemordan keyin avtoklavda, paketi bemorning oldida ochiladi' },
  { id: 'route', question: "Klinikaga qanday boriladi, mashina qo'yadigan joy bormi?", hint: "Masalan: mo'ljal — Korzinka ro'parasi, bino oldida bepul turargoh" },
];

export const GENERAL_PACK: PackQuestion[] = [
  { id: 'payment', question: "Qanday to'lash mumkin?", hint: 'Masalan: naqd, karta, Click, Payme' },
  { id: 'installment', question: "Bo'lib to'lash bormi?", hint: "Masalan: 6 oygacha, boshlang'ich to'lov 30%" },
  { id: 'delivery', question: 'Yetkazib berasizmi, narxi va muddati qanday?', hint: "Masalan: shahar ichida bepul, 1–2 kunda; viloyatlarga pochta orqali" },
  { id: 'warranty', question: 'Kafolat bormi, qaytarib yoki almashtirib olsa bo\'ladimi?', hint: 'Masalan: 1 yil kafolat; 10 kun ichida almashtirish mumkin' },
  { id: 'discount', question: 'Chegirma yoki aksiya bormi?', hint: "Masalan: 2 tadan ko'p olinsa 5%; hozir aksiya yo'q" },
  { id: 'order', question: 'Buyurtma qanday beriladi?', hint: "Masalan: shu yerga yozing yoki qo'ng'iroq qiling; oldindan to'lov 50%" },
  { id: 'route', question: 'Qanday boriladi?', hint: "Masalan: mo'ljal — Korzinka ro'parasi, 2-qavat" },
];

// Qaysi biznesga qaysi ro'yxat — soha profilida (industries.ts: packFor)
