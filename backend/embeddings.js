// embeddings.js — Local semantic embedding using all-MiniLM-L6-v2
// Uses @xenova/transformers (ESM) via dynamic import() for CJS compatibility.
// The model (~23MB) is downloaded once and cached in ./model_cache.

const path = require('path');

let _model = null;
let _loadPromise = null;

async function loadModel() {
  if (_model) return _model;
  if (_loadPromise) return _loadPromise;

  _loadPromise = (async () => {
    console.log('[Embeddings] Loading all-MiniLM-L6-v2 (first run downloads ~23MB)...');
    const { pipeline, env } = await import('@xenova/transformers');
    env.cacheDir = path.join(__dirname, 'model_cache');
    env.allowLocalModels = false; // always use HuggingFace hub

    _model = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
      quantized: true, // smaller, faster, same quality for sentence similarity
    });
    console.log('[Embeddings] Model ready ✓');
    return _model;
  })();

  return _loadPromise;
}

/**
 * Compute a normalized 384-dim embedding for a single string.
 * Returns a plain JS number array (so it can be JSON-serialized for SQLite).
 */
async function computeEmbedding(text) {
  const model = await loadModel();
  const output = await model(text.slice(0, 512), { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

/**
 * Cosine similarity between two normalized vectors.
 * Since we use normalize:true, both vectors are unit-length → dot product = cosine similarity.
 */
function cosineSimilarity(a, b) {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}

// Start warming up the model in the background when this module loads
loadModel().catch(err => console.error('[Embeddings] Model load failed:', err.message));

module.exports = { computeEmbedding, cosineSimilarity, loadModel };
