"""Ovoz yuboruvchi (player) va mikrofon ochilishi tekshiruvi — qo'ng'iroqsiz, soxta Telegram bilan.
AI ovozi (bo'lakka karrali bo'lmagan uzunlikda) to'liq yuboriladi, bufer bo'shaydi va salomdan keyin mikrofon ochiladi."""
import asyncio
import sys
from pathlib import Path

sys.stdout.reconfigure(encoding='utf-8')
sys.argv = ['call_live.py', 'tekshiruv']
src = open(Path(__file__).resolve().parent / 'call_live.py', encoding='utf-8').read().split('MISSED = 2')[0]
exec(compile(src, 'call_live.py', 'exec'))


class FakeCalls:
    def __init__(self):
        self.sent = 0

    async def send_frame(self, peer, device, data):
        assert len(data) == FRAME_BYTES, len(data)
        self.sent += 1


async def main():
    calls = FakeCalls()
    b = Bridge(calls, 1)
    b.outbuf += b'\1' * (FRAME_BYTES * 5 + 123)  # 5 to'liq bo'lak + 123 bayt qoldiq
    player = asyncio.create_task(b.player())
    opener = asyncio.create_task(b._open_mic())
    await asyncio.wait_for(b.greeted.wait(), 2)
    print('bufer bo\'shadi:', len(b.outbuf) == 0, '| mikrofon ochildi:', b.greeted.is_set(), '| yuborilgan bo\'laklar ≥ 6:', calls.sent >= 6)
    b.done.set()
    player.cancel()
    opener.cancel()

asyncio.run(main())
