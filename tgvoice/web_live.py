"""Panel ovozi: egasi panelda (AI bosh ekran) Palantir bilan jonli gaplashadi — brauzer ↔ Gemini Live, telefondagi bilan bir xil
yordamchi (vazifalar, Palantir, Obsidian, Telefon.md ovozi). sip_live.py ichida ishlaydi (nazoratchi yoqadi), port SIP_WEB_PORT.

Brauzer WebSocket orqali: birinchi xabar {"token": "<panel kaliti>", "mode": "owner" | "customer" | "wake"} — kalit Palantir'da tekshiriladi
(egasi bo'lmasa — yopiladi). customer — egasi qabulxonani sinaydi: AI unga mijozdek javob beradi (reception.py, sinov rejimi —
jadvalga yozilmaydi, so'rov ochilmaydi); wake — «quloq»: mikrofon shu kompyuterda tinglanadi (wake.py, internetsiz), «Palantir» yoki
«Jarvis» eshitilsa — {type: wake, word} va shu ulanishning o'zida egasi bilan suhbat boshlanadi (chaqiriqdan keyingi gap ham Live'ga boradi);
keyin mikrofon 16 kHz PCM (ikkilik xabarlar), javobda AI ovozi 24 kHz PCM va matn/amal xabarlari (JSON):
  partial  {who, text}        — gap aytilayotgan paytdagi matn
  line     {who, text}        — tugagan gap (who: Siz | Palantir | Amal)
  tool     {name, state, args, result} — asbob ishlayapti / natija (ekranda karta bo'lib chiqadi)
  interrupt                    — odam gapni bo'ldi: brauzer AI ovozini darhol to'xtatadi
Faqat shu kompyuterdan (127.0.0.1) va panel sahifasidan (Origin: localhost)."""
import asyncio
import json
import re
import time
from collections import deque

import httpx
from google.genai import types
from websockets.asyncio.server import ServerConnection

from call_live import CEREBRO, LIVE_VOICE, Bridge, log
from common import env
from reception import Desk
from wake import WakeSpotter, available as wake_available

WEB_PORT = int(env('SIP_WEB_PORT', '9093'))
IN_RATE, OUT_RATE = 16000, 24000
IN_CHUNK = IN_RATE * 40 // 1000 * 2          # Live'ga 40 ms bo'laklarda
MAX_SESSIONS = 2
MAX_LISTENERS = 2
# Chaqiriq topilgach Live'ga shu qadar oldingi ovoz ham beriladi: «Palantir, ertaga…» — buyruq qayta aytilmasin
WAKE_REPLAY_CHUNKS = 40
# Chaqiriqdan keyin odam odatda biroz to'xtab, keyin buyruqni aytadi — bu pauza gap tugadi deb olinmasin
WAKE_SILENCE_MS = 1300
# Chaqirilgan suhbat: shuncha jim tursa (na odam, na AI gapirmasa) yopiladi — xonadagi mikrofon Live'ga bekor ochiq qolmasin
WAKE_IDLE_S = 25
WAKE_LIMIT_S = 300
WAKE_NOTE = ("\n\nEgasi seni panelda ovoz bilan chaqirdi («Palantir» yoki «Jarvis» deb). Salomlashma: chaqiriqdan keyingi buyrug'ini eshit va "
             "darhol bajar. Faqat chaqirib, boshqa hech narsa demasa — qisqa «Ha, eshitaman» de. Ishi bitgach, egasi yana "
             "so'ramasa — qisqa «Xo'p» deb end_call. Mikrofon xonada ochiq — atrofdagilar ham eshitadi: tushum, qarz, bemorlarning "
             "ismi va telefoni kabi maxfiy ma'lumotni ovoz chiqarib aytma — «ekranga chiqardim» de (natija panelda karta bo'lib ko'rinadi).")
WEB_LIMIT_S = 900
ORIGIN = re.compile(r'^https?://(localhost|127\.0\.0\.1)(:\d+)?$')


