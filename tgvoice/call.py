"""Telegram orqali jonli qo'ng'iroq: DentaCRM akkauntidan egasiga qo'ng'iroq qilib, Palantir yordamchisi bilan ovozda gaplashish.
Quloq — VoiceLab jonli STT, miya — Palantir (panel chati: vazifa, eslatma, eslab qolish… hammasi), og'iz — VoiceLab TTS (Lola).
Ishga tushirish:  tgvoice\\.venv\\Scripts\\python.exe tgvoice\\call.py <username yoki +998...>
Eski zanjir (VoiceLab ovozi bilan) — asosiysi call_live.py; «ovoz: voicelab:…» imkoniyati shu asosda qilinadi.
Suhbat navbatma-navbat: AI gapirayotganda tinglanmaydi (aks-sado bo'lmasligi uchun). «Xayr» — qo'ng'iroq tugaydi."""
import array
import asyncio
import faulthandler
import json
import math
import re
import subprocess
import sys
import time
import uuid

import httpx
import websockets
from pytgcalls import PyTgCalls, filters
from pytgcalls.exceptions import CallBusy, CallDeclined, CallDiscarded, NotInCallError, TimedOutAnswer
from pytgcalls.types import CallConfig, Device, Direction, ExternalMedia, MediaStream, RecordStream, StreamFrames
from pytgcalls.types.raw import AudioParameters
from telethon import TelegramClient

from common import ROOT, SESSION, env

RATE = 48000                      # Telegram tomoni: 48 kHz, mono, 16-bit
FRAME_MS = 10
FRAME_BYTES = RATE * FRAME_MS // 1000 * 2
STT_RATE = 16000                  # VoiceLab jonli STT talabi
SPEECH_RMS = 700                  # shundan baland — gap (shovqinga qarab sozlanadi)
SPEECH_START_FRAMES = 4           # 40 ms ketma-ket gap — gap boshlandi
SILENCE_END_MS = 1100             # gapdan keyin shuncha jimlik — gap tugadi (kamroq bo'lsa, o'ylab to'xtaganda gap kesiladi)
MAX_UTTERANCE_S = 25
CALL_LIMIT_S = 300
VOICELAB = 'https://api.voicelab.uz'
PALANTIR = env('PALANTIR_URL', 'http://127.0.0.1:3200')
GREETING = "Assalomu alaykum, Ulug'bek aka! Palantir eshitadi. Nima qilay?"
VOICE_NAME = env('VOICE_NAME', 'Madina')   # VoiceLab ovozi (ro'yxat: /v1/voices?language=uz)
VOICE_MODEL = env('VOICE_MODEL', 'lison-v2')  # v2 — jonliroq (belgisi 1,5 kredit), lison — oddiy (1 kredit)
GOODBYE = re.compile(r"\b(xayr|hayr|bo'ldi rahmat|rahmat bo'ldi)\b", re.I)


def log(who: str, text: str):
    line = f"[{time.strftime('%H:%M:%S')}] {who}: {text}"
    print(line, flush=True)
    with open(ROOT / 'suhbat.log', 'a', encoding='utf-8') as f:
        f.write(line + '\n')


def rms(pcm: bytes) -> float:
    a = array.array('h', pcm[: len(pcm) - len(pcm) % 2])
    return math.sqrt(sum(s * s for s in a) / len(a)) if a else 0.0


