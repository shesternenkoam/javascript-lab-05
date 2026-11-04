import './style.css';
import { loadAll } from './assets/loader.js';
import { initAudio } from './audio.js';
import { Lobby } from './Lobby.js';
import { connection } from './connection.js';
import { NetGame } from './net/NetGame.js';

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const width = window.innerWidth;
const height = window.innerHeight;
canvas.width = width;
canvas.height = height;

function drawLoadingScreen(progress, text = "Завантаження...") {
  ctx.fillStyle = '#111';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = 'white';
  ctx.font = '24px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(text, width / 2, height / 2 - 40);
  ctx.strokeStyle = 'white';
  ctx.strokeRect(width / 2 - 150, height / 2 - 10, 300, 20);
  ctx.fillStyle = 'green';
  ctx.fillRect(width / 2 - 150, height / 2 - 10, 300 * progress, 20);
}

async function bootstrap(roomData) {
  const abortController = new AbortController();

  const AudioContext = window.AudioContext || window.webkitAudioContext;
  const audioCtx = new AudioContext();

  const game = new NetGame({ canvas, connection });

  try {
    drawLoadingScreen(0, "Ініціалізація...");

    const assets = await loadAll('/src/assets/manifest.json', {
      signal: abortController.signal,
      audioCtx: audioCtx,
      onProgress: (ratio) => drawLoadingScreen(ratio, `Завантаження... ${Math.round(ratio * 100)}%`)
    });

    drawLoadingScreen(1, "Готово! Клікніть для старту");

    window.addEventListener('click', () => {
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }

      initAudio(audioCtx, assets.sounds);
      game.start(assets);
    }, { once: true });

  } catch (error) {
    console.error("Помилка завантаження!", error);
    drawLoadingScreen(0, "Помилка завантаження (див. консоль).");
  }
}

function initLobby() {
  const lobby = new Lobby();
  const uiContainer = document.getElementById('lobby-ui');

  const createButton = document.createElement('button');
  createButton.textContent = 'Створити кімнату';
  createButton.onclick = async () => {
    const name = prompt('Назва кімнати:', `room_${Math.floor(Math.random() * 1000)}`);
    if (!name) return;
    await fetch('/api/rooms', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name }),
    });
    lobby.refresh();
  };
  uiContainer?.appendChild(createButton);

  lobby.addEventListener('join', (e) => {
    const { room, name } = e.detail;
    console.log(`Гравець ${name} увійшов у кімнату ${room}`);

    if (uiContainer) {
      uiContainer.style.display = 'none';
    }

    if (canvas) {
      canvas.style.display = 'block';
    }

    bootstrap(e.detail);
  });

  lobby.start();
}

initLobby();
