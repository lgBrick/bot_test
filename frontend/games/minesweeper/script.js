document.addEventListener('DOMContentLoaded', () => {
    const tg = window.Telegram.WebApp;
    tg.ready();
    tg.expand();

    const RECORDS_KEY = 'ms_recs_v3';
    let records = { beginner: null, amateur: null, expert: null };

    // --- СИНХРОНИЗАЦИЯ РЕКОРДОВ ---
    const loadRecords = async () => {
        // Загрузка из локала
        const local = localStorage.getItem(RECORDS_KEY);
        if (local) records = JSON.parse(local);

        // Загрузка из облака
        if (tg.CloudStorage) {
            tg.CloudStorage.getItem(RECORDS_KEY, (err, val) => {
                if (!err && val) {
                    const cloud = JSON.parse(val);
                    Object.keys(records).forEach(k => {
                        if (!records[k] || (cloud[k] && cloud[k] < records[k])) {
                            records[k] = cloud[k];
                        }
                    });
                    saveRecordsLocally();
                    updateMenuScores();
                }
            });
        }
    };

    const saveRecord = async (mode, time) => {
        if (!records[mode] || time < records[mode]) {
            records[mode] = time;
            saveRecordsLocally();
            if (tg.CloudStorage) {
                tg.CloudStorage.setItem(RECORDS_KEY, JSON.stringify(records));
            }
            return true;
        }
        return false;
    };

    const saveRecordsLocally = () => localStorage.setItem(RECORDS_KEY, JSON.stringify(records));

    // --- ЛОГИКА ИГРЫ ---
    let board = [];
    let state = {
        gameOver: false,
        firstMove: true,
        startTime: null,
        timerInt: null,
        mode: null,
        config: {}
    };

    // Генерация без угадывания (упрощенная проверка)
    const generateSafeBoard = (safeX, safeY) => {
        let minesPlaced = 0;
        const { rows, cols, mines } = state.config;

        while (minesPlaced < mines) {
            const rx = Math.floor(Math.random() * cols);
            const ry = Math.floor(Math.random() * rows);

            // Зона 3х3 вокруг первого клика всегда пуста
            if (!board[ry][rx].isMine && (Math.abs(rx - safeX) > 1 || Math.abs(ry - safeY) > 1)) {
                board[ry][rx].isMine = true;
                minesPlaced++;
            }
        }

        // Вычисление цифр
        for(let y=0; y<rows; y++) {
            for(let x=0; x<cols; x++) {
                if(board[y][x].isMine) continue;
                board[y][x].count = getNeighbors(x, y).filter(n => n.isMine).length;
            }
        }
    };

    const getNeighbors = (x, y) => {
        const n = [];
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
                if (dx === 0 && dy === 0) continue;
                const ny = y + dy, nx = x + dx;
                if (ny >= 0 && ny < state.config.rows && nx >= 0 && nx < state.config.cols) {
                    n.push(board[ny][nx]);
                }
            }
        }
        return n;
    };

    // ФУНКЦИЯ CHORD (Раскрытие по цифре)
    const handleChord = (x, y) => {
        const cell = board[y][x];
        if (!cell.isOpen || cell.count === 0) return;

        const neighbors = getNeighbors(x, y);
        const flags = neighbors.filter(n => n.isFlagged).length;

        if (flags === cell.count) {
            neighbors.forEach(n => {
                if (!n.isFlagged && !n.isOpen) openCell(n.x, n.y);
            });
        }
    };

    const openCell = (x, y) => {
        if (state.gameOver) return;
        const cell = board[y][x];
        if (cell.isOpen || cell.isFlagged) return;

        if (state.firstMove) {
            state.firstMove = false;
            generateSafeBoard(x, y);
            startTimer();
        }

        cell.isOpen = true;
        if (cell.isMine) return endGame(false, x, y);

        if (cell.count === 0) {
            getNeighbors(x, y).forEach(n => openCell(n.x, n.y));
        }

        render();
        checkWin();
    };

    const endGame = (win, hitX, hitY) => {
        state.gameOver = true;
        clearInterval(state.timerInt);
        const finalTime = Date.now() - state.startTime;

        if (!win) {
            tg.HapticFeedback.notificationOccurred('error');
            // Анимация показа мин
            board.flat().forEach((c, i) => {
                setTimeout(() => {
                    if (c.isMine) {
                        const el = document.querySelector(`[data-x="${c.x}"][data-y="${c.y}"]`);
                        el.classList.add('open', c.x === hitX && c.y === hitY ? 'mine-hit' : 'mine-reveal');
                        el.innerHTML = '💣';
                    } else if (c.isFlagged) {
                        document.querySelector(`[data-x="${c.x}"][data-y="${c.y}"]`).classList.add('wrong-flag');
                    }
                }, i * 10); // Плавное появление
            });
        } else {
            tg.HapticFeedback.notificationOccurred('success');
            saveRecord(state.mode, finalTime);
        }

        showOverlay(win, finalTime);
    };

    // --- ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ---
    const formatTime = (ms) => {
        const m = Math.floor(ms / 60000);
        const s = Math.floor((ms % 60000) / 1000);
        const ms_part = Math.floor((ms % 1000) / 10);
        return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}:${String(ms_part).padStart(2,'0')}`;
    };

    const startTimer = () => {
        state.startTime = Date.now();
        state.timerInt = setInterval(() => {
            document.getElementById('timer').innerText = formatTime(Date.now() - state.startTime);
        }, 40);
    };

    // Слушатели для Chord и кликов
    const render = () => {
        // Оптимизированное обновление DOM
        board.flat().forEach(c => {
            const el = document.querySelector(`[data-x="${c.x}"][data-y="${c.y}"]`);
            if (c.isOpen && !el.classList.contains('open')) {
                el.classList.add('open');
                if (!c.isMine && c.count > 0) {
                    el.innerText = c.count;
                    el.style.color = `var(--val-${c.count})`; // Добавить цвета в CSS
                }
            }
        });
    };

    // Инициализация
    loadRecords();
    // ... (Остальной код привязки событий аналогичен вашему, с добавлением вызова handleChord на клик по открытой ячейке)
});