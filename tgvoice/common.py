"""Umumiy: kalitlar Cerebro'ning .env faylidan va DATA_DIR/ovoz.env dan o'qiladi (bu yerda nusxasi saqlanmaydi).

ovoz.env ni Cerebro serveri yozadi (server/voice/serviceEnv.ts): panelda kiritilgan kalitlar (Gemini) va klinika kompyuterida o'zi
yaratilgan ovozli agent kaliti. .env dagi qiymat ustun. Fayl o'zgarsa (kalit panelda almashdi) — keyingi so'rovda yangisi olinadi."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SESSION = str(ROOT / 'dentacrm')
# Kalitlar Cerebro'ning .env faylidan (tgvoice/ — loyiha ichida, .env bir pog'ona yuqorida)
ENV_FILE = ROOT.parent / '.env'


def _parse(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    if not path.exists():
        return out
    for line in path.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


_DOT = _parse(ENV_FILE)
SERVICE_FILE = (ROOT.parent / _DOT.get('DATA_DIR', 'data')).resolve() / 'ovoz.env'
_service: dict[str, str] = {}
_service_mtime = -1.0


def _current() -> dict[str, str]:
    """ovoz.env + .env (.env ustun); ovoz.env o'zgargan bo'lsa qayta o'qiladi"""
    global _service, _service_mtime
    try:
        mtime = SERVICE_FILE.stat().st_mtime
    except OSError:
        mtime = 0.0
    if mtime != _service_mtime:
        _service, _service_mtime = _parse(SERVICE_FILE), mtime
    return {**_service, **_DOT}


def env(name: str, default: str | None = None) -> str:
    # Cerebro ishga tushirganda (eslatma qo'ng'irog'i) manzil va kalitni muhit o'zgaruvchisida beradi — u ustun
    value = os.environ.get(name) or _current().get(name, default)
    if not value:
        raise SystemExit(f"{name} topilmadi — {ENV_FILE} ga qo'shing (yoki panelda kiriting)")
    return value
