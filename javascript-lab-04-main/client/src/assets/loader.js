export async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    const error = new Error(`HTTP Error: ${response.status}`);
    error.status = response.status;
    throw error; 
  }
  return response.json();
}

export async function withRetry(fn, { attempts = 3, baseMs = 100, signal } = {}) {
  let attempt = 0;
  while (attempt < attempts) {
    try {
      return await fn();
    } catch (error) {
      if (signal?.aborted) throw error; 
      

      if (error.status >= 400 && error.status < 500) {
        throw error;
      }
      
      attempt++;
      if (attempt >= attempts) throw error;
      
      const jitter = Math.random() * baseMs;
      const delay = (baseMs * Math.pow(2, attempt - 1)) + jitter;
      
      await new Promise(res => {
        const timeout = setTimeout(res, delay);
        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timeout);
            res();
          }, { once: true });
        }
      });
      if (signal?.aborted) throw error;
    }
  }
}

export function loadImage(src, { signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
    
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => {
      const err = new Error(`Failed to load image: ${src}`);
      err.status = 404; 
      reject(err);
    };
    img.src = src;

    if (signal) {
      signal.addEventListener('abort', () => {
        img.src = ''; 
        reject(new DOMException('Aborted', 'AbortError'));
      }, { once: true });
    }
  });
}

export async function loadAudio(audioCtx, url, { signal } = {}) {
  const response = await fetch(url, { signal });
  if (!response.ok) {
    const error = new Error(`HTTP Error: ${response.status}`);
    error.status = response.status;
    throw error;
  }
  const arrayBuffer = await response.arrayBuffer();
  return audioCtx.decodeAudioData(arrayBuffer);
}

export async function loadAll(manifestUrl, { onProgress, signal, audioCtx } = {}) {
  const manifest = await withRetry(() => fetchJson(manifestUrl, { signal }), { signal });
  
  const promises = [];
  let done = 0;
  let total = 0;
  
  const assets = { sprites: {}, sounds: {}, config: null };

 
  if (manifest.sprites) total += Object.keys(manifest.sprites).length;
  if (manifest.sounds) total += Object.keys(manifest.sounds).length;
  if (manifest.config) total += 1;

  
  const track = (promise) => promise.then(v => {
    done++;
    if (onProgress) onProgress(done / total);
    return v;
  });


  if (manifest.sprites) {
    for (const [key, url] of Object.entries(manifest.sprites)) {
      const p = withRetry(() => loadImage(url, { signal }), { signal })
        .then(img => assets.sprites[key] = img);
      promises.push(track(p));
    }
  }


  if (manifest.sounds && audioCtx) {
    for (const [key, url] of Object.entries(manifest.sounds)) {
      const p = withRetry(() => loadAudio(audioCtx, url, { signal }), { signal })
        .then(buffer => assets.sounds[key] = buffer);
      promises.push(track(p));
    }
  }

  if (manifest.config) {
    const p = withRetry(() => fetchJson(manifest.config, { signal }), { signal })
      .then(cfg => assets.config = cfg);
    promises.push(track(p));
  }


  await Promise.all(promises);
  return assets;
}