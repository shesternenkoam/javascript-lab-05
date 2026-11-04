import { connection } from './connection.js';

export class Lobby extends EventTarget {
  constructor(containerElement) {
    super();
    this.container = containerElement || document.getElementById('room-list') || document.querySelector('.lobby');
    this.pollInterval = null;
  }

  async refresh() {
    try {
      const response = await fetch('/api/rooms');
      if (!response.ok) throw new Error('Network response was not ok');
      const rooms = await response.json();
      this.render(rooms);
    } catch (err) {
      console.error('Помилка завантаження лобі:', err);
    }
  }

  render(rooms) {
    if (!this.container) return;

    if (rooms.length === 0) {
      this.container.innerHTML = '<p>Немає активних кімнат. Створіть нову!</p>';
      return;
    }

    this.container.innerHTML = '';

    rooms.forEach(room => {
      const button = document.createElement('button');
      button.className = 'room-button';
      button.textContent = `Увійти: ${room.name} (${room.players} гравців)`;

      button.onclick = () => {
        const playerName = prompt("Введіть ваше ім'я:", "Гравець") || "Anonymous";

        connection.send({
          type: 'join',
          room: room.id,
          name: playerName
        });

        console.log(`Відправлено запит на вхід у ${room.name} як ${playerName}`);
        this.stop();

        this.dispatchEvent(new CustomEvent('join', {
          detail: { room: room.id, name: playerName }
        }));
      };

      this.container.appendChild(button);
    });
  }

  start() {
    this.container.innerHTML = '<p>Завантаження кімнат...</p>';
    this.refresh();
    this.pollInterval = setInterval(() => this.refresh(), 2000);
  }

  stop() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }
}