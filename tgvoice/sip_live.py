"""Telefon liniyasi ↔ Gemini Live: Asterisk (WSL'da) qo'ng'iroqni AudioSocket orqali shu dasturga uzatadi.
Har qo'ng'iroq — o'z Gemini Live suhbati: bir vaqtda bir nechta qo'ng'iroq (SIP_MAX_CALLS gacha) ko'tariladi.

Kim qo'ng'iroq qilganini Asterisk aytadi (sozlamasi: asterisk/extensions.conf):
  egasi  — egasining SIP ilovasi (parol bilan): vazifalar, Palantir — xuddi Telegram qo'ng'irog'idagidek
  mijoz  — shahar raqamiga (Uztelecom) kelgan qo'ng'iroq: AI qabulxona (reception.py) — bilim, qabulga yozish, so'rov;
           faqat ovozli agent kaliti bilan, egasining vazifalari, boshqa mijozlar va ichki ma'lumot mijozga berilmaydi.
           Ish vaqtida (Sozlamalar → Telefon liniyasi, «kerak bo'lsa o'tkazadi» rejimi) AI qo'ng'iroqni administratorga o'tkaza oladi:
           Asterisk'ga «channel redirect» — [operator]; administrator ko'tarmasa, qo'ng'iroq AI'ga qaytadi (3-rejim)
Ishga tushirish:  tgvoice\\.venv\\Scripts\\python.exe tgvoice\\sip_live.py"""
import array
import asyncio
import os
import struct
import subprocess
import sys
import time
from datetime import datetime

import httpx
from google.genai import types
from websockets.asyncio.server import serve

# --stend: AI qabulxonani stend bilan sinash (npm run stend — soxta DentaCRM, haqiqiy ma'lumotga tegilmaydi). Import'dan oldin:
# Palantir manzili call_live yuklanayotganda o'qiladi
if '--stend' in sys.argv:
    from pathlib import Path
    os.environ['PALANTIR_URL'] = 'http://127.0.0.1:3220'
    os.environ['VOICE_AGENT_KEY'] = (Path(__file__).resolve().parent.parent / '.stend-data' / 'ovozli-agent-kaliti.txt').read_text().strip()

from call_live import PALANTIR, LIVE_VOICE, UZ_TZ, Bridge, down_48_to_16, log, up_24_to_48
from common import env
from reception import Desk
from web_live import WEB_PORT, WebVoice

LINE_RATE = 8000                                   # Asterisk AudioSocket: 8 kHz, mono, 16-bit
FRAME_MS = 20
FRAME_BYTES = LINE_RATE * FRAME_MS // 1000 * 2     # 320 bayt
UPLINK_BYTES = FRAME_BYTES * 2                     # Live'ga 40 ms bo'laklarda (Telegram'dagidek)
HOST = '127.0.0.1'                                 # faqat shu kompyuter ichidan (WSL — mirrored tarmoq)
PORT = int(env('SIP_BRIDGE_PORT', '9092'))
MAX_CALLS = int(env('SIP_MAX_CALLS', '4'))         # ortig'i ko'tarilmaydi (Gemini va kompyuter kuchiga qarab)
# Mijozlar hamma joyni egallab, egasini o'z yordamchisidan qoldirmasin: bitta joy egasiga
CUSTOMER_SLOTS = max(1, MAX_CALLS - 1)
CUSTOMER_LIMIT_S = 240                             # mijoz qo'ng'irog'i
OWNER_LIMIT_S = 900                                # egasining qo'ng'irog'i (Telegram'dagisi — call_live.CALL_LIMIT_S)
# Aks-sado: AI gapirayotganda (va undan keyin ECHO_TAIL_S) liniyadan kelgan shundan past ovoz Live'ga yuborilmaydi — telefon
# karnayidan qaytgan AI ovozi «gap» bo'lib (turkcha, hindcha bo'laklar) suhbatni buzmasin. Baland gap (odam AI'ni bo'lsa) o'tadi
ECHO_GATE = int(env('SIP_ECHO_GATE', '1500'))      # 16-bit namuna RMS (0..32767)
ECHO_TAIL_S = 0.4
def _wsl_distro() -> str:
    """Asterisk turgan WSL distributivi: SIP_WSL_DISTRO yoki «Palantir»; dastur avval Cerebro deb atalgan — o'sha nomlisi bo'lsa, o'sha
    (server/voice/line.ts bilan bir xil). Noto'g'ri nom bilan WSL yoqiq tutilmaydi va Asterisk har necha soniyada o'chib qoladi"""
    chosen = env('SIP_WSL_DISTRO', '-')
    if chosen != '-':
        return chosen
    if os.name != 'nt':
        return 'Palantir'
    try:
        out = subprocess.run(['wsl.exe', '-l', '-q'], capture_output=True, timeout=30).stdout
        have = {s.strip() for s in out.decode('utf-16-le', errors='ignore').replace('\0', '').splitlines()}
    except (OSError, subprocess.SubprocessError):
        return 'Palantir'
    return 'Cerebro' if 'Palantir' not in have and 'Cerebro' in have else 'Palantir'  # eski nom


