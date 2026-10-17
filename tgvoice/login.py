"""Qo'ng'iroq qiladigan Telegram akkauntiga bir marta kirish: sessiya tgvoice\\dentacrm.session ga saqlanadi (git'ga tushmaydi).
Ishga tushirish (o'z terminalingizda, loyiha papkasidan):  tgvoice\\.venv\\Scripts\\python.exe tgvoice\\login.py
Telefon raqam, Telegram kodi va (bo'lsa) ikki bosqichli parol shu yerda so'raladi — hech qayerga yuborilmaydi."""
import asyncio
from telethon import TelegramClient
from common import SESSION, env


async def main():
    client = TelegramClient(SESSION, int(env('TG_API_ID')), env('TG_API_HASH'))
    await client.start()
    me = await client.get_me()
    print(f"\nKirildi: {me.first_name} (@{me.username or '-'}), id {me.id}. Endi oynani yopsangiz bo'ladi.")
    await client.disconnect()

asyncio.run(main())
