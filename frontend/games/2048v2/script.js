const tg = window.Telegram.WebApp;
tg.ready();
tg.expand();

// === МОДУЛЬ ХРАНЕНИЯ (CloudStorage) ===
const Storage = {
    KEY: '2048_best_score',

    async getBestScore() {
        return new Promise((resolve) => {
            try {
                // Пытаемся взять из облака Telegram
                tg.CloudStorage.getItem(this.KEY, (err, value) => {
                    if (!err && value) {
                        resolve(parseInt(value) || 0);
                    } else {
                        // Если ошибка, берем локально
                        const local = localStorage.getItem(this.KEY);
                        resolve(local ? parseInt(local) : 0);
                    }
                });
            } catch (e) {
                const local = localStorage.getItem(this.KEY);
                resolve(local ? parseInt(local) : 0);
            }
        });
    },

    setBestScore(score) {
        localStorage.setItem(this.KEY, score); // Локально
        try {
            // В облако
            tg.CloudStorage.setItem(this.KEY, score.toString(), (err) => {
                if (err) console.error("Cloud Error:", err);
            });
        } catch (e) {}
    }
};

// === ИГРОВОЙ ДВИЖОК ===
class Game2048 {
    constructor() {
        this.gridSize = 4;
        this.grid = [];
        this.score = 0;
        this.bestScore = 0;

        // DOM Элементы
        this.tileContainer = document.getElementById('tile-container');
        this.scoreEl = document.getElementById('score');
        this.bestScoreEl = document.getElementById('best-score');
        this.gameOverScreen = document.getElementById('game-over-screen');
        this.messageEl = document.getElementById('game-message');

        // Переменные для свайпов
        this.touchStartX = 0;
        this.touchStartY = 0;

        // Привязка кнопок
        document.getElementById('restart-btn').addEventListener('click', () => this.restart());
        document.getElementById('retry-btn').addEventListener('click', () => this.restart());

        this.init();
    }

    async init() {
        this.bestScore = await Storage.getBestScore();
        this.bestScoreEl.innerText = this.bestScore;
        this.setupInput();
        this.restart();
    }

    restart() {
        this.grid = Array(this.gridSize).fill().map(() => Array(this.gridSize).fill(0));
        this.score = 0;
        this.scoreEl.innerText = 0;
        this.gameOverScreen.style.display = 'none';
        this.tileContainer.innerHTML = '';

        this.spawnTile();
        this.spawnTile();
        this.render();
    }

    spawnTile() {
        const emptyCells = [];
        for (let r = 0; r < this.gridSize; r++) {
            for (let c = 0; c < this.gridSize; c++) {
                if (this.grid[r][c] === 0) emptyCells.push({r, c});
            }
        }

        if (emptyCells.length > 0) {
            const {r, c} = emptyCells[Math.floor(Math.random() * emptyCells.length)];
            this.grid[r][c] = Math.random() < 0.9 ? 2 : 4;
            this.render(true, {r, c});
        }
    }

    render(animateNew = false, newPos = null) {
        this.tileContainer.innerHTML = '';
        // Вычисляем размер ячейки динамически
        const containerWidth = document.getElementById('game-container').clientWidth;
        const gap = 10;
        const cellSize = (containerWidth - 5 * gap) / 4;

        for (let r = 0; r < this.gridSize; r++) {
            for (let c = 0; c < this.gridSize; c++) {
                const val = this.grid[r][c];
                if (val > 0) {
                    const tile = document.createElement('div');
                    tile.classList.add('tile', `tile-${val > 2048 ? 2048 : val}`);
                    tile.innerText = val;

                    const top = gap + r * (cellSize + gap);
                    const left = gap + c * (cellSize + gap);

                    tile.style.top = `${top}px`;
                    tile.style.left = `${left}px`;
                    tile.style.width = `${cellSize}px`;
                    tile.style.height = `${cellSize}px`;

                    if (animateNew && newPos && newPos.r === r && newPos.c === c) {
                        tile.classList.add('tile-new');
                    }
                    this.tileContainer.appendChild(tile);
                }
            }
        }
    }

