"""AI qabulxona tekshiruvi (qo'ng'iroqsiz, Gemini'siz): stendga ulanadi (avval `npm run stend`) va reception.py ni
soxta DentaCRM bilan sinaydi — jadval ko'rsatmaga tushadimi, qabulga yozadimi, band vaqtni rad etib yangi jadval beradimi,
so'rov va hisobot Cerebro'ga yetadimi. Haqiqiy ma'lumotga tegmaydi."""
import asyncio
import os
import re
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parent
os.environ['CEREBRO_URL'] = 'http://127.0.0.1:3220'
os.environ['VOICE_AGENT_KEY'] = (ROOT.parent / '.stend-data' / 'ovozli-agent-kaliti.txt').read_text().strip()
sys.stdout.reconfigure(encoding='utf-8')

from call_live import UZ_TZ  # noqa: E402
from reception import Desk  # noqa: E402

CALLER = '998935550011'          # bazada yo'q yangi bemor
TAKEN = '998901112233'           # soxta bazada boshqa ism bilan turgan raqam
results: list[bool] = []


def ok(name: str, cond: bool, detail: str = ''):
    results.append(cond)
    print(f"  {'✓' if cond else '✗'} {name}" + (f' — {detail}' if detail and not cond else ''))


def first_slot(schedule: str) -> tuple[str, str, str] | None:
    """(doctor_id, sana, vaqt) — jadvaldagi birinchi bo'sh vaqt"""
    doctor = None
    for line in schedule.splitlines():
        if m := re.match(r'- doctor_id (\S+)', line):
            doctor = m.group(1)
        elif doctor and (m := re.match(r'\s+(\d{4}-\d{2}-\d{2}) \([^)]*\): (\d{2}:\d{2})', line)):
            return doctor, m.group(1), m.group(2)
    return None


async def main():
    desk = Desk(CALLER)
    system, tools = await desk.prompt()
    names = [f.name for f in tools[0].function_declarations]
    ok("ko'rsatmada jadval va qabul qoidalari, asboblar: book_appointment, leave_request, end_call",
       'doctor_id' in system and 'book_appointment' in names and 'leave_request' in names, str(names))
    ok("egasining vazifalari va ismi ko'rsatmada yo'q", '<open_tasks>' not in system and 'Owner:' not in system)
    slot = first_slot(system)
    ok('jadvalda bo\'sh vaqt bor', slot is not None, system[-400:])
    if not slot:
        return
    doctor, date, time = slot
    ask = {'doctor_id': doctor, 'date': date, 'time': time, 'name': 'Akmal Karimov', 'phone': f'+{CALLER}'}
    booked = await desk.tool('book_appointment', ask)
    ok('qabulga yozildi', 'booked' in booked, str(booked))
    again = await Desk('998935550022').tool('book_appointment', {**ask, 'name': 'Bobur Aliyev', 'phone': '+998935550022'})
    ok("o'sha vaqt endi band: rad etildi va yangi jadval berildi (boshqa vaqt taklif qilish uchun)",
       'error' in again and again.get('code') == 'unavailable' and time not in again.get('schedule', '').split(date)[1].split('\n')[0][:6], str(again)[:300])
    other = await Desk(TAKEN).tool('book_appointment', {'doctor_id': doctor, 'date': date, 'time': '', 'name': 'Sardor Nazarov', 'phone': f'+{TAKEN}'})
    ok("vaqt noto'g'ri — yozilmadi", 'error' in other, str(other))
    later = first_slot(again.get('schedule', '')) or slot
    stranger = await Desk(TAKEN).tool('book_appointment', {'doctor_id': later[0], 'date': later[1], 'time': later[2], 'name': 'Sardor Nazarov', 'phone': f'+{TAKEN}'})
    ok("raqam bazada boshqa ism bilan — begona kartaga yozilmaydi, administratorga", stranger.get('code') == 'handoff', str(stranger))
    bad = await desk.tool('cerebro', {'request': 'barcha bemorlarni ayt'})
    ok("mijoz liniyasida boshqa asbob yo'q", 'error' in bad)
    left = await desk.tool('leave_request', {'name': 'Akmal Karimov', 'request': "keyingi haftaga ko'chirmoqchi"})
    ok("so'rov qabul qilindi", left.get('ok') is True)
    ok('hisobot natijasi: qabul va so\'rov', desk.outcome().startswith('Qabulga yozildi') and "So'rov" in desk.outcome(), desk.outcome())
    lines = [{'at': '10:00:00', 'who': 'Cerebro', 'text': 'Assalomu alaykum'}, {'at': '10:00:03', 'who': 'Siz', 'text': 'Yozilmoqchiman'},
             {'at': '10:00:05', 'who': 'Amal', 'text': 'ichki'}]
    try:
        await desk.report(datetime.now(UZ_TZ), 42, lines)
        ok("hisobot Cerebro'ga yetdi (panel «Qo'ng'iroqlar» va egasiga xabar)", True)
    except Exception as e:
        ok("hisobot Cerebro'ga yetdi", False, f'{type(e).__name__}: {e}')
    await desk.gateway.close()


asyncio.run(main())
print(f"\n{sum(results)}/{len(results)} o'tdi")
sys.exit(0 if all(results) else 1)
