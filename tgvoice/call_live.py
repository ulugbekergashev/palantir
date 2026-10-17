"""Telegram qo'ng'irog'i + Gemini Live: DentaCRM akkauntidan egasiga qo'ng'iroq, jonli o'zbekcha suhbat.
Eshitish, o'ylash va gapirish — bitta oqimda (Gemini Live). Vazifa, eslatma, biznes ma'lumoti — Cerebro'dan (asbob orqali).
Gap bo'linsa (AI gapirayotganda odam gapirsa) — AI to'xtaydi va tinglaydi.
Ishga tushirish:  tgvoice\\.venv\\Scripts\\python.exe tgvoice\\call_live.py <username yoki Telegram id> [--remind <vazifa id>]
Odatda Cerebro o'zi ishga tushiradi (eslatma vaqtida, server/tgcall.ts)."""
import array
import asyncio
import faulthandler
import os
import sys
import time
from datetime import datetime, timedelta, timezone

import httpx
from google import genai
from google.genai import types
from pytgcalls import PyTgCalls, filters
from pytgcalls.exceptions import CallBusy, CallDeclined, CallDiscarded, NotInCallError, TimedOutAnswer
from pytgcalls.types import CallConfig, Device, Direction, ExternalMedia, MediaStream, RecordStream, StreamFrames
from pytgcalls.types.raw import AudioParameters
from telethon import TelegramClient

from common import ROOT, SESSION, env