    setupInput() {
        // Клавиатура
        document.addEventListener('keydown', (e) => {
            if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
                e.preventDefault();
                this.move(e.key);
            }
        });

        // Тач события (Свайпы)
        const container = document.getElementById('game-container');

        container.addEventListener('touchstart', (e) => {
            this.touchStartX = e.touches[0].clientX;
            this.touchStartY = e.touches[0].clientY;
        }, {passive: false});

        // Запрет скролла при игре
        container.addEventListener('touchmove', (e) => {
            e.preventDefault();
        }, {passive: false});

        container.addEventListener('touchend', (e) => {
            const touchEndX = e.changedTouches[0].clientX;
            const touchEndY = e.changedTouches[0].clientY;
            this.handleSwipe(touchEndX, touchEndY);
        }, {passive: false});
    }

    handleSwipe(endX, endY) {
        const dx = endX - this.touchStartX;
        const dy = endY - this.touchStartY;

        if (Math.max(Math.abs(dx), Math.abs(dy)) > 30) { // Порог свайпа
            if (Math.abs(dx) > Math.abs(dy)) {
                this.move(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
            } else {
                this.move(dy > 0 ? 'ArrowDown' : 'ArrowUp');
            }
        }
    }

    // Логика перемещения
    move(direction) {
        let rotated = false;
        let moved = false;
        let scoreAdd = 0;

        // Поворачиваем сетку, чтобы всегда сдвигать ВЛЕВО
        if (direction === 'ArrowRight') { this.rotateGrid(2); rotated = true; }
        else if (direction === 'ArrowUp') { this.rotateGrid(3); rotated = true; }
        else if (direction === 'ArrowDown') { this.rotateGrid(1); rotated = true; }

        // Сдвиг влево и слияние
        for (let r = 0; r < this.gridSize; r++) {
            let row = this.grid[r].filter(val => val !== 0);

            for (let i = 0; i < row.length - 1; i++) {
                if (row[i] === row[i+1]) {
                    row[i] *= 2;
                    scoreAdd += row[i];
                    row.splice(i+1, 1);
                }
            }
            while (row.length < this.gridSize) row.push(0);

            if (row.toString() !== this.grid[r].toString()) moved = true;
            this.grid[r] = row;
        }

        // Поворот обратно
        if (rotated) {
            if (direction === 'ArrowRight') this.rotateGrid(2);
            else if (direction === 'ArrowUp') this.rotateGrid(1);
            else if (direction === 'ArrowDown') this.rotateGrid(3);
        }

        if (moved) {
            this.score += scoreAdd;
            this.scoreEl.innerText = this.score;
            if (this.score > this.bestScore) {
                this.bestScore = this.score;
                this.bestScoreEl.innerText = this.bestScore;
                Storage.setBestScore(this.bestScore);
            }

            this.spawnTile();
            this.render();

            if (this.isGameOver()) {
                this.messageEl.innerText = "Игра окончена!";
                this.gameOverScreen.style.display = 'flex';
            }
        }
    }

    rotateGrid(times = 1) {
        for (let t = 0; t < times; t++) {
            const newGrid = Array(this.gridSize).fill().map(() => Array(this.gridSize).fill(0));
            for (let r = 0; r < this.gridSize; r++) {
                for (let c = 0; c < this.gridSize; c++) {
                    newGrid[c][this.gridSize - 1 - r] = this.grid[r][c];
                }
            }
            this.grid = newGrid;
        }
    }

    isGameOver() {
        for(let r=0; r<4; r++)
            for(let c=0; c<4; c++)
                if(this.grid[r][c] === 0) return false;

        for(let r=0; r<4; r++) {
            for(let c=0; c<4; c++) {
                if (c < 3 && this.grid[r][c] === this.grid[r][c+1]) return false;
                if (r < 3 && this.grid[r][c] === this.grid[r+1][c]) return false;
            }
        }
        return true;
    }
}

// Запуск
new Game2048();