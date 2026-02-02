document.addEventListener('DOMContentLoaded', () => {
    // === 1. ИНИЦИАЛИЗАЦИЯ TELEGRAM ===
    const tg = window.Telegram.WebApp;
    tg.ready();
    if (tg.expand) tg.expand();

    // Haptic Feedback helper
    function haptic(type = 'medium') {
        if (tg.HapticFeedback && tg.HapticFeedback.impactOccurred) {
            tg.HapticFeedback.impactOccurred(type);
        }
    }

    // === 2. ХРАНИЛИЩЕ (Синхронизация Local + Cloud) ===
    const STORAGE_KEY = 'minesweeper_state_v1';
    let cloudStorage = tg.CloudStorage && tg.isVersionAtLeast('6.9') ? tg.CloudStorage : null;

    const StorageManager = {
        saveState(state) {
            const json = JSON.stringify(state);
            // 1. Local
            try { localStorage.setItem(STORAGE_KEY, json); } catch (e) {}
            // 2. Cloud
            if (cloudStorage) {
                cloudStorage.setItem(STORAGE_KEY, json, (err) => {
                    if (err) console.error('Cloud Save Error', err);
                });
            }
        },

        getState(callback) {
            // 1. Check Local first (fastest)
            let localState = null;
            try {
                const s = localStorage.getItem(STORAGE_KEY);
                if (s) localState = JSON.parse(s);
            } catch (e) {}

            // 2. Check Cloud (async)
            if (cloudStorage) {
                cloudStorage.getItem(STORAGE_KEY, (err, val) => {
                    if (!err && val) {
                        try {
                            const cloudState = JSON.parse(val);
                            // Простая логика: если есть в облаке и оно валидно, используем его (или можно сравнивать таймстемп)
                            // Для простоты, если есть облачное сохранение и игра не закончена, берем его
                            if (cloudState && !cloudState.gameOver) {
                                callback(cloudState);
                                return;
                            }
                        } catch (e) {}
                    }
                    // Fallback to local
                    callback(localState);
                });
            } else {
                callback(localState);
            }
        },

        clearState() {
            try { localStorage.removeItem(STORAGE_KEY); } catch(e) {}
            if (cloudStorage) {
                cloudStorage.removeItem(STORAGE_KEY);
            }
        }
    };

    // === 3. ЛОГИКА ИГРЫ ===
    const CONFIG = {
        rows: 10,
        cols: 10,
        mines: 15
    };

    const UI = {
        grid: document.getElementById('grid'),
        minesCount: document.getElementById('mines-count'),
        timer: document.getElementById('timer'),
        faceBtn: document.getElementById('restart-btn'),
        overlay: document.getElementById('result-overlay'),
        resultTitle: document.getElementById('result-title'),
        overlayBtn: document.getElementById('overlay-restart-btn')
    };

    let gameState = {
        grid: [], // Массив объектов ячеек
        gameOver: false,
        gameWon: false,
        timer: 0,
        flags: 0,
        firstMove: true,
        startTime: null
    };

    let timerInterval = null;

    // --- Инициализация ---
    function init() {
        UI.faceBtn.addEventListener('click', startNewGame);
        UI.overlayBtn.addEventListener('click', startNewGame);

        // Настройка сетки CSS
        UI.grid.style.gridTemplateColumns = `repeat(${CONFIG.cols}, 1fr)`;

        // Проверка сохранений
        StorageManager.getState((savedState) => {
            if (savedState && !savedState.gameOver && !savedState.gameWon) {
                restoreGame(savedState);
            } else {
                startNewGame();
            }
        });
    }

    function startNewGame() {
        stopTimer();
        gameState = {
            grid: createEmptyGrid(),
            gameOver: false,
            gameWon: false,
            timer: 0,
            flags: CONFIG.mines,
            firstMove: true,
            startTime: null
        };
        UI.overlay.classList.add('hidden');
        UI.faceBtn.innerText = '🙂';
        updateHeader();
        renderGrid();
        StorageManager.clearState();
    }

    function restoreGame(saved) {
        gameState = saved;
        updateHeader();
        renderGrid();
        startTimer(false); // Продолжить таймер
    }

    function createEmptyGrid() {
        let grid = [];
        for (let y = 0; y < CONFIG.rows; y++) {
            let row = [];
            for (let x = 0; x < CONFIG.cols; x++) {
                row.push({
                    x, y,
                    isMine: false,
                    isOpen: false,
                    isFlagged: false,
                    count: 0
                });
            }
            grid.push(row);
        }
        return grid;
    }

    // Генерация бомб ПОСЛЕ первого клика (чтобы не взорваться сразу)
    function generateMines(safeX, safeY) {
        let minesPlaced = 0;
        while (minesPlaced < CONFIG.mines) {
            let rx = Math.floor(Math.random() * CONFIG.cols);
            let ry = Math.floor(Math.random() * CONFIG.rows);

            // Не ставим бомбу в уже занятую и в радиусе 1 клетки от первого клика
            if (!gameState.grid[ry][rx].isMine) {
                if (Math.abs(rx - safeX) <= 1 && Math.abs(ry - safeY) <= 1) continue;

                gameState.grid[ry][rx].isMine = true;
                minesPlaced++;
            }
        }

        // Подсчет цифр
        for (let y = 0; y < CONFIG.rows; y++) {
            for (let x = 0; x < CONFIG.cols; x++) {
                if (!gameState.grid[y][x].isMine) {
                    gameState.grid[y][x].count = countNeighbors(x, y);
                }
            }
        }
    }

    function countNeighbors(x, y) {
        let count = 0;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                let ny = y + dy, nx = x + dx;
                if (ny >= 0 && ny < CONFIG.rows && nx >= 0 && nx < CONFIG.cols) {
                    if (gameState.grid[ny][nx].isMine) count++;
                }
            }
        }
        return count;
    }

    // --- Таймер ---
    function startTimer(reset = true) {
        if (reset) gameState.timer = 0;
        clearInterval(timerInterval);
        timerInterval = setInterval(() => {
            gameState.timer++;
            UI.timer.innerText = String(gameState.timer).padStart(3, '0');
            // Сохраняем периодически
            if (gameState.timer % 5 === 0) StorageManager.saveState(gameState);
        }, 1000);
    }

    function stopTimer() {
        clearInterval(timerInterval);
    }

    function updateHeader() {
        UI.minesCount.innerText = String(gameState.flags).padStart(3, '0');
        UI.timer.innerText = String(gameState.timer).padStart(3, '0');
    }

    // --- Рендеринг ---
    function renderGrid() {
        UI.grid.innerHTML = '';
        gameState.grid.forEach(row => {
            row.forEach(cell => {
                const el = document.createElement('div');
                el.className = 'cell';
                el.dataset.x = cell.x;
                el.dataset.y = cell.y;

                updateCellVisual(el, cell);
                attachEvents(el, cell);

                UI.grid.appendChild(el);
            });
        });
    }

    function updateCellVisual(el, cell) {
        el.className = 'cell';
        el.innerText = '';

        if (cell.isOpen) {
            el.classList.add('open');
            if (cell.isMine) {
                el.classList.add('mine');
                el.innerText = '💣';
            } else if (cell.count > 0) {
                el.innerText = cell.count;
                el.classList.add(`val-${cell.count}`);
            }
        } else if (cell.isFlagged) {
            el.classList.add('flagged');
            el.innerText = '🚩';
        }
    }

    // --- Управление (Mouse + Touch) ---
    function attachEvents(el, cell) {
        // ПК: Правый клик -> Флаг
        el.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            toggleFlag(cell);
        });

        // ПК: Левый клик -> Открыть
        el.addEventListener('mousedown', (e) => {
            if (e.button === 0) handleInteraction(cell, 'click');
        });

        // Телефон: Touch logic
        let touchTimer = null;
        let isLongPress = false;

        el.addEventListener('touchstart', (e) => {
            if (gameState.gameOver) return;
            isLongPress = false;

            // Запуск таймера для Long Press
            touchTimer = setTimeout(() => {
                isLongPress = true;
                haptic('medium'); // Вибрация
                toggleFlag(cell);
            }, 500); // 500мс для удержания
        }, { passive: false });

        el.addEventListener('touchend', (e) => {
            // Если отпустили раньше 500мс -> это обычный клик
            clearTimeout(touchTimer);
            if (!isLongPress) {
                // Предотвращаем двойной клик (эмуляцию мыши)
                e.preventDefault();
                handleInteraction(cell, 'click');
            }
        });

        el.addEventListener('touchmove', () => {
            // Если палец сдвинулся, отменяем действия
            clearTimeout(touchTimer);
            isLongPress = true; // Блокируем клик
        });
    }

    function handleInteraction(cell, type) {
        if (gameState.gameOver || gameState.gameWon) return;

        if (type === 'click') {
            openCell(cell.x, cell.y);
        }
    }

    // --- Действия игры ---
    function toggleFlag(cell) {
        if (gameState.gameOver || cell.isOpen) return;

        if (!cell.isFlagged && gameState.flags > 0) {
            cell.isFlagged = true;
            gameState.flags--;
        } else if (cell.isFlagged) {
            cell.isFlagged = false;
            gameState.flags++;
        }

        updateHeader();
        // Находим элемент в DOM и обновляем только его
        const el = document.querySelector(`.cell[data-x="${cell.x}"][data-y="${cell.y}"]`);
        if (el) updateCellVisual(el, cell);

        StorageManager.saveState(gameState);
    }

    function openCell(x, y) {
        const cell = gameState.grid[y][x];
        if (cell.isOpen || cell.isFlagged) return;

        // Первый ход
        if (gameState.firstMove) {
            gameState.firstMove = false;
            startTimer(true);
            generateMines(x, y);
        }

        cell.isOpen = true;

        if (cell.isMine) {
            // Поражение
            gameOver(false);
        } else if (cell.count === 0) {
            // Flood Fill
            floodFill(x, y);
        }

        // Обновляем визуализацию
        const el = document.querySelector(`.cell[data-x="${x}"][data-y="${y}"]`);
        if (el) updateCellVisual(el, cell);

        checkWin();
        StorageManager.saveState(gameState);
    }

    function floodFill(x, y) {
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                let ny = y + dy, nx = x + dx;
                if (ny >= 0 && ny < CONFIG.rows && nx >= 0 && nx < CONFIG.cols) {
                    const neighbor = gameState.grid[ny][nx];
                    if (!neighbor.isOpen && !neighbor.isMine) {
                        openCell(nx, ny);
                    }
                }
            }
        }
    }

    function checkWin() {
        if (gameState.gameOver) return;
        let openCount = 0;
        gameState.grid.forEach(row => row.forEach(c => {
            if (c.isOpen) openCount++;
        }));

        const totalCells = CONFIG.rows * CONFIG.cols;
        if (openCount === totalCells - CONFIG.mines) {
            gameOver(true);
        }
    }

    function gameOver(win) {
        gameState.gameOver = true;
        gameState.gameWon = win;
        stopTimer();

        UI.faceBtn.innerText = win ? '😎' : '😵';

        // Показать все мины при поражении
        if (!win) {
            gameState.grid.forEach(row => row.forEach(c => {
                if (c.isMine) {
                    c.isOpen = true;
                    const el = document.querySelector(`.cell[data-x="${c.x}"][data-y="${c.y}"]`);
                    if (el) updateCellVisual(el, c);
                }
            }));
            haptic('error');
        } else {
            haptic('success');
        }

        // Удаляем сохранение
        StorageManager.clearState();

        // Показать оверлей через небольшую паузу
        setTimeout(() => {
            UI.resultTitle.innerText = win ? 'Победа!' : 'Взрыв!';
            UI.overlay.classList.remove('hidden');
        }, 1000);
    }


    // Запуск
    init();
});