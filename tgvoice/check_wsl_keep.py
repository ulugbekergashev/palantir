"""WSL'ni yoqiq tutuvchi jarayon o'lsa qayta ochiladi — tekshiruv (Asterisk'siz, WSL'siz, hech qayerga ulanmaydi): jarayon va soat
soxtalashtiriladi. Ishga tushirish (tgvoice papkasidan):  .venv\\Scripts\\python.exe check_wsl_keep.py"""
import asyncio
import os
import sys

os.environ.setdefault('VOICE_AGENT_KEY', 'sinov')
os.environ.setdefault('PALANTIR_URL', 'http://127.0.0.1:9')
os.environ.setdefault('SIP_WSL_DISTRO', 'Palantir')
sys.stdout.reconfigure(encoding='utf-8')

import sip_live  # noqa: E402
from sip_live import WSL_RETRY_MAX_S, WSL_RETRY_MIN_S, WslKeeper  # noqa: E402

sip_live.log = lambda who, text: logged.append(text)   # haqiqiy telefon.log ga yozilmasin
logged: list[str] = []
results: list[bool] = []


def ok(name: str, cond: bool, detail: str = ''):
    results.append(cond)
    print(f"  {'✓' if cond else '✗'} {name}" + (f' — {detail}' if detail and not cond else ''))


class Proc:
    """wsl.exe o'rnida: dies_at (soxta soat) dan keyin «o'lgan»"""
    def __init__(self, world, dies_at: float | None):
        self.world, self.dies_at, self.terminated = world, dies_at, False

    def poll(self):
        return 1 if self.terminated or (self.dies_at is not None and self.world.now >= self.dies_at) else None

    @property
    def returncode(self):
        return self.poll()

    def terminate(self):
        self.terminated = True


class World:
    """Soxta soat va jarayon ochish: lives — har ochilgan jarayon necha soniya yashaydi (None — abadiy)"""
    def __init__(self, lives: list[float | None]):
        self.now, self.lives, self.spawned, self.waits = 0.0, list(lives), [], []

    def spawn(self):
        life = self.lives.pop(0) if self.lives else None
        p = Proc(self, None if life is None else self.now + life)
        self.spawned.append((self.now, p))
        return p

    async def sleep(self, s: float):
        self.waits.append(s)
        self.now += s
        await asyncio.sleep(0)

    def clock(self):
        return self.now


async def run(world: World, keeper: WslKeeper, until: float):
    task = asyncio.create_task(keeper.watch())
    while world.now < until and not task.done():
        await asyncio.sleep(0)
    keeper.stop()
    await asyncio.wait_for(task, 1)


async def main():
    print("O'lsa — qayta ochiladi")
    w = World([10, None])
    k = WslKeeper(w.spawn, w.sleep, w.clock)
    ok('boshida ochildi', k.start() and len(w.spawned) == 1)
    await run(w, k, 60)
    ok("10 s da o'ldi — qayta ochildi (bir marta)", len(w.spawned) == 2 and k.restarts == 1, str([t for t, _ in w.spawned]))
    ok(f'qayta ochishdan oldin {WSL_RETRY_MIN_S} s kutildi', WSL_RETRY_MIN_S in w.waits)
    ok('jurnalda sababi bor', any("qayta ochiladi" in t for t in logged), str(logged))
    ok("to'xtatilganda jarayon yopildi", w.spawned[-1][1].terminated)

    print('Ketma-ket o\'lsa — kutish ikki baravar, chegarada to\'xtaydi')
    w = World([1] * 12 + [None])
    k = WslKeeper(w.spawn, w.sleep, w.clock)
    k.start()
    await run(w, k, 2000)
    backoff = [s for s in w.waits if s != sip_live.WSL_CHECK_S]
    ok('3, 6, 12, 24, 48, 60, 60…', backoff[:7] == [3, 6, 12, 24, 48, 60, 60], str(backoff))
    ok(f'eng ko\'pi {WSL_RETRY_MAX_S} s', max(backoff) == WSL_RETRY_MAX_S)

    print('Uzoq ishlagandan keyin o\'lsa — kutish yana qisqasidan')
    w = World([1, 1, 1, 500, None])
    k = WslKeeper(w.spawn, w.sleep, w.clock)
    k.start()
    await run(w, k, 1200)
    backoff = [s for s in w.waits if s != sip_live.WSL_CHECK_S]
    ok('3, 6, 12, keyin (500 s ishlagach) yana 3', backoff[:4] == [3, 6, 12, 3], str(backoff))

    print("WSL topilmasa (spawn → None) — kuzatuv to'xtaydi, yiqilmaydi")
    k = WslKeeper(lambda: None, w.sleep, w.clock)
    ok('start() — False', k.start() is False)
    await asyncio.wait_for(k.watch(), 1)
    ok('watch() darhol tugadi', True)

    print("To'xtatilgan bo'lsa — qayta ochilmaydi")
    w = World([5, None])
    k = WslKeeper(w.spawn, w.sleep, w.clock)
    k.start()
    task = asyncio.create_task(k.watch())
    while w.now < 6:
        await asyncio.sleep(0)
    k.stop()
    await asyncio.wait_for(task, 1)
    ok("stop() dan keyin yangi jarayon ochilmadi", len(w.spawned) == 1, str(len(w.spawned)))

    failed = results.count(False)
    print(f"\n{len(results) - failed}/{len(results)} o'tdi")
    sys.exit(1 if failed else 0)


asyncio.run(main())
