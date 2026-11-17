"""Kech qolgan Palantir javobi yo'qolmasin — tekshiruv (Gemini'siz, Palantir'siz): /api/chat PALANTIR_WAIT_S dan kech javob bersa,
AI avval «hali ishlayapti» deydi, so'rov to'xtatilmaydi, javob kelgach AI'ga beriladi va u aytadi. Suhbat tugagan bo'lsa — aytilmaydi.
Ishga tushirish (tgvoice papkasidan):  .venv\\Scripts\\python.exe check_late.py"""
import asyncio
import os
import sys

os.environ.setdefault('PALANTIR_URL', 'http://127.0.0.1:9')
sys.stdout.reconfigure(encoding='utf-8')

import httpx  # noqa: E402

import call_live  # noqa: E402
from call_live import Bridge, Palantir  # noqa: E402

call_live.PALANTIR_WAIT_S = 0.2
call_live.LATE_SPEAK_WAIT_S = 1
results: list[bool] = []


def ok(name: str, cond: bool, detail: str = ''):
    results.append(cond)
    print(f"  {'✓' if cond else '✗'} {name}" + (f' — {detail}' if detail and not cond else ''))


def server(delay: float, text: str = 'Menda bunday vosita yo\'q', status: int = 200):
    """/api/chat o'rnida: delay soniyadan keyin javob; qancha so'rov kelgani va oxirigacha yetgani sanaladi"""
    seen = {'asked': 0, 'answered': 0}

    async def handler(request: httpx.Request) -> httpx.Response:
        seen['asked'] += 1
        await asyncio.sleep(delay)
        seen['answered'] += 1
        return httpx.Response(status, json={'entries': [{'text': text}], 'delivered': False})
    return seen, httpx.AsyncClient(base_url='http://palantir', transport=httpx.MockTransport(handler))


class Session:
    """Gemini Live o'rnida: AI'ga nima berilganini eslab qoladi"""
    def __init__(self):
        self.sent: list[str] = []

    async def send_client_content(self, turns, turn_complete=True):
        self.sent.append(turns.parts[0].text)


class TestBridge(Bridge):
    def log(self, who: str, text: str):  # haqiqiy suhbat.log ga yozilmasin
        self.logged.append((who, text))


def bridge(http: httpx.AsyncClient) -> TestBridge:
    b = TestBridge(None, 0)
    b.logged = []
    b.lines = []
    b.palantir.http = http
    b.palantir.to_telegram = False
    b._session = Session()
    return b


async def main():
    print('Tez javob — o\'zi qaytadi, kech javob chaqirilmaydi')
    seen, http = server(0.01, 'Tayyor: 3 ta mijoz')
    late: list[str] = []
    async def on_late(t): late.append(t)
    p = Palantir(); p.http = http
    got = await p.ask('mijozlar soni', on_late=on_late)
    await asyncio.sleep(0.1)
    ok('javob matni qaytdi', got == 'Tayyor: 3 ta mijoz', got)
    ok('on_late chaqirilmadi', late == [])

    print('Kech javob — so\'rov to\'xtatilmaydi, keyin beriladi')
    seen, http = server(0.6)
    p = Palantir(); p.http = http; p.to_telegram = False
    got = await p.ask('nomini o\'zgartir', on_late=on_late)
    ok('AI\'ga «hali ishlayapti» deyiladi', 'hali ishlayapti' in got and 'Suhbat' in got, got)
    ok('«biroz vaqt oladi … jim» eski matni yo\'q', 'biroz vaqt' not in got)
    await asyncio.sleep(0.8)
    ok('so\'rov oxirigacha bordi (bekor qilinmadi)', seen['answered'] == 1, str(seen))
    ok('kech javob on_late ga keldi', late == ["Menda bunday vosita yo'q"], str(late))

    print('Kech javob xato bilan — baribir aytiladi')
    late.clear()
    seen, http = server(0.5, status=500)
    p = Palantir(); p.http = http
    await p.ask('x', on_late=on_late)
    await asyncio.sleep(0.7)
    ok('xato haqida xabar', late == ['Palantir hozir javob bera olmadi.'], str(late))

    print('Bridge: suhbat davom etyapti — AI kech javobni aytadi')
    seen, http = server(0.5)
    b = bridge(http)
    res = await b.run_tool('palantir', {'request': "Leadboost'ni Verion IT Company deb o'zgartir"})
    ok('asbob darhol javob berdi', 'hali ishlayapti' in res['result'], str(res))
    await asyncio.sleep(0.8)
    sent = b._session.sent
    ok('AI\'ga kech javob berildi', len(sent) == 1 and "Menda bunday vosita yo'q" in sent[0] and 'Tizim' in sent[0], str(sent))
    ok('panel yozuviga tushdi', any('kech javob' in l['text'] for l in b.lines), str(b.lines))

    print('Bridge: odam gapirayotgan payt — gap tugashi kutiladi')
    seen, http = server(0.3)
    b = bridge(http)
    b._heard.append('hali gapiryapman')
    await b.run_tool('palantir', {'request': 'x'})
    await asyncio.sleep(0.6)
    ok('odam gapirayotganda aytilmadi', b._session.sent == [])
    b._heard.clear()
    await asyncio.sleep(0.4)
    ok('gap tugagach aytildi', len(b._session.sent) == 1, str(b._session.sent))

    print('Bridge: suhbat tugagan — aytilmaydi')
    seen, http = server(0.4)
    b = bridge(http)
    await b.run_tool('palantir', {'request': 'x'})
    b.done.set()
    await asyncio.sleep(0.6)
    ok('tugagan suhbatga yuborilmadi', b._session.sent == [])
    ok('jurnalda qayd bor', any('tugagach' in t for _, t in b.logged), str(b.logged))

    print('Bridge: uzun javob qisqartiriladi')
    seen, http = server(0.3, 'x' * 5000)
    b = bridge(http)
    await b.run_tool('palantir', {'request': 'x'})
    await asyncio.sleep(0.5)
    ok(f'AI\'ga ko\'pi bilan {call_live.LATE_ANSWER_MAX} belgi', b._session.sent and len(b._session.sent[0]) < call_live.LATE_ANSWER_MAX + 200)

    failed = results.count(False)
    print(f"\n{len(results) - failed}/{len(results)} o'tdi")
    sys.exit(1 if failed else 0)


asyncio.run(main())
