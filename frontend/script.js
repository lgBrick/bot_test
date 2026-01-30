const tg = window.Telegram.WebApp;
tg.expand(); // Раскрыть на весь экран

// Список игр (это наша база данных)
// url может быть ссылкой на другую страницу или iframe
const games = [
    { id: 1, title: "Кликер Монет", icon: "https://cdn-icons-png.flaticon.com/512/1685/1685956.png", type: "clicker" },
    { id: 2, title: "Космо-гонки", icon: "https://cdn-icons-png.flaticon.com/512/3063/3063778.png", type: "race" },
    { id: 3, title: "2048", icon: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/2048_logo.svg/1200px-2048_logo.svg.png", url: "https://play2048.co/" },
    { id: 4, title: "Динозаврик", icon: "https://cdn-icons-png.flaticon.com/512/7070/7070498.png", type: "dino" }
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
    gameScreen.style.display = "flex";

    // Показываем кнопку "Назад" в интерфейсе Телеграма
    tg.BackButton.show();

    document.getElementById("game-title-display").innerText = game.title;

    // ЛОГИКА ЗАПУСКА ИГРЫ
    if (game.url) {
        // Если это внешняя ссылка (например 2048), открываем в iframe
        gameContent.innerHTML = `<iframe src="${game.url}" width="100%" height="500px" style="border:none;"></iframe>`;
    } else {
        // Если игры нет, просто заглушка
        gameContent.innerHTML = `<p>Тут должна быть игра "${game.title}".<br>Пока это просто демо.</p>`;
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