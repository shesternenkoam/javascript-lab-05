import { EventEmitter } from 'node:events';
import { createMatchLogStream } from './log/matchlog.js';
import { Match } from './match.js';

export class Room extends EventEmitter {
  constructor(id) {
    super();
    this.id = id;
    this.players = new Map();
    this.logger = createMatchLogStream(id);
    this.logger.pipeToFile();
    this.match = new Match(this);
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map();
  }

  create(id) {
    if (this.rooms.has(id)) return this.rooms.get(id);
    const room = new Room(id);
    this.rooms.set(id, room);

    room.logger.write({ event: 'room_created', roomId: id });

    room.on('join', (player) => {
      room.logger.write({ event: 'player_joined', player: player.name });
    });

    room.once("empty", () => {
      room.match.stop();
      room.logger.write({ event: 'room_empty_destroyed' });
      room.logger.close();
      this.rooms.delete(id);
    });

    return room;
  }

  get(id) {
    return this.rooms.get(id);
  }

  stats() {
    return Array.from(this.rooms.values()).map((room) => room.match.summary());
  }

  list() {
    return Array.from(this.rooms.values()).map(room => ({
      id: room.id,
      name: room.id,
      players: room.players.size
    }));
  }
}

export const roomManager = new RoomManager();