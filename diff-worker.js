import { comparePixels } from './compare.js';
self.onmessage = ({ data }) => {
  try {
    const result = comparePixels(data.before, data.after, data.width, data.height, data.threshold);
    self.postMessage({ ok: true, ...result }, [result.pixels.buffer]);
  } catch (error) { self.postMessage({ ok: false, error: error.message }); }
};
