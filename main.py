import asyncio
import logging
from aiogram import Bot, Dispatcher, types
from aiogram.filters.command import Command

# Вставь сюда свой токен (в кавычках)
# В реальных крупных проектах токен хранят в отдельном файле .env,
# но для начала можно и так. НО НЕ ПОКАЗЫВАЙ ЭТОТ КОД НИКОМУ!
API_TOKEN = "8097357843:AAEkhMnfooj4BzStyOgA-fa2bj07bcZ-LhQ"

# Включаем логирование, чтобы видеть сообщения в консоли
logging.basicConfig(level=logging.INFO)

# Объект бота и диспетчера
bot = Bot(token=API_TOKEN)
dp = Dispatcher()

# Хэндлер на команду /start
@dp.message(Command("start"))
async def cmd_start(message: types.Message):
    await message.answer("Привет! Я твой бот. Как дела?")

# Хэндлер на любые текстовые сообщения (эхо-бот)
@dp.message()
async def echo_handler(message: types.Message):
    await message.answer(f"Ты написал: {message.text}")

# Запуск процесса поллинга (прослушивания серверов Telegram)
async def main():
    await dp.start_polling(bot)

if __name__ == "__main__":
    asyncio.run(main())
#я дэбил