"""Gemini Live ovozlari namunasi: bir xil gap har xil ovozda, jonli ohang ko'rsatmasi va «hissiyotli suhbat» bilan → egasining Telegramiga.
Ishga tushirish:  python voices_live.py [ovoz1 ovoz2 ...]"""
import asyncio
import os
import subprocess
import sys

import httpx
from google import genai
from google.genai import types

from common import env

sys.stdout.reconfigure(encoding='utf-8')
CHAT = '1471335034'
LINE = "Assalomu alaykum, Ulug'bek aka! Xo'p, aka, eshitaman. Ertaga soat o'nda Akmal akaga qo'ng'iroq qilishingizni eslatib qo'yaman. Rahmat, aka, yana nima qilay?"
PRONUNCIATION = ("Talaffuz: o'zbek adabiy (Toshkent) talaffuzida gapir — rus yoki turk talaffuzida emas. "
                 "Urg'u ko'pincha so'zning oxirgi bo'g'iniga tushadi: a-KA, rah-MAT, e-sha-TA-man emas — e-shi-ta-MAN. "
                 "«aka» so'zida «k» qattiq va toza: «a-ka», hech qachon «akya» emas. «q» — chuqur bo'g'iz tovushi, «k» dan farqli; "
                 "«g'» — yumshoq g'ayn; «o'» — o'zbekcha o'; «x» — xirildoq x, «h» dan farqli.")
STYLE = ("Sen telefonda gaplashayotgan toshkentlik, iliq va xushmuomala yordamchisan. Ona tiling o'zbek tili. "
         "Matnni o'qib bergandek emas, jonli suhbatdek gapir: tabiiy intonatsiya, savolda ohang ko'tariladi, "
         "gap oxirida yumshoq tushadi, so'zlar orasida tabiiy kichik pauzalar, kerak joyda tabassum bilan. "
         "Faqat berilgan gapni aytasan, boshqa hech narsa qo'shmaysan. " + PRONUNCIATION)
VOICES = sys.argv[1:] or ['Kore', 'Aoede', 'Leda', 'Zephyr', 'Sulafat', 'Achernar', 'Puck', 'Charon', 'Orus']


LANG = os.environ.get('LANG_CODE')  # masalan uz-UZ


def speech(voice: str) -> types.SpeechConfig:
    """«default» — ovoz nomisiz (Gemini o'zi tanlaydi); LANG_CODE berilsa — til kodi ham"""
    vc = None if voice == 'default' else types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=voice))
    return types.SpeechConfig(voice_config=vc, **({'language_code': LANG} if LANG else {}))


async def sample(client: genai.Client, voice: str, affective: bool) -> bytes:
    config = types.LiveConnectConfig(
        response_modalities=['AUDIO'], system_instruction=STYLE,
        speech_config=speech(voice),
        **({'enable_affective_dialog': True} if affective else {}))
    pcm = bytearray()
    async with client.aio.live.connect(model=env('LIVE_MODEL', 'gemini-3.8-live'), config=config) as s:
        await s.send_client_content(turns=types.Content(role='user', parts=[types.Part(text=f"Shu gapni ayt: «{LINE}»")]), turn_complete=True)
        async for m in s.receive():
            sc = m.server_content
            if sc and sc.model_turn:
                for p in sc.model_turn.parts:
                    if p.inline_data and p.inline_data.data:
                        pcm += p.inline_data.data
            if sc and sc.turn_complete:
                break
    return bytes(pcm)


async def main():
    client = genai.Client(api_key=env('GEMINI_API_KEY'))
    async with httpx.AsyncClient(timeout=60) as tg:
        for voice in VOICES:
            for affective in (False,):
                try:
                    pcm = await asyncio.wait_for(sample(client, voice, affective), 40)
                except Exception as e:
                    print(f"{voice} {'hissiyotli' if affective else 'oddiy'}: XATO {type(e).__name__}: {str(e)[:120]}")
                    continue
                if not pcm:
                    print(f"{voice}: ovoz kelmadi")
                    continue
                ogg = subprocess.run(['ffmpeg', '-loglevel', 'error', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', 'pipe:0',
                                      '-c:a', 'libopus', '-b:a', '32k', '-f', 'ogg', 'pipe:1'], input=pcm, capture_output=True, check=True).stdout
                caption = f"🌐 {env('LIVE_MODEL', 'gemini-3.8-live').replace('gemini-', '')} · {'ovoz nomisiz' if voice == 'default' else voice}" + (f" · {LANG}" if LANG else '')
                for attempt in range(3):  # tarmoq uzilsa — qayta
                    try:
                        r = await tg.post(f"https://api.telegram.org/bot{env('BOT_TOKEN')}/sendVoice", data={'chat_id': CHAT, 'caption': caption},
                                          files={'voice': ('v.ogg', ogg, 'audio/ogg')})
                        print(f"{caption}: {'yuborildi' if r.json().get('ok') else r.text[:100]} ({len(pcm) / 48000:.1f} s)")
                        break
                    except httpx.HTTPError as e:
                        print(f"{caption}: Telegram xatosi ({type(e).__name__}), qayta urinish {attempt + 1}")
                        await asyncio.sleep(2)

asyncio.run(main())
