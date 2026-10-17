"""Javob tezligi o'lchovi (qo'ng'iroqsiz): o'zbekcha savol real vaqtda 20 ms bo'laklarda, keyin jimlik — xuddi telefondagidek.
O'lchanadi: gap tugagan paytdan AI ovozining birinchi bo'lagigacha. Har sozlama bir necha marta."""
import asyncio
import os
import subprocess
import sys
import time

from google import genai
from google.genai import types

from common import ROOT, env

sys.stdout.reconfigure(encoding='utf-8')
QUESTION = "Ertaga soat o'nda Akmal akaga qo'ng'iroq qilishim kerak, shuni eslatib qo'ying."
SYSTEM = ("Sen Cerebro — biznes yordamchisisan. Bu jonli telefon qo'ng'irog'i. Faqat o'zbek tilida, qisqa: bir-ikki gap. "
          "Eslatma so'ralsa «xo'p, eslatib qo'yaman» de.")
CACHE = str(ROOT / 'tmp' / 'question16k.pcm')
CHUNK = 640  # 20 ms, 16 kHz, 16-bit


async def question(client: genai.Client) -> bytes:
    os.makedirs(os.path.dirname(CACHE), exist_ok=True)
    if os.path.exists(CACHE):
        return open(CACHE, 'rb').read()
    r = await client.aio.models.generate_content(
        model='gemini-3.8-flash-tts', contents=f"Read in Uzbek, natural male voice, phone call: {QUESTION}",
        config=types.GenerateContentConfig(response_modalities=['AUDIO'], speech_config=types.SpeechConfig(
            voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name='Puck')))))
    pcm = subprocess.run(['ffmpeg', '-loglevel', 'error', '-f', 's16le', '-ar', '24000', '-ac', '1', '-i', 'pipe:0', '-f', 's16le', '-ar', '16000', '-ac', '1', 'pipe:1'],
                         input=r.candidates[0].content.parts[0].inline_data.data, capture_output=True, check=True).stdout
    # Oxiridagi jimlikni kesish: gap tugash payti aniq bo'lsin
    import array
    a = array.array('h', pcm)
    end = len(a)
    while end > 0 and abs(a[end - 1]) < 300:
        end -= 1
    pcm = a[:end].tobytes()
    open(CACHE, 'wb').write(pcm)
    return pcm


async def once(client, model: str, extra: dict, q: bytes) -> tuple[float | None, str]:
    config = types.LiveConnectConfig(response_modalities=['AUDIO'], system_instruction=SYSTEM,
                                     output_audio_transcription=types.AudioTranscriptionConfig(), **extra)
    said: list[str] = []
    async with client.aio.live.connect(model=model, config=config) as s:
        speech_end = asyncio.get_running_loop().create_future()
        stop = asyncio.Event()

        async def send():
            t = time.monotonic()
            for i, o in enumerate(range(0, len(q), CHUNK)):
                await s.send_realtime_input(audio=types.Blob(data=q[o:o + CHUNK], mime_type='audio/pcm;rate=16000'))
                await asyncio.sleep(max(0, t + (i + 1) * 0.02 - time.monotonic()))
            speech_end.set_result(time.monotonic())
            silence, i0, t = b'\0' * CHUNK, 0, time.monotonic()
            while not stop.is_set():  # telefondagidek: jimlik oqimi davom etadi
                await s.send_realtime_input(audio=types.Blob(data=silence, mime_type='audio/pcm;rate=16000'))
                i0 += 1
                await asyncio.sleep(max(0, t + i0 * 0.02 - time.monotonic()))

        sender = asyncio.create_task(send())
        first = None
        try:
            async def receive():
                nonlocal first
                async for m in s.receive():
                    sc = m.server_content
                    if not sc:
                        continue
                    if sc.output_transcription and sc.output_transcription.text:
                        said.append(sc.output_transcription.text)
                    if sc.model_turn and first is None and any(p.inline_data and p.inline_data.data for p in sc.model_turn.parts):
                        first = time.monotonic()
                    if sc.turn_complete:
                        return
            await asyncio.wait_for(receive(), 25)
        except asyncio.TimeoutError:
            pass
        finally:
            stop.set()
            sender.cancel()
        end = speech_end.result() if speech_end.done() else None
    return (first - end) if first and end else None, ''.join(said).strip()


async def main():
    client = genai.Client(api_key=env('GEMINI_API_KEY'))
    q = await question(client)
    print(f"savol: {len(q) / 32000:.1f} s")
    fast_vad = {'realtime_input_config': types.RealtimeInputConfig(automatic_activity_detection=types.AutomaticActivityDetection(
        end_of_speech_sensitivity=types.EndSensitivity.END_SENSITIVITY_HIGH, silence_duration_ms=300, prefix_padding_ms=20))}
    no_think = {'thinking_config': types.ThinkingConfig(thinking_budget=0)}
    low_think = {'thinking_config': types.ThinkingConfig(thinking_level='minimal')}
    vad = lambda ms: {'realtime_input_config': types.RealtimeInputConfig(automatic_activity_detection=types.AutomaticActivityDetection(
        end_of_speech_sensitivity=types.EndSensitivity.END_SENSITIVITY_HIGH, silence_duration_ms=ms, prefix_padding_ms=20))}
    variants = [
        ("3.8-live, VAD 500 ms + o'ylashsiz", 'gemini-3.8-live', {**vad(500), **no_think}),
        ('3.1-flash-live, VAD 500 ms', 'gemini-3.1-flash-live-preview', vad(500)),
        ("3.1-flash-live, VAD 500 ms + o'ylashsiz", 'gemini-3.1-flash-live-preview', {**vad(500), **no_think}),
    ]
    for label, model, extra in variants:
        times = []
        for _ in range(4):
            try:
                dt, said = await once(client, model, extra, q)
            except Exception as e:
                print(f"{label}: XATO {type(e).__name__}: {str(e)[:150]}")
                break
            times.append(dt)
        if times:
            ok = [t for t in times if t is not None]
            print(f"{label}: {', '.join(f'{t:.2f}' if t is not None else '—' for t in times)} s"
                  + (f"  | o'rtacha {sum(ok) / len(ok):.2f} s" if ok else '') + f"  | «{said[:70]}»")

asyncio.run(main())
