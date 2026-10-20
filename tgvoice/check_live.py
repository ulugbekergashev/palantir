"""call_live.py tekshiruvi (qo'ng'iroqsiz): ko'rsatma, asboblar, Palantir bilan bog'lanish, Obsidian'ga yozish"""
import asyncio
import sys
from pathlib import Path
from datetime import datetime

sys.stdout.reconfigure(encoding='utf-8')
sys.argv = ['call_live.py', 'tekshiruv']
src = open(Path(__file__).resolve().parent / 'call_live.py', encoding='utf-8').read().split('MISSED = 2')[0]
exec(compile(src, 'call_live.py', 'exec'))


async def t():
    c = Palantir()
    await c.login()
    info = await c.phone_context(); ctx = info['context']; print('egasi:', info['owner'], '| ovoz:', info['voice'], '| guide:', info['guide'].splitlines()[-1])
    print('bilim:', len(ctx), 'belgi |', [tag for tag in ('<business_profile>', '<business_pages>', '<saved_notes>', '<open_tasks>') if tag in ctx])
    print(ctx[ctx.index('<open_tasks>'):][:300])
    print(action_text('add_task', {}, {'ok': True, 'title': 'Universitet', 'due_at': '2026-10-18T09:00'}))
    print(action_text('update_task', {}, {'ok': True, 'title': 'Universitet', 'status': 'done'}))

asyncio.run(t())


async def remind_check():
    c = Palantir()
    await c.login()
    t = (await c.list_tasks())['tasks'][0]
    print(REMIND.format(title=t['title'], id=t['id'], due=(t.get('due_at') or '').replace('T', ' ')).splitlines()[0])

asyncio.run(remind_check())
