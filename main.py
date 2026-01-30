import asyncio
import logging
import os  # Импортируем модуль работы с системой
from dotenv import load_dotenv # Импортируем загрузчик
from aiogram import Bot, Dispatcher, types
from aiogram.filters.command import Command
from aiogram.types import WebAppInfo, InlineKeyboardMarkup, InlineKeyboardButton

# 1. Загружаем переменные из файла .env в память
load_dotenv()

# 2. Достаем токен (если файла нет или токена нет, будет ошибка, и это хорошо)
API_TOKEN = os.getenv("BOT_TOKEN")

# ВСТАВЬ СЮДА ССЫЛКУ, КОТОРУЮ ДАЛ GITHUB
WEB_APP_URL = "https://твой-ник.github.io/твой-проект/"

logging.basicConfig(level=logging.INFO)
bot = Bot(token=API_TOKEN)
dp = Dispatcher()


@dp.message(Command("start"))
async def cmd_start(message: types.Message):
    # Создаем кнопку, которая открывает Mini App
    kb = InlineKeyboardMarkup(inline_keyboard=[
        [InlineKeyboardButton(text="🎮 Играть", web_app=WebAppInfo(url=WEB_APP_URL))]
    ])

    await message.answer("Привет! Нажми кнопку, чтобы открыть список игр:", reply_markup=kb)


async def main():
    await dp.start_polling(bot)


if __name__ == "__main__":
    asyncio.run(main())