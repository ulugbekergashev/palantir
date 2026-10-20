"""Uyg'otuvchi so'z: «Palantir» yoki «Jarvis» — shu kompyuterning o'zida (Vosk, internetsiz, bepul), panel mikrofoni tinglab turganda.

Vosk'ning kichik rus modeli faqat cheklangan lug'at bilan ishlaydi: uyg'otuvchi so'zlar va ko'p uchraydigan to'ldiruvchi so'zlar.
To'ldiruvchilar oddiy gapni o'ziga «tortadi» — shunda o'zbekcha va ruscha gap uyg'otuvchi so'zga yopishib qolmaydi. «Palantir» bu
modelning lug'atida o'zi bor («палантир»; ingliz va o'zbek kichik modellarida yo'q). Uyg'otuvchiga o'xshash so'zlar (палатин, паланкин,
пала, тир…) to'ldiruvchiga qo'shilmaydi — ular haqiqiy chaqiriqni ham «o'g'irlaydi». Topish oraliq natijada — gap tugashini kutmaydi.
Dastur avval Cerebro deb atalgan («серебро» bilan topilardi). Palantir sinovi (Windows inglizcha TTS, 2 ovoz): 10 chaqiriqdan 10 tasi
topildi, 14 oddiy gapdan 1 tasida yolg'on («plant a tree»). O'zbekcha va ruscha jonli ovoz bilan hali sinalmagan.

Model: tgvoice/models/vosk-model-small-ru-0.22 (https://alphacephei.com/vosk/models, Apache-2.0) — WAKE_MODEL bilan boshqasi."""
import json
from pathlib import Path

from common import env

MODEL_DIR = Path(env('WAKE_MODEL', str(Path(__file__).parent / 'models' / 'vosk-model-small-ru-0.22')))
RATE = 16000
WAKE_WORDS = {'палантир': 'Palantir', 'джарвис': 'Jarvis'}
FILLERS = """я ты он она мы вы они и в не на что с как а то все так его но да к у же вот за бы по только мне было от меня нет о из ему
теперь когда даже ну ли если уже или ни быть был до вас вам там потом себя ничего ей может тут где есть надо для тебя их чем была
сам без чего раз тоже себе под будет тогда кто этот того потому какой совсем здесь один мой тем чтобы сейчас были куда зачем всех
можно при два об другой хоть после над больше тот через эти нас про всего много три моя хорошо этой перед лучше нельзя такой им
всегда конечно между сегодня завтра вчера банк деньги врач доктор пациент время день час минута позвони запиши скажи сделай напомни
поставь задача задачи расписание администратор клиника бор кел касса сарой центр церковь цирк цвет чарли джаз жара вес мир берег бургер""".split()

_model = None


def available() -> bool:
    """Model papkasi bor va vosk o'rnatilgan"""
    if not MODEL_DIR.is_dir():
        return False
    try:
        import vosk  # noqa: F401
    except ImportError:
        return False
    return True


def _load():
    global _model
    if _model is None:
        from vosk import Model, SetLogLevel
        SetLogLevel(-1)
        _model = Model(str(MODEL_DIR))
    return _model


class WakeSpotter:
    """16 kHz 16-bit mono PCM bo'laklari → topilgan so'z («Palantir» / «Jarvis») yoki None"""

    def __init__(self):
        from vosk import KaldiRecognizer
        words = list(WAKE_WORDS) + sorted(set(FILLERS)) + ['[unk]']
        self.rec = KaldiRecognizer(_load(), RATE, json.dumps(words, ensure_ascii=False))

    def feed(self, pcm: bytes) -> str | None:
        if self.rec.AcceptWaveform(pcm):
            text = json.loads(self.rec.Result()).get('text', '')
        else:
            text = json.loads(self.rec.PartialResult()).get('partial', '')
        hit = next((WAKE_WORDS[w] for w in text.split() if w in WAKE_WORDS), None)
        if hit:
            self.rec.Reset()
        return hit
