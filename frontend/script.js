document.addEventListener("DOMContentLoaded", () => {
    // Оборачиваем в try-catch для отлова ошибок на телефоне
    try {
        const tg = window.Telegram.WebApp;

        // Раскрываем приложение на весь экран
        if (tg.expand) {
            tg.expand();
        }

        // --- УБРАНО: tg.enableClosingConfirmation() ---
        // Теперь уведомление при закрытии появляться не будет.

        // --- СПИСОК КАТЕГОРИЙ ---
        // Добавьте сюда любые категории, которые хотите видеть в меню
        const CATEGORIES = ["Все", "Популярное", "Головоломки", "Аркады", "Новые"];

        // --- СПИСОК ИГР ---
        // В поле 'categories' перечисляем через запятую, куда относится игра
        const games = [
            {
                id: 1,
                title: "2048",
                categories: ["Головоломки", "Популярное", "Классика"],
                icon: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/2048_logo.svg/1200px-2048_logo.svg.png",
                url: "games/2048/index.html"
            },
            {
                id: 2,
                title: "Hextris",
                categories: ["Аркады", "Сложные", "Новые"],
                icon: "https://hextris.io/images/touch-icon-iphone-retina.png",
                url: "games/hextris/index.html"
            },
            {
                id: 3,
                title: "Minesweeper",
                categories: ["Головоломки", "Классика"],
                icon: "https://img.icons8.com/emoji/48/bomb-emoji.png",
                url: "games/minesweeper/index.html"
            },
            {
                id: 4,
                title: "2058",
                categories: ["Новые", "Головоломки"],
                icon: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/2048_logo.svg/1200px-2048_logo.svg.png",
                url: "games/2048v2/index.html"
            }
        ];

        // --- ПОЛУЧЕНИЕ ЭЛЕМЕНТОВ DOM ---
        const gamesContainer = document.getElementById("games-container");
        const searchInput = document.getElementById("search-input");
        const categoriesContainer = document.getElementById("categories-container");
        const mainScreen = document.getElementById("main-screen");
        const gameScreen = document.getElementById("game-screen");
        const gameContent = document.getElementById("game-content");
        const gameLoader = document.getElementById("game-loader");

        let activeCategory = "Все";

        // --- ФУНКЦИЯ ВИБРАЦИИ (БЕЗОПАСНАЯ) ---
        function triggerHaptic(type) {
            // Проверяем, поддерживает ли телефон вибрацию, чтобы не было ошибки
            if (tg.HapticFeedback && tg.HapticFeedback.impactOccurred) {
                tg.HapticFeedback.impactOccurred(type);
            }
        }

        // --- ОТРИСОВКА КАТЕГОРИЙ ---
        function renderCategories() {
            if (!categoriesContainer) return;
            categoriesContainer.innerHTML = "";

            CATEGORIES.forEach(cat => {
                const chip = document.createElement("div");
                chip.className = `category-chip ${cat === activeCategory ? 'active' : ''}`;
                chip.innerText = cat;

                chip.addEventListener("click", () => {
                    triggerHaptic('light'); // Легкая вибрация

                    // Переключаем активный класс
                    document.querySelectorAll('.category-chip').forEach(c => c.classList.remove('active'));
                    chip.classList.add('active');

                    activeCategory = cat;
                    // Перерисовываем игры с учетом поиска и новой категории
                    renderGames(searchInput ? searchInput.value : "");
                });

                categoriesContainer.appendChild(chip);
            });
        }

        // --- ОТРИСОВКА ИГР ---
        function renderGames(filterText = "") {
            if (!gamesContainer) return;
            gamesContainer.innerHTML = "";

            const filtered = games.filter(game => {
                // 1. Фильтр по названию
                const matchesSearch = game.title.toLowerCase().includes(filterText.toLowerCase());

                // 2. Фильтр по категориям (множественный выбор)
                // Если "Все" - показываем всё. Иначе проверяем, есть ли выбранная категория в массиве игры.
                const matchesCategory = activeCategory === "Все" || (game.categories && game.categories.includes(activeCategory));

                return matchesSearch && matchesCategory;
            });

            // Создаем карточки
            filtered.forEach((game, index) => {
                const card = document.createElement("div");
                card.className = "game-card";

                // Добавляем плавную анимацию появления каскадом
                card.style.animation = `fadeIn 0.4s ease-out ${index * 0.05}s both`;

                card.innerHTML = `
                    <div class="game-icon" style="background-image: url('${game.icon}')"></div>
                    <div class="game-title">${game.title}</div>
                `;

                card.addEventListener("click", () => openGame(game));
                gamesContainer.appendChild(card);
            });

            // Если ничего не нашли
            if (filtered.length === 0) {
                gamesContainer.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--tg-theme-hint-color); padding: 20px; font-size: 14px;">В этой категории пока пусто</div>`;
            }
        }

        // --- ЗАПУСК ИГРЫ ---
        function openGame(game) {
            triggerHaptic('medium'); // Средняя вибрация

            if (mainScreen) mainScreen.style.display = "none";
            if (gameScreen) gameScreen.style.display = "flex";
            if (gameLoader) gameLoader.style.display = "block"; // Показываем спиннер загрузки

            // Показываем нативную кнопку "Назад"
            if (tg.BackButton) tg.BackButton.show();

            if (game.url && gameContent) {
                const iframe = document.createElement('iframe');
                // Добавляем timestamp, чтобы браузер не кешировал старую версию игры
                iframe.src = `${game.url}?v=${Date.now()}`;

                // Стили для iframe
                iframe.style.width = "100%";
                iframe.style.height = "100%";
                iframe.style.border = "none";
                iframe.allow = "autoplay; fullscreen; vibration; gyroscope; accelerometer";

                // Когда игра загрузилась — убираем спиннер
                iframe.onload = () => {
                    if (gameLoader) gameLoader.style.display = "none";
                };

                gameContent.innerHTML = ""; // Очищаем старое
                gameContent.appendChild(iframe);
            }
        }

        // --- ОБРАБОТКА КНОПКИ "НАЗАД" ---
        if (tg.BackButton) {
            tg.BackButton.onClick(() => {
                triggerHaptic('light');

                if (gameScreen) gameScreen.style.display = "none";
                if (mainScreen) mainScreen.style.display = "block";

                // Важно: очищаем iframe, чтобы остановить звуки и скрипты игры
                if (gameContent) gameContent.innerHTML = "";

                tg.BackButton.hide();
            });
        }

        // --- ЖИВОЙ ПОИСК ---
        if (searchInput) {
            searchInput.addEventListener("input", (e) => {
                renderGames(e.target.value);
            });
        }

        // --- ДОБАВЛЕНИЕ CSS АНИМАЦИИ ---
        const styleSheet = document.createElement("style");
        styleSheet.innerText = `
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }`;
        document.head.appendChild(styleSheet);

        // --- ПЕРВЫЙ ЗАПУСК ---
        renderCategories();
        renderGames();

    } catch (error) {
        // Если всё же произошла критическая ошибка, покажем её на экране
        console.error(error);
        const errDiv = document.createElement('div');
        errDiv.style.cssText = "color: red; padding: 20px; background: white; position: fixed; top: 0; left: 0; z-index: 9999;";
        errDiv.innerText = "Error: " + error.message;
        document.body.prepend(errDiv);
    }
});