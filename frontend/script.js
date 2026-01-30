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
        title: "Tower Blocks",
        icon: "https://cdn-icons-png.flaticon.com/512/3655/3655682.png",
        url: "games/tower/index.html"
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
    gameScreen.style.display = "block"; // Поменяли flex на block для корректного iframe

    tg.BackButton.show();
    document.getElementById("game-title-display").innerText = game.title;

    if (game.url) {
        // Добавляем атрибуты для лучшей работы на мобильных
        gameContent.innerHTML = `
            <iframe src="${game.url}"
                    style="width: 100%; height: 85vh; border: none;"
                    allow="accelerometer; gyroscope; payment">
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