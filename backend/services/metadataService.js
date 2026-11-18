const { execFile } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');

const execFilePromise = util.promisify(execFile);

/**
 * Extracts comprehensive video, audio, and subtitle metadata using ffprobe and generates a thumbnail.
 * Supports universal media containers, video codecs, and standalone audio uploads.
 */
async function extractMetadata(mediaPath, projectId, uploadsDir) {
  const thumbnailDir = path.join(uploadsDir, 'thumbnails');
  if (!fs.existsSync(thumbnailDir)) {
    fs.mkdirSync(thumbnailDir, { recursive: true });
  }

  const thumbnailFilename = `${projectId}.jpg`;
  const thumbnailPath = path.join(thumbnailDir, thumbnailFilename);

  let metadata = {
    duration: 0,
    width: 1920,
    height: 1080,
    fps: 30,
    aspectRatio: '16:9',
    format: 'unknown',
    sizeBytes: 0,
    hasVideo: true,
    isAudioOnly: false,
    videoCodec: 'none',
    pixelFormat: 'yuv420p',
    rotation: 0,
    audioTracks: 0,
    audioCodec: 'none',
    channels: 2,
    channelLayout: 'stereo',
    sampleRate: 44100,
    subtitlesCount: 0,
    thumbnail: `/data/uploads/thumbnails/${thumbnailFilename}`
  };

  try {
    const stats = fs.statSync(mediaPath);
    metadata.sizeBytes = stats.size;
  } catch (err) {
    console.error('Failed to stat file:', err.message);
  }

  try {
    const probeArgs = [
      '-v', 'error',
      '-show_entries', 'stream=index,codec_type,codec_name,width,height,avg_frame_rate,channels,sample_rate,channel_layout,pix_fmt:stream_tags=rotate',
      '-show_entries', 'format=duration,format_name,size,bit_rate',
      '-of', 'json',
      mediaPath
    ];
    const { stdout } = await execFilePromise('ffprobe', probeArgs, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
    const data = JSON.parse(stdout);

    if (data.format && data.format.duration) {
      metadata.duration = Math.max(0, parseFloat(data.format.duration));
      metadata.format = data.format.format_name || 'media';
    }

    const streams = Array.isArray(data.streams) ? data.streams : [];
    const videoStream = streams.find(s => s.codec_type === 'video');
    const audioStreams = streams.filter(s => s.codec_type === 'audio');
    const subtitleStreams = streams.filter(s => s.codec_type === 'subtitle');

    metadata.audioTracks = audioStreams.length;
    metadata.subtitlesCount = subtitleStreams.length;

    if (audioStreams.length > 0) {
      const primaryAudio = audioStreams[0];
      metadata.audioCodec = primaryAudio.codec_name || 'aac';
      metadata.channels = parseInt(primaryAudio.channels, 10) || 2;
      metadata.channelLayout = primaryAudio.channel_layout || (metadata.channels === 1 ? 'mono' : 'stereo');
      metadata.sampleRate = parseInt(primaryAudio.sample_rate, 10) || 44100;
    }

    if (videoStream) {
      metadata.hasVideo = true;
      metadata.isAudioOnly = false;
      metadata.videoCodec = videoStream.codec_name || 'h264';
      metadata.pixelFormat = videoStream.pix_fmt || 'yuv420p';

      let rawWidth = parseInt(videoStream.width, 10) || 1920;
      let rawHeight = parseInt(videoStream.height, 10) || 1080;

      // Handle rotation metadata (e.g. smartphone recordings rotated 90/270 deg)
      const rotateTag = videoStream.tags && (videoStream.tags.rotate || videoStream.tags.ROTATION);
      const rotation = rotateTag ? Math.abs(parseInt(rotateTag, 10)) : 0;
      metadata.rotation = rotation;

      if (rotation === 90 || rotation === 270) {
        metadata.width = rawHeight;
        metadata.height = rawWidth;
      } else {
        metadata.width = rawWidth;
        metadata.height = rawHeight;
      }

      if (videoStream.avg_frame_rate && videoStream.avg_frame_rate.includes('/')) {
        const [num, den] = videoStream.avg_frame_rate.split('/').map(Number);
        metadata.fps = den ? Math.round((num / den) * 100) / 100 : 30;
      }

      const ratio = metadata.width / metadata.height;
      if (Math.abs(ratio - 16 / 9) < 0.05) metadata.aspectRatio = '16:9';
      else if (Math.abs(ratio - 9 / 16) < 0.05) metadata.aspectRatio = '9:16';
      else if (Math.abs(ratio - 1) < 0.05) metadata.aspectRatio = '1:1';
      else if (Math.abs(ratio - 4 / 3) < 0.05) metadata.aspectRatio = '4:3';
      else metadata.aspectRatio = `${metadata.width}:${metadata.height}`;
    } else if (audioStreams.length > 0) {
      // Standalone audio upload (MP3, WAV, AAC, FLAC, OGG, OPUS, etc.)
      metadata.hasVideo = false;
      metadata.isAudioOnly = true;
      metadata.width = 1080;
      metadata.height = 1920;
      metadata.fps = 30;
      metadata.aspectRatio = '9:16';
    }
  } catch (error) {
    console.warn(`[${projectId}] ffprobe extraction failed or partially missing:`, error.message);
  }

  // Generate thumbnail: video snapshot or aesthetic dark audio visualizer card
  try {
    if (metadata.hasVideo) {
      const seekTime = metadata.duration > 3 ? Math.min(2, metadata.duration * 0.1) : 0.5;
      const thumbArgs = [
        '-y',
        '-ss', seekTime.toFixed(2),
        '-i', mediaPath,
        '-vframes', '1',
        '-q:v', '2',
        '-vf', 'scale=640:-1',
        thumbnailPath
      ];
      await execFilePromise('ffmpeg', thumbArgs, { timeout: 30000, maxBuffer: 10 * 1024 * 1024 });
    } else {
      // Create clean dark studio thumbnail for standalone audio upload
      const thumbArgs = [
        '-y',
        '-f', 'lavfi',
        '-i', 'color=c=0x0f172a:s=640x360:d=1',
        '-vframes', '1',
        '-q:v', '2',
        thumbnailPath
      ];
      await execFilePromise('ffmpeg', thumbArgs, { timeout: 15000, maxBuffer: 10 * 1024 * 1024 });
    }
  } catch (thumbErr) {
    console.warn(`[${projectId}] Thumbnail generation failed:`, thumbErr.message);
  }

  return metadata;
}

module.exports = {
  extractMetadata
};
