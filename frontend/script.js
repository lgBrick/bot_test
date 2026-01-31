const tg = window.Telegram.WebApp;
tg.expand(); // Раскрыть на весь экран

// Список игр
const games = [
    {
        id: 1,
        title: "2048",
        icon: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/2048_logo.svg/1200px-2048_logo.svg.png",
        url: "games/2048/index.html"
    },
    {
        id: 2,
        title: "Hextris",
        icon: "https://hextris.io/images/touch-icon-iphone-retina.png",
        url: "games/hextris/index.html"
    },
    {
        id: 3,
        title: "Minesweeper",
        icon: "https://img.icons8.com/emoji/48/bomb-emoji.png",
        url: "games/minesweeper/index.html"
    },
    {
        id: 4,
        title: "2058",
        icon: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/2048_logo.svg/1200px-2048_logo.svg.png",
        url: "games/2048v2/index.html"
    }
];

const gamesContainer = document.getElementById("games-container");
const searchInput = document.getElementById("search-input");
const mainScreen = document.getElementById("main-screen");
const gameScreen = document.getElementById("game-screen");
const gameContent = document.getElementById("game-content");

// 1. Функция отрисовки игр
function renderGames(filterText = "") {
    gamesContainer.innerHTML = ""; // Очистить текущий список

    const filteredGames = games.filter(game =>
        game.title.toLowerCase().includes(filterText.toLowerCase())
    );

    filteredGames.forEach(game => {
        const card = document.createElement("div");
        card.className = "game-card";

        // Создаем карточку
        card.innerHTML = `
            <div class="game-icon" style="background-image: url('${game.icon}')"></div>
            <div class="game-title">${game.title}</div>
        `;

        // Клик по игре
        card.addEventListener("click", () => openGame(game));
        gamesContainer.appendChild(card);
    });
}

// 2. Функция открытия игры
function openGame(game) {
    // Переключаем экраны
    mainScreen.style.display = "none";
    gameScreen.style.display = "flex"; // Используем flex для центрирования, если в CSS задано

    // Показываем нативную кнопку "Назад" в Telegram
    tg.BackButton.show();

    if (game.url) {
        // Добавляем ?v=TIME для уникальности ссылки (чтобы не было кеширования старой версии)
        const cacheBuster = `?v=${Date.now()}`;

        // Вставляем iframe.
        // allow="autoplay" нужен для звуков в некоторых играх.
        // style="height: 100%" важен, чтобы игра заняла весь экран.
        gameContent.innerHTML = `
            <iframe
                src="${game.url}${cacheBuster}"
                style="width: 100%; height: 100%; border: none;"
                allow="autoplay; fullscreen; vibration"
            ></iframe>`;
    }
}

// 3. Обработка кнопки "Назад" (в шапке Телеграма)
tg.BackButton.onClick(() => {
    gameScreen.style.display = "none";
    mainScreen.style.display = "block";

    gameContent.innerHTML = ""; // Полностью удаляем игру, чтобы остановить звуки и скрипты
    tg.BackButton.hide(); // Скрываем кнопку
});

// 4. Слушаем ввод в поиск
if (searchInput) {
    searchInput.addEventListener("input", (e) => {
        renderGames(e.target.value);
    });
}

// Запуск при старте
renderGames();