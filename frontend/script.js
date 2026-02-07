document.addEventListener("DOMContentLoaded", () => {
    try {
        const tg = window.Telegram.WebApp;

        if (tg.expand) {
            tg.expand();
        }

        // --- СПИСОК КАТЕГОРИЙ ---
        const CATEGORIES = ["Все", "Популярное", "Головоломки", "Аркады", "Новые"];

        // --- СПИСОК ИГР ---
        // Добавлено поле storageKeys: [] для очистки прогресса
        const games = [
            {
                id: 1,
                title: "Hextris",
                categories: ["Аркады", "Сложные", "Новые"],
                icon: "https://hextris.io/images/touch-icon-iphone-retina.png",
                url: "games/hextris/index.html",
                storageKeys: ['hextris-highscore'] // Пример для Hextris
            },
            {
                id: 2,
                title: "Minesweeper",
                categories: ["Головоломки", "Классика"],
                icon: "https://img.icons8.com/emoji/48/bomb-emoji.png",
                url: "games/minesweeper/index.html",
                storageKeys: [
                    'minesweeper_best_beginner',
                    'minesweeper_best_amateur',
                    'minesweeper_best_expert'
                ]
            },
            {
                id: 3,
                title: "2048 (моя игра)",
                categories: ["Новые", "Головоломки"],
                icon: "https://upload.wikimedia.org/wikipedia/commons/thumb/1/18/2048_logo.svg/1200px-2048_logo.svg.png",
                url: "games/2048v2/index.html",
                // Здесь указываем ключи, которые мы прописали в коде самой игры
                storageKeys: ['2048_best_score_v1', '2048_game_state_v1']
            }
        ];

        // --- DOM ЭЛЕМЕНТЫ ---
        const gamesContainer = document.getElementById("games-container");
        const searchInput = document.getElementById("search-input");
        const categoriesContainer = document.getElementById("categories-container");
        const mainScreen = document.getElementById("main-screen");
        const gameScreen = document.getElementById("game-screen");
        const gameContent = document.getElementById("game-content");
        const gameLoader = document.getElementById("game-loader");

        // Элементы для сброса
        const openResetBtn = document.getElementById("open-reset-btn");
        const resetModal = document.getElementById("reset-modal");
        const resetGamesList = document.getElementById("reset-games-list");
        const selectAllBtn = document.getElementById("select-all-btn");
        const deselectAllBtn = document.getElementById("deselect-all-btn");
        const cancelResetBtn = document.getElementById("cancel-reset-btn");
        const confirmResetBtn = document.getElementById("confirm-reset-btn");

        let activeCategory = "Все";

        function triggerHaptic(type) {
            if (tg.HapticFeedback && tg.HapticFeedback.impactOccurred) {
                tg.HapticFeedback.impactOccurred(type);
            }
        }

        // --- РЕНДЕР КАТЕГОРИЙ ---
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

        // --- РЕНДЕР ИГР ---
        function renderGames(filterText = "") {
            if (!gamesContainer) return;
            gamesContainer.innerHTML = "";

            const filtered = games.filter(game => {
                const matchesSearch = game.title.toLowerCase().includes(filterText.toLowerCase());
                const matchesCategory = activeCategory === "Все" || (game.categories && game.categories.includes(activeCategory));
                return matchesSearch && matchesCategory;
            });

            filtered.forEach((game, index) => {
                const card = document.createElement("div");
                card.className = "game-card";
                card.style.animation = `fadeIn 0.4s ease-out ${index * 0.05}s both`;

                card.innerHTML = `
                    <div class="game-icon" style="background-image: url('${game.icon}')"></div>
                    <div class="game-title">${game.title}</div>
                `;

                card.addEventListener("click", () => openGame(game));
                gamesContainer.appendChild(card);
            });

            if (filtered.length === 0) {
                gamesContainer.innerHTML = `<div style="grid-column: 1/-1; text-align: center; color: var(--tg-theme-hint-color); padding: 20px; font-size: 14px;">В этой категории пока пусто</div>`;
            }
        }

        function openGame(game) {
            triggerHaptic('medium');
            if (mainScreen) mainScreen.style.display = "none";
            if (gameScreen) gameScreen.style.display = "flex";
            if (gameLoader) gameLoader.style.display = "block";
            if (tg.BackButton) tg.BackButton.show();

            if (game.url && gameContent) {
                const iframe = document.createElement('iframe');
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

        if (tg.BackButton) {
            tg.BackButton.onClick(() => {
                triggerHaptic('light');
                if (gameScreen) gameScreen.style.display = "none";
                if (mainScreen) mainScreen.style.display = "block";
                if (gameContent) gameContent.innerHTML = "";
                tg.BackButton.hide();
            });
        }

        if (searchInput) {
            searchInput.addEventListener("input", (e) => {
                renderGames(e.target.value);
            });
        }

        // --- ЛОГИКА СБРОСА ПРОГРЕССА ---

        // Открытие модального окна
        openResetBtn.addEventListener('click', () => {
            triggerHaptic('medium');
            renderResetList();
            resetModal.classList.remove('hidden');
        });

        // Закрытие модального окна
        cancelResetBtn.addEventListener('click', () => {
            resetModal.classList.add('hidden');
        });

        // Рендер списка чекбоксов
        function renderResetList() {
            resetGamesList.innerHTML = '';
            games.forEach(game => {
                if (!game.storageKeys || game.storageKeys.length === 0) return;

                const label = document.createElement('label');
                label.className = 'checkbox-item';
                label.innerHTML = `
                    <input type="checkbox" value="${game.id}">
                    <span>${game.title}</span>
                `;
                resetGamesList.appendChild(label);
            });
        }

        // Кнопки "Выбрать все" / "Снять все"
        selectAllBtn.addEventListener('click', () => {
            document.querySelectorAll('#reset-games-list input[type="checkbox"]').forEach(cb => cb.checked = true);
        });
        deselectAllBtn.addEventListener('click', () => {
            document.querySelectorAll('#reset-games-list input[type="checkbox"]').forEach(cb => cb.checked = false);
        });

        // Основная логика удаления
        confirmResetBtn.addEventListener('click', () => {
            triggerHaptic('heavy');

            const selectedIds = Array.from(document.querySelectorAll('#reset-games-list input[type="checkbox"]:checked'))
                .map(cb => parseInt(cb.value));

            if (selectedIds.length === 0) {
                resetModal.classList.add('hidden');
                return;
            }

            // Находим выбранные игры
            const selectedGames = games.filter(g => selectedIds.includes(g.id));

            // Массив промисов для отслеживания удаления из Cloud
            const cloudPromises = [];

            selectedGames.forEach(game => {
                if (game.storageKeys) {
                    game.storageKeys.forEach(key => {
                        // 1. Удаляем из LocalStorage браузера
                        localStorage.removeItem(key);

                        // 2. Удаляем из CloudStorage Телеграма (если доступен)
                        if (tg.CloudStorage && tg.isVersionAtLeast('6.9')) {
                            const p = new Promise((resolve) => {
                                tg.CloudStorage.removeItem(key, (err, result) => {
                                    // Игнорируем ошибки, просто резолвим, чтобы не висеть
                                    resolve();
                                });
                            });
                            cloudPromises.push(p);
                        }
                    });
                }
            });

            // Ждем завершения всех операций с облаком (или сразу закрываем, если нет облака)
            Promise.all(cloudPromises).then(() => {
                tg.showAlert(`Прогресс сброшен для ${selectedGames.length} игр(ы).`);
                resetModal.classList.add('hidden');
            });
        });


        // --- СТИЛИ АНИМАЦИИ ---
        const styleSheet = document.createElement("style");
        styleSheet.innerText = `
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }`;
        document.head.appendChild(styleSheet);

        // --- СТАРТ ---
        renderCategories();
        renderGames();

    } catch (error) {
        console.error(error);
        const errDiv = document.createElement('div');
        errDiv.style.cssText = "color: red; padding: 20px; background: white; position: fixed; top: 0; left: 0; z-index: 9999;";
        errDiv.innerText = "Error: " + error.message;
        document.body.prepend(errDiv);
    }
});