class WebBridge(Bridge):
    """Bitta panel suhbati: brauzer mikrofoni ↔ Gemini Live; ovozni brauzer o'zi navbat bilan chaladi"""
    channel = 'panel'
    out_rate = OUT_RATE
    call_limit_s = WEB_LIMIT_S

    def __init__(self, ws: ServerConnection, token: str, who: str, customer: bool = False, wake: str | None = None):
        super().__init__(None, 0)
        self.ws = ws
        self.wake = wake
        # Chaqirilganda salomlashuv yo'q — odamning ovozi darhol Live'ga
        self.heard_at = time.monotonic()
        if wake:
            self.greeted.set()
            self.silence_ms = WAKE_SILENCE_MS
            self.call_limit_s = WAKE_LIMIT_S
        self.palantir.http.headers['Authorization'] = f'Bearer {token}'
        self.who = who
        self.desk = Desk('', test=True) if customer else None
        self.tag = '[panel sinov] ' if customer else '[panel] '
        self.connected.set()

    # Qabulxona sinovi: ko'rsatma va asboblar — mijoz liniyasidagi bilan bir (reception.py)
    async def prompt(self) -> tuple[str, str, str, list]:
        if not self.desk:
            system, voice, kickoff, tools = await super().prompt()
            return (system + WAKE_NOTE, voice, '', tools) if self.wake else (system, voice, kickoff, tools)
        system, tools = await self.desk.prompt()
        return system, LIVE_VOICE, "(qo'ng'iroq ulandi)", tools

    async def archive(self):
        if not self.desk:
            await super().archive()

    async def close(self):
        await super().close()
        if self.desk:
            await self.desk.gateway.close()

    def action_text(self, name: str, args: dict, result: dict) -> str | None:
        return self.desk.action_text(name, args, result) if self.desk else super().action_text(name, args, result)

    async def login(self):
        """Kalitni brauzer bergan, tekshirilgan"""

    def from_live(self, pcm24: bytes) -> bytes:
        return pcm24

    async def emit(self, msg: dict):
        try:
            await self.ws.send(json.dumps(msg, ensure_ascii=False))
        except Exception:
            self.done.set()

    def on_partial(self, who: str, text: str):
        self.heard_at = time.monotonic()
        asyncio.ensure_future(self.emit({'type': 'partial', 'who': who, 'text': text}))

    def note(self, who: str, text: str):
        super().note(who, text)
        asyncio.ensure_future(self.emit({'type': 'line', 'who': who, 'text': text}))

    def hush(self):
        super().hush()
        asyncio.ensure_future(self.emit({'type': 'interrupt'}))

    async def uplink(self, s):
        buf = bytearray()
        while not self.done.is_set():
            pcm = await self.inbox.get()
            if not self.greeted.is_set():
                continue
            buf += pcm
            if len(buf) >= IN_CHUNK:
                await s.send_realtime_input(audio=types.Blob(data=bytes(buf), mime_type=f'audio/pcm;rate={IN_RATE}'))
                buf.clear()

    async def player(self):
        """AI ovozi brauzerga kelishi bilan (vaqtni brauzer o'zi rejalashtiradi)"""
        while not self.done.is_set():
            if self.outbuf:
                chunk = bytes(self.outbuf)
                self.outbuf.clear()
                await self.ws.send(chunk)
            await asyncio.sleep(0.02)

    async def run_tool(self, name: str, args: dict) -> dict:
        await self.emit({'type': 'tool', 'name': name, 'state': 'start', 'args': args})
        result = await self.desk.tool(name, args) if self.desk else await super().run_tool(name, args)
        await self.emit({'type': 'tool', 'name': name, 'state': 'done', 'args': args, 'result': result})
        return result


async def owner_of(token: str) -> str | None:
    """Kalit egasiniki bo'lsa — uning ismi (bo'sh bo'lishi mumkin), aks holda None"""
    if not token or len(token) > 4096:
        return None
    try:
        async with httpx.AsyncClient(base_url=CEREBRO, timeout=10) as http:
            r = await http.get('/api/me', headers={'Authorization': f'Bearer {token}'})
    except httpx.HTTPError:
        return None
    return (r.json().get('business', {}).get('ownerName') or 'egasi') if r.status_code == 200 else None


