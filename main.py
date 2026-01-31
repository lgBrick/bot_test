import asyncio
import logging
import os
from dotenv import load_dotenv
from aiogram import Bot, Dispatcher, types
from aiogram.filters.command import Command
from aiogram.types import WebAppInfo, InlineKeyboardMarkup, InlineKeyboardButton

# Загрузка переменных
load_dotenv()
API_TOKEN = os.getenv("BOT_TOKEN")
WEB_APP_URL = "https://lgbrick.github.io/bot_test/"

# Логирование (лучше ставить INFO, чтобы видеть запуск)
logging.basicConfig(level=logging.INFO)

# Инициализация
bot = Bot(token=API_TOKEN)
dp = Dispatcher()


@dp.message(Command("start"))
async def cmd_start(message: types.Message):
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🎮 Играть", web_app=WebAppInfo(url=WEB_APP_URL))]
    ])
    await message.answer("Привет! Жми кнопку ниже, чтобы запустить игры:", reply_markup=kb)


async def main():
    # === ИСПРАВЛЕНИЕ СПАМА ===
    # Эта строчка удаляет все сообщения, накопившиеся пока бот спал
    print("Бот запущен. Старые сообщения игнорируются.")
    await bot.delete_webhook(drop_pending_updates=True)

    # Запуск опроса
    await dp.start_polling(bot)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("Бот выключен")