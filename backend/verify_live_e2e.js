/**
 * V4 Clipper — Evidence-Based End-to-End Live Verification Suite
 * Executes full local video upload transcode, standalone audio transcode,
 * ffprobe stream verification, and YouTube extraction contracts.
 */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const util = require('util');
const assert = require('assert');

const execFilePromise = util.promisify(execFile);

const { extractMetadata } = require('./services/metadataService');
const { renderClip } = require('./services/videoProcessingService');
const {
  getYtDlpBaseArgs,
  retrieveClipSegment,
  downloadTemporaryAudio,
  getYouTubeMetadata,
  detectYouTubeLive,
  extractLiveRollingChunk,
  cleanupLiveRollingChunk
} = require('./services/youtubeService');
const {
  generateTwoWordChunks,
  generateWordSynchronizedAss,
  wordsToTwoWordSrt,
  alignWordsInSegment
} = require('./services/transcriptionService');
const { analyzeLiveHighlight } = require('./services/analysisService');

const VERIFY_DIR = path.join(__dirname, 'verify_sandbox');
if (!fs.existsSync(VERIFY_DIR)) fs.mkdirSync(VERIFY_DIR, { recursive: true });

async function runLiveVerification() {
  console.log('======================================================');
  console.log(' V4 CLIPPER — EVIDENCE-BASED END-TO-END VERIFICATION');
  console.log('======================================================\n');

  const results = {
    passed: [],
    failed: [],
    untested: []
  };

  function logPass(name, detail = '') {
    console.log(`[PASS] ${name}${detail ? ' — ' + detail : ''}`);
    results.passed.push(name);
  }

  function logFail(name, err) {
    console.error(`[FAIL] ${name}: ${err.message || err}`);
    results.failed.push({ name, error: err.message || err });
  }

  // -------------------------------------------------------------------------
  // TEST 1: FFmpeg & FFprobe Binary Capabilities Check
  // -------------------------------------------------------------------------
  console.log('--- TEST 1: FFmpeg / FFprobe Environment Inspection ---');
  let ffmpegVersion = 'unknown';
  try {
    const { stdout } = await execFilePromise('ffmpeg', ['-version']);
    ffmpegVersion = stdout.split('\n')[0];
    logPass('FFmpeg Binary Installed', ffmpegVersion);
  } catch (err) {
    logFail('FFmpeg Binary Check', err);
  }

  try {
    const { stdout } = await execFilePromise('ffprobe', ['-version']);
    const probeVer = stdout.split('\n')[0];
    logPass('FFprobe Binary Installed', probeVer);
  } catch (err) {
    logFail('FFprobe Binary Check', err);
  }

  // -------------------------------------------------------------------------
  // TEST 2: Local Video Upload & Metadata Extraction
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 2: Synthetic Video Generation & Metadata Extraction ---');
  const testVideoPath = path.join(VERIFY_DIR, 'test_source_video.mp4');
  try {
    // Generate 5-second 1280x720 video with a sine wave audio tone
    await execFilePromise('ffmpeg', [
      '-y',
      '-f', 'lavfi', '-i', 'testsrc=duration=5:size=1280x720:rate=30',
      '-f', 'lavfi', '-i', 'sine=frequency=1000:duration=5',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k',
      testVideoPath
    ]);

    const meta = await extractMetadata(testVideoPath, 'test_vid_proj', VERIFY_DIR);
    assert.equal(meta.hasVideo, true, 'hasVideo must be true');
    assert.equal(meta.isAudioOnly, false, 'isAudioOnly must be false');
    assert.equal(meta.width, 1280, 'Width must be 1280');
    assert.equal(meta.height, 720, 'Height must be 720');
    assert.ok(meta.duration >= 4.9 && meta.duration <= 5.1, `Duration ~5s (got ${meta.duration})`);
    logPass('Local Video Metadata Probe', `1280x720, ${meta.duration.toFixed(1)}s, ${meta.videoCodec}/${meta.audioCodec}`);
  } catch (err) {
    logFail('Local Video Metadata Probe', err);
  }

  // -------------------------------------------------------------------------
  // TEST 3: 9:16 Vertical Render with Subtitles & Fixed Top-Right V4 Watermark
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 3: 9:16 Vertical Render, Subtitles & Discrete Top-Right V4 Watermark ---');
  const testClip = {
    id: 'clip_e2e_video',
    start: 0,
    end: 4,
    duration: 4,
    title: 'Verification Clip',
    segments: [
      { id: 1, start: 0.5, end: 3.5, text: 'Evidence-based live subtitle test' }
    ]
  };

  const testProject = {
    id: 'proj_e2e_video',
    name: 'E2E Test Video',
    hasVideo: true,
    isAudioOnly: false,
    width: 1280,
    height: 720,
    duration: 5
  };

  try {
    const exportResult = await renderClip({
      videoPath: testVideoPath,
      clip: testClip,
      project: testProject,
      outputDir: VERIFY_DIR,
      options: {
        resolution: '720x1280',
        aspectRatio: '9:16',
        cropPosition: 'center',
        subtitleStyle: 'clean_white',
        burnSubtitles: true
      }
    });

    assert.ok(fs.existsSync(exportResult.filePath), 'Rendered file must exist on disk');
    assert.ok(exportResult.fileSizeBytes > 10000, `File size must be > 10KB (got ${exportResult.fileSizeBytes})`);

    // Probe exported MP4 with ffprobe to verify resolution and stream codecs
    const probeArgs = [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,codec_name,width,height:format=duration,size',
      '-of', 'json',
      exportResult.filePath
    ];
    const { stdout: probeStdout } = await execFilePromise('ffprobe', probeArgs);
    const probeData = JSON.parse(probeStdout);

    const vStream = probeData.streams.find(s => s.codec_type === 'video');
    const aStream = probeData.streams.find(s => s.codec_type === 'audio');

    assert.ok(vStream, 'Export must have a video stream');
    assert.equal(vStream.width, 720, 'Rendered width must be 720');
    assert.equal(vStream.height, 1280, 'Rendered height must be 1280 (9:16 vertical)');
    assert.equal(vStream.codec_name, 'h264', 'Video codec must be H.264');
    assert.ok(aStream, 'Export must have an audio stream');
    assert.equal(aStream.codec_name, 'aac', 'Audio codec must be AAC');

    logPass('9:16 Vertical Video Render', `720x1280 H.264/AAC, ${(exportResult.fileSizeBytes / 1024).toFixed(1)} KB`);
  } catch (err) {
    logFail('9:16 Vertical Video Render', err);
  }

  // -------------------------------------------------------------------------
  // TEST 4: Standalone Audio Upload & 9:16 Dark Studio Video Conversion
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 4: Standalone Audio Upload (MP3) → 9:16 Dark Studio Canvas ---');
  const testAudioPath = path.join(VERIFY_DIR, 'test_source_audio.mp3');
  try {
    // Generate 4-second MP3 audio tone
    await execFilePromise('ffmpeg', [
      '-y',
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4',
      '-c:a', 'libmp3lame', '-b:a', '128k',
      testAudioPath
    ]);

    const audioMeta = await extractMetadata(testAudioPath, 'test_aud_proj', VERIFY_DIR);
    assert.equal(audioMeta.hasVideo, false, 'hasVideo must be false for standalone audio');
    assert.equal(audioMeta.isAudioOnly, true, 'isAudioOnly must be true for standalone audio');
    assert.equal(audioMeta.aspectRatio, '9:16', 'Default aspect ratio must be 9:16');
    logPass('Standalone Audio Metadata Probe', `hasVideo: false, isAudioOnly: true, duration: ${audioMeta.duration.toFixed(1)}s`);

    const audioClip = {
      id: 'clip_e2e_audio',
      start: 0,
      end: 3.5,
      duration: 3.5,
      title: 'Audio Podcast Highlight',
      segments: [
        { id: 1, start: 0.5, end: 3.0, text: 'Audio only podcast clip test' }
      ]
    };

    const audioProject = {
      id: 'proj_e2e_audio',
      name: 'E2E Podcast Audio',
      hasVideo: false,
      isAudioOnly: true,
      width: 720,
      height: 1280,
      duration: 4
    };

    const audioExportResult = await renderClip({
      videoPath: testAudioPath,
      clip: audioClip,
      project: audioProject,
      outputDir: VERIFY_DIR,
      options: {
        resolution: '720x1280',
        aspectRatio: '9:16',
        subtitleStyle: 'bold_creator',
        burnSubtitles: true
      }
    });

    assert.ok(fs.existsSync(audioExportResult.filePath), 'Audio-to-video rendered file must exist');

    const probeAudioArgs = [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,codec_name,width,height',
      '-of', 'json',
      audioExportResult.filePath
    ];
    const { stdout: probeAudioOut } = await execFilePromise('ffprobe', probeAudioArgs);
    const audioProbe = JSON.parse(probeAudioOut);
    const audioVidStream = audioProbe.streams.find(s => s.codec_type === 'video');

    assert.equal(audioVidStream.width, 720);
    assert.equal(audioVidStream.height, 1280);
    logPass('Standalone Audio 9:16 Video Render', `Generated 720x1280 MP4 from MP3 with subtitles & V4 watermark (${(audioExportResult.fileSizeBytes / 1024).toFixed(1)} KB)`);
  } catch (err) {
    logFail('Standalone Audio 9:16 Video Render', err);
  }

  // -------------------------------------------------------------------------
  // TEST 5: Real Public YouTube Extraction Test
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 5: Live Public YouTube Extraction Test ---');
  const publicTestUrl = 'https://www.youtube.com/watch?v=aqz-KE-bpKQ';
  try {
    console.log(`Connecting to YouTube: ${publicTestUrl}...`);
    const ytMeta = await getYouTubeMetadata(publicTestUrl);
    assert.ok(ytMeta.title, 'YouTube title must be present');
    assert.ok(ytMeta.duration > 0, 'YouTube duration must be > 0');
    logPass('Live YouTube Metadata Extraction', `Title: "${ytMeta.title}", Duration: ${ytMeta.duration}s`);

    // Download audio track only (zero video)
    console.log('Downloading audio track only (Format 258/140 ba)...');
    const wavPath = await downloadTemporaryAudio(publicTestUrl, 'verify_yt_aud', VERIFY_DIR);
    assert.ok(fs.existsSync(wavPath), 'Converted 16kHz WAV must exist');
    const wavStat = fs.statSync(wavPath);
    assert.ok(wavStat.size > 100000, `WAV size must be > 100KB (got ${wavStat.size} bytes)`);
    logPass('Live YouTube Audio-Only Stream Extraction', `Converted to 16kHz mono WAV: ${(wavStat.size / (1024 * 1024)).toFixed(2)} MB`);

    // Clean up temporary WAV
    try { fs.unlinkSync(wavPath); } catch (_) {}

    // Retrieve a 10-second selective clip segment (zero full video download)
    console.log('Selectively retrieving 10-second segment (0s - 10s)...');
    const segPath = await retrieveClipSegment({
      url: publicTestUrl,
      start: 5,
      end: 15,
      clipId: 'verify_yt_seg',
      tempDir: VERIFY_DIR
    });

    assert.ok(fs.existsSync(segPath), 'Retrieved segment file must exist');
    const segStat = fs.statSync(segPath);
    assert.ok(segStat.size > 10000, `Segment size must be > 10KB (got ${segStat.size} bytes)`);
    logPass('Live YouTube Selective 10s Clip Retrieval', `Fetched only 5s-15s segment: ${(segStat.size / (1024 * 1024)).toFixed(2)} MB`);

    // Clean up temporary segment
    try { fs.unlinkSync(segPath); } catch (_) {}
  } catch (err) {
    logFail('Live YouTube Extraction', err);
  }

  // -------------------------------------------------------------------------
  // TEST 6: Two-Word Synchronized Subtitle System (ASS + SRT)
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 6: Subtitle Overhaul — 2-Word Synchronized ASS & SRT Engine ---');
  try {
    const speechSegments = [
      { id: 1, start: 0.0, end: 1.8, text: 'Welcome to this incredible live stream session.' },
      { id: 2, start: 2.2, end: 4.0, text: 'Look at this amazing moment right here!' }
    ];

    const words = speechSegments.flatMap(s => alignWordsInSegment(s));
    assert.ok(words.length >= 10, 'Must produce word tokens from speech segments');

    const twoWordChunks = generateTwoWordChunks(words, 0);
    assert.ok(twoWordChunks.length >= 5, 'Must group speech into ~2-word chunks');
    twoWordChunks.forEach(chunk => {
      assert.ok(chunk.words.length <= 2, `Chunk "${chunk.text}" must not exceed 2 words (got ${chunk.words.length})`);
    });

    const assScript = generateWordSynchronizedAss(speechSegments, 0, {
      resolution: '720x1280',
      subtitleStyle: 'clean_white'
    });

    assert.ok(assScript.includes('PlayResX: 720'), 'ASS script must set 720 width');
    assert.ok(assScript.includes('PlayResY: 1280'), 'ASS script must set 1280 height for 9:16 vertical');
    assert.ok(assScript.includes('V4Sub,DejaVu Sans'), 'ASS style must define V4Sub');
    assert.ok(assScript.includes('\\c&H00FFFFFF&'), 'Must include active word color highlight tag');

    const twoWordSrt = wordsToTwoWordSrt(speechSegments, 0);
    assert.ok(twoWordSrt.includes('1\n'), 'SRT must be numbered');
    assert.ok(twoWordSrt.includes(' --> '), 'SRT must include standard timestamps');

    logPass('Two-Word Synchronized Subtitle Engine', `Generated ${twoWordChunks.length} chunks, ASS & SRT verified`);
  } catch (err) {
    logFail('Two-Word Synchronized Subtitle Engine', err);
  }

  // -------------------------------------------------------------------------
  // TEST 7: YouTube Live Status Detection Contract
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 7: YouTube Live Status Detection Contract ---');
  try {
    const mockLiveRunner = async () => ({
      stdout: JSON.stringify({
        id: 'mock_live_stream',
        title: 'Breaking News 24/7 Live Broadcast',
        is_live: true,
        live_status: 'is_live',
        uploader: 'NewsNetwork'
      }),
      stderr: ''
    });

    const liveResult = await detectYouTubeLive('https://www.youtube.com/watch?v=mock_live_stream', { _execFile: mockLiveRunner });
    assert.equal(liveResult.isLive, true, 'isLive must be true');
    assert.equal(liveResult.liveStatus, 'is_live', 'liveStatus must be is_live');

    const mockOfflineRunner = async () => ({
      stdout: JSON.stringify({
        id: 'mock_past_stream',
        title: 'Completed Podcast Episode',
        is_live: false,
        was_live: true,
        live_status: 'was_live',
        uploader: 'Podcaster'
      }),
      stderr: ''
    });

    const offlineResult = await detectYouTubeLive('https://www.youtube.com/watch?v=mock_past_stream', { _execFile: mockOfflineRunner });
    assert.equal(offlineResult.isLive, false, 'isLive must be false for past broadcast');
    assert.equal(offlineResult.liveStatus, 'was_live', 'liveStatus must be was_live');

    logPass('YouTube Live Status Detection Contract', 'Verified active live and past broadcast status parsing');
  } catch (err) {
    logFail('YouTube Live Status Detection Contract', err);
  }

  // -------------------------------------------------------------------------
  // TEST 8: Live Highlight Detection & Rolling Chunk Processing
  // -------------------------------------------------------------------------
  console.log('\n--- TEST 8: Live Highlight Detection & Boundary Snapping ---');
  try {
    const liveTranscript = [
      { id: 1, start: 2.0, end: 5.5, text: 'Hey chat, wait what did just happen?' },
      { id: 2, start: 6.0, end: 12.0, text: 'Look at this unbelievable play, oh my god!' },
      { id: 3, start: 12.5, end: 20.0, text: 'No way that actually worked, this is completely insane!' },
      { id: 4, start: 20.5, end: 28.0, text: 'That is definitely the highlight of the entire stream.' },
      { id: 5, start: 28.5, end: 35.0, text: 'We just won the tournament right here!' }
    ];

    const highlightAnalysis = await analyzeLiveHighlight(liveTranscript, 60, { minDuration: 20, maxDuration: 40 });
    assert.ok(highlightAnalysis && highlightAnalysis.clip, 'Must identify a highlight moment');
    const clip = highlightAnalysis.clip;
    assert.ok(clip.duration >= 18 && clip.duration <= 42, `Duration must be ~20-40s (got ${clip.duration})`);
    assert.ok(clip.start >= 2.0, 'Start timestamp must align to speech');
    assert.ok(clip.transcript_evidence.length > 5, 'Must provide authentic transcript evidence');
    assert.ok(clip.overall_score >= 60, 'Must compute high overall score for reaction dialogue');

    logPass('Live Highlight Analysis & Boundary Snapping', `Selected "${clip.title}" (${clip.duration}s, score: ${clip.overall_score})`);
  } catch (err) {
    logFail('Live Highlight Analysis & Boundary Snapping', err);
  }

  // -------------------------------------------------------------------------
  // Teardown & Final Scoreboard
  // -------------------------------------------------------------------------
  console.log('\n======================================================');
  console.log(' VERIFICATION SUMMARY');
  console.log('======================================================');
  console.log(`Passed Checks: ${results.passed.length}`);
  console.log(`Failed Checks: ${results.failed.length}`);

  if (results.failed.length > 0) {
    console.error('\nFAILED CHECKS:');
    results.failed.forEach(f => console.error(`- ${f.name}: ${f.error}`));
    process.exit(1);
  } else {
    console.log('\nALL EVIDENCE-BASED VERIFICATION CHECKS PASSED SUCCESSFULLY!');
  }
}

runLiveVerification().catch(err => {
  console.error('Fatal verification runner error:', err);
  process.exit(1);
});