RATE = 48000                      # Telegram tomoni: 48 kHz, mono, 16-bit, 10 ms bo'laklar
FRAME_BYTES = RATE // 100 * 2
LIVE_IN_RATE = 16000              # Gemini Live kirishi
LIVE_MODEL = env('LIVE_MODEL', 'gemini-3.8-live')
# Ovoz: «standart» — nom berilmaydi, faqat til kodi (sinovda o'zbekchani eng tabiiy shunday aytdi, 2026-10-18);
# Telefon.md dagi «ovoz:» qatori ustun. Eslatma: Google standart ovozni ogohlantirmasdan o'zgartirishi mumkin
LIVE_VOICE = env('LIVE_VOICE', 'standart')
LIVE_LANG = env('LIVE_LANG', 'uz-UZ')
# O'lchovda (latency.py, 2026-10-17): gap tugagandan javobgacha 3.8-live standart ~1,6 s → shu sozlamalar bilan ~1,1 s
LIVE_SILENCE_MS = int(env('LIVE_SILENCE_MS', '500'))   # shuncha jimlik — gap tugadi (300 — tezroq, lekin o'ylab to'xtaganda kesadi)
LIVE_THINKING = int(env('LIVE_THINKING', '0'))          # o'ylash byudjeti: 0 — o'ylamasdan darhol javob
UPLINK_FRAMES = 4                                       # Live'ga 40 ms bo'laklarda
CEREBRO = env('CEREBRO_URL', 'http://127.0.0.1:3200')
CALL_LIMIT_S = 300
UZ_TZ = timezone(timedelta(hours=5))   # O'zbekistonda yozgi vaqt yo'q
WEEKDAYS = ['dushanba', 'seshanba', 'chorshanba', 'payshanba', 'juma', 'shanba', 'yakshanba']
# Biznesga bog'liq hamma narsa (nomi, egasi, murojaat, ohang, ovoz) — Cerebro'dan: profil va Obsidian'dagi Telefon.md
SYSTEM = """Sen Cerebro — «{business}» biznesining AI yordamchisisan.
Bu jonli telefon qo'ng'irog'i: biznes egasi ({owner}) bilan gaplashyapsan. Faqat o'zbek tilida (lotin), iliq va tabiiy, xuddi odam kabi gapir.
Ohang: ona tili o'zbek tili bo'lgan toshkentlik xushmuomala yordamchidek — matnni o'qib bergandek emas, jonli suhbatdek.
Savolda ohang ko'tariladi, gap oxirida yumshoq tushadi, so'zlar orasida tabiiy kichik pauzalar, kerak joyda tabassum bilan.
Talaffuz: o'zbek adabiy (Toshkent) talaffuzi — rus yoki turk talaffuzida emas. Urg'u ko'pincha so'zning oxirgi bo'g'inida: a-KA, rah-MAT, e-shi-ta-MAN.
«aka» so'zida «k» qattiq va toza — hech qachon «akya» emas. «q» — chuqur bo'g'iz tovushi, «k» dan farqli; «g'» — yumshoq g'ayn; «x» — «h» dan farqli.
Javoblar qisqa: bir-ikki gap. Ro'yxat sanama, eng muhimini ayt.
Hozir: {now} ({weekday}), Toshkent vaqti.
Asboblar:
- add_task — vazifa yoki eslatma qo'shish. Vaqt aytilsa, due_at ni aniq hisobla (YYYY-MM-DDTHH:MM). «Ertalab» — 09:00, «tushdan keyin» — 14:00, «kechqurun» — 18:00.
- list_tasks — ochiq vazifalar («bugun nima ishlarim bor?» kabi savolga).
- update_task — bajarildi deb belgilash yoki vaqtini surish (id — list_tasks dan).
- cerebro — qolgan hamma narsa: mijozlar, narxlar, biznes ma'lumotlari, eslab qolish, murakkab so'rovlar.
O'zingdan ma'lumot to'qima, asbob chaqirmasdan «qildim» dema. Asbob natijasini bitta qisqa gap bilan, bir marta tasdiqla — takrorlama.
Egasi xayrlashsa (xayr, bo'ldi rahmat) — qisqa xayrlash va end_call ni chaqir."""
# Telefon.md bo'lmasa (egasi o'chirgan) — shu standart
DEFAULT_GUIDE = "Salomlashish: «Assalomu alaykum{comma_owner}! Cerebro eshitadi.»"
GREET = "Qo'ng'iroq ulanganda birinchi bo'lib salomlash — egasining ko'rsatmasidagi salomlashish bilan."
REMIND = """BU ESLATMA QO'NG'IROG'I — sen o'zing qo'ng'iroq qilding. Vazifa: «{title}» (id: {id}, muddati {due}).
Ulanganda ko'rsatmadagidek murojaat bilan qisqa salomlash va darhol eslat: «… Eslatma: …». Keyin qisqa so'ra: bajarildimi yoki surib qo'yaymi?
«Bajarildi» desa — update_task (status=done) va «Bajarildi deb belgiladim» de; «surib qo'y», «yarim soatdan keyin eslat» desa — update_task (yangi due_at) va yangi vaqtni ayt.
Ishi bitgach qisqa xayrlash va end_call."""

S = types.Schema
TOOLS = [types.Tool(function_declarations=[
    types.FunctionDeclaration(
        name='add_task', description="Vazifa yoki eslatma qo'shish. Vaqti bo'lsa — o'sha vaqtda eslatiladi.",
        parameters=S(type='OBJECT', properties={
            'title': S(type='STRING', description="Qisqa nom, o'zbekcha (masalan: «Akmal akaga qo'ng'iroq qilish»)"),
            'due_at': S(type='STRING', description="Muddat YYYY-MM-DDTHH:MM (Toshkent vaqti); aytilmasa — bo'sh"),
            'notes': S(type='STRING', description="Qo'shimcha izoh (ixtiyoriy)"),
            'call': S(type='BOOLEAN', description="true — vaqti kelganda Cerebro qo'ng'iroq qilib eslatsin («qo'ng'iroq qilib eslat», «telefon qil» desa)")},
            required=['title'])),
    types.FunctionDeclaration(name='list_tasks', description="Ochiq vazifalar ro'yxati (id, nom, muddat)."),
    types.FunctionDeclaration(
        name='update_task', description="Vazifani yangilash: bajarildi (status=done), bekor (status=cancelled) yoki vaqtini surish (due_at).",
        parameters=S(type='OBJECT', properties={
            'id': S(type='STRING', description='Vazifa id (list_tasks dan)'),
            'status': S(type='STRING', description='done yoki cancelled (ixtiyoriy)'),
            'due_at': S(type='STRING', description='Yangi muddat YYYY-MM-DDTHH:MM (ixtiyoriy)')}, required=['id'])),
    types.FunctionDeclaration(
        name='cerebro',
        description="Cerebro yordamchisiga murakkab topshiriq yoki savol: mijozlar, narxlar, biznes ma'lumotlari, eslab qolish. "
                    "Egasining so'rovini o'zbekcha, to'liq va aniq yoz.",
        parameters=S(type='OBJECT', properties={'request': S(type='STRING', description="O'zbekcha so'rov")}, required=['request'])),
    types.FunctionDeclaration(name='end_call', description="Qo'ng'iroqni tugatish (xayrlashgandan keyin)."),
])]


