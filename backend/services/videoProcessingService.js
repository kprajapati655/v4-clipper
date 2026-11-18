const { execFile } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');
const {
  segmentsToSrt,
  wordsToTwoWordSrt,
  generateWordSynchronizedAss,
  generateTwoWordChunks
} = require('./transcriptionService');

const execFilePromise = util.promisify(execFile);

const FONTS_DIR = process.env.FONTS_DIR || '/data/data/com.termux/files/usr/share/fonts/TTF';

/**
 * Renders a vertical 9:16, 1:1, or 16:9 short clip with burned-in subtitles and official V4 watermark.
 *
 * Watermark Specifications (Mandatory & Non-Negotiable):
 * - Text strictly: 'V4' (never 'V4 Clipper')
 * - Position: Fixed Top-Right (x=w-tw-(w*0.03), y=h*0.03)
 * - Typography: Subtle, clean, transparent white (white@0.38)
 * - Visibility: Continuous throughout entire clip
 */
async function renderClip({
  videoPath,
  clip,
  project = {},
  outputDir,
  options = {}
}) {
  if (!fs.existsSync(videoPath)) {
    throw new Error(`Source video not found: ${videoPath}`);
  }

  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const allowedResolutions = ['720x1280', '1080x1920'];
  const safeResolution = allowedResolutions.includes(options.resolution) ? options.resolution : '720x1280';

  const allowedAspectRatios = ['9:16', '1:1', '16:9'];
  const safeAspectRatio = allowedAspectRatios.includes(options.aspectRatio) ? options.aspectRatio : '9:16';

  const allowedCropPositions = ['center', 'left', 'right', 'blur_background'];
  const safeCropPosition = allowedCropPositions.includes(options.cropPosition) ? options.cropPosition : 'center';

  const allowedSubtitleStyles = ['clean_white', 'highlighted', 'minimal', 'bold_creator'];
  const safeSubtitleStyle = allowedSubtitleStyles.includes(options.subtitleStyle) ? options.subtitleStyle : 'clean_white';

  const allowedAlignments = ['bottom', 'middle', 'top'];
  const safeAlignment = allowedAlignments.includes(options.customAlignment) ? options.customAlignment : 'bottom';

  const safeFontSize = Math.min(48, Math.max(10, parseInt(options.customFontSize, 10) || 19));
  const burnSubtitles = options.burnSubtitles !== false;

  const [targetWidth, targetHeight] = safeResolution.split('x').map(Number);
  const start = Math.max(0, parseFloat(clip.start) || 0);
  const end = Math.min(project.duration || 999999, parseFloat(clip.end) || (start + 1));
  const clipDuration = Math.max(0.5, end - start);

  const cleanTitle = (clip.title || 'clip').toLowerCase().replace(/[^\w-]/g, '_').slice(0, 40);
  const safeClipId = String(clip.id || 'clip').replace(/[^\w-]/g, '_');
  const outputFileName = `clip_${safeClipId.slice(0, 8)}_${cleanTitle}.mp4`;
  const srtFileName = `clip_${safeClipId.slice(0, 8)}_${cleanTitle}.srt`;

  const outputPath = path.join(outputDir, outputFileName);
  const srtPath = path.join(outputDir, srtFileName);

  // Standalone clip SRT file generation (compact ~2-word synchronized display)
  const clipSegments = clip.segments && clip.segments.length > 0
    ? clip.segments
    : (project.transcript || []).filter(s => s.end > start && s.start < end);

  const srtContent = wordsToTwoWordSrt(clipSegments, start);
  fs.writeFileSync(srtPath, srtContent, 'utf8');

  // Build FFmpeg video filter graph
  const filterParts = [];

  // 1. Aspect Ratio & Framing Filter
  if (safeAspectRatio === '9:16') {
    if (safeCropPosition === 'blur_background') {
      // Blurred background for landscape source inside vertical 9:16 frame
      filterParts.push(
        `split=2[bg_in][fg_in];` +
        `[bg_in]scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase,crop=${targetWidth}:${targetHeight},boxblur=20:20[bg];` +
        `[fg_in]scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=decrease[fg];` +
        `[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1`
      );
    } else {
      let cropX = `(iw-${targetWidth})/2`;
      if (safeCropPosition === 'left') cropX = '0';
      else if (safeCropPosition === 'right') cropX = `iw-${targetWidth}`;

      filterParts.push(
        `scale=${targetWidth}:${targetHeight}:force_original_aspect_ratio=increase,` +
        `crop=${targetWidth}:${targetHeight}:${cropX}:(ih-${targetHeight})/2,` +
        `setsar=1`
      );
    }
  } else if (safeAspectRatio === '1:1') {
    const squareSize = Math.min(targetWidth, targetHeight);
    filterParts.push(
      `scale=${squareSize}:${squareSize}:force_original_aspect_ratio=increase,` +
      `crop=${squareSize}:${squareSize}:(iw-${squareSize})/2:(ih-${squareSize})/2,` +
      `setsar=1`
    );
  } else {
    // 16:9 Fit
    filterParts.push(
      `scale='min(${targetWidth},iw)':-2,` +
      `setsar=1`
    );
  }

  // 2. Subtitle Filter (Burn-in via word-synchronized ASS)
  let tempSubPath = null;
  if (burnSubtitles && clipSegments.length > 0) {
    const tempDir = path.join(outputDir, '../temp');
    if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });

    tempSubPath = path.join(tempDir, `temp_${safeClipId}.ass`);
    const assContent = generateWordSynchronizedAss(clipSegments, start, {
      resolution: safeResolution,
      subtitleStyle: safeSubtitleStyle,
      customAlignment: safeAlignment,
      customFontSize: safeFontSize,
      customFontColor: options.customFontColor
    });
    fs.writeFileSync(tempSubPath, assContent, 'utf8');

    let fontOpt = '';
    if (fs.existsSync(FONTS_DIR)) {
      fontOpt = `:fontsdir='${FONTS_DIR}'`;
    }

    const escapedSubPath = tempSubPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''");
    filterParts.push(`subtitles='${escapedSubPath}'${fontOpt}`);
  }

  // 3. Official V4 Watermark Filter (Strict Non-Negotiable Top-Right Position)
  let watermarkFontOpt = '';
  const fontFile = path.join(FONTS_DIR, 'DejaVuSans-Bold.ttf');
  if (fs.existsSync(fontFile)) {
    const escapedFontFile = fontFile.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''");
    watermarkFontOpt = `:fontfile='${escapedFontFile}'`;
  }

  // Top-Right: x = right margin (3%), y = top margin (3%)
  filterParts.push(
    `drawtext=text='V4'${watermarkFontOpt}:fontsize=h*0.022:fontcolor=white@0.38:box=0:x=w-tw-(w*0.03):y=(h*0.03)`
  );

  const vfString = filterParts.join(',');

  // Check if source video is pre-trimmed (e.g. from YouTube selective segment retrieval)
  const isPreTrimmed = Boolean(options.isPreTrimmed || clip.isPreTrimmed);
  const seekArg = isPreTrimmed ? ['-ss', '0'] : ['-ss', start.toFixed(3)];
  const isAudioOnly = Boolean(project.isAudioOnly || project.hasVideo === false);

  let ffmpegArgs = [];
  if (isAudioOnly) {
    // Generate aesthetic 9:16 vertical canvas for standalone audio with subtitles & watermark
    ffmpegArgs = [
      '-y',
      '-f', 'lavfi',
      '-i', `color=c=0x0f172a:s=${targetWidth}x${targetHeight}:r=30`,
      ...seekArg,
      '-i', videoPath,
      '-t', clipDuration.toFixed(3),
      '-map', '0:v',
      '-map', '1:a:0',
      '-vf', vfString,
      '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '24',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
      '-shortest',
      '-movflags', '+faststart',
      outputPath
    ];
  } else {
    ffmpegArgs = [
      '-y',
      ...seekArg,
      '-i', videoPath,
      '-t', clipDuration.toFixed(3),
      '-map', '0:v:0',
      '-map', '0:a?',
      '-vf', vfString,
      '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '24',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-b:a', '128k',
      '-ar', '44100',
      '-movflags', '+faststart',
      outputPath
    ];
  }

  console.log(`[${safeClipId}] Rendering vertical short: ${outputFileName}...`);
  try {
    try {
      await execFilePromise('ffmpeg', ffmpegArgs, { timeout: 180000, maxBuffer: 10 * 1024 * 1024 });
    } catch (primaryErr) {
      // If loudnorm filter failed (e.g. silent audio track), retry cleanly without -af loudnorm
      if (ffmpegArgs.includes('-af')) {
        console.warn(`[${safeClipId}] Retrying transcode without loudnorm filter:`, primaryErr.message);
        const fallbackArgs = ffmpegArgs.filter(a => a !== '-af' && a !== 'loudnorm=I=-16:TP=-1.5:LRA=11');
        await execFilePromise('ffmpeg', fallbackArgs, { timeout: 180000, maxBuffer: 10 * 1024 * 1024 });
      } else {
        throw primaryErr;
      }
    }
  } finally {
    if (tempSubPath && fs.existsSync(tempSubPath)) {
      try { fs.unlinkSync(tempSubPath); } catch (_) {}
    }
  }

  if (!fs.existsSync(outputPath)) {
    throw new Error('Rendering finished but output MP4 file was not generated.');
  }

  const stats = fs.statSync(outputPath);
  if (stats.size < 1000) {
    throw new Error('Rendered MP4 file appears corrupt or empty (<1KB).');
  }

  return {
    clipId: clip.id,
    fileName: outputFileName,
    filePath: outputPath,
    fileUrl: `/data/exports/${outputFileName}`,
    srtUrl: `/data/exports/${srtFileName}`,
    fileSizeBytes: stats.size,
    duration: clipDuration,
    resolution: safeResolution,
    aspectRatio: safeAspectRatio
  };
}

