"""Telefon liniyasi tekshiruvi (haqiqiy telefonsiz): Asterisk ichida «mijoz» qo'ng'iroq qiladi va savol beradi.
sip_live.py ishlab turgan bo'lishi kerak. Natija: jurnal (suhbat.log) va yozuv tmp/sinov.wav — eshitib ko'rish mumkin.
Gemini'dan ~2 so'mlik sarflaydi (savol bir marta yasaladi, keyin tmp/ dan). AI qoldirgan sinov so'rovi oxirida bekor qilinadi."""
import asyncio
import re
import subprocess
import sys
import time

from google import genai
from google.genai import types

from call_live import Palantir
from common import ROOT, env

sys.stdout.reconfigure(encoding='utf-8')
DISTRO = env('SIP_WSL_DISTRO', 'Cerebro')
CALLER = '0712345678'   # boshidagi nol ham AI'ga yetib borishi tekshiriladi
QUESTION = "Assalomu alaykum. Tish tozalash qancha turadi? Ertaga soat uchga yozilsam bo'ladimi? Ismim Akmal."
WAV = ROOT / 'tmp' / 'savol8k.wav'


def wsl(cmd: str) -> str:
    return subprocess.run(['wsl.exe', '-d', DISTRO, '-u', 'root', '--', 'bash', '-lc', cmd], capture_output=True, text=True, encoding='utf-8').stdout


async def make_question():
    if WAV.exists():
        return
    WAV.parent.mkdir(exist_ok=True)
    client = genai.Client(api_key=env('GEMINI_API_KEY'))   # o'zgaruvchida tursin: aks holda so'rov tugamasdan yopilib qoladi
    r = await client.aio.models.generate_content(
        model='gemini-3.8-flash-tts', contents=QUESTION,
        config=types.GenerateContentConfig(response_modalities=['AUDIO'], speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name='Puck')))))
    pcm = r.candidates[0].content.parts[0].inline_data.data
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', 'pipe:0', '-ar', '8000', str(WAV)],
                   input=pcm, check=True)


async def requests(c: Palantir) -> set[str]:
    """Mijoz qoldirgan so'rovlar (vazifa «📞 …»)"""
    return {t['id'] for t in (await c.list_tasks())['tasks'] if t['title'].startswith('📞')}


async def cleanup(before: set[str]):
    """Sinovda AI qoldirgan so'rov haqiqiy vazifa bo'lib tushadi — bekor qilinadi (egasiga eslatma bormasin)"""
    c = Palantir()
    await c.login()
    for task_id in await requests(c) - before:
        await c.update_task(task_id, 'cancelled', None)
        print("sinov so'rovi bekor qilindi:", task_id)


async def snapshot() -> set[str]:
    c = Palantir()
    await c.login()
    return await requests(c)


def main():
    asyncio.run(make_question())
    before = asyncio.run(snapshot())
    win = str(WAV).replace('\\', '/')
    wsl(f"mkdir -p /usr/share/asterisk/sounds/custom && cp \"$(wslpath '{win}')\" /usr/share/asterisk/sounds/custom/savol.wav && rm -f /tmp/sinov.wav")
    log = ROOT / 'suhbat.log'
    start = log.stat().st_size if log.exists() else 0
    wsl(f"asterisk -rx 'channel originate Local/{CALLER}@sinov_raqam extension s@sinov'")
    time.sleep(32)
    out = ROOT / 'tmp' / 'sinov.wav'
    wsl(f"cp /tmp/sinov.wav \"$(wslpath '{str(out).replace(chr(92), '/')}')\"")
    talk = log.read_bytes()[start:].decode('utf-8', errors='replace') if log.exists() else "jurnal yo'q"
    print(talk)
    # Obsidian'dagi suhbat sahifasida kim qo'ng'iroq qilgani (raqam to'liq, boshidagi nol bilan)
    for rel in re.findall(r"Obsidian'ga yozildi: (.+)", talk):
        for page in (ROOT.parent / 'data' / 'miya').glob(f'*/{rel.strip()}'):
            kim = next((l for l in page.read_text(encoding='utf-8').splitlines() if l.startswith('kim:')), '')
            print(kim, "| raqam to'g'ri:", CALLER in kim)
    print('yozuv:', out if out.exists() else "yo'q")
    asyncio.run(cleanup(before))


main()
