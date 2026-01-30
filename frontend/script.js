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

    tg.BackButton.show();
    document.getElementById("game-title-display").innerText = game.title;

    if (game.url) {
        // Добавляем ?v= и текущее время, чтобы ссылка всегда была уникальной
        const cacheBuster = `?v=${Date.now()}`;
        gameContent.innerHTML = `
            <iframe src="${game.url}${cacheBuster}"
                    style="width: 100%; height: 85vh; border: none;">
            </iframe>`;
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