/**
 * Returns libass force_style configuration strings for the 4 design system subtitle presets.
 */
function getSubtitleStyleParams(style, overrides = {}) {
  let fontName = 'DejaVu Sans';
  let fontSize = 19;
  let bold = 1;
  let primaryColor = '&H00FFFFFF'; // White in BGR
  let outlineColor = '&H00151515'; // Dark Grey
  let outline = 2.0;
  let shadow = 0;
  let alignment = 2; // 2 = Bottom-Center, 6 = Top-Center, 10 = Middle-Center
  let marginV = 95;

  switch (style) {
    case 'highlighted':
      fontSize = 21;
      primaryColor = '&H001B79FF'; // Amber in BGR (&H00BBGGRR)
      outlineColor = '&H00000000';
      outline = 2.5;
      shadow = 1;
      marginV = 100;
      break;

    case 'minimal':
      fontSize = 15;
      bold = 0;
      primaryColor = '&H00F5F5F5';
      outlineColor = '&H002A2A2A';
      outline = 1.0;
      shadow = 0;
      marginV = 80;
      break;

    case 'bold_creator':
      fontSize = 24;
      bold = 1;
      primaryColor = '&H0000E5FF'; // Yellow in BGR (&H0000E5FF)
      outlineColor = '&H00000000';
      outline = 3.5;
      shadow = 2;
      marginV = 110;
      break;

    case 'clean_white':
    default:
      fontSize = 19;
      bold = 1;
      primaryColor = '&H00FFFFFF';
      outlineColor = '&H00151515';
      outline = 2.0;
      shadow = 0;
      marginV = 95;
      break;
  }

  // Handle user custom overrides
  if (overrides.customFontSize) {
    fontSize = parseInt(overrides.customFontSize, 10) || fontSize;
  }
  if (overrides.customFontColor) {
    primaryColor = hexToBgr(overrides.customFontColor);
  }
  if (overrides.customAlignment === 'top') {
    alignment = 6;
  } else if (overrides.customAlignment === 'middle') {
    alignment = 10;
  } else if (overrides.customAlignment === 'bottom') {
    alignment = 2;
  }

  return [
    `FontName=${fontName}`,
    `FontSize=${fontSize}`,
    `Bold=${bold}`,
    `PrimaryColour=${primaryColor}`,
    `OutlineColour=${outlineColor}`,
    `BorderStyle=1`,
    `Outline=${outline}`,
    `Shadow=${shadow}`,
    `Alignment=${alignment}`,
    `MarginL=48`,
    `MarginR=48`,
    `MarginV=${marginV}`,
    `WrapStyle=2`,
    `Spacing=0`
  ].join(',');
}

function hexToBgr(hex) {
  if (typeof hex !== 'string') return '&H00FFFFFF';
  const clean = hex.replace('#', '').trim();
  if (/^[0-9A-Fa-f]{6}$/.test(clean)) {
    const r = clean.slice(0, 2);
    const g = clean.slice(2, 4);
    const b = clean.slice(4, 6);
    return `&H00${b}${g}${r}`.toUpperCase();
  }
  return '&H00FFFFFF';
}

module.exports = {
  renderClip,
  getSubtitleStyleParams,
  hexToBgr
};
