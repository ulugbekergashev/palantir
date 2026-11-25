"""AI ovozini telefon liniyasiga tushirish (24 → 8 kHz) — tekshiruv: hech qayerga ulanmaydi, faqat hisob.
Eski usul (uchta namunaning o'rtachasi) 4 kHz dan yuqori tovushlarni («s», «sh», «ch») o'chirmasdan liniyaga buklab tushirardi —
ovoz xirillab, «robot» bo'lib eshitilardi. Ishga tushirish (tgvoice papkasidan):  .venv\\Scripts\\python.exe check_resample.py"""
import array
import math
import sys
import time

from resample import Downsampler

sys.stdout.reconfigure(encoding='utf-8')
results: list[bool] = []
IN_RATE, OUT_RATE = 24000, 8000


def ok(name: str, cond: bool, detail: str = '') -> None:
    results.append(cond)
    print(f"  {'✓' if cond else '✗'} {name}" + (f' — {detail}' if detail else ''))


def tone(freq: float, seconds: float = 0.5, amp: int = 12000) -> bytes:
    return array.array('h', (round(amp * math.sin(2 * math.pi * freq * i / IN_RATE)) for i in range(int(IN_RATE * seconds)))).tobytes()


def level_db(pcm: bytes, ref: int = 12000) -> float:
    """Chiqishning o'rtacha kuchi kirish ohangiga nisbatan (boshi — filtr to'lguncha — tashlanadi)"""
    a = array.array('h', pcm)[200:]
    rms = math.sqrt(sum(s * s for s in a) / len(a))
    return 20 * math.log10(max(rms, 1e-9) / (ref / math.sqrt(2)))


def old_way(pcm: bytes) -> bytes:
    a = array.array('h', pcm[: len(pcm) - len(pcm) % 6])
    return array.array('h', ((a[i] + a[i + 1] + a[i + 2]) // 3 for i in range(0, len(a), 3))).tobytes()


def main() -> None:
    print('Gap tovushlari (liniya o\'tkazadigan qism) saqlanadi:')
    for freq in (300, 1000, 2000, 3000):
        db = level_db(Downsampler()(tone(freq)))
        ok(f'{freq} Hz', abs(db) < 1.0, f'{db:+.1f} dB')

    print('Liniyaga sig\'maydigan tovushlar o\'chiriladi (buklanib «xirillash» bo\'lmaydi):')
    for freq in (5000, 6000, 7000, 9000, 11000):
        db, was = level_db(Downsampler()(tone(freq))), level_db(old_way(tone(freq)))
        ok(f'{freq} Hz', db < -40, f'{db:+.0f} dB (eski usulda {was:+.0f} dB)')

    print('Oqim bo\'laklab kelsa ham natija bir xil (bo\'lak chegarasida «chiq» etmaydi):')
    pcm = tone(1000, 0.3) + tone(2500, 0.3)
    whole = Downsampler()(pcm)
    d, parts = Downsampler(), bytearray()
    sizes, at = [2, 960, 14, 4800, 962, 6, 1234], 0
    while at < len(pcm):
        n = sizes[len(parts) % len(sizes)]
        parts += d(pcm[at:at + n])
        at += n
    ok('bo\'laklab = bir yo\'la', bytes(parts) == whole, f'{len(parts)} / {len(whole)} bayt')
    ok('3 kirish namunasiga 1 chiqish', abs(len(whole) // 2 - len(pcm) // 2 // 3) <= 21, f'{len(whole) // 2} namuna')
    ok('toq baytli bo\'lak yiqitmaydi', len(Downsampler()(b'\x01\x02\x03')) == 0)

    print('Baland ovoz buzilmaydi:')
    loud = array.array('h', Downsampler()(tone(1000, amp=32767)))
    ok('chegaradan chiqmaydi', max(loud) <= 32767 and min(loud) >= -32768)

    print('Tezlik (bitta qo\'ng\'iroq protsessorni band qilmasin):')
    second = tone(700, 1.0)
    d, t0 = Downsampler(), time.perf_counter()
    for i in range(0, len(second), 960):   # Gemini'dan keladigan kabi 20 ms bo'laklar
        d(second[i:i + 960])
    spent = time.perf_counter() - t0
    ok('1 soniya ovoz — 0,1 s dan kam hisob', spent < 0.1, f'{spent * 1000:.0f} ms')

    failed = results.count(False)
    print(f"\n{len(results) - failed}/{len(results)} o'tdi")
    sys.exit(1 if failed else 0)


main()