def to_16k(pcm48: bytes) -> bytes:
    """48 kHz → 16 kHz: har 3 namunaning o'rtachasi (oddiy past chastota filtri bilan birga)"""
    a = array.array('h', pcm48[: len(pcm48) - len(pcm48) % 6])
    return array.array('h', ((a[i] + a[i + 1] + a[i + 2]) // 3 for i in range(0, len(a), 3))).tobytes()


def spoken(text: str) -> str:
    """Chat javobi → ovozga: belgi, havola, emoji olib tashlanadi; uzun bo'lsa — gap chegarasida qisqartiriladi"""
    t = re.sub(r'https?://\S+', '', text)
    t = re.sub(r'[*_`#>|]+', '', t)
    t = re.sub(r'^\s*[-•\d.)]+\s+', '', t, flags=re.M)
    t = re.sub(r'[\U0001F000-\U0001FAFF\u2600-\u27BF\uFE0F]', '', t)
    t = re.sub(r'\s+', ' ', t).strip()
    if len(t) > 450:
        cut = max(t.rfind('. ', 0, 450), t.rfind('? ', 0, 450), t.rfind('! ', 0, 450))
        t = t[: cut + 1] if cut > 100 else t[:450]
    return t


class Voice:
    def __init__(self):
        self.http = httpx.AsyncClient(timeout=30, headers={'Authorization': f"Bearer {env('VOICELAB_API_KEY')}"})
        self.voice_id: str | None = None

    async def hear(self, pcm16k: bytes) -> str:
        t = (await self.http.post(f'{VOICELAB}/v1/ticket', json={'transport': 'websocket', 'service': 'stt'})).json()
        async with websockets.connect(f"{t['websocket_url']}?ticket={t['ticket']}", max_size=None) as ws:
            await ws.recv()  # ready
            await ws.send(json.dumps({'type': 'start', 'language': 'uz', 'audio_format': 'pcm_s16le', 'sample_rate': STT_RATE, 'channels': 1}))
            for o in range(0, len(pcm16k), 6400):
                await ws.send(pcm16k[o:o + 6400])
            await ws.send(json.dumps({'type': 'commit'}))
            res = json.loads(await ws.recv())
        return (res.get('text') or '').strip()

    async def speak(self, text: str) -> bytes:
        """Matn → 48 kHz mono PCM (Telegram'ga yuborish uchun)"""
        if not self.voice_id:
            voices = (await self.http.get(f'{VOICELAB}/v1/voices', params={'language': 'uz'})).json()['data']
            self.voice_id = next((v['id'] for v in voices if v['name'].lower().startswith(VOICE_NAME.lower())), voices[0]['id'])
        r = await self.http.post(f'{VOICELAB}/v1/tts', headers={'Idempotency-Key': str(uuid.uuid4())},
                                 json={'text': text[:600], 'language': 'uz', 'voice_id': self.voice_id, 'model_id': VOICE_MODEL})
        if r.status_code != 200:
            raise RuntimeError(f'TTS {r.status_code}: {r.text[:120]}')
        # Asinxron: ffmpeg ishlaguncha qo'ng'iroqdan keladigan ovoz to'xtab qolmasin
        p = await asyncio.create_subprocess_exec('ffmpeg', '-loglevel', 'error', '-i', 'pipe:0', '-f', 's16le', '-ar', str(RATE), '-ac', '1', 'pipe:1',
                                                 stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        out, err = await p.communicate(r.content)
        if p.returncode:
            raise RuntimeError(f'ffmpeg: {err.decode(errors="replace")[:120]}')
        return out


class Brain:
    """Palantir yordamchisi: panel chati orqali — gap jurnalga «📞» bilan tushadi, asboblar (vazifa, eslatma…) ishlaydi"""
    def __init__(self):
        self.http = httpx.AsyncClient(base_url=PALANTIR, timeout=120)

    async def login(self):
        r = await self.http.post('/api/login', json={'login': env('PALANTIR_LOGIN'), 'password': env('PALANTIR_PASSWORD')})
        r.raise_for_status()
        self.http.headers['Authorization'] = f"Bearer {r.json()['token']}"

    async def think(self, heard: str) -> str:
        r = await self.http.post('/api/chat', json={'text': heard, 'phone': True})
        if r.status_code != 200:
            return "Kechirasiz, Palantir hozir javob bera olmadi."
        entries = r.json().get('entries') or []
        return entries[-1]['text'] if entries else ''


class Call:
    def __init__(self, calls: PyTgCalls, peer: int):
        self.calls, self.peer = calls, peer
        self.voice = Voice()
        self.brain = Brain()
        self.connected = asyncio.Event()
        self.speaking = False
        self.utterances: asyncio.Queue[bytes] = asyncio.Queue()
        self._buf = bytearray()
        self._loud = 0
        self._silent_ms = 0
        self._in_speech = False

    def on_audio(self, pcm: bytes):
        """Suhbatdosh ovozi (10 ms bo'laklar) → gap boshi/oxirini aniqlash"""
        self.connected.set()
        if self.speaking:
            return
        loud = rms(pcm) > SPEECH_RMS
        if not self._in_speech:
            self._loud = self._loud + 1 if loud else 0
            self._buf += pcm
            self._buf = self._buf[-FRAME_BYTES * 30:]  # gap boshidan oldingi 300 ms ham qolsin
            if self._loud >= SPEECH_START_FRAMES:
                self._in_speech, self._silent_ms = True, 0
            return
        self._buf += pcm
        self._silent_ms = 0 if loud else self._silent_ms + FRAME_MS
        if self._silent_ms >= SILENCE_END_MS or len(self._buf) >= RATE * 2 * MAX_UTTERANCE_S:
            self.utterances.put_nowait(bytes(self._buf))
            self._buf, self._in_speech, self._loud = bytearray(), False, 0

    async def play(self, pcm: bytes):
        self.speaking = True
        try:
            start = time.monotonic()
            for i, o in enumerate(range(0, len(pcm), FRAME_BYTES)):
                await self.calls.send_frame(self.peer, Device.MICROPHONE, pcm[o:o + FRAME_BYTES].ljust(FRAME_BYTES, b'\0'))
                delay = start + (i + 1) * FRAME_MS / 1000 - time.monotonic()
                if delay > 0:
                    await asyncio.sleep(delay)
            await asyncio.sleep(0.3)
        finally:
            self.speaking = False
            while not self.utterances.empty():  # AI gapirayotganda yig'ilgan aks-sadoni tashlab yuborish
                self.utterances.get_nowait()

    async def say(self, text: str):
        t0 = time.monotonic()
        pcm = await self.voice.speak(text)
        log('Palantir', f"{text}   (ovoz {time.monotonic() - t0:.1f} s)")
        await self.play(pcm)

    async def run(self):
        await self.brain.login()
        await asyncio.wait_for(self.connected.wait(), 20)
        await self.say(GREETING)
        deadline = time.monotonic() + CALL_LIMIT_S
        while time.monotonic() < deadline:
            try:
                pcm = await asyncio.wait_for(self.utterances.get(), max(1, deadline - time.monotonic()))
            except asyncio.TimeoutError:
                break
            t0 = time.monotonic()
            heard = await self.voice.hear(to_16k(pcm))
            t1 = time.monotonic()
            if not heard:
                continue
            log('Siz', f"{heard}   (tanish {t1 - t0:.1f} s, gap {len(pcm) / RATE / 2:.1f} s)")
            if GOODBYE.search(heard):
                await self.say("Xo'p, Ulug'bek aka, xayr!")
                return
            reply = spoken(await self.brain.think(heard))
            log('…', f"Palantir o'yladi {time.monotonic() - t1:.1f} s")
            await self.say(reply or "Kechirasiz, tushunmadim. Qaytarib ayting.")
        await self.say("Vaqt tugadi. Rahmat, xayr!")


async def main():
    sys.stdout.reconfigure(encoding='utf-8')
    # Ichki kutubxona (NTgCalls) qulasa — qaysi joyda ekani shu faylda qoladi
    faulthandler.enable(open(ROOT / 'fault.txt', 'w'))
    if len(sys.argv) < 2:
        raise SystemExit("Kimga qo'ng'iroq: call.py <username yoki +998...>")
    app = TelegramClient(SESSION, int(env('TG_API_ID')), env('TG_API_HASH'))
    await app.start()
    calls = PyTgCalls(app)
    await calls.start()
    peer = (await app.get_entity(sys.argv[1])).id
    call = Call(calls, peer)

    @calls.on_update(filters.stream_frame(Direction.INCOMING))
    async def _frames(_, update: StreamFrames):
        if update.chat_id == peer:
            for f in update.frames:
                call.on_audio(f.frame)

    log('—', f"qo'ng'iroq: {sys.argv[1]}")
    try:
        await calls.play(peer, MediaStream(ExternalMedia.AUDIO, AudioParameters(RATE, 1), video_flags=MediaStream.Flags.IGNORE), CallConfig(timeout=45))
        await calls.record(peer, RecordStream(audio=True, audio_parameters=AudioParameters(RATE, 1)))
        await call.run()
    except (CallDeclined, CallBusy, CallDiscarded, TimedOutAnswer) as e:
        log('—', f"qo'ng'iroq bo'lmadi: {e}")
    except asyncio.TimeoutError:
        log('—', "ulandi, lekin ovoz kelmadi (20 s)")
    except NotInCallError:
        log('—', "suhbatdosh go'shakni qo'ydi")
    except (RuntimeError, httpx.HTTPError, websockets.WebSocketException) as e:
        # Ovoz xizmati (masalan, VoiceLab krediti tugadi) yoki Palantir javob bermadi — qo'ng'iroq toza yopiladi
        log('—', f"xizmat xatosi, qo'ng'iroq yopildi: {str(e)[:160]}")
    finally:
        try:
            await calls.leave_call(peer)
        except Exception:
            pass
        await app.disconnect()
    log('—', 'tugadi')

asyncio.run(main())
