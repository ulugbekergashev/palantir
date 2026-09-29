// Barcha sana va jadval Toshkent vaqtida (hosting serveri odatda UTC'da ishlaydi).
// Birinchi import bo'lishi kerak — boshqa modullar sana hisoblashidan oldin.
process.env.TZ ||= 'Asia/Tashkent';