async def read_browser(ws: ServerConnection, bridge: WebBridge):
    try:
        async for msg in ws:
            if isinstance(msg, bytes):
                bridge.on_audio(msg)
            elif json.loads(msg).get('type') == 'stop':
                break
    except Exception:
        pass
    finally:
        bridge.done.set()


async def idle_guard(bridge: WebBridge):
    """Chaqirilgan suhbat: WAKE_IDLE_S davomida hech kim gapirmasa — yopiladi (quloq yana tinglashga qaytadi)"""
    while not bridge.done.is_set():
        await asyncio.sleep(2)
        if bridge.speaking():
            bridge.heard_at = time.monotonic()
        elif time.monotonic() - bridge.heard_at > WAKE_IDLE_S:
            log('[panel quloq] —', 'jim — suhbat yopildi')
            bridge.done.set()


async def wait_for_wake(ws: ServerConnection) -> tuple[str, list[bytes]] | None:
    """«Quloq»: mikrofonni tinglaydi; chaqiriq — (so'z, oxirgi ovoz bo'laklari); egasi to'xtatsa yoki ulanish uzilsa — None"""
    spotter = await asyncio.to_thread(WakeSpotter)
    await ws.send(json.dumps({'type': 'listening'}))
    recent: deque[bytes] = deque(maxlen=WAKE_REPLAY_CHUNKS)
    async for msg in ws:
        if isinstance(msg, bytes):
            recent.append(msg)
            word = spotter.feed(msg)
            if word:
                return word, list(recent)
        elif json.loads(msg).get('type') == 'stop':
            return None
    return None


class WebVoice:
    def __init__(self):
        self.active = 0
        self.listening = 0

    async def handle(self, ws: ServerConnection):
        origin = ws.request.headers.get('Origin', '') if ws.request else ''
        if not ORIGIN.match(origin):
            await ws.close(1008, 'origin')
            return
        try:
            first = json.loads(await asyncio.wait_for(ws.recv(), 5))
            who = await owner_of(str(first.get('token', '')))
        except Exception:
            who = None
        if who is None:
            await ws.send(json.dumps({'type': 'error', 'text': "Kirish kaliti eskirgan — panelga qayta kiring"}))
            await ws.close(1008, 'auth')
            return
        wake = None
        if first.get('mode') == 'wake':
            if not wake_available():
                # fatal — brauzer qayta urinmaydi (model yoki vosk o'rnatilmagan)
                await ws.send(json.dumps({'type': 'error', 'fatal': True, 'text': "Ovoz bilan chaqirish o'rnatilmagan: tgvoice/README.md dagi «Quloq» bo'limi"}))
                await ws.close(1011, 'no model')
                return
            if self.listening >= MAX_LISTENERS:
                await ws.close(1013, 'busy')
                return
            self.listening += 1
            try:
                heard = await wait_for_wake(ws)
            except Exception as e:
                log('[panel quloq] —', f"xato: {type(e).__name__}: {str(e)[:200]}")
                heard = None
            finally:
                self.listening -= 1
            if not heard:
                await ws.close()
                return
            wake, replay = heard
            log('[panel quloq] —', f'chaqirildi: {wake}')
            await ws.send(json.dumps({'type': 'wake', 'word': wake}))
        if self.active >= MAX_SESSIONS:
            await ws.send(json.dumps({'type': 'error', 'text': "Hozir boshqa oynada suhbat ketyapti"}))
            await ws.close(1013, 'busy')
            return
        self.active += 1
        bridge = WebBridge(ws, str(first['token']), who, customer=first.get('mode') == 'customer', wake=wake)
        if wake:
            for chunk in replay:
                bridge.on_audio(chunk)
        reading = asyncio.create_task(read_browser(ws, bridge))
        guard = asyncio.create_task(idle_guard(bridge)) if wake else None
        try:
            await ws.send(json.dumps({'type': 'ready'}))
            await bridge.run()
        except Exception as e:
            log('[panel] —', f"xato: {type(e).__name__}: {str(e)[:200]}")
            await bridge.emit({'type': 'error', 'text': "Ovozli suhbat uzildi — qayta bosing"})
        finally:
            self.active -= 1
            bridge.done.set()
            reading.cancel()
            if guard:
                guard.cancel()
            await ws.close()