DISTRO = _wsl_distro()
TOKEN_TTL_S = 6 * 3600

# AudioSocket xabarlari: 1 bayt tur, 2 bayt uzunlik (big-endian), keyin ma'lumot
HANGUP, CALL_ID, DTMF, AUDIO, ERROR = 0x00, 0x01, 0x03, 0x10, 0xFF
OWNER, CUSTOMER, MISSED = '1', '2', '3'          # MISSED — mijoz, AI o'tkazdi, administrator ko'tarmadi (AI'ga qaytdi)
CUSTOMERS = (CUSTOMER, MISSED)
HANDOFF_SPEECH_S = 10                              # «Hozir ulayman» gapi tugashini shuncha kutib, keyin o'tkaziladi

def parse_call_id(raw: bytes) -> tuple[str, str]:
    """Asterisk yuborgan id (extensions.conf): 1-raqam — kim (1 egasi, 2 mijoz), keyingi 2 tasi — telefon raqami uzunligi,
    keyingi 13 tasi — raqamning o'zi (oldi nol bilan to'ldirilgan; uzunlik bor — raqamdagi o'z nollari yo'qolmaydi)"""
    digits = raw.hex()
    length = int(digits[1:3]) if digits[1:3].isdigit() else 0
    return digits[0], digits[3:16][13 - min(length, 13):] if length else ''


def call_uuid(raw: bytes) -> str:
    """AudioSocket id'si Asterisk'dagi ko'rinishda (8-4-4-4-12) — kanalni shu bilan topamiz"""
    h = raw.hex()
    return f'{h[:8]}-{h[8:12]}-{h[12:16]}-{h[16:20]}-{h[20:32]}'


