"""Bluetooth liniya: telefon kompyuterga Bluetooth «garnitura» (Hands-Free) bo'lib ulangan — qo'ng'iroq ovozi Windows'da
alohida ovoz qurilmasi bo'lib keladi. Shu dastur o'sha qurilmani AI qabulxonaga (sip_live.py, 9092-port, AudioSocket) ulaydi:
xuddi Asterisk'dan kelgan qo'ng'iroqdek. Ovoz telefon karnayi→mikrofon orqali emas, raqamli keladi — shuning uchun
Android ilovadagi muammo (mijoz AI'ni eshitmasdi: telefon aks-sado bostirgichi karnay ovozini o'chirardi) bu yerda yo'q.

Sinov (hozircha qo'lda): telefonni «Связь с телефоном» orqali kompyuterga ulang → telefonga qo'ng'iroq qiling → kompyuterda
ko'taring → shu dasturni ishga tushiring. sip_live.py ishlab turishi kerak (Palantir nazoratchisi uni o'zi yoqadi).
  python bt_line.py --list            ovoz qurilmalari; Bluetooth telefonnikilari belgilanadi
  python bt_line.py                   topilgan Hands-Free qurilmani AI qabulxonaga ulaydi (mijoz rejimi)
  python bt_line.py --egasi           o'zingiz sinash uchun: egasining yordamchisi rejimi
  python bt_line.py --qurilma "Galaxy" --raqam 998901234567
Qurilma nomini .env dagi BT_DEVICE bilan ham berish mumkin."""
import argparse
import asyncio
import secrets
import struct
import sys
import threading

import sounddevice as sd

from common import env

RATE = 8000                          # sip_live bilan bir xil: 8 kHz, mono, 16-bit
FRAME_MS = 20
FRAME_SAMPLES = RATE * FRAME_MS // 1000
FRAME_BYTES = FRAME_SAMPLES * 2
MAX_LAG_BYTES = RATE * 2 * 2         # AI ovozi 2 s dan ko'p yig'ilib qolsa — eskisi tashlanadi (kechikish o'smasin)
HANGUP, CALL_ID, AUDIO, ERROR = 0x00, 0x01, 0x10, 0xFF
OWNER, CUSTOMER = '1', '2'
# Windows telefon uchun yaratadigan qurilma nomlari (til va drayverga qarab har xil)
HANDS_FREE = ('hands-free', 'handsfree', 'ag audio', 'hfp')


def optional(name: str) -> str:
    """common.env yo'q kalitda chiqib ketadi — bu yerda bo'sh qator yetarli"""
    try:
        return env(name)
    except SystemExit:
        return ''


def frame(kind: int, data: bytes = b'') -> bytes:
    return struct.pack('>BH', kind, len(data)) + data


def call_id(mode: str, number: str) -> bytes:
    """sip_live.parse_call_id kutgan ko'rinish: tur, raqam uzunligi (2 raqam), raqam (13 ta, oldi nol), qolgani — tasodifiy id"""
    digits = ''.join(c for c in number if c.isdigit())[-13:]
    head = f'{mode}{len(digits):02d}{digits.zfill(13)}'
    return bytes.fromhex(head + secrets.token_hex(8))


def mme() -> int:
    """MME — Windows'ning eski ovoz yo'li: istalgan chastotani (8 kHz) o'zi moslaydi; boshqa tizimda — standart"""
    return next((i for i, api in enumerate(sd.query_hostapis()) if api['name'] == 'MME'), sd.default.hostapi)


def is_phone(name: str, wanted: str) -> bool:
    low = name.lower()
    return wanted.lower() in low if wanted else any(w in low for w in HANDS_FREE)


def phone_devices(wanted: str) -> list[dict]:
    """MME qurilmalari ichidan telefonnikilar. MME nomni 31 belgida kesadi («Headset (Galaxy A52 Hands-Fr…») — shuning uchun
    to'liq nom boshqa yo'llardan (WASAPI) olinib, kesilgan nom uning boshi bo'lsa ham telefonniki sanaladi"""
    devices = sd.query_devices()
    full = [d['name'] for d in devices if is_phone(d['name'], wanted)]
    api = mme()
    return [d for d in devices if d['hostapi'] == api and any(f.startswith(d['name']) for f in full)]


def find(kind: str, wanted: str) -> int | None:
    channels = 'max_input_channels' if kind == 'in' else 'max_output_channels'
    return next((d['index'] for d in phone_devices(wanted) if d[channels] > 0), None)


