"""Administratorga o'tkazish tekshiruvi — Gemini'siz, haqiqiy Asterisk'da: «mijoz» qo'ng'iroq qiladi (sinov_otkazish), AI o'rnida
soxta AI (9096) qo'ng'iroqni sip_live.redirect_to_operator bilan administratorga buradi. Administrator telefoni ulanmagan bo'lsa,
Asterisk qo'ng'iroqni AI'ga 3-rejimda («administrator ko'tarmadi») qaytarishi kerak.
Telefon liniyasi o'rnatilgan bo'lishi kerak (install.sh); sip_live.py ishlashi shart emas, Palantir serveri — kerak (kim javob beradi).
Ishga tushirish:  tgvoice\\.venv\\Scripts\\python.exe tgvoice\\check_transfer.py"""
import asyncio
import struct
import subprocess
import sys

from common import env
from sip_live import AUDIO, CUSTOMER, HANGUP, MISSED, asterisk, call_uuid, parse_call_id, redirect_to_operator

sys.stdout.reconfigure(encoding='utf-8')
DISTRO = env('SIP_WSL_DISTRO', 'Cerebro')
PORT = 9096          # extensions.conf, [sinov_otkazish] — AI_SOCKET
CALLER = '998901112233'
RING = 5             # administrator shuncha soniya jiringlaydi
FRAME = 320          # 20 ms, 8 kHz


def wsl(cmd: str) -> str:
    return subprocess.run(['wsl.exe', '-d', DISTRO, '-u', 'root', '--', 'bash', '-lc', cmd], capture_output=True, text=True, encoding='utf-8').stdout


async def main() -> int:
    seen: list[tuple[str, str]] = []
    result: dict = {}
    back = asyncio.Event()

    async def handle(reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        kind, size = struct.unpack('>BH', await reader.readexactly(3))
        mode, caller = parse_call_id(raw := await reader.readexactly(size))
        seen.append((mode, caller))
        print(f"  soxta AI: ulanish — rejim {mode}, raqam {caller or 'yashirin'}")

        async def silence():   # Asterisk ovoz oqimini kutadi
            while True:
                writer.write(struct.pack('>BH', AUDIO, FRAME) + bytes(FRAME))
                await writer.drain()
                await asyncio.sleep(0.02)
        talking = asyncio.create_task(silence())
        try:
            if mode == CUSTOMER:
                await asyncio.sleep(1)
                result['redirect'] = await redirect_to_operator(call_uuid(raw), RING)
                try:   # o'tkazilgach Asterisk shu ulanishni o'zi yopadi
                    await asyncio.wait_for(reader.read(), 5)
                    result['closed'] = True
                except asyncio.TimeoutError:
                    result['closed'] = False
            elif mode == MISSED:
                await asyncio.sleep(1)
                writer.write(struct.pack('>BH', HANGUP, 0))
                await writer.drain()
                back.set()
        except (ConnectionError, asyncio.IncompleteReadError):
            result.setdefault('closed', True)
        finally:
            talking.cancel()
            writer.close()

    srv = await asyncio.start_server(handle, '127.0.0.1', PORT)
    print(f"«Mijoz» {CALLER} qo'ng'iroq qilyapti (administrator {RING} s jiringlaydi)…")
    await asterisk(f'channel originate Local/{CALLER}@sinov_otkazish application Wait 40')
    try:
        await asyncio.wait_for(back.wait(), RING + 25)
    except asyncio.TimeoutError:
        pass
    srv.close()
    # Eski o'rnatilgan extensions.conf jurnalga «Cerebro:» deb yozadi (install.sh qayta yurgunicha)
    log = wsl(f"grep -hE '(Palantir|Cerebro): ({CALLER}|administrator)' /var/log/asterisk/messages* 2>/dev/null | tail -4")
    status = next((line.rsplit('— ', 1)[-1].strip() for line in reversed(log.splitlines()) if 'administrator —' in line), '?')

    checks = [
        ("AI'ga mijoz rejimida ulandi, raqami bilan", bool(seen) and seen[0] == (CUSTOMER, CALLER)),
        ("Asterisk qo'ng'iroqni administratorga burdi", 'redirect' in result and result['redirect'] is None),
        ("o'tkazilgach AI ulanishi yopildi", result.get('closed') is True),
        (f"administrator ko'tarmadi ({status}) — qo'ng'iroq AI'ga qaytdi, 3-rejim", len(seen) > 1 and seen[1] == (MISSED, CALLER)),
    ]
    for name, ok in checks:
        print(f"  {'✓' if ok else '✗'} {name}")
    if result.get('redirect'):
        print(f"  o'tkazish xatosi: {result['redirect']}")
    passed = sum(ok for _, ok in checks)
    print(f"{passed}/{len(checks)} o'tdi")
    return 0 if passed == len(checks) else 1


if __name__ == '__main__':
    sys.exit(asyncio.run(main()))