async def asterisk(command: str) -> str:
    """Asterisk buyrug'i (WSL ichida; Linux'da — to'g'ridan-to'g'ri). Fonda: oyna ochilmaydi"""
    argv = ['wsl.exe', '-d', DISTRO, '--', 'asterisk', '-rx', command] if os.name == 'nt' else ['asterisk', '-rx', command]
    proc = await asyncio.create_subprocess_exec(*argv, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    out, _ = await asyncio.wait_for(proc.communicate(), 10)
    return out.decode('utf-8', 'replace')


async def redirect_to_operator(uuid: str, ring: int) -> str | None:
    """Qo'ng'iroqni administratorga buradi ([operator], ring soniya). Xato bo'lsa — sababi, bo'lmasa None.
    Kanal AudioSocket id'si bo'yicha topiladi (Asterisk 20 da AI ulanishni yopsa qo'ng'iroq butunlay uziladi — shuning uchun redirect)"""
    channels = await asterisk('core show channels concise')
    chan = next((line.split('!')[0] for line in channels.splitlines() if uuid in line and 'AudioSocket' in line), None)
    if not chan:
        return 'kanal topilmadi'
    out = await asterisk(f'channel redirect {chan} operator,{max(5, min(int(ring), 60))},1')
    return None if 'redirected' in out.lower() else out.strip()[:160]


def rms(pcm: bytes) -> int:
    a = array.array('h', pcm[: len(pcm) - len(pcm) % 2])
    return int((sum(x * x for x in a) / len(a)) ** 0.5) if a else 0


def frame(kind: int, data: bytes = b'') -> bytes:
    return struct.pack('>BH', kind, len(data)) + data


class Token:
    """Palantir kaliti — bir marta olinadi va hamma qo'ng'iroqqa ishlatiladi (har qo'ng'iroqda login qilinmaydi)"""
    def __init__(self):
        self.value, self.at = '', 0.0
        self.lock = asyncio.Lock()

    async def get(self) -> str:
        async with self.lock:
            if not self.value or time.monotonic() - self.at > TOKEN_TTL_S:
                async with httpx.AsyncClient(base_url=PALANTIR, timeout=10) as http:
                    r = await http.post('/api/login', json={'login': env('PALANTIR_LOGIN'), 'password': env('PALANTIR_PASSWORD')})
                    r.raise_for_status()
                    self.value, self.at = r.json()['token'], time.monotonic()
            return self.value


class PhoneBridge(Bridge):
    """Bitta telefon qo'ng'irog'i: AudioSocket (8 kHz, 20 ms) ↔ Gemini Live"""
    channel = 'telefon'
    out_rate = LINE_RATE
    start_sensitivity = types.StartSensitivity.START_SENSITIVITY_LOW   # karnay sadosi va shovqin gap deb olinmasin

    def __init__(self, writer: asyncio.StreamWriter, mode: str, caller: str, token: str, number: int, uuid: str = ''):
        super().__init__(None, 0)
        self.writer, self.mode, self.caller, self.uuid = writer, mode, caller, uuid
        # Mijoz qo'ng'irog'i — AI qabulxona (faqat ovozli agent kaliti bilan); egasiniki — Palantir kaliti bilan.
        # Administrator ko'tarmay AI'ga qaytgan qo'ng'iroqda yana o'tkazilmaydi (aylanib qolmasin)
        self.desk = Desk(caller, missed=mode == MISSED, can_transfer=mode == CUSTOMER) if mode in CUSTOMERS else None
        self.live = None                        # Gemini Live seansi (o'tkazib bo'lmasa AI'ga aytish uchun)
        self.voice_at = 0.0                     # AI ovozi liniyaga oxirgi marta ketgan payt
        self.echo = {'cut': 0, 'cut_max': 0, 'pass': 0, 'pass_max': 0}   # aks-sado filtri hisobi (jurnalga, sozlash uchun)
        self.call_limit_s = CUSTOMER_LIMIT_S if mode in CUSTOMERS else OWNER_LIMIT_S
        self.palantir.http.headers['Authorization'] = f'Bearer {token}'
        self.who = caller or 'raqami yashirin'
        # Jurnalda qaysi qo'ng'iroq: tartib raqami va telefonning oxirgi 4 raqami
        self.tag = f"[#{number} {'egasi' if mode == OWNER else 'mijoz'} {caller[-4:] or 'yashirin'}] "
        # Asterisk qo'ng'iroqni ko'tarib bo'lib ulanadi: ovoz kelishini kutish shart emas (jim turgan odam ham salom eshitsin)
        self.connected.set()

    async def login(self):
        """Kalit allaqachon bor (Token)"""

    def from_live(self, pcm24: bytes) -> bytes:
        return down_48_to_16(pcm24)   # 24 → 8 kHz: o'sha 3:1

    async def uplink(self, s):
        """Liniya → Live: 8 kHz dan 16 kHz ga, 40 ms dan. Salomlashuv tugaguncha yuborilmaydi (Telegram'dagidek).
        Liniyada ovoz kelmay qolsa (ba'zi SIP ilovalar jimlikda hech narsa yubormaydi) — jimlik yuboriladi:
        Live gap tugaganini jimlikdan biladi, aks holda javob bermay kutib qoladi"""
        buf = bytearray()
        silence = b'\0' * FRAME_BYTES
        while not self.done.is_set():
            try:
                pcm = await asyncio.wait_for(self.inbox.get(), FRAME_MS * 3 / 1000)
            except asyncio.TimeoutError:
                pcm = silence * 3
            if not self.greeted.is_set():
                continue
            buf += self.echo_gate(pcm)
            if len(buf) >= UPLINK_BYTES:
                await s.send_realtime_input(audio=types.Blob(data=up_24_to_48(bytes(buf)), mime_type='audio/pcm;rate=16000'))
                buf.clear()

    def echo_gate(self, pcm: bytes) -> bytes:
        """AI gapirayotgan paytda kelgan past ovoz — aks-sado: jimlik bilan almashtiriladi"""
        if time.monotonic() - self.voice_at > ECHO_TAIL_S:
            return pcm
        level = rms(pcm)
        kind = 'cut' if level < ECHO_GATE else 'pass'
        self.echo[kind] += 1
        self.echo[f'{kind}_max'] = max(self.echo[f'{kind}_max'], level)
        return bytes(len(pcm)) if kind == 'cut' else pcm

    async def player(self):
        """Live → liniya: har 20 ms da bitta bo'lak (bufer bo'sh bo'lsa — jimlik, ovoz oqimi uzilmasin)"""
        start, i = time.monotonic(), 0
        silence = b'\0' * FRAME_BYTES
        while not self.done.is_set():
            if self.outbuf:
                chunk = bytes(self.outbuf[:FRAME_BYTES]).ljust(FRAME_BYTES, b'\0')
                del self.outbuf[:FRAME_BYTES]
                self.voice_at = time.monotonic()
            else:
                chunk = silence
            self.writer.write(frame(AUDIO, chunk))
            await self.writer.drain()
            i += 1
            delay = start + i * FRAME_MS / 1000 - time.monotonic()
            if delay > 0:
                await asyncio.sleep(delay)
            elif delay < -0.2:
                start, i = time.monotonic(), 0

    async def prompt(self) -> tuple[str, str, str, list]:
        if not self.desk:
            return await super().prompt()
        system, tools = await self.desk.prompt()
        return system, LIVE_VOICE, "(qo'ng'iroq ulandi)", tools

    async def tools(self, s, call):
        self.live = s
        await super().tools(s, call)

    async def run_tool(self, name: str, args: dict) -> dict:
        if not self.desk:
            return await super().run_tool(name, args)
        result = await self.desk.tool(name, args)
        if name == 'transfer_to_operator' and result.get('ring'):
            asyncio.ensure_future(self.hand_over(int(result['ring'])))
        return result

    async def hand_over(self, ring: int):
        """AI «hozir ulayman» degach — gapi tugashini kutib, qo'ng'iroqni administratorga buradi. Asterisk AI ulanishini o'zi yopadi.
        Bo'lmasa — AI'ga aytiladi: uzr so'rab, so'rov qoldiradi"""
        await asyncio.sleep(1.0)   # tool javobidan keyin AI gapira boshlasin
        end = time.monotonic() + HANDOFF_SPEECH_S
        while self.speaking() and not self.done.is_set() and time.monotonic() < end:
            await asyncio.sleep(0.1)
        if self.done.is_set():
            return
        try:
            problem = await redirect_to_operator(self.uuid, ring) if self.uuid else "qo'ng'iroq id'si yo'q"
        except (OSError, asyncio.TimeoutError) as e:
            problem = f'{type(e).__name__}: {str(e)[:120]}'
        if problem is None:
            self.log('—', f"administratorga o'tkazildi ({ring} s jiringlaydi)")
            self.desk.handed_over = True
            return
        self.log('—', f"administratorga o'tkazib bo'lmadi: {problem}")
        self.desk.transferred = ''
        if self.live:
            try:
                await self.live.send_client_content(turns=types.Content(role='user', parts=[types.Part(
                    text="(Administratorga ulab bo'lmadi. Mijozdan uzr so'ra, savolini va raqamini aniqlab leave_request qil.)")]), turn_complete=True)
            except Exception as e:
                self.log('—', f"AI'ga aytib bo'lmadi: {type(e).__name__}")

    def action_text(self, name: str, args: dict, result: dict) -> str | None:
        return self.desk.action_text(name, args, result) if self.desk else super().action_text(name, args, result)

    async def archive(self):
        """Mijoz qo'ng'irog'i — Palantir'ga hisobot (panel va egasining Telegram'i); egasiniki — Obsidian'ga"""
        if not self.desk:
            return await super().archive()
        if not self.started:
            return
        try:
            await self.desk.report(self.started, round((datetime.now(UZ_TZ) - self.started).total_seconds()), self.lines)
            self.log('—', f"hisobot yuborildi: {self.desk.outcome()}")
        except Exception as e:
            self.log('—', f"hisobot yuborilmadi: {type(e).__name__}: {str(e)[:160]}")

    async def close(self):
        await super().close()
        if self.desk:
            await self.desk.gateway.close()

    async def ended(self):
        """Go'shak darhol qo'yiladi (Obsidian'ga yozish kutilmaydi): mijoz jimlikda qolmasin, joy bo'shasin"""
        e = self.echo
        self.log('—', f"aks-sado filtri: AI gapirganda {e['cut']} bo'lak o'chirildi (eng balandi {e['cut_max']}), "
                      f"{e['pass']} bo'lak o'tdi (eng balandi {e['pass_max']}); chegara {ECHO_GATE}")
        try:
            self.writer.write(frame(HANGUP))
            await self.writer.drain()
        except (ConnectionError, RuntimeError):
            pass


async def read_line(reader: asyncio.StreamReader, bridge: PhoneBridge):
    """Asterisk → ovoz; go'shak qo'yilsa (HANGUP yoki ulanish uzilsa) qo'ng'iroq yopiladi"""
    try:
        while not bridge.done.is_set():
            kind, size = struct.unpack('>BH', await reader.readexactly(3))
            data = await reader.readexactly(size) if size else b''
            if kind == AUDIO:
                bridge.on_audio(data)
            elif kind == HANGUP:
                bridge.log('—', "go'shak qo'yildi")
                break
            elif kind == ERROR:
                bridge.log('—', f"Asterisk xatosi: {data.hex()}")
                break
    except (asyncio.IncompleteReadError, ConnectionError):
        bridge.log('—', 'liniya uzildi')
    finally:
        bridge.done.set()


class Server:
    def __init__(self):
        self.active = 0
        self.customers = 0
        self.count = 0
        self.token = Token()

    @property
    def reception(self) -> bool:
        """AI qabulxona ovozli agent kaliti bilan ishlaydi: .env yoki ovoz.env (klinika kompyuterida Palantir o'zi yaratadi) — har qo'ng'iroqda tekshiriladi"""
        return bool(os.environ.get('VOICE_AGENT_KEY') or _env_has('VOICE_AGENT_KEY'))

    async def handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter):
        try:
            kind, size = struct.unpack('>BH', await asyncio.wait_for(reader.readexactly(3), 5))
            raw = await reader.readexactly(size)
        except (asyncio.TimeoutError, asyncio.IncompleteReadError, ConnectionError):
            writer.close()
            return
        if kind != CALL_ID or size != 16:
            writer.close()
            return
        mode, caller = parse_call_id(raw)
        if mode not in (OWNER, *CUSTOMERS):
            writer.close()
            return
        if mode in CUSTOMERS and not self.reception:
            log('—', f"mijoz qo'ng'irog'i ({caller or 'yashirin raqam'}) ko'tarilmadi: .env da VOICE_AGENT_KEY yo'q")
            writer.write(frame(HANGUP))
            writer.close()
            return
        # Administrator ko'tarmay AI'ga qaytgan mijoz (MISSED) band deb qaytarilmaydi: u allaqachon navbatda edi
        busy = self.active >= MAX_CALLS or (mode == CUSTOMER and self.customers >= CUSTOMER_SLOTS)
        if busy:
            log('—', f"band: {self.active} ta qo'ng'iroq ketyapti, {caller or 'yashirin raqam'} ko'tarilmadi")
            writer.write(frame(HANGUP))
            writer.close()
            return
        self.active += 1
        self.customers += mode in CUSTOMERS
        self.count += 1
        bridge: PhoneBridge | None = None
        reading: asyncio.Task | None = None
        try:
            bridge = PhoneBridge(writer, mode, caller, await self.token.get() if mode == OWNER else '', self.count, call_uuid(raw))
            reading = asyncio.create_task(read_line(reader, bridge))
            bridge.log('—', f"qo'ng'iroq ({self.active}/{MAX_CALLS})")
            await bridge.run()
        except asyncio.TimeoutError:
            if bridge:
                bridge.log('—', 'ulandi, lekin ovoz kelmadi')
        except Exception as e:
            log('—', f"qo'ng'iroq xatosi: {type(e).__name__}: {str(e)[:200]}")
        finally:
            self.active -= 1
            self.customers -= mode in CUSTOMERS
            if bridge:
                bridge.done.set()
            if reading:
                reading.cancel()
            try:
                writer.write(frame(HANGUP))
                await writer.drain()
            except (ConnectionError, RuntimeError):
                pass
            writer.close()


