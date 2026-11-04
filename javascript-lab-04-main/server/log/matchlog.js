import fs from 'node:fs';
import { pipeline } from 'node:stream';
import { Transform } from 'node:stream';
import readline from 'node:readline';


export function readMatchLog(roomName) {
  const filePath = `./logs/${roomName}.ndjson`;
  if (!fs.existsSync(filePath)) {
    console.log('Лог-файл ще не створено.');
    return;
  }

  const fileStream = fs.createReadStream(filePath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity
  });

  console.log(`--- Читання логів кімнати ${roomName} через потік ---`);
  rl.on('line', (line) => {
    const event = JSON.parse(line);
    console.log(`[Подія ${new Date(event.timestamp).toLocaleTimeString()}]:`, event);
  });
}
export class MatchLogTransform extends Transform {
  constructor(options = {}) {
    super({ ...options, objectMode: true });
  }

  _transform(chunk, encoding, callback) {
    try {
      const logLine = JSON.stringify({ timestamp: Date.now(), ...chunk }) + '\n';
      callback(null, logLine);
    } catch (err) {
      callback(err);
    }
  }
}

export function createMatchLogStream(roomName) {
  const logDir = './logs';
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const writableStream = fs.createWriteStream(`${logDir}/${roomName}.ndjson`, { flags: 'a' });
  const transformStream = new MatchLogTransform();

  return {
    write(eventData) {
      transformStream.write(eventData);
    },
    pipeToFile() {
      pipeline(transformStream, writableStream, (err) => {
        if (err) console.error('Помилка стрімінгу логів:', err);
      });
    },
    close() {
      transformStream.end();
    }
  };
}