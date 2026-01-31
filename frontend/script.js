document.addEventListener("DOMContentLoaded", () => {
    // Оборачиваем всё в try-catch, чтобы поймать ошибки
    try {
        const tg = window.Telegram.WebApp;

        // Безопасное расширение
        if (tg.expand) {
            tg.expand();
        }

        // Безопасное включение подтверждения закрытия
        if (tg.enableClosingConfirmation) {
            tg.enableClosingConfirmation();
        }

        // Данные
        const CATEGORIES = ["Все", "Головоломки", "Аркады", "Новые"];
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

        // Элементы
        const gamesContainer = document.getElementById("games-container");
        const searchInput = document.getElementById("search-input");
        const categoriesContainer = document.getElementById("categories-container");
        const mainScreen = document.getElementById("main-screen");
        const gameScreen = document.getElementById("game-screen");
        const gameContent = document.getElementById("game-content");
        const gameLoader = document.getElementById("game-loader");

        let activeCategory = "Все";

        // Функция безопасной вибрации
        function triggerHaptic(type) {
            if (tg.HapticFeedback && tg.HapticFeedback.impactOccurred) {
                tg.HapticFeedback.impactOccurred(type);
            }
        }

        // --- КАТЕГОРИИ ---
        function renderCategories() {
            if (!categoriesContainer) return;
            categoriesContainer.innerHTML = "";
            CATEGORIES.forEach(cat => {
                const chip = document.createElement("div");
                chip.className = `category-chip ${cat === activeCategory ? 'active' : ''}`;
                chip.innerText = cat;

                chip.addEventListener("click", () => {
                    triggerHaptic('light');

                    document.querySelectorAll('.category-chip').forEach(c => c.classList.remove('active'));
                    chip.classList.add('active');

                    activeCategory = cat;
                    renderGames(searchInput ? searchInput.value : "");
                });

                categoriesContainer.appendChild(chip);
            });
        }

        // --- ИГРЫ ---
        function renderGames(filterText = "") {
            if (!gamesContainer) return;
            gamesContainer.innerHTML = "";

            const filtered = games.filter(game => {
                const matchesSearch = game.title.toLowerCase().includes(filterText.toLowerCase());
                const matchesCategory = activeCategory === "Все" || game.category === activeCategory;
                return matchesSearch && matchesCategory;
            });

            filtered.forEach((game, index) => {
                const card = document.createElement("div");
                card.className = "game-card";
                // Добавляем задержку анимации инлайн, чтобы не зависеть от внешних CSS классов
                card.style.animation = `fadeIn 0.4s ease-out ${index * 0.05}s both`;

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
            triggerHaptic('medium');

            if (mainScreen) mainScreen.style.display = "none";
            if (gameScreen) gameScreen.style.display = "flex";
            if (gameLoader) gameLoader.style.display = "block";

            if (tg.BackButton) tg.BackButton.show();

            if (game.url && gameContent) {
                const iframe = document.createElement('iframe');
                // Добавляем timestamp, чтобы избежать кеширования
                iframe.src = `${game.url}?v=${Date.now()}`;
                iframe.style.width = "100%";
                iframe.style.height = "100%";
                iframe.style.border = "none";
                iframe.allow = "autoplay; fullscreen; vibration; gyroscope; accelerometer";

                iframe.onload = () => {
                    if (gameLoader) gameLoader.style.display = "none";
                };

                gameContent.innerHTML = "";
                gameContent.appendChild(iframe);
            }
        }

        // --- КНОПКА НАЗАД ---
        if (tg.BackButton) {
            tg.BackButton.onClick(() => {
                triggerHaptic('light');

                if (gameScreen) gameScreen.style.display = "none";
                if (mainScreen) mainScreen.style.display = "block";
                if (gameContent) gameContent.innerHTML = ""; // Очистка iframe
                tg.BackButton.hide();
            });
        }

        // --- ПОИСК ---
        if (searchInput) {
            searchInput.addEventListener("input", (e) => {
                renderGames(e.target.value);
            });
        }

        // Добавляем стиль анимации
        const styleSheet = document.createElement("style");
        styleSheet.innerText = `
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }`;
        document.head.appendChild(styleSheet);

        // Запуск
        renderCategories();
        renderGames();

    } catch (error) {
        // Если произошла ошибка, выводим её на экран, чтобы понять причину
        console.error(error);
        const errDiv = document.createElement('div');
        errDiv.style.color = 'red';
        errDiv.style.padding = '20px';
        errDiv.style.background = 'white';
        errDiv.innerText = "Error: " + error.message;
        document.body.prepend(errDiv);
    }
});