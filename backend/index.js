const express = require('express');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');

const { execFile } = require('child_process');
const util = require('util');
const execFilePromise = util.promisify(execFile);

const { extractMetadata } = require('./services/metadataService');
const { extractAudio, transcribeAudio } = require('./services/transcriptionService');
const { analyzeTranscript, analyzeLiveHighlight } = require('./services/analysisService');
const { renderClip } = require('./services/videoProcessingService');
const {
  parseYouTubeUrl,
  isValidYouTubeUrl,
  getYouTubeMetadata,
  getYouTubeCaptions,
  downloadTemporaryAudio,
  retrieveClipSegment,
  detectYouTubeLive,
  extractLiveRollingChunk,
  cleanupLiveRollingChunk,
  cleanupMatchingFiles
} = require('./services/youtubeService');

const app = express();
const PORT = process.env.PORT || 5000;

// Load secrets if available from ai-video-workstation config
const secretsPath = path.join(process.env.HOME || '/data/data/com.termux/files/home', '.config/ai-video-workstation/secrets.sh');
if (fs.existsSync(secretsPath)) {
  try {
    const content = fs.readFileSync(secretsPath, 'utf8');
    const match = content.match(/export\s+GROQ_API_KEY=["']?([^"'\s\n]+)["']?/);
    if (match && match[1] && !process.env.GROQ_API_KEY) {
      process.env.GROQ_API_KEY = match[1];
      console.log('Loaded GROQ_API_KEY from secrets.sh');
    }
  } catch (err) {
    console.warn('Could not read secrets.sh:', err.message);
  }
}

// Middleware
app.use(cors());
app.use(express.json());

// Base directories
const DATA_DIR = path.join(__dirname, '../data');
const UPLOADS_DIR = path.join(DATA_DIR, 'uploads');
const PROJECTS_DIR = path.join(DATA_DIR, 'projects');
const EXPORTS_DIR = path.join(DATA_DIR, 'exports');
const TEMP_DIR = path.join(DATA_DIR, 'temp');

[UPLOADS_DIR, PROJECTS_DIR, EXPORTS_DIR, TEMP_DIR, path.join(UPLOADS_DIR, 'thumbnails')].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Active temp file registry to prevent periodic cleanup from deleting files belonging to in-flight processing jobs
const activeTempFiles = new Set();
function registerActiveTemp(fileName) {
  if (fileName) activeTempFiles.add(path.basename(fileName));
}
function unregisterActiveTemp(fileName) {
  if (fileName) activeTempFiles.delete(path.basename(fileName));
}

// Periodic safe cleanup of orphaned temporary files (older than 1 hour)
function cleanupTempFiles() {
  try {
    if (!fs.existsSync(TEMP_DIR)) return;
    const now = Date.now();
    const files = fs.readdirSync(TEMP_DIR);
    for (const f of files) {
      if (activeTempFiles.has(f)) continue; // Never delete files of active jobs
      const p = path.join(TEMP_DIR, f);
      try {
        const stats = fs.statSync(p);
        if (now - stats.mtimeMs > 3600000) {
          fs.unlinkSync(p);
        }
      } catch (_) {}
    }
  } catch (e) {
    console.warn('Temp cleanup warning:', e.message);
  }
}
setInterval(cleanupTempFiles, 1800000); // Clean every 30 mins
cleanupTempFiles();

// Global FFmpeg task serializer to protect Android Termux ARM64 from OOM / LMK
let renderLock = Promise.resolve();
function withRenderLock(fn) {
  const next = renderLock.then(() => fn(), () => fn());
  renderLock = next.catch(() => {});
  return next;
}

// Serve static assets exclusively from safe public subfolders (Strict Protection of cookies.txt & projects)
app.use('/data/uploads', express.static(UPLOADS_DIR));
app.use('/data/exports', express.static(EXPORTS_DIR));

// Universal Video and Audio formats for direct local file upload
const VIDEO_EXTENSIONS = new Set([
  '.mp4', '.mov', '.mkv', '.webm', '.avi', '.flv', '.wmv',
  '.mpeg', '.mpg', '.m4v', '.3gp', '.ts', '.mts', '.m2ts',
  '.vob', '.ogv', '.mxf', '.asf'
]);

const AUDIO_EXTENSIONS = new Set([
  '.mp3', '.wav', '.aac', '.m4a', '.flac', '.ogg', '.opus',
  '.wma', '.aiff', '.alac', '.ac3', '.eac3', '.amr', '.caf'
]);

const ALLOWED_EXTENSIONS = new Set([...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS]);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 1024 * 1024 * 1024 }, // 1GB limit for local uploads
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ALLOWED_EXTENSIONS.has(ext)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type. Supported video/audio formats: ${Array.from(ALLOWED_EXTENSIONS).join(', ')}`));
    }
  }
});

function isValidId(id) {
  return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(id);
}

// Validate URL parameters to prevent path traversal
app.param('id', (req, res, next, id) => {
  if (!isValidId(id)) {
    return res.status(400).json({ error: 'Invalid project ID format' });
  }
  next();
});

app.param('clipId', (req, res, next, clipId) => {
  if (!isValidId(clipId)) {
    return res.status(400).json({ error: 'Invalid clip ID format' });
  }
  next();
});

// ==========================================
// ROUTES
// ==========================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    app: 'V4 AI Clipper',
    version: '4.0.0',
    timestamp: new Date().toISOString()
  });
});

// System Configuration
app.get('/api/config', (req, res) => {
  const whisperCli = process.env.WHISPER_CLI || '/data/data/com.termux/files/home/whisper.cpp/build/bin/whisper-cli';
  const whisperModel = process.env.WHISPER_MODEL || '/data/data/com.termux/files/home/whisper.cpp/models/ggml-tiny.bin';
  const cookiesPath = path.join(DATA_DIR, 'cookies.txt');

  res.json({
    hasGroqKey: Boolean(process.env.GROQ_API_KEY),
    hasCookies: fs.existsSync(cookiesPath) && fs.statSync(cookiesPath).size > 0,
    localWhisperAvailable: fs.existsSync(whisperCli) && fs.existsSync(whisperModel),
    allowedExtensions: Array.from(ALLOWED_EXTENSIONS),
    supportedResolutions: ['720x1280', '1080x1920'],
    supportedAspectRatios: ['9:16', '1:1', '16:9'],
    subtitleStyles: ['clean_white', 'highlighted', 'minimal', 'bold_creator'],
    cropPositions: ['center', 'left', 'right', 'blur_background']
  });
});

// List all projects
app.get('/api/projects', (req, res) => {
  try {
    const files = fs.readdirSync(PROJECTS_DIR).filter(f => f.endsWith('.json'));
    const projects = files.map(file => {
      try {
        return JSON.parse(fs.readFileSync(path.join(PROJECTS_DIR, file), 'utf8'));
      } catch (e) {
        return null;
      }
    }).filter(Boolean);

    projects.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    res.json(projects);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single project
app.get('/api/projects/:id', (req, res) => {
  const projectPath = path.join(PROJECTS_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(projectPath)) {
    return res.status(404).json({ error: 'Project not found' });
  }
  try {
    const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
    res.json(project);
  } catch (error) {
    res.status(500).json({ error: 'Failed to read project file' });
  }
});

// Delete project and associated exports
app.delete('/api/projects/:id', (req, res) => {
  const projectId = req.params.id;
  const projectPath = path.join(PROJECTS_DIR, `${projectId}.json`);

  if (!fs.existsSync(projectPath)) {
    return res.status(404).json({ error: 'Project not found' });
  }

  try {
    const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));

    // If local uploaded video exists, remove it
    if (project.videoPath && project.sourceType !== 'youtube') {
      const safeVideo = path.basename(project.videoPath);
      const vPath = path.join(UPLOADS_DIR, safeVideo);
      if (fs.existsSync(vPath)) fs.unlinkSync(vPath);
    }

    // Remove local thumbnail if stored in uploads
    const thumbPath = path.join(UPLOADS_DIR, 'thumbnails', `${projectId}.jpg`);
    if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath);

    // Remove any exported clip MP4 and SRT files
    if (Array.isArray(project.clips)) {
      for (const clip of project.clips) {
        if (clip.export && clip.export.filePath) {
          const safeExp = path.basename(clip.export.filePath);
          const expPath = path.join(EXPORTS_DIR, safeExp);
          if (fs.existsSync(expPath)) {
            try { fs.unlinkSync(expPath); } catch (e) {}
          }
        }
        if (clip.export && clip.export.fileName) {
          const safeBaseName = path.basename(clip.export.fileName);
          const srtName = safeBaseName.replace(/\.mp4$/i, '.srt');
          const srtFile = path.join(EXPORTS_DIR, srtName);
          if (fs.existsSync(srtFile)) {
            try { fs.unlinkSync(srtFile); } catch (e) {}
          }
        }
      }
    }

    // Remove project file
    fs.unlinkSync(projectPath);

    res.json({ message: 'Project deleted successfully' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Upload Video (Direct local file upload preserved)
app.post('/api/upload', upload.single('video'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No video file provided' });
  }

  const projectId = uuidv4();
  const filePath = req.file.path;
  const rawName = (req.body.name || req.file.originalname).replace(/\.[^/.]+$/, '');

  try {
    console.log(`[${projectId}] Uploaded local file: ${req.file.originalname} (${(req.file.size / (1024 * 1024)).toFixed(2)} MB)`);
    const metadata = await extractMetadata(filePath, projectId, UPLOADS_DIR);

    const project = {
      id: projectId,
      name: rawName,
      createdAt: new Date().toISOString(),
      status: 'uploaded',
      stage: 'idle',
      sourceType: 'upload',
      mediaType: metadata.isAudioOnly ? 'audio' : 'video',
      isAudioOnly: Boolean(metadata.isAudioOnly),
      hasVideo: Boolean(metadata.hasVideo),
      videoPath: req.file.filename,
      originalName: req.file.originalname,
      videoUrl: `/data/uploads/${req.file.filename}`,
      thumbnailUrl: metadata.thumbnail,
      duration: metadata.duration,
      width: metadata.width,
      height: metadata.height,
      fps: metadata.fps,
      aspectRatio: metadata.aspectRatio,
      audioTracks: metadata.audioTracks || 1,
      audioCodec: metadata.audioCodec || 'aac',
      channels: metadata.channels || 2,
      sampleRate: metadata.sampleRate || 44100,
      subtitlesCount: metadata.subtitlesCount || 0,
      fileSizeBytes: req.file.size,
      transcript: [],
      clips: []
    };

    fs.writeFileSync(path.join(PROJECTS_DIR, `${projectId}.json`), JSON.stringify(project, null, 2), 'utf8');
    res.json(project);
  } catch (error) {
    console.error('Upload processing error:', error);
    res.status(500).json({ error: error.message });
  }
});

// ========================================================
// AUTOMATED YOUTUBE PIPELINE (STRICT NO-FULL-VIDEO-DOWNLOAD)
// ========================================================

/**
 * Handles YouTube URL input:
 * 1. Validates URL.
 * 2. Fetches metadata without downloading video.
 * 3. Launches fully automated end-to-end background pipeline:
 *    Source connect -> Subtitle/Audio analysis -> Moment identification ->
 *    Selective segment retrieval -> 9:16 vertical render -> Synchronized subtitles ->
 *    V4 watermark (fixed top-right) -> Ready for preview & download.
 */
app.post('/api/youtube', async (req, res) => {
  const { url, options = {} } = req.body;
  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: 'Please provide a YouTube URL.' });
  }

  const parsed = parseYouTubeUrl(url);
  if (!parsed.isValid) {
    return res.status(400).json({ error: parsed.error || 'Unsupported URL format: Please provide a valid YouTube link.' });
  }

  if (parsed.type === 'playlist') {
    return res.status(400).json({
      error: 'Playlist not supported for this operation: V4 Clipper generates vertical shorts from individual videos. Please provide a link to a specific video in the playlist.',
      urlType: 'playlist'
    });
  }

  const projectId = uuidv4();
  const cleanUrl = parsed.canonicalUrl || parsed.url;

  try {
    console.log(`[${projectId}] Step 1: Validating YouTube URL & Extracting Metadata...`);
    const metadata = await getYouTubeMetadata(cleanUrl);

    // Safeguard: Check if the stream is scheduled / upcoming (not started)
    if (metadata.isUpcoming) {
      return res.status(400).json({
        error: 'Livestream not started: This scheduled broadcast has not started yet. Please wait until the stream goes live before generating clips.',
        liveStatus: 'is_upcoming',
        title: metadata.title,
        urlType: 'scheduled_livestream'
      });
    }

    const isLive = Boolean(metadata.isLive);
    const wasLive = Boolean(metadata.wasLive);

    const project = {
      id: projectId,
      name: isLive ? `[LIVE] ${metadata.title || 'YouTube Live'}` : (metadata.title || 'YouTube Video'),
      createdAt: new Date().toISOString(),
      status: 'processing',
      stage: isLive ? 'validating_live' : 'validating_url',
      sourceType: isLive ? 'youtube_live' : (wasLive ? 'youtube_replay' : 'youtube'),
      sourceUrl: url.trim(),
      canonicalUrl: metadata.canonicalUrl || cleanUrl,
      videoPath: null, // Full video is NEVER stored in uploads
      thumbnailUrl: metadata.thumbnail,
      duration: metadata.duration || 0,
      width: isLive ? 1280 : 1920,
      height: isLive ? 720 : 1080,
      aspectRatio: '16:9',
      uploader: metadata.uploader,
      isLive,
      wasLive,
      urlType: metadata.detectedType || (isLive ? 'active_livestream' : 'video'),
      detectedType: metadata.detectedType || (isLive ? 'active_livestream' : 'video'),
      transcript: [],
      clips: [],
      error: null
    };

    const projectPath = path.join(PROJECTS_DIR, `${projectId}.json`);
    fs.writeFileSync(projectPath, JSON.stringify(project, null, 2), 'utf8');

    // Launch appropriate pipeline in background
    if (isLive) {
      runAutomatedYouTubeLivePipeline(project, options).catch(err => {
        try {
          console.error(`Live pipeline failed for project ${projectId}:`, err);
          project.status = 'error';
          project.error = err.message || 'Live pipeline failed.';
          fs.writeFileSync(projectPath, JSON.stringify(project, null, 2));
        } catch (saveErr) {
          console.error(`Failed to record error for project ${projectId}:`, saveErr.message);
        }
      });
    } else {
      runAutomatedYouTubePipeline(project, options).catch(err => {
        try {
          console.error(`Automated pipeline failed for project ${projectId}:`, err);
          project.status = 'error';
          project.error = err.message || 'Automated pipeline failed.';
          fs.writeFileSync(projectPath, JSON.stringify(project, null, 2));
        } catch (saveErr) {
          console.error(`Failed to record error for project ${projectId}:`, saveErr.message);
        }
      });
    }

    res.json(project);
  } catch (error) {
    console.error(`[${projectId}] YouTube metadata extraction failed:`, error);
    res.status(500).json({ error: error.message || 'Failed to access YouTube video.' });
  }
});

/**
 * Dedicated endpoint for YouTube Live Stream highlight extraction.
 * Verifies live status and captures rolling highlights without downloading full stream.
 */
app.post('/api/youtube/live', async (req, res) => {
  const { url, options = {}, chunkDuration = 60 } = req.body;
  if (!url || typeof url !== 'string' || !url.trim()) {
    return res.status(400).json({ error: 'Please provide a YouTube Live URL.' });
  }

  const parsed = parseYouTubeUrl(url);
  if (!parsed.isValid) {
    return res.status(400).json({ error: parsed.error || 'Unsupported URL format: Please provide a valid YouTube Live URL.' });
  }

  const projectId = uuidv4();
  const cleanUrl = parsed.canonicalUrl || parsed.url;

  try {
    console.log(`[${projectId}] Step 1: Detecting YouTube Live Stream Status...`);
    const liveInfo = await detectYouTubeLive(cleanUrl);

    if (liveInfo.isUpcoming) {
      return res.status(400).json({
        error: 'Livestream not started: This scheduled broadcast has not started yet. Please wait until the stream goes live before generating clips.',
        liveStatus: 'is_upcoming',
        title: liveInfo.title,
        urlType: 'scheduled_livestream'
      });
    }

    if (!liveInfo.isLive) {
      const errorMsg = liveInfo.wasLive
        ? 'This livestream has ended and is now a replay. You can process it using the standard video clipper.'
        : `This YouTube stream is not currently live (status: ${liveInfo.liveStatus}). Please provide an active YouTube Live stream URL.`;
      return res.status(400).json({
        error: errorMsg,
        liveStatus: liveInfo.liveStatus,
        title: liveInfo.title,
        urlType: liveInfo.wasLive ? 'livestream_replay' : 'video'
      });
    }

    const project = {
      id: projectId,
      name: `[LIVE] ${liveInfo.title}`,
      createdAt: new Date().toISOString(),
      status: 'processing',
      stage: 'validating_live',
      sourceType: 'youtube_live',
      sourceUrl: url.trim(),
      canonicalUrl: liveInfo.canonicalUrl || cleanUrl,
      videoPath: null,
      thumbnailUrl: liveInfo.thumbnail,
      duration: 0,
      width: 1280,
      height: 720,
      aspectRatio: '16:9',
      uploader: liveInfo.uploader,
      isLive: true,
      urlType: 'active_livestream',
      detectedType: 'active_livestream',
      transcript: [],
      clips: [],
      error: null
    };

    const projectPath = path.join(PROJECTS_DIR, `${projectId}.json`);
    fs.writeFileSync(projectPath, JSON.stringify(project, null, 2), 'utf8');

    // Launch automated live clipping pipeline in background
    runAutomatedYouTubeLivePipeline(project, { ...options, chunkDuration }).catch(err => {
      try {
        console.error(`Live pipeline failed for project ${projectId}:`, err);
        project.status = 'error';
        project.error = err.message || 'Live clipping pipeline failed.';
        fs.writeFileSync(projectPath, JSON.stringify(project, null, 2));
      } catch (saveErr) {
        console.error(`Failed to record error for project ${projectId}:`, saveErr.message);
      }
    });

    res.json(project);
  } catch (error) {
    console.error(`[${projectId}] YouTube Live detection failed:`, error);
    res.status(500).json({ error: error.message || 'Failed to access YouTube Live stream.' });
  }
});

/**
 * Executes the full 9-stage automated AI video clipping pipeline.
 * Complete source video is NEVER permanently saved to phone flash or loaded into RAM.
 */
async function runAutomatedYouTubePipeline(project, options = {}) {
  const projectPath = path.join(PROJECTS_DIR, `${project.id}.json`);
  const url = project.canonicalUrl || project.sourceUrl;

  const updateStage = (stage) => {
    project.stage = stage;
    fs.writeFileSync(projectPath, JSON.stringify(project, null, 2));
  };

  try {
    // Stage 1: URL validation (already passed)
    updateStage('validating_url');

    // Stage 2: Metadata extraction
    updateStage('extracting_metadata');

    // Stage 3: Source connection (retrieve captions or lightweight temp audio)
    updateStage('connecting_source');
    console.log(`[${project.id}] Connecting to source to retrieve transcript...`);

    let segments = await getYouTubeCaptions(url, project.id, TEMP_DIR);
    let transcriptionEngine = 'youtube_captions';

    if (!segments || segments.length === 0) {
      console.log(`[${project.id}] Direct captions unavailable. Downloading audio track only for Whisper...`);
      let tempAudioWav = null;
      try {
        tempAudioWav = await downloadTemporaryAudio(url, project.id, TEMP_DIR);
        registerActiveTemp(tempAudioWav);
        const whisperResult = await transcribeAudio(tempAudioWav);
        segments = whisperResult.segments || [];
        transcriptionEngine = whisperResult.engine || 'whisper';
      } finally {
        unregisterActiveTemp(tempAudioWav);
        if (tempAudioWav && fs.existsSync(tempAudioWav)) {
          try { fs.unlinkSync(tempAudioWav); } catch (_) {}
        }
        cleanupMatchingFiles(TEMP_DIR, `raw_audio_${project.id}`);
        const directWav = path.join(TEMP_DIR, `${project.id}.wav`);
        if (fs.existsSync(directWav)) {
          try { fs.unlinkSync(directWav); } catch (_) {}
        }
      }
    }

    project.transcript = segments || [];
    project.transcriptionEngine = transcriptionEngine;

    // Stage 4: Full video analysis
    updateStage('analyzing_video');
    console.log(`[${project.id}] Analyzing full video content (${(project.transcript || []).length} segments)...`);

    // Stage 5: Best moments identification
    updateStage('identifying_moments');
    const totalDuration = project.duration || 60;
    let minDuration = 30;
    let maxDuration = 60;
    if (totalDuration < 35) {
      minDuration = Math.max(5, Math.floor(totalDuration * 0.25));
      maxDuration = Math.max(minDuration + 5, Math.floor(totalDuration * 0.95));
    } else if (totalDuration < 60) {
      minDuration = 15;
      maxDuration = Math.floor(totalDuration);
    }

    const analysis = await analyzeTranscript(project.transcript, totalDuration, 4, [minDuration, maxDuration]);
    const detectedClips = analysis.clips || [];

    if (detectedClips.length === 0) {
      throw new Error('Analysis completed but could not detect distinct moments within target duration.');
    }

    project.clips = detectedClips;
    project.analysisEngine = analysis.engine;
    fs.writeFileSync(projectPath, JSON.stringify(project, null, 2));
    console.log(`[${project.id}] Identified ${detectedClips.length} high-engagement clips.`);

    // Stage 6 & 7 & 8: Clip Generation, Subtitle Processing, V4 Watermark Application
    // Process only the 3-4 selected clips sequentially to avoid Android RAM exhaustion
    for (let i = 0; i < detectedClips.length; i++) {
      const clip = detectedClips[i];
      console.log(`[${project.id}] Processing clip ${i + 1}/${detectedClips.length}: "${clip.title}" (${clip.duration}s)...`);

      // 6. Clip generation (selective segment retrieval)
      updateStage('generating_clips');
      let tempSegmentPath = null;
      try {
        tempSegmentPath = await retrieveClipSegment({
          url,
          start: clip.start,
          end: clip.end,
          clipId: clip.id,
          tempDir: TEMP_DIR
        });
        registerActiveTemp(tempSegmentPath);

        // 7. Subtitle processing
        updateStage('rendering_subtitles');

        // 8. V4 Watermark application (top-right fixed)
        updateStage('applying_watermark');

        const exportResult = await withRenderLock(() => renderClip({
          videoPath: tempSegmentPath,
          clip,
          project,
          outputDir: EXPORTS_DIR,
          options: {
            ...options,
            resolution: options.resolution || '720x1280',
            aspectRatio: options.aspectRatio || '9:16',
            cropPosition: options.cropPosition || 'center',
            subtitleStyle: options.subtitleStyle || 'clean_white',
            burnSubtitles: true,
            isPreTrimmed: true
          }
        }));

        clip.export = exportResult;
        fs.writeFileSync(projectPath, JSON.stringify(project, null, 2));
      } finally {
        unregisterActiveTemp(tempSegmentPath);
        // Strictly purge temporary segment file immediately after rendering
        if (tempSegmentPath && fs.existsSync(tempSegmentPath)) {
          try { fs.unlinkSync(tempSegmentPath); } catch (_) {}
        }
        cleanupMatchingFiles(TEMP_DIR, `segment_${clip.id}`);
      }
    }

    // Stage 9: Final export ready
    project.status = 'completed';
    project.stage = 'ready';
    project.completedAt = new Date().toISOString();
    fs.writeFileSync(projectPath, JSON.stringify(project, null, 2));
    console.log(`[${project.id}] Automated clipping completed successfully! All clips ready.`);
  } catch (err) {
    console.error(`[${project.id}] Pipeline failure:`, err.message);
    project.status = 'error';
    project.error = err.message || 'Pipeline execution failed.';
    fs.writeFileSync(projectPath, JSON.stringify(project, null, 2));
    throw err;
  }
}

/**
 * Executes the automated YouTube Live clipping pipeline:
 * 1. Validates live stream access.
 * 2. Connects to stream and extracts a bounded rolling chunk (e.g. 60s) via yt-dlp & FFmpeg.
 * 3. Transcribes spoken content with word synchronization.
 * 4. Identifies the strongest highlight moment (30–60s) using conversational & emotional dynamics.
 * 5. Cuts the highlight segment from the rolling chunk.
 * 6. Immediately purges the raw rolling chunk files.
 * 7. Transcodes to 9:16 vertical short with 2-word synchronized subtitles and discrete top-right V4 watermark.
 * 8. Exports to finished short workflow.
 */
async function runAutomatedYouTubeLivePipeline(project, options = {}) {
  const projectPath = path.join(PROJECTS_DIR, `${project.id}.json`);
  const url = project.canonicalUrl || project.sourceUrl;
  const chunkDuration = Math.min(120, Math.max(20, parseInt(options.chunkDuration, 10) || 60));

  const updateStage = (stage) => {
    project.stage = stage;
    fs.writeFileSync(projectPath, JSON.stringify(project, null, 2));
  };

  let chunkResult = null;
  let highlightSegmentPath = null;

  try {
    // Stage 1: Live validation
    updateStage('validating_live');
    console.log(`[${project.id}] Validating live stream URL: ${url}`);

    // Stage 2: Connect and extract rolling chunk
    updateStage('connecting_stream');
    chunkResult = await extractLiveRollingChunk({
      url,
      projectId: project.id,
      chunkDuration,
      tempDir: TEMP_DIR
    });
    registerActiveTemp(chunkResult.videoChunkPath);
    registerActiveTemp(chunkResult.audioChunkPath);

    // Stage 3: Word-synchronized Speech Transcription
    updateStage('transcribing_live');
    console.log(`[${project.id}] Transcribing live stream rolling audio with word-level timing...`);
    const transcription = await transcribeAudio(chunkResult.audioChunkPath);
    const segments = transcription.segments || [];

    if (segments.length === 0) {
      throw new Error('No spoken speech was detected in this live stream chunk. Try another moment in the stream.');
    }

    project.transcript = segments;
    project.transcriptionEngine = transcription.engine;

    // Stage 4: Live Highlight Analysis (30-60s)
    updateStage('analyzing_highlight');
    console.log(`[${project.id}] Analyzing live dialogue for highest-engagement highlight...`);
    const analysis = await analyzeLiveHighlight(segments, chunkResult.duration, options);

    if (!analysis || !analysis.clip) {
      throw new Error('Analysis completed but could not detect a distinct highlight within target duration.');
    }

    const clip = analysis.clip;
    project.clips = [clip];
    project.analysisEngine = analysis.engine;
    fs.writeFileSync(projectPath, JSON.stringify(project, null, 2));

    // Stage 5: Cut Highlight Segment
    updateStage('cutting_highlight');
    const highlightPrefix = `highlight_${clip.id}`;
    highlightSegmentPath = path.join(TEMP_DIR, `${highlightPrefix}.mp4`);
    registerActiveTemp(highlightSegmentPath);

    const cutDuration = Math.max(1, clip.end - clip.start);
    console.log(`[${project.id}] Trimming highlight moment (${clip.start}s to ${clip.end}s, ${cutDuration.toFixed(1)}s)...`);

    await execFilePromise('ffmpeg', [
      '-y',
      '-ss', clip.start.toFixed(3),
      '-t', cutDuration.toFixed(3),
      '-i', chunkResult.videoChunkPath,
      '-c', 'copy',
      highlightSegmentPath
    ]);

    if (!fs.existsSync(highlightSegmentPath) || fs.statSync(highlightSegmentPath).size === 0) {
      throw new Error('Highlight segment extraction produced an empty video file.');
    }

    // Immediately purge the full rolling chunk to free phone storage
    unregisterActiveTemp(chunkResult.videoChunkPath);
    unregisterActiveTemp(chunkResult.audioChunkPath);
    cleanupLiveRollingChunk(project.id, TEMP_DIR);
    chunkResult = null;

    // Stage 6 & 7: Render 9:16 vertical video with 2-word synchronized subtitles & discrete top-right V4 watermark
    updateStage('rendering_subtitles');
    updateStage('applying_watermark');

    // Offset clip segment timestamps relative to trimmed highlight start (0s)
    const normalizedClip = {
      ...clip,
      start: 0,
      end: cutDuration,
      isPreTrimmed: true,
      segments: (clip.segments || []).map(s => {
        const segStart = Math.max(0, s.start - clip.start);
        const segEnd = Math.max(segStart + 0.1, s.end - clip.start);
        const segWords = (s.words || []).map(w => ({
          ...w,
          start: Math.max(0, w.start - clip.start),
          end: Math.max(0.05, w.end - clip.start)
        }));
        return {
          ...s,
          start: segStart,
          end: segEnd,
          words: segWords
        };
      })
    };

    console.log(`[${project.id}] Rendering 9:16 vertical short with 2-word synchronized ASS subtitles...`);
    const exportResult = await withRenderLock(() => renderClip({
      videoPath: highlightSegmentPath,
      clip: normalizedClip,
      project,
      outputDir: EXPORTS_DIR,
      options: {
        ...options,
        resolution: options.resolution || '720x1280',
        aspectRatio: options.aspectRatio || '9:16',
        cropPosition: options.cropPosition || 'center',
        subtitleStyle: options.subtitleStyle || 'clean_white',
        burnSubtitles: true,
        isPreTrimmed: true
      }
    }));

    clip.export = exportResult;

    // Stage 8: Export Ready
    project.status = 'completed';
    project.stage = 'ready';
    project.completedAt = new Date().toISOString();
    fs.writeFileSync(projectPath, JSON.stringify(project, null, 2));
    console.log(`[${project.id}] YouTube Live highlight short rendered successfully! Ready for export.`);
  } catch (err) {
    console.error(`[${project.id}] Live pipeline failure:`, err.message);
    project.status = 'error';
    project.error = err.message || 'Live pipeline execution failed.';
    fs.writeFileSync(projectPath, JSON.stringify(project, null, 2));
    throw err;
  } finally {
    if (chunkResult) {
      unregisterActiveTemp(chunkResult.videoChunkPath);
      unregisterActiveTemp(chunkResult.audioChunkPath);
      cleanupLiveRollingChunk(project.id, TEMP_DIR);
    }
    if (highlightSegmentPath) {
      unregisterActiveTemp(highlightSegmentPath);
      if (fs.existsSync(highlightSegmentPath)) {
        try { fs.unlinkSync(highlightSegmentPath); } catch (_) {}
      }
      cleanupMatchingFiles(TEMP_DIR, `highlight_${project.id}`);
    }
  }
}

// Process / Analyze Full Video for Local Uploads (or re-analyze)
app.post('/api/projects/:id/process', async (req, res) => {
  const projectId = req.params.id;
  const projectPath = path.join(PROJECTS_DIR, `${projectId}.json`);

  if (!fs.existsSync(projectPath)) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));

  if (project.status === 'processing') {
    return res.json({ status: 'processing', message: 'Pipeline is currently running' });
  }

  project.status = 'processing';
  project.stage = project.sourceType === 'youtube_live' ? 'validating_live' : 'validating_url';
  project.error = null;
  fs.writeFileSync(projectPath, JSON.stringify(project, null, 2));

  // Determine appropriate pipeline
  if (project.sourceType === 'youtube_live') {
    runAutomatedYouTubeLivePipeline(project, req.body || {}).catch(err => {
      console.error('YouTube Live re-process failed:', err);
    });
  } else if (project.sourceType === 'youtube') {
    runAutomatedYouTubePipeline(project, req.body || {}).catch(err => {
      console.error(`YouTube re-process failed:`, err);
    });
  } else {
    runFullPipelineForUpload(project, req.body || {}).catch(err => {
      console.error(`Upload pipeline failed:`, err);
    });
  }

  res.json({
    status: 'processing',
    message: 'Processing initiated'
  });
});

// Full Pipeline for Local Uploaded Videos
async function runFullPipelineForUpload(project, options = {}) {
  const projectPath = path.join(PROJECTS_DIR, `${project.id}.json`);
  const videoPath = path.join(UPLOADS_DIR, project.videoPath);
  const audioPath = path.join(TEMP_DIR, `${project.id}.wav`);

  const updateStage = (stage) => {
    project.stage = stage;
    fs.writeFileSync(projectPath, JSON.stringify(project, null, 2));
  };

  try {
    updateStage('extracting_audio');
    await extractAudio(videoPath, audioPath);

    updateStage('transcribing');
    const transcription = await transcribeAudio(audioPath);
    project.transcript = transcription.segments || [];
    project.transcriptionEngine = transcription.engine;

    updateStage('analyzing_moments');
    const totalDuration = project.duration || 60;
    let minDuration = 30;
    let maxDuration = 60;
    if (totalDuration < 35) {
      minDuration = Math.max(5, Math.floor(totalDuration * 0.25));
      maxDuration = Math.max(minDuration + 5, Math.floor(totalDuration * 0.95));
    } else if (totalDuration < 60) {
      minDuration = 15;
      maxDuration = Math.floor(totalDuration);
    }

    const analysis = await analyzeTranscript(project.transcript, totalDuration, 4, [minDuration, maxDuration]);
    project.clips = analysis.clips || [];
    project.analysisEngine = analysis.engine;

    // Render clips sequentially
    for (let i = 0; i < project.clips.length; i++) {
      const clip = project.clips[i];
      updateStage('generating_clips');
      updateStage('rendering_subtitles');
      updateStage('applying_watermark');

      const exportResult = await withRenderLock(() => renderClip({
        videoPath,
        clip,
        project,
        outputDir: EXPORTS_DIR,
        options: {
          ...options,
          resolution: options.resolution || '720x1280',
          aspectRatio: options.aspectRatio || '9:16',
          cropPosition: options.cropPosition || 'center',
          subtitleStyle: options.subtitleStyle || 'clean_white',
          burnSubtitles: true,
          isPreTrimmed: false
        }
      }));
      clip.export = exportResult;
      fs.writeFileSync(projectPath, JSON.stringify(project, null, 2));
    }

    project.status = 'completed';
    project.stage = 'ready';
    project.completedAt = new Date().toISOString();
    fs.writeFileSync(projectPath, JSON.stringify(project, null, 2));
  } catch (err) {
    project.status = 'error';
    project.error = err.message || 'Processing failed.';
    fs.writeFileSync(projectPath, JSON.stringify(project, null, 2));
    throw err;
  } finally {
    if (fs.existsSync(audioPath)) {
      try { fs.unlinkSync(audioPath); } catch (_) {}
    }
  }
}

// Update a clip (e.g. title, start/end trim, subtitles)
app.put('/api/projects/:id/clips/:clipId', (req, res) => {
  const { id, clipId } = req.params;
  const projectPath = path.join(PROJECTS_DIR, `${id}.json`);

  if (!fs.existsSync(projectPath)) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
  const clipIndex = (project.clips || []).findIndex(c => c.id === clipId);

  if (clipIndex === -1) {
    return res.status(404).json({ error: 'Clip not found' });
  }

  const updatedData = req.body;
  const targetClip = project.clips[clipIndex];

  if (updatedData.title !== undefined) targetClip.title = updatedData.title;
  if (updatedData.start !== undefined) targetClip.start = parseFloat(updatedData.start);
  if (updatedData.end !== undefined) targetClip.end = parseFloat(updatedData.end);
  if (targetClip.start !== undefined && targetClip.end !== undefined) {
    targetClip.duration = Math.round((targetClip.end - targetClip.start) * 100) / 100;
  }
  if (updatedData.segments !== undefined) targetClip.segments = updatedData.segments;

  project.clips[clipIndex] = targetClip;
  fs.writeFileSync(projectPath, JSON.stringify(project, null, 2));

  res.json(targetClip);
});

// Render / Export a Single Clip (with on-demand selective retrieval for YouTube)
app.post('/api/projects/:id/clips/:clipId/export', async (req, res) => {
  const { id, clipId } = req.params;
  const projectPath = path.join(PROJECTS_DIR, `${id}.json`);

  if (!fs.existsSync(projectPath)) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
  const clip = (project.clips || []).find(c => c.id === clipId);

  if (!clip) {
    return res.status(404).json({ error: 'Clip not found' });
  }

  const options = req.body || {};
  let tempSegmentPath = null;
  let videoPath = null;
  let isPreTrimmed = false;

  try {
    if (project.sourceType === 'youtube_live' && clip.export && fs.existsSync(clip.export.filePath)) {
      videoPath = clip.export.filePath;
      isPreTrimmed = true;
    } else if (project.sourceType === 'youtube') {
      tempSegmentPath = await retrieveClipSegment({
        url: project.canonicalUrl || project.sourceUrl,
        start: clip.start,
        end: clip.end,
        clipId: clip.id,
        tempDir: TEMP_DIR
      });
      registerActiveTemp(tempSegmentPath);
      videoPath = tempSegmentPath;
      isPreTrimmed = true;
    } else {
      videoPath = path.join(UPLOADS_DIR, project.videoPath);
      isPreTrimmed = false;
    }

    const exportResult = await withRenderLock(() => renderClip({
      videoPath,
      clip,
      project,
      outputDir: EXPORTS_DIR,
      options: {
        ...options,
        isPreTrimmed
      }
    }));

    clip.export = exportResult;
    fs.writeFileSync(projectPath, JSON.stringify(project, null, 2));

    res.json({
      status: 'exported',
      export: exportResult
    });
  } catch (err) {
    console.error('Export error:', err);
    res.status(500).json({ error: err.message });
  } finally {
    if (tempSegmentPath) {
      unregisterActiveTemp(tempSegmentPath);
      if (fs.existsSync(tempSegmentPath)) {
        try { fs.unlinkSync(tempSegmentPath); } catch (_) {}
      }
    }
    if (clip && clip.id) {
      cleanupMatchingFiles(TEMP_DIR, `segment_${clip.id}`);
    }
  }
});

// Render / Export All Clips for a Project
app.post('/api/projects/:id/export-all', async (req, res) => {
  const { id } = req.params;
  const projectPath = path.join(PROJECTS_DIR, `${id}.json`);

  if (!fs.existsSync(projectPath)) {
    return res.status(404).json({ error: 'Project not found' });
  }

  const project = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
  const clips = project.clips || [];

  if (clips.length === 0) {
    return res.status(400).json({ error: 'No clips found to export' });
  }

  const options = req.body || {};
  const results = [];

  try {
    for (const clip of clips) {
      let tempSegmentPath = null;
      let videoPath = null;
      let isPreTrimmed = false;

      try {
        if (project.sourceType === 'youtube_live' && clip.export && fs.existsSync(clip.export.filePath)) {
          videoPath = clip.export.filePath;
          isPreTrimmed = true;
        } else if (project.sourceType === 'youtube') {
          tempSegmentPath = await retrieveClipSegment({
            url: project.canonicalUrl || project.sourceUrl,
            start: clip.start,
            end: clip.end,
            clipId: clip.id,
            tempDir: TEMP_DIR
          });
          registerActiveTemp(tempSegmentPath);
          videoPath = tempSegmentPath;
          isPreTrimmed = true;
        } else {
          videoPath = path.join(UPLOADS_DIR, project.videoPath);
          isPreTrimmed = false;
        }

        const exportResult = await withRenderLock(() => renderClip({
          videoPath,
          clip,
          project,
          outputDir: EXPORTS_DIR,
          options: {
            ...options,
            isPreTrimmed
          }
        }));

        clip.export = exportResult;
        results.push(exportResult);
      } finally {
        if (tempSegmentPath) {
          unregisterActiveTemp(tempSegmentPath);
          if (fs.existsSync(tempSegmentPath)) {
            try { fs.unlinkSync(tempSegmentPath); } catch (_) {}
          }
        }
        if (clip && clip.id) {
          cleanupMatchingFiles(TEMP_DIR, `segment_${clip.id}`);
        }
      }
    }

    fs.writeFileSync(projectPath, JSON.stringify(project, null, 2));

    res.json({
      status: 'all_exported',
      exports: results
    });
  } catch (err) {
    console.error('Export all error:', err);
    res.status(500).json({ error: err.message });
  }
});

// Direct Download Route with Content-Disposition headers
app.get('/api/download/:type/:filename', (req, res) => {
  const { type, filename } = req.params;
  if (type !== 'exports' && type !== 'uploads') {
    return res.status(400).json({ error: 'Invalid download type. Expected "exports" or "uploads"' });
  }

  const targetFolder = type === 'uploads' ? UPLOADS_DIR : EXPORTS_DIR;
  const safeFilename = path.basename(filename);
  const filePath = path.join(targetFolder, safeFilename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'File not found' });
  }

  res.download(filePath, safeFilename);
});

// 404 handler for unmatched /api routes
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API route not found' });
});

// 404 handler for missing static /data assets
app.use('/data', (req, res) => {
  res.status(404).json({ error: 'Asset not found' });
});

// Serve frontend dist when built
const frontendDist = path.join(__dirname, '../frontend/dist');
if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  app.use((req, res, next) => {
    if (req.method === 'GET' && req.accepts('html')) {
      return res.sendFile(path.join(frontendDist, 'index.html'));
    }
    next();
  });
}

// Fallback 404
app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, () => {
  console.log(`========================================`);
  console.log(`V4 Clipper Backend API running on port ${PORT}`);
  console.log(`Uploads: ${UPLOADS_DIR}`);
  console.log(`Exports: ${EXPORTS_DIR}`);
  console.log(`========================================`);
});