def list_devices(wanted: str):
    api = mme()
    phones = {d['index'] for d in phone_devices(wanted)}
    for d in sd.query_devices():
        if d['hostapi'] != api:
            continue
        way = ('kirish' if d['max_input_channels'] else '') + (' chiqish' if d['max_output_channels'] else '')
        print(f"{'>>' if d['index'] in phones else '  '} {d['index']:3} {d['name']} ({way.strip()})")
    print(">> — telefon qurilmasi. Hech biri belgilanmagan bo'lsa: telefon ulanmagan yoki nomi boshqacha (--qurilma)")


class Line:
    """Bitta qo'ng'iroq: Bluetooth qurilma ↔ sip_live (AudioSocket)"""

    def __init__(self, loop: asyncio.AbstractEventLoop):
        self.loop = loop
        self.inbox: asyncio.Queue[bytes] = asyncio.Queue()
        self.out = bytearray()
        self.lock = threading.Lock()
        self.done = asyncio.Event()

    def heard(self, data, frames, time, status):
        """Telefon → kompyuter (ovoz qurilmasining o'z oqimida chaqiriladi)"""
        self.loop.call_soon_threadsafe(self.inbox.put_nowait, bytes(data))

    def speak(self, data, frames, time, status):
        """AI → telefon: navbatdagi bo'lak, bo'lmasa — jimlik (oqim uzilmasin)"""
        need = len(data)
        with self.lock:
            chunk = bytes(self.out[:need])
            del self.out[:need]
        data[:] = chunk.ljust(need, b'\0')

    def queue_voice(self, pcm: bytes):
        with self.lock:
            self.out += pcm
            if len(self.out) > MAX_LAG_BYTES:
                del self.out[: len(self.out) - MAX_LAG_BYTES]

    async def send(self, writer: asyncio.StreamWriter):
        while not self.done.is_set():
            pcm = await self.inbox.get()
            writer.write(frame(AUDIO, pcm))
            await writer.drain()

    async def receive(self, reader: asyncio.StreamReader):
        try:
            while True:
                kind, size = struct.unpack('>BH', await reader.readexactly(3))
                data = await reader.readexactly(size) if size else b''
                if kind == AUDIO:
                    self.queue_voice(data)
                elif kind in (HANGUP, ERROR):
                    print("AI qo'ng'iroqni tugatdi" if kind == HANGUP else f'AI qabulxona xatosi: {data.hex()}')
                    return
        except (asyncio.IncompleteReadError, ConnectionError):
            print('AI qabulxona bilan aloqa uzildi')
        finally:
            self.done.set()


async def bridge(mic: int, speaker: int, mode: str, number: str, port: int):
    try:
        reader, writer = await asyncio.open_connection('127.0.0.1', port)
    except OSError:
        sys.exit(f"AI qabulxona (sip_live.py, port {port}) ishlamayapti — avval Palantir'ni yoqing")
    writer.write(frame(CALL_ID, call_id(mode, number)))
    line = Line(asyncio.get_running_loop())
    opts = dict(samplerate=RATE, channels=1, dtype='int16', blocksize=FRAME_SAMPLES)
    with sd.RawInputStream(device=mic, callback=line.heard, **opts), sd.RawOutputStream(device=speaker, callback=line.speak, **opts):
        print(f"ulandi: {sd.query_devices(mic)['name']} ↔ AI ({'egasi' if mode == OWNER else 'mijoz'}). To'xtatish — Ctrl+C")
        sending = asyncio.create_task(line.send(writer))
        try:
            await line.receive(reader)
        finally:
            sending.cancel()
            try:
                writer.write(frame(HANGUP))
                await writer.drain()
            except (ConnectionError, RuntimeError):
                pass
            writer.close()


def main():
    sys.stdout.reconfigure(encoding='utf-8')
    p = argparse.ArgumentParser(description='Bluetooth telefon ↔ AI qabulxona')
    p.add_argument('--list', action='store_true', help="ovoz qurilmalarini ko'rsatish")
    p.add_argument('--qurilma', default=optional('BT_DEVICE'), help="qurilma nomidan bir bo'lak")
    p.add_argument('--egasi', action='store_true', help='egasining yordamchisi rejimi (o\'zingiz sinash uchun)')
    p.add_argument('--raqam', default='', help="qo'ng'iroq qilgan raqam (bilinsa)")
    a = p.parse_args()
    if a.list:
        return list_devices(a.qurilma)
    mic, speaker = find('in', a.qurilma), find('out', a.qurilma)
    if mic is None or speaker is None:
        list_devices(a.qurilma)
        sys.exit("Telefonning Bluetooth ovoz qurilmasi topilmadi (kirish va chiqish ikkalasi kerak)")
    port = int(optional('SIP_BRIDGE_PORT') or '9092')
    try:
        asyncio.run(bridge(mic, speaker, OWNER if a.egasi else CUSTOMER, a.raqam, port))
    except KeyboardInterrupt:
        print("to'xtatildi")


if __name__ == '__main__':
    main()
