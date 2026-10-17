"""«ovoz: voicelab:…» tekshiruvi (qo'ng'iroqsiz, soxta Telegram bilan): Live matni bo'lak-bo'lak keladi →
gaplar VoiceLab'da tartib bilan o'qiladi; gap bo'linsa navbatdagilar tashlanadi; AI gapirib bo'lgach «gapiryapti» holati tushadi.
VoiceLab kreditidan ~200 sarflaydi."""
import asyncio
import sys
import time
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
sys.argv = ['call_live.py', 'tekshiruv']
src = open(Path(__file__).resolve().parent / 'call_live.py', encoding='utf-8').read().split('MISSED = 2')[0]
exec(compile(src, 'call_live.py', 'exec'))


class FakeCalls:
    async def send_frame(self, peer, device, data):
        assert len(data) == FRAME_BYTES


async def main():
    b = Bridge(FakeCalls(), 1)
    b.speaker = VoiceLabVoice('Madina')
    worker = asyncio.create_task(b.tts_worker())
    t0 = time.monotonic()
    # Live matni shunday bo'laklarda keladi
    for chunk in ["Assalomu alaykum, Ulug'bek", " aka! Ertaga soat o'nda", " eslatib qo'yaman. Yana nima", " qilay?"]:
        b.feed(chunk)
        await asyncio.sleep(0.15)
    b.feed('', final=True)
    while not b.outbuf:
        await asyncio.sleep(0.02)
    first = time.monotonic() - t0
    while b.speaking() and b.tts_busy or not b.tts_q.empty():
        await asyncio.sleep(0.05)
    print(f"birinchi gap ovozi: {first:.2f} s | uchala gap: {len(b.outbuf) / 96000:.1f} s ovoz | model: {b.speaker.model}")
    # Gap bo'lindi: navbatdagi gaplar tashlanadi
    b.outbuf.clear()
    b.feed("Bu gap aytilmasligi kerak. Bu ham. ")
    b.hush()
    await asyncio.sleep(1.5)
    print("gap bo'linganda tashlandi:", not b.outbuf and b.tts_q.empty(), "| gapiryapti:", b.speaking())
    worker.cancel()

asyncio.run(main())
