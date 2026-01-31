const tg = window.Telegram.WebApp;
tg.expand(); // Раскрыть на весь экран

// Список игр (это наша база данных)
// url может быть ссылкой на другую страницу или iframe
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
        // ВАЖНО: правильный путь к папке игры
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
    mainScreen.style.display = "none";
    gameScreen.style.display = "block";

    // Показываем кнопку назад
    tg.BackButton.show();

    // (Опционально) Меняем цвет хедера на цвет игры, если нужно
    // tg.setHeaderColor(game.color || "#ffffff");

    if (game.url) {
        // Добавляем ?v= и время для сброса кеша
        const cacheBuster = `?v=${Date.now()}`;

        // Используем 100% высоты без заголовков
        gameContent.innerHTML = `
            <iframe src="${game.url}${cacheBuster}"
                    allow="autoplay; fullscreen; vibration"
                    sandbox="allow-scripts allow-same-origin allow-forms"
            ></iframe>`;
    }
}

// 3. Обработка кнопки "Назад" (которая в шапке Телеграма)
tg.BackButton.onClick(() => {
    gameScreen.style.display = "none";
    mainScreen.style.display = "block";
    gameContent.innerHTML = ""; // Очищаем игру
    tg.BackButton.hide(); // Скрываем кнопку
});

// 4. Слушаем ввод в поиск
searchInput.addEventListener("input", (e) => {
    renderGames(e.target.value);
});

// Запуск при старте
renderGames();