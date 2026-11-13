"""Qo'ng'iroq yo'qolmasin — tekshiruv (Asterisk'siz, Gemini'siz, Palantir'siz): AI ishlamay qolganda sip_live.py mijozni jim uzmaydi,
administratorga buradi ([yordam]); bura olmasa — «qayta qo'ng'iroq qiling» so'rovi. Mijoz o'zi qo'ygan, egasining yoki odatdagi
tugagan qo'ng'iroqqa tegilmaydi. Hech qayerga ulanmaydi: Asterisk buyrug'i va so'rov ochish soxtalashtiriladi.
Ishga tushirish (tgvoice papkasidan):  .venv\\Scripts\\python.exe check_rescue.py"""
import asyncio
import os
import sys

os.environ.setdefault('VOICE_AGENT_KEY', 'sinov')
os.environ.setdefault('PALANTIR_URL', 'http://127.0.0.1:9')
os.environ.setdefault('SIP_WSL_DISTRO', 'Palantir')
sys.stdout.reconfigure(encoding='utf-8')

import sip_live  # noqa: E402
from sip_live import CUSTOMER, MISSED, NO_CHANNEL, OWNER, RESCUE_RING_S, PhoneBridge  # noqa: E402

results: list[bool] = []


def ok(name: str, cond: bool, detail: str = ''):
    results.append(cond)
    print(f"  {'✓' if cond else '✗'} {name}" + (f' — {detail}' if detail and not cond else ''))


class Writer:
    """Liniya o'rnida: nima yozilganini eslab qoladi"""
    def __init__(self):
        self.data = bytearray()

    def write(self, b: bytes):
        self.data += b

    async def drain(self):
        pass

    def close(self):
        pass


def fake(answer: str | None):
    """Asterisk «channel redirect» va so'rov ochish o'rnida: chaqiruvlar ro'yxati"""
    calls: dict[str, list] = {'redirect': [], 'missed': []}

    async def redirect(uuid, ring, context='operator'):
        calls['redirect'].append((uuid, ring, context))
        return answer

    async def missed(caller, summary=''):
        calls['missed'].append((caller, summary))
        return True
    sip_live.redirect_to_operator, sip_live.missed_call = redirect, missed
    return calls


def bridge(mode: str = CUSTOMER, app: bool = False) -> PhoneBridge:
    return PhoneBridge(Writer(), mode, '998935550011', '', 1, 'abcd-uuid', app)


async def main():
    calls = fake(None)
    b = bridge()
    b.failure = 'ConnectionClosedError: 1011'
    await b.ended()
    ok("Gemini uzildi — qo'ng'iroq [yordam] ga burildi, administrator 20 s jiringlaydi",
       calls['redirect'] == [('abcd-uuid', RESCUE_RING_S, 'yordam')] and b.rescued, str(calls))
    ok("burilgan qo'ng'iroqqa go'shak yuborilmadi (Asterisk o'zi yopadi)", len(b.writer.data) == 0, b.writer.data.hex()[:20])
    ok("burilganda so'rov sip_live'dan ochilmaydi (ko'tarilmasa — Asterisk ochadi)", calls['missed'] == [])

    calls = fake(None)
    b = bridge(MISSED)
    b.failure = 'xato'
    await b.ended()
    ok("administrator allaqachon ko'tarmagan qo'ng'iroq (3) — qayta jiringlatilmaydi (0)", calls['redirect'] == [('abcd-uuid', 0, 'yordam')], str(calls))

    calls = fake(None)
    b = bridge()
    await b.ended()
    ok("odatdagi tugash (AI xayrlashdi) — burilmaydi, go'shak qo'yiladi", calls['redirect'] == [] and b.writer.data[:1] == b'\x00', str(calls))

    calls = fake(None)
    b = bridge()
    b.failure, b.hung_up = 'xato', True
    await b.ended()
    ok("mijoz o'zi qo'ydi — hech narsa qilinmaydi", calls['redirect'] == [] and calls['missed'] == [], str(calls))

    calls = fake(None)
    b = bridge(OWNER)
    b.failure = 'xato'
    await b.ended()
    ok("egasining qo'ng'irog'i — burilmaydi", calls['redirect'] == [], str(calls))

    calls = fake(None)
    b = bridge()
    b.failure, b.desk.handed_over = 'xato', True
    await b.ended()
    ok("AI allaqachon administratorga o'tkazgan — qayta burilmaydi", calls['redirect'] == [], str(calls))

    calls = fake('No such channel')
    b = bridge()
    b.failure = 'xato'
    await b.ended()
    ok("Asterisk bura olmadi — «qayta qo'ng'iroq qiling» so'rovi va go'shak",
       len(calls['missed']) == 1 and calls['missed'][0][0] == '998935550011' and not b.rescued and b.writer.data[:1] == b'\x00', str(calls))

    calls = fake(NO_CHANNEL)
    b = bridge()
    b.failure = 'xato'
    await b.ended()
    ok("kanal yo'q (mijoz qo'yib bo'lgan) — so'rov ochilmaydi", calls['missed'] == [], str(calls))

    calls = fake(None)
    b = bridge(app=True)
    b.failure = 'xato'
    await b.ended()
    ok("Android telefon orqali — burib bo'lmaydi, so'rov ochiladi", calls['redirect'] == [] and len(calls['missed']) == 1, str(calls))

    # AI umuman ishga tushmadi (Palantir yoki Gemini javob bermadi): Server.handle buni ushlab, administratorga buradi
    calls = fake(None)

    async def broken(self):
        raise ConnectionError('Gemini javob bermadi')
    PhoneBridge.run = broken
    server = sip_live.Server()
    reader = asyncio.StreamReader()
    raw = bytes.fromhex('2' + '12' + '0998935550011' + '1234567890123456')   # mijoz, 12 xonali raqam
    reader.feed_data(sip_live.frame(sip_live.CALL_ID, raw))
    writer = Writer()
    await server.handle(reader, writer)
    ok("AI ishga tushmadi — qo'ng'iroq uzilmay administratorga burildi, go'shak yuborilmadi",
       len(calls['redirect']) == 1 and calls['redirect'][0][2] == 'yordam' and len(writer.data) == 0, f"{calls} {writer.data.hex()[:20]}")
    ok("joy bo'shadi (faol qo'ng'iroqlar 0)", server.active == 0 and server.customers == 0)


asyncio.run(main())
print(f"\n{sum(results)}/{len(results)} o'tdi")
sys.exit(0 if all(results) else 1)
