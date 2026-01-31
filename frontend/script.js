const tg = window.Telegram.WebApp;
tg.expand();
tg.enableClosingConfirmation(); // Спрашивать подтверждение при закрытии

// Определяем категории (автоматически или вручную)
const CATEGORIES = ["Все", "Головоломки", "Аркады", "Новые"];

// Список игр (Добавил поле category)
const games = [
    {
        id: 1,
        title: "2048",
        category: "Головоломки",
        icon: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/2048_logo.svg/1200px-2048_logo.svg.png",
        url: "games/2048/index.html"
    },
    {
        id: 2,
        title: "Hextris",
        category: "Аркады",
        icon: "https://hextris.io/images/touch-icon-iphone-retina.png",
        url: "games/hextris/index.html"
    },
    {
        id: 3,
        title: "Minesweeper",
        category: "Головоломки",
        icon: "https://img.icons8.com/emoji/48/bomb-emoji.png",
        url: "games/minesweeper/index.html"
    },
    {
        id: 4,
        title: "2058",
        category: "Новые",
        icon: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/2048_logo.svg/1200px-2048_logo.svg.png",
        url: "games/2048v2/index.html"
    }
];

const gamesContainer = document.getElementById("games-container");
const searchInput = document.getElementById("search-input");
const categoriesContainer = document.getElementById("categories-container");
const mainScreen = document.getElementById("main-screen");
const gameScreen = document.getElementById("game-screen");
const gameContent = document.getElementById("game-content");
const gameLoader = document.getElementById("game-loader");

let activeCategory = "Все";

// --- ИНИЦИАЛИЗАЦИЯ ---

function init() {
    renderCategories();
    renderGames();
}

// --- КАТЕГОРИИ ---

function renderCategories() {
    categoriesContainer.innerHTML = "";
    CATEGORIES.forEach(cat => {
        const chip = document.createElement("div");
        chip.className = `category-chip ${cat === activeCategory ? 'active' : ''}`;
        chip.innerText = cat;

        chip.addEventListener("click", () => {
            // Вибрация при смене категории
            tg.HapticFeedback.impactOccurred('light');

            // Обновляем UI
            document.querySelectorAll('.category-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');

            activeCategory = cat;
            renderGames(searchInput.value);
        });

        categoriesContainer.appendChild(chip);
    });
}

// --- ОТРИСОВКА ИГР ---

function renderGames(filterText = "") {
    gamesContainer.innerHTML = "";

    const filtered = games.filter(game => {
        const matchesSearch = game.title.toLowerCase().includes(filterText.toLowerCase());
        const matchesCategory = activeCategory === "Все" || game.category === activeCategory;
        return matchesSearch && matchesCategory;
    });

    // Анимация появления (постепенная)
    filtered.forEach((game, index) => {
        const card = document.createElement("div");
        card.className = "game-card";
        card.style.animation = `fadeIn 0.3s ease-out ${index * 0.05}s both`; // Каскадная анимация

        card.innerHTML = `
            <div class="game-icon" style="background-image: url('${game.icon}')"></div>
            <div class="game-title">${game.title}</div>
        `;

        card.addEventListener("click", () => openGame(game));
        gamesContainer.appendChild(card);
    });

    if (filtered.length === 0) {
        gamesContainer.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--tg-theme-hint-color); padding: 20px;">Ничего не найдено</div>`;
    }
}

// --- ОТКРЫТИЕ ИГРЫ ---

function openGame(game) {
    // Сильная вибрация при запуске
    tg.HapticFeedback.impactOccurred('medium');

    mainScreen.style.display = "none";
    gameScreen.style.display = "flex";
    gameLoader.style.display = "block"; // Показать спиннер
    tg.BackButton.show();

    if (game.url) {
        const iframe = document.createElement('iframe');
        iframe.src = `${game.url}?v=${Date.now()}`;
        iframe.style.width = "100%";
        iframe.style.height = "100%";
        iframe.style.border = "none";
        iframe.allow = "autoplay; fullscreen; vibration; gyroscope; accelerometer";

        // Убираем лоадер когда iframe загрузился
        iframe.onload = () => {
            gameLoader.style.display = "none";
        };

        gameContent.innerHTML = "";
        gameContent.appendChild(iframe);
    }
}

// --- ОБРАБОТЧИКИ СОБЫТИЙ ---

tg.BackButton.onClick(() => {
    tg.HapticFeedback.impactOccurred('light');

    gameScreen.style.display = "none";
    mainScreen.style.display = "block";
    gameContent.innerHTML = "";
    tg.BackButton.hide();
});

if (searchInput) {
    searchInput.addEventListener("input", (e) => {
        renderGames(e.target.value);
    });
}

// Добавляем стиль для анимации в JS динамически (или можно в CSS)
const styleSheet = document.createElement("style");
styleSheet.innerText = `
@keyframes fadeIn {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
}`;
document.head.appendChild(styleSheet);

// Запуск
init();