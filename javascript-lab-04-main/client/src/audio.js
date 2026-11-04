import { eventBus } from './events.js';

let audioCtx = null;
let buffers = {};

export function initAudio(context, loadedBuffers) {
  audioCtx = context;
  buffers = loadedBuffers;
  eventBus.addEventListener('fired', () => playSound('shoot'));
}

function playSound(name) {
  if (!audioCtx || !buffers[name]) return;
  const source = audioCtx.createBufferSource();
  source.buffer = buffers[name];
  source.connect(audioCtx.destination);
  source.start(0);
}