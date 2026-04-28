// ffmpeg_lib.js — Extract frames from video URLs using FFmpeg
// Uses ffmpeg/ffprobe from system PATH (apt-installed in Docker, Homebrew on macOS)

const { spawn } = require('child_process');

const FFMPEG  = process.env.FFMPEG_PATH  || 'ffmpeg';
const FFPROBE = process.env.FFPROBE_PATH || 'ffprobe';

/**
 * Get the duration of a video in seconds via ffprobe.
 * Works directly on a URL (Dropbox temp link) — no download needed.
 */
function getVideoDuration(url) {
  return new Promise((resolve, reject) => {
    const proc = spawn(FFPROBE, [
      '-v', 'quiet',
      '-show_entries', 'format=duration',
      '-of', 'csv=p=0',
      url,
    ]);
    let output = '';
    proc.stdout.on('data', d => { output += d.toString(); });
    proc.stderr.on('data', () => {}); // suppress
    proc.on('close', () => {
      const dur = parseFloat(output.trim());
      if (!isNaN(dur) && dur > 0) resolve(dur);
      else reject(new Error('Could not determine video duration'));
    });
    proc.on('error', reject);
  });
}

/**
 * Extract a single JPEG frame at a specific timestamp (seconds).
 * Uses fast seek (-ss before -i) — accurate enough for thumbnails.
 * Returns a Buffer containing JPEG data.
 */
function extractFrame(url, timestamp) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const proc = spawn(FFMPEG, [
      '-ss', timestamp.toFixed(2),
      '-i', url,
      '-frames:v', '1',
      '-vf', 'scale=960:540:force_original_aspect_ratio=decrease,pad=960:540:(ow-iw)/2:(oh-ih)/2',
      '-f', 'image2pipe',
      '-vcodec', 'mjpeg',
      '-q:v', '3', // quality 1-31, lower = better
      'pipe:1',
    ]);
    proc.stdout.on('data', chunk => { chunks.push(chunk); });
    proc.stderr.on('data', () => {}); // suppress ffmpeg progress output
    proc.on('close', code => {
      const buf = Buffer.concat(chunks);
      if (buf.length > 0) resolve(buf);
      else reject(new Error(`No frame data at ${timestamp.toFixed(1)}s`));
    });
    proc.on('error', reject);
  });
}

/**
 * Extract N frames from a video URL at evenly-spaced percentage positions.
 * Percentages avoid the very start/end to skip title cards and black frames.
 *
 * @param {string} url     - Direct video URL (Dropbox temp link)
 * @param {number} count   - Number of frames to extract (default: 4)
 * @returns {Promise<Buffer[]>} - Array of JPEG buffers (may be fewer than count if some fail)
 */
async function extractVideoFrames(url, count = 4) {
  const duration = await getVideoDuration(url);

  // Spread across the video, avoiding first/last 10%
  const positions = [0.15, 0.35, 0.60, 0.85].slice(0, count);
  const timestamps = positions.map(p => p * duration);

  console.log(`[FFmpeg] Extracting ${timestamps.length} frames from ${duration.toFixed(1)}s video`);

  // Extract frames in parallel — fast for 5-20MB files
  const results = await Promise.allSettled(
    timestamps.map(t => extractFrame(url, t))
  );

  const frames = results
    .filter(r => r.status === 'fulfilled')
    .map(r => r.value);

  console.log(`[FFmpeg] Got ${frames.length}/${timestamps.length} frames`);
  return frames;
}

module.exports = { extractVideoFrames };