def speech_config(voice: str) -> types.SpeechConfig:
    """«standart» (yoki bo'sh) — ovoz nomisiz, faqat til kodi; aks holda — Gemini'ning shu nomli ovozi"""
    named = voice.strip() and voice.strip().lower() not in ('standart', 'default')
    return types.SpeechConfig(
        voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice.strip())) if named else None,
        **({'language_code': LIVE_LANG} if LIVE_LANG else {}))


def clock() -> str:
    """Toshkent vaqti. time.strftime emas: Cerebro ishga tushirganda TZ=Asia/Tashkent beradi, Windows'dagi Python uni noto'g'ri o'qiydi"""
    return datetime.now(UZ_TZ).strftime('%H:%M:%S')


def log(who: str, text: str):
    line = f"[{clock()}] {who}: {text}"
    print(line, flush=True)
    with open(ROOT / 'suhbat.log', 'a', encoding='utf-8') as f:
        f.write(line + '\n')


def down_48_to_16(pcm: bytes) -> bytes:
    a = array.array('h', pcm[: len(pcm) - len(pcm) % 6])
    return array.array('h', ((a[i] + a[i + 1] + a[i + 2]) // 3 for i in range(0, len(a), 3))).tobytes()


def up_24_to_48(pcm: bytes) -> bytes:
    """24 kHz → 48 kHz: namunalar orasiga o'rtacha qo'shiladi"""
    a = array.array('h', pcm[: len(pcm) - len(pcm) % 2])
    out = array.array('h', bytes(len(a) * 4))
    for i, s in enumerate(a):
        nxt = a[i + 1] if i + 1 < len(a) else s
        out[2 * i] = s
        out[2 * i + 1] = (s + nxt) // 2
    return out.tobytes()


class Cerebro:
    def __init__(self):
        self.http = httpx.AsyncClient(base_url=CEREBRO, timeout=120)

    async def login(self):
        # Cerebro eslatma qo'ng'irog'ini o'zi boshlasa — biznesning qisqa muddatli kalitini beradi (boshqa biznesga tegolmaydi)
        if token := os.environ.get('CEREBRO_TOKEN'):
            self.http.headers['Authorization'] = f'Bearer {token}'
            return
        r = await self.http.post('/api/login', json={'login': env('CEREBRO_LOGIN'), 'password': env('CEREBRO_PASSWORD')})
        r.raise_for_status()
        self.http.headers['Authorization'] = f"Bearer {r.json()['token']}"

    async def ask(self, request: str) -> str:
        r = await self.http.post('/api/chat', json={'text': request, 'phone': True})
        if r.status_code != 200:
            return "Cerebro hozir javob bera olmadi."
        entries = r.json().get('entries') or []
        return entries[-1]['text'] if entries else ''


    # Oddiy ishlar — katta AI'siz, to'g'ridan-to'g'ri (tez va tekin)
    async def list_tasks(self) -> dict:
        r = await self.http.get('/api/tasks', params={'status': 'open'})
        r.raise_for_status()
        return {'tasks': [{'id': t['id'], 'title': t['title'], 'due_at': t.get('dueAt')} for t in r.json()['tasks'][:30]]}

    async def add_task(self, title: str, due_at: str | None, notes: str | None, call: bool = False) -> dict:
        r = await self.http.post('/api/tasks', json={'title': title, 'dueAt': due_at or None, 'notes': notes or None, 'call': bool(call and due_at)})
        if r.status_code != 200:
            return {'error': r.json().get('error', r.text[:200])}
        t = r.json()['task']
        return {'ok': True, 'id': t['id'], 'title': t['title'], 'due_at': t.get('dueAt')}

    async def update_task(self, task_id: str, status: str | None, due_at: str | None) -> dict:
        body = {k: v for k, v in {'status': status, 'dueAt': due_at}.items() if v}
        r = await self.http.patch(f'/api/tasks/{task_id}', json=body)
        if r.status_code != 200:
            return {'error': r.json().get('error', r.text[:200])}
        t = r.json()['task']
        return {'ok': True, 'title': t['title'], 'status': t['status'], 'due_at': t.get('dueAt')}

    # Obsidian (ikkinchi miya): boshida bilim, oxirida suhbat
    async def phone_context(self) -> dict:
        """{business, owner, guide (Telefon.md), voice, context (bilim va ochiq vazifalar)}"""
        r = await self.http.get('/api/brain/phone')
        r.raise_for_status()
        return r.json()

    async def save_call(self, record: dict) -> str:
        r = await self.http.post('/api/brain/call', json=record)
        r.raise_for_status()
        return r.json()['file']


def action_text(name: str, args: dict, result: dict) -> str | None:
    """Obsidian'dagi «Nima qilindi» qatori; ro'yxatni ko'rish — amal emas"""
    if 'error' in result:
        return f"Bajarilmadi ({name}): {result['error']}"
    due = lambda r: f" — {r['due_at'].replace('T', ' ')}" if r.get('due_at') else ''
    if name == 'add_task':
        return f"Vazifa qo'shildi: {result['title']}{due(result)}"
    if name == 'update_task':
        if result.get('status') == 'done':
            return f"Bajarildi: {result['title']}"
        if result.get('status') == 'cancelled':
            return f"Bekor qilindi: {result['title']}"
        return f"Vaqti o'zgardi: {result['title']}{due(result)}"
    if name == 'cerebro':
        return f"Cerebro: {args.get('request', '')} → {str(result.get('result', ''))[:400]}"
    return None


class Bridge:
    """Telegram ↔ Gemini Live: kirayotgan ovoz Live'ga oqadi, Live ovozi 10 ms bo'laklarda Telegram'ga yuboriladi"""
    def __init__(self, calls: PyTgCalls, peer: int, remind: str | None = None):
        self.calls, self.peer = calls, peer
        # Eslatma qo'ng'irog'i: shu vazifa haqida (Cerebro eslatma vaqtida ishga tushiradi)
        self.remind = remind
        self.inbox: asyncio.Queue[bytes] = asyncio.Queue(maxsize=500)
        self.outbuf = bytearray()
        self.connected = asyncio.Event()
        # AI birinchi salomini tugatdi — shundan keyin odamning ovozi Live'ga boradi (gapni bo'lish ham shundan keyin)
        self.greeted = asyncio.Event()
        self.done = asyncio.Event()
        self.cerebro = Cerebro()
        self._heard: list[str] = []
        self._said: list[str] = []
        # Obsidian'ga yoziladigan suhbat: {'at', 'who': Siz | Cerebro | Amal, 'text'}
        self.lines: list[dict] = []
        self.started: datetime | None = None
        self.who = ''

    def note(self, who: str, text: str):
        self.lines.append({'at': clock(), 'who': who, 'text': text[:2000]})

    def on_audio(self, pcm: bytes):
        self.connected.set()
        if not self.inbox.full():
            self.inbox.put_nowait(pcm)

    async def uplink(self, s):
        """Telegram → Live: 40 ms dan (kichikroq bo'lak — gap tugaganini Live tezroq sezadi).
        Birinchi salomlashuv tugaguncha yuborilmaydi: ulanish shovqini yoki «alo» salomni bo'lib, qayta boshlatmasin"""
        buf = bytearray()
        while not self.done.is_set():
            frame = await self.inbox.get()
            if not self.greeted.is_set():
                continue
            buf += frame
            if len(buf) >= FRAME_BYTES * UPLINK_FRAMES:
                await s.send_realtime_input(audio=types.Blob(data=down_48_to_16(bytes(buf)), mime_type=f'audio/pcm;rate={LIVE_IN_RATE}'))
                buf.clear()

    async def player(self):
        """Live → Telegram: har 10 ms da bitta bo'lak (bufer bo'sh bo'lsa — jimlik)"""
        start, i = time.monotonic(), 0
        silence = b'\0' * FRAME_BYTES
        while not self.done.is_set():
            # Oxirgi to'liq bo'lmagan bo'lak ham jimlik bilan to'ldirib yuboriladi: bufer albatta bo'shaydi
            # (aks holda «AI hali gapiryapti» deb mikrofon ochilmay qolardi)
            chunk = bytes(self.outbuf[:FRAME_BYTES]).ljust(FRAME_BYTES, b'\0') if self.outbuf else silence
            del self.outbuf[:FRAME_BYTES]
            await self.calls.send_frame(self.peer, Device.MICROPHONE, chunk)
            i += 1
            delay = start + i / 100 - time.monotonic()
            if delay > 0:
                await asyncio.sleep(delay)
            elif delay < -0.2:  # kechikib qolsa — soatni qayta boshlash
                start, i = time.monotonic(), 0

    def flush_text(self):
        for who, parts in (('Siz', self._heard), ('Cerebro', self._said)):
            if parts and (text := ''.join(parts).strip()):
                log(who, text)
                self.note(who, text)
            parts.clear()

    async def downlink(self, s):
        """Live xabarlari: ovoz, matn, gap bo'linishi, asbob chaqiruvlari"""
        while not self.done.is_set():
            async for m in s.receive():
                if m.tool_call:
                    await self.tools(s, m.tool_call)
                sc = m.server_content
                if not sc:
                    continue
                if sc.interrupted:  # odam gapirib yubordi — AI darhol jim bo'ladi
                    self.outbuf.clear()
                if sc.input_transcription and sc.input_transcription.text:
                    if self._said:
                        self.flush_text()
                    self._heard.append(sc.input_transcription.text)
                if sc.output_transcription and sc.output_transcription.text:
                    if self._heard:
                        self.flush_text()
                    self._said.append(sc.output_transcription.text)
                if sc.model_turn:
                    for p in sc.model_turn.parts:
                        if p.inline_data and p.inline_data.data:
                            self.outbuf += up_24_to_48(p.inline_data.data)
                if sc.turn_complete:
                    self.flush_text()
                    if not self.greeted.is_set():
                        asyncio.ensure_future(self._open_mic())

    async def tools(self, s, call):
        responses = []
        for fc in call.function_calls:
            args, t0 = fc.args or {}, time.monotonic()
            if fc.name == 'end_call':
                log('—', "AI qo'ng'iroqni tugatyapti")
                asyncio.get_running_loop().call_later(0.5, self._end_after_speech)
                result: dict = {'result': 'ok'}
            elif fc.name == 'add_task':
                result = await self.cerebro.add_task(args.get('title', ''), args.get('due_at'), args.get('notes'), bool(args.get('call')))
            elif fc.name == 'list_tasks':
                result = await self.cerebro.list_tasks()
            elif fc.name == 'update_task':
                result = await self.cerebro.update_task(str(args.get('id', '')), args.get('status'), args.get('due_at'))
            else:
                result = {'result': await self.cerebro.ask(args.get('request', ''))}
            if fc.name != 'end_call':
                log(f'⚙ {fc.name}', f"{dict(args)} → {result}   ({time.monotonic() - t0:.1f} s)")
                if done := action_text(fc.name, dict(args), result):
                    self.note('Amal', done)
            responses.append(types.FunctionResponse(id=fc.id, name=fc.name, response=result))
        await s.send_tool_response(function_responses=responses)

    async def _open_mic(self):
        """Salom oxirigacha eshitilgach odamning ovozi Live'ga ochiladi (eng ko'pi 15 s kutiladi — nima bo'lsa ham ochiladi)"""
        end = time.monotonic() + 15
        while self.outbuf and not self.done.is_set() and time.monotonic() < end:
            await asyncio.sleep(0.05)
        self.greeted.set()

    def _end_after_speech(self):
        async def wait():
            while self.outbuf:  # xayrlashuv ovozi oxirigacha eshitilsin
                await asyncio.sleep(0.1)
            await asyncio.sleep(0.5)
            self.done.set()
        asyncio.ensure_future(wait())

    async def guard(self, coro):
        """Bitta qism to'xtasa (go'shak qo'yildi, Live uzildi) — butun qo'ng'iroq yopiladi"""
        try:
            await coro
        except asyncio.CancelledError:
            raise
        except NotInCallError:
            log('—', "suhbatdosh go'shakni qo'ydi")
        except Exception as e:
            log('—', f"xato: {type(e).__name__}: {str(e)[:200]}")
        finally:
            self.done.set()

    async def run(self):
        await self.cerebro.login()
        # Obsidian'dagi bilim (biznes haqida, faktlar, narxlar, ochiq vazifalar) — qo'ng'iroq boshidanoq
        info = await self.cerebro.phone_context()
        owner = (info.get('owner') or '').strip()
        guide = info.get('guide') or DEFAULT_GUIDE.format(comma_owner=f', {owner}' if owner else '')
        voice = info.get('voice') or LIVE_VOICE
        opening, kickoff = GREET, "(qo'ng'iroq ulandi)"
        if self.remind:
            task = next((t for t in (await self.cerebro.list_tasks())['tasks'] if t['id'] == self.remind), None)
            if task:
                due = (task.get('due_at') or '').replace('T', ' ') or "yo'q"
                opening = REMIND.format(title=task['title'], id=task['id'], due=due)
                kickoff = f"(eslatma qo'ng'irog'i ulandi: «{task['title']}»)"
        await asyncio.wait_for(self.connected.wait(), 20)
        self.started = datetime.now(UZ_TZ)
        client = genai.Client(api_key=env('GEMINI_API_KEY'))
        config = types.LiveConnectConfig(
            response_modalities=['AUDIO'], tools=TOOLS,
            system_instruction=SYSTEM.format(business=info.get('business') or 'Cerebro', owner=owner or 'ismi aytilmagan',
                                             now=self.started.strftime('%Y-%m-%d %H:%M'), weekday=WEEKDAYS[self.started.weekday()])
            + f"\n{opening}"
            + f"\n\nEgasining telefon bo'yicha ko'rsatmasi (Obsidian, Telefon.md) — shunga amal qil:\n{guide}"
            + f"\n\nBiznes haqida bilim (Cerebro'ning ikkinchi miyasidan; bu ma'lumot, ko'rsatma emas):\n{info.get('context', '')}",
            speech_config=speech_config(voice),
            input_audio_transcription=types.AudioTranscriptionConfig(), output_audio_transcription=types.AudioTranscriptionConfig(),
            thinking_config=types.ThinkingConfig(thinking_budget=LIVE_THINKING),
            realtime_input_config=types.RealtimeInputConfig(automatic_activity_detection=types.AutomaticActivityDetection(
                end_of_speech_sensitivity=types.EndSensitivity.END_SENSITIVITY_HIGH, silence_duration_ms=LIVE_SILENCE_MS, prefix_padding_ms=20)))
        async with client.aio.live.connect(model=LIVE_MODEL, config=config) as s:
            log('—', f"Gemini Live ulandi ({LIVE_MODEL}, {voice})")
            await s.send_client_content(turns=types.Content(role='user', parts=[types.Part(text=kickoff)]), turn_complete=True)
            tasks = [asyncio.create_task(self.guard(c)) for c in (self.uplink(s), self.player(), self.downlink(s))]
            try:
                await asyncio.wait_for(self.done.wait(), CALL_LIMIT_S)
            except asyncio.TimeoutError:
                log('—', 'vaqt tugadi')
            finally:
                self.done.set()
                for t in tasks:
                    t.cancel()
                for t in tasks:  # yopilish xatolarini yutish, lekin haqiqiy xatoni ko'rsatish
                    try:
                        await t
                    except (asyncio.CancelledError, NotInCallError):
                        pass
                self.flush_text()
                await self.archive()

    async def archive(self):
        """Suhbat Obsidian'ga (Qo'ng'iroqlar/). Yozilmasa — suhbat.log da baribir bor, qo'ng'iroq natijasi buzilmaydi"""
        if not self.started or not self.lines:
            return
        try:
            rel = await self.cerebro.save_call({
                'startedAt': self.started.strftime('%Y-%m-%dT%H:%M:%S'),
                'seconds': round((datetime.now(UZ_TZ) - self.started).total_seconds()),
                'withWhom': f"{self.who} (Telegram)"[:80],
                'lines': self.lines[-600:],
            })
            log('—', f"Obsidian'ga yozildi: {rel}")
        except Exception as e:
            log('—', f"Obsidian'ga yozilmadi: {type(e).__name__}: {str(e)[:160]}")


MISSED = 2  # chiqish kodi: ko'tarmadi, rad etdi yoki band — Cerebro Telegram'da xabar va ovozli eslatma yuboradi


async def main() -> int:
    sys.stdout.reconfigure(encoding='utf-8')
    faulthandler.enable(open(ROOT / 'fault.txt', 'w'))
    args = sys.argv[1:]
    if not args:
        raise SystemExit("Kimga qo'ng'iroq: call_live.py <username yoki Telegram id> [--remind <vazifa id>]")
    remind = args[args.index('--remind') + 1] if '--remind' in args and args.index('--remind') + 1 < len(args) else None
    app = TelegramClient(SESSION, int(env('TG_API_ID')), env('TG_API_HASH'))
    await app.start()
    calls = PyTgCalls(app)
    await calls.start()
    # Cerebro egasining Telegram id'sini beradi (sessiyada tanish bo'lishi kerak), qo'lda — username
    who = args[0]
    person = await app.get_entity(int(who) if who.lstrip('-').isdigit() else who)
    peer = person.id
    bridge = Bridge(calls, peer, remind)
    bridge.who = ' '.join(filter(None, [person.first_name, f'(@{person.username})' if person.username else None])) or who
    code = 1

    @calls.on_update(filters.stream_frame(Direction.INCOMING))
    async def _frames(_, update: StreamFrames):
        if update.chat_id == peer:
            for f in update.frames:
                bridge.on_audio(f.frame)

    log('—', f"qo'ng'iroq: {who}" + (f" (eslatma {remind})" if remind else ''))
    try:
        await calls.play(peer, MediaStream(ExternalMedia.AUDIO, AudioParameters(RATE, 1), video_flags=MediaStream.Flags.IGNORE), CallConfig(timeout=45))
        await calls.record(peer, RecordStream(audio=True, audio_parameters=AudioParameters(RATE, 1)))
        await bridge.run()
        code = 0 if bridge.lines else 1
    except (CallDeclined, CallBusy, CallDiscarded, TimedOutAnswer) as e:
        log('—', f"qo'ng'iroq bo'lmadi: {e}")
        code = MISSED
    except asyncio.TimeoutError:
        log('—', "ulandi, lekin ovoz kelmadi (20 s)")
    except NotInCallError:
        log('—', "suhbatdosh go'shakni qo'ydi")
        code = 0 if bridge.lines else MISSED
    except Exception as e:
        log('—', f"xato, qo'ng'iroq yopildi: {type(e).__name__}: {str(e)[:200]}")
    finally:
        try:
            await calls.leave_call(peer)
        except Exception:
            pass
        await app.disconnect()
    log('—', f'tugadi (kod {code})')
    return code

sys.exit(asyncio.run(main()))
