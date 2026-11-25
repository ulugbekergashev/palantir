"""AI ovozini telefon liniyasi chastotasiga tushirish (24 → 8 kHz), oqim uchun.
Telefon liniyasi 4 kHz dan yuqorini o'tkazmaydi. Yuqori tovushlarni («s», «sh», «ch») avval o'chirmasdan har uchinchi namunani olsak,
ular yo'qolmaydi — pastki tovushlar ustiga buklanib tushadi va ovoz xirillab, sun'iy eshitiladi. Shuning uchun avval filtr, keyin siyraklash.
Kutubxonasiz (numpy klinika o'rnatgichini og'irlashtiradi): bitta qo'ng'iroqqa protsessorning ~2–3 foizi yetadi (check_resample.py)."""
import array
import math
from operator import mul

TAPS = 63            # filtr uzunligi: 3 kHz gacha tekis, 4,3 kHz dan boshlab −50 dB dan past
CUTOFF_HZ = 3700     # liniya 300–3400 Hz ni tashiydi


def lowpass(taps: int, cutoff_hz: float, rate: int) -> tuple[float, ...]:
    """Hamming oynali sinc filtri; yig'indisi 1 (ovoz balandligi o'zgarmaydi)"""
    mid, fc = (taps - 1) / 2, cutoff_hz / rate
    raw = [(2 * fc if i == mid else math.sin(2 * math.pi * fc * (i - mid)) / (math.pi * (i - mid)))
           * (0.54 - 0.46 * math.cos(2 * math.pi * i / (taps - 1))) for i in range(taps)]
    total = sum(raw)
    return tuple(c / total for c in raw)


class Downsampler:
    """Har bir qo'ng'iroqqa o'z nusxasi: bo'laklar orasidagi «dum» shu yerda saqlanadi, chegarada ovoz uzilmaydi"""

    def __init__(self, in_rate: int = 24000, factor: int = 3, taps: int = TAPS, cutoff_hz: float = CUTOFF_HZ) -> None:
        self.factor, self.taps = factor, taps
        self.coefs = lowpass(taps, cutoff_hz, in_rate)
        self.tail: list[int] = []     # hali to'liq ishlanmagan oxirgi namunalar
        self.odd = b''                # yarim namuna (toq bayt) keyingi bo'lakka

    def __call__(self, pcm: bytes) -> bytes:
        data = self.odd + pcm
        cut = len(data) - len(data) % 2
        self.odd = data[cut:]
        buf = self.tail + array.array('h', data[:cut]).tolist()
        coefs, taps, factor = self.coefs, self.taps, self.factor
        last = len(buf) - taps
        out = array.array('h', (max(-32768, min(32767, round(sum(map(mul, coefs, buf[i:i + taps])))))
                                for i in range(0, last + 1, factor)))
        self.tail = buf[len(out) * factor:]
        return out.tobytes()
