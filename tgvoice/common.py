"""Umumiy: kalitlar Cerebro'ning .env faylidan o'qiladi (bu yerda nusxasi saqlanmaydi)."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SESSION = str(ROOT / 'dentacrm')
# Kalitlar Cerebro'ning .env faylidan (tgvoice/ — loyiha ichida, .env bir pog'ona yuqorida)
ENV_FILE = ROOT.parent / '.env'


def _load() -> dict[str, str]:
    out: dict[str, str] = {}
    for line in ENV_FILE.read_text(encoding='utf-8').splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue
        k, v = line.split('=', 1)
        out[k.strip()] = v.strip().strip('"').strip("'")
    return out


_ENV = _load()


def env(name: str, default: str | None = None) -> str:
    # Cerebro ishga tushirganda (eslatma qo'ng'irog'i) manzil va kalitni muhit o'zgaruvchisida beradi — u ustun
    value = os.environ.get(name) or _ENV.get(name, default)
    if not value:
        raise SystemExit(f"{name} topilmadi — {ENV_FILE} ga qo'shing")
    return value