def _env_has(name: str) -> bool:
    try:
        return bool(env(name))
    except SystemExit:
        return False


def keep_wsl_alive() -> subprocess.Popen | None:
    """WSL hech kim ishlatmasa o'zi o'chadi (Asterisk ham) — shu dastur ishlab turguncha yoqiq tursin"""
    try:
        return subprocess.Popen(['wsl.exe', '-d', DISTRO, '--', 'sleep', 'infinity'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))   # fonda ishlaganda oyna ochilmasin
    except FileNotFoundError:
        log('—', "WSL topilmadi — Asterisk boshqa joyda bo'lsa, shunchaki ulanishni kutaman")
        return None


async def main():
    sys.stdout.reconfigure(encoding='utf-8')
    wsl = keep_wsl_alive() if os.name == 'nt' else None
    server = Server()
    srv = await asyncio.start_server(server.handle, HOST, PORT)
    log('—', f"telefon liniyasi tayyor: {HOST}:{PORT}, bir vaqtda {MAX_CALLS} tagacha qo'ng'iroq; "
             f"AI qabulxona: {'yoqiq' if server.reception else 'o‘chiq (VOICE_AGENT_KEY yo‘q)'}")
    # Panel ovozi (AI bosh ekran): egasi brauzerda Palantir bilan jonli gaplashadi
    web = await serve(WebVoice().handle, HOST, WEB_PORT, max_size=1 << 20)
    log('—', f"panel ovozi tayyor: ws://{HOST}:{WEB_PORT}")
    try:
        async with srv:
            await srv.serve_forever()
    finally:
        web.close()
        if wsl:
            wsl.terminate()


if __name__ == '__main__':
    asyncio.run(main())
