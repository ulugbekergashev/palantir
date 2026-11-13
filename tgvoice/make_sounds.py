"""Telefon liniyasining yozib qo'yilgan ovozli xabarlari (Asterisk o'ynatadi, AI'siz): asterisk/sounds/*.wav — 8 kHz, mono.
Fayllar git'da turadi; matn o'zgarsa shu dastur qayta ishga tushiriladi (Gemini'dan ~1 so'm), install.sh Asterisk'ka o'rnatadi.
Ishga tushirish (tgvoice papkasidan):  .venv\\Scripts\\python.exe make_sounds.py"""
import asyncio
import subprocess
import sys

from google import genai
from google.genai import types

from common import ROOT, env

SOUNDS = ROOT / 'asterisk' / 'sounds'
VOICE = 'Kore'
# AI ham, administrator ham javob bermadi (extensions.conf, [yordam]) — Palantir'da «qayta qo'ng'iroq qiling» so'rovi ochiladi
MESSAGES = {
    'uzr': "Assalomu alaykum! Kechirasiz, hozir qo'ng'iroqqa javob bera olmadik. "
           "Raqamingiz yozib olindi — administratorimiz tez orada o'zi sizga qo'ng'iroq qiladi. Rahmat!",
}


async def make(client: genai.Client, name: str, text: str):
    r = await client.aio.models.generate_content(
        model='gemini-3.8-flash-tts', contents=text,   # faqat matn: ohang haqidagi ko'rsatmani ham ovoz chiqarib o'qib yuboradi
        config=types.GenerateContentConfig(response_modalities=['AUDIO'], speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=VOICE)))))
    pcm = r.candidates[0].content.parts[0].inline_data.data
    out = SOUNDS / f'{name}.wav'
    subprocess.run(['ffmpeg', '-loglevel', 'error', '-y', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', 'pipe:0',
                    '-ar', '8000', '-ac', '1', '-c:a', 'pcm_s16le', str(out)], input=pcm, check=True)
    print(f'{out.name}: {out.stat().st_size // 1024} KB')


async def main():
    sys.stdout.reconfigure(encoding='utf-8')
    SOUNDS.mkdir(parents=True, exist_ok=True)
    client = genai.Client(api_key=env('GEMINI_API_KEY'))
    for name, text in MESSAGES.items():
        await make(client, name, text)


if __name__ == '__main__':
    asyncio.run(main())
