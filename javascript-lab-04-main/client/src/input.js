export function createInput() {
  const keys = { w: false, a: false, d: false, space: false };
  const alias = { arrowup: 'w', arrowleft: 'a', arrowright: 'd', ' ': 'space' };

  const keyOf = (e) => {
    const k = e.key.toLowerCase();
    return alias[k] ?? k;
  };
  
  const handleKeyDown = (e) => {
    const key = keyOf(e);
    if (keys.hasOwnProperty(key)) {
      keys[key] = true;
      if (key === 'space') e.preventDefault();
    }
  };
  
  const handleKeyUp = (e) => {
    const key = keyOf(e);
    if (keys.hasOwnProperty(key)) keys[key] = false;
  };

  const handleBlur = () => {
    for (let key in keys) keys[key] = false;
  };

  window.addEventListener('keydown', handleKeyDown);
  window.addEventListener('keyup', handleKeyUp);
  window.addEventListener('blur', handleBlur);

  return () => ({ ...keys }); 
}
