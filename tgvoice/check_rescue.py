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


async def orphan_tests():
    """Ishga tushishda: oldingi nusxadan AI'siz qolgan qo'ng'iroqlar (Asterisk 20.6 AudioSocket uzilganini sezmaydi)"""
    concise = '\n'.join([
        'Local/998901112233@shahar-00000001;2!ai!s!13!Up!AudioSocket!20129989011122331234-5678-…,127.0.0.1:9092!998901112233!!!3!12!!',
        'Local/101@egasi-00000002;2!ai!s!13!Up!AudioSocket!10301010000000000000-…,127.0.0.1:9092!101!!!3!40!!',
        'Local/998907778899@shahar-00000003;2!ai!s!13!Up!AudioSocket!3012…,127.0.0.1:9096!998907778899!!!3!5!!',
        'PJSIP/admin-00000004!yordam!20!4!Ring!Dial!PJSIP/admin,20!998901112233!!!3!2!!',
    ])
    found = sip_live.orphaned_calls(concise, 9092)
    ok("AI'siz qolganlar: faqat shu portdagi AudioSocket kanallari, rejimi bilan (boshqa port, Dial — yo'q)",
       found == [('Local/998901112233@shahar-00000001;2', '2'), ('Local/101@egasi-00000002;2', '1')], str(found))
    sent: list[str] = []

    async def fake_asterisk(cmd: str) -> str:
        sent.append(cmd)
        return concise if cmd == 'core show channels concise' else 'Channel Local/x redirected'
    real = sip_live.asterisk
    sip_live.asterisk = fake_asterisk
    try:
        await sip_live.rescue_orphans()
    finally:
        sip_live.asterisk = real
    ok(f"mijoz — [yordam] ga ({RESCUE_RING_S} s jiringlaydi), egasi — uziladi",
       sent[1:] == [f'channel redirect Local/998901112233@shahar-00000001;2 yordam,{RESCUE_RING_S},1', 'channel request hangup Local/101@egasi-00000002;2'], str(sent))


async def main():
    await orphan_tests()
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

    # F6: jadval javob bermadi (qabul yozildimi — noma'lum): AI shu qo'ng'iroqda boshqa vaqtga qayta yozmaydi
    from reception import Desk
    desk = Desk('998935550011')
    sent: list[dict] = []

    async def unknown_book(ask):
        sent.append(ask)
        return {'error': "Jadval javob bermadi — boshqa vaqtga YOZMANG", 'code': 'unknown'}
    desk.gateway.book = unknown_book
    ask = {'doctor_id': 'd1', 'date': '2026-11-20', 'time': '10:00', 'name': 'Nodira Saidova', 'phone': '+998935550011'}
    first = await desk.tool('book_appointment', ask)
    second = await desk.tool('book_appointment', {**ask, 'time': '11:00'})
    ok("jadval javob bermadi — AI'ga «unknown», ikkinchi urinish CRM'ga yuborilmaydi",
       first.get('code') == 'unknown' and 'error' in second and len(sent) == 1, f"{first} {second} {len(sent)}")
    ok("hisobotda «Tekshirish kerak», panel yozuvida ham", 'Tekshirish kerak' in desk.outcome()
       and 'administrator tekshiradi' in (desk.action_text('book_appointment', ask, first) or ''), desk.outcome())
    await desk.gateway.close()


asyncio.run(main())
print(f"\n{sum(results)}/{len(results)} o'tdi")
sys.exit(0 if all(results) else 1)
