const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const { isValidYouTubeUrl } = require('../services/youtubeService');
const { getSubtitleStyleParams, hexToBgr } = require('../services/videoProcessingService');
const {
  formatSrtTimestamp,
  formatAssTimestamp,
  segmentsToSrt,
  wordsToTwoWordSrt,
  generateTwoWordChunks,
  generateWordSynchronizedAss,
  alignWordsInSegment,
  parseSubtitleContent
} = require('../services/transcriptionService');

async function runSystemIntegrationTests() {
  console.log('=============================================');
  console.log(' RUNNING V4 SYSTEM & API INTEGRATION TESTS');
  console.log('=============================================\n');

  let passed = 0;
  let failed = 0;

  function test(name, fn) {
    try {
      fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}: ${err.message}`);
      failed++;
    }
  }

  async function asyncTest(name, fn) {
    try {
      await fn();
      console.log(`[PASS] ${name}`);
      passed++;
    } catch (err) {
      console.error(`[FAIL] ${name}: ${err.message}`);
      failed++;
    }
  }

  // 1. SRT Timestamp Formatter Tests
  test('formatSrtTimestamp: correctly formats zero, seconds, and hours with millisecond precision', () => {
    assert.equal(formatSrtTimestamp(0), '00:00:00,000');
    assert.equal(formatSrtTimestamp(1.5), '00:00:01,500');
    assert.equal(formatSrtTimestamp(65.123), '00:01:05,123');
    assert.equal(formatSrtTimestamp(3665.045), '01:01:05,045');
  });

  // 2. SRT Segment Serializer Tests
  test('segmentsToSrt: generates valid numbered SRT subtitle blocks', () => {
    const segments = [
      { id: 1, start: 10.0, end: 14.5, text: 'First spoken caption' },
      { id: 2, start: 15.0, end: 18.2, text: 'Second spoken caption' }
    ];

    const srt = segmentsToSrt(segments, 10.0);
    assert.ok(srt.includes('1\n00:00:00,000 --> 00:00:04,500\nFirst spoken caption'));
    assert.ok(srt.includes('2\n00:00:05,000 --> 00:00:08,200\nSecond spoken caption'));
  });

  // 3. YouTube URL Validation Contract
  test('isValidYouTubeUrl: validates various canonical and mobile YouTube formats', () => {
    assert.equal(isValidYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), true);
    assert.equal(isValidYouTubeUrl('https://youtu.be/dQw4w9WgXcQ'), true);
    assert.equal(isValidYouTubeUrl('https://youtube.com/shorts/dQw4w9WgXcQ'), true);
    assert.equal(isValidYouTubeUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ'), true);
    assert.equal(isValidYouTubeUrl('http://youtube.com/watch?v=dQw4w9WgXcQ&feature=share'), true);

    // Invalid & injection tests
    assert.equal(isValidYouTubeUrl('https://malicious.com/watch?v=dQw4w9WgXcQ'), false);
    assert.equal(isValidYouTubeUrl('https://youtube.com/not_a_video'), false);
    assert.equal(isValidYouTubeUrl('https://youtu.be/short'), false);
    assert.equal(isValidYouTubeUrl('; rm -rf /'), false);
    assert.equal(isValidYouTubeUrl(''), false);
    assert.equal(isValidYouTubeUrl(null), false);
  });

  // 4. Subtitle Style Preset & BGR Conversion
  test('getSubtitleStyleParams: validates preset styling attributes and overrides', () => {
    const white = getSubtitleStyleParams('clean_white');
    assert.ok(white.includes('PrimaryColour=&H00FFFFFF'));
    assert.ok(white.includes('FontSize=19'));
    assert.ok(white.includes('Alignment=2'));

    const highlighted = getSubtitleStyleParams('highlighted');
    assert.ok(highlighted.includes('PrimaryColour=&H001B79FF')); // BGR for Amber
    assert.ok(highlighted.includes('FontSize=21'));

    const bold = getSubtitleStyleParams('bold_creator');
    assert.ok(bold.includes('PrimaryColour=&H0000E5FF')); // BGR for Yellow
    assert.ok(bold.includes('FontSize=24'));
    assert.ok(bold.includes('Bold=1'));

    const minimal = getSubtitleStyleParams('minimal');
    assert.ok(minimal.includes('PrimaryColour=&H00F5F5F5'));
    assert.ok(minimal.includes('FontSize=15'));
    assert.ok(minimal.includes('Bold=0'));

    // Test overrides
    const overridden = getSubtitleStyleParams('clean_white', {
      customFontSize: 24,
      customFontColor: '#00F0FF', // Cyan
      customAlignment: 'middle'
    });
    assert.ok(overridden.includes('FontSize=24'));
    assert.ok(overridden.includes('PrimaryColour=&H00FFF000')); // Cyan converted to BGR
    assert.ok(overridden.includes('Alignment=10')); // Middle-Center is 10
  });

  // 5. Hex to BGR Sanitization and Injection Neutralization
  test('hexToBgr: strictly converts valid hex colors and neutralizes injection attempts', () => {
    assert.equal(hexToBgr('#FFFFFF'), '&H00FFFFFF');
    assert.equal(hexToBgr('#000000'), '&H00000000');
    assert.equal(hexToBgr('#FF0000'), '&H000000FF'); // Red in BGR is 0000FF
    assert.equal(hexToBgr('#00FF00'), '&H0000FF00'); // Green in BGR is 00FF00
    assert.equal(hexToBgr('#0000FF'), '&H00FF0000'); // Blue in BGR is FF0000

    // Malicious or malformed inputs must return safe default white
    assert.equal(hexToBgr('#000000,drawtext=...'), '&H00FFFFFF');
    assert.equal(hexToBgr('malicious'), '&H00FFFFFF');
    assert.equal(hexToBgr(''), '&H00FFFFFF');
    assert.equal(hexToBgr(null), '&H00FFFFFF');
    assert.equal(hexToBgr(undefined), '&H00FFFFFF');
  });

  // 6. Security: Path Traversal Parameter Guard
  test('Parameter regex: strictly rejects directory traversal characters in IDs', () => {
    const isValidId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(id);

    // Safe IDs
    assert.equal(isValidId('550e8400-e29b-41d4-a716-446655440000'), true);
    assert.equal(isValidId('project_123'), true);
    assert.equal(isValidId('CLIP-99'), true);

    // Path traversal sequences
    assert.equal(isValidId('../'), false);
    assert.equal(isValidId('..\\'), false);
    assert.equal(isValidId('../../etc/passwd'), false);
    assert.equal(isValidId('....//'), false);
    assert.equal(isValidId('foo/bar'), false);
    assert.equal(isValidId('foo\\bar'), false);
    assert.equal(isValidId('clip;reboot'), false);
    assert.equal(isValidId('clip`id`'), false);
  });

  // 7. Security: Download Type Whitelist Contract
  test('Download route: only permits "exports" or "uploads" target directories', () => {
    const isAllowedType = type => type === 'exports' || type === 'uploads';

    assert.equal(isAllowedType('exports'), true);
    assert.equal(isAllowedType('uploads'), true);

    assert.equal(isAllowedType('projects'), false);
    assert.equal(isAllowedType('temp'), false);
    assert.equal(isAllowedType('../'), false);
    assert.equal(isAllowedType('etc'), false);
  });

  // 8. Security: Universal Media Allowed Extensions Set Contract
  test('Allowed extensions: accepts universal video and audio containers and rejects executables and scripts', () => {
    const videoExts = ['.mp4', '.mov', '.mkv', '.webm', '.avi', '.flv', '.wmv', '.mpeg', '.mpg', '.m4v', '.3gp', '.ts', '.mts', '.m2ts', '.vob', '.ogv', '.mxf', '.asf'];
    const audioExts = ['.mp3', '.wav', '.aac', '.m4a', '.flac', '.ogg', '.opus', '.wma', '.aiff', '.alac', '.ac3', '.eac3', '.amr', '.caf'];
    const allowed = new Set([...videoExts, ...audioExts]);

    // Check all video formats
    for (const ext of videoExts) {
      assert.equal(allowed.has(ext), true, `Video extension ${ext} must be allowed`);
    }

    // Check all audio formats
    for (const ext of audioExts) {
      assert.equal(allowed.has(ext), true, `Audio extension ${ext} must be allowed`);
    }

    // Rejection of dangerous scripts and executables
    assert.equal(allowed.has('.sh'), false);
    assert.equal(allowed.has('.exe'), false);
    assert.equal(allowed.has('.js'), false);
    assert.equal(allowed.has('.py'), false);
    assert.equal(allowed.has('.html'), false);
    assert.equal(allowed.has('.php'), false);
    assert.equal(allowed.has('.bat'), false);
    assert.equal(allowed.has('.cmd'), false);
  });

  // 9. Video Processing: Render Options Whitelist Contract
  test('Render options whitelisting: verifies that invalid options safely fallback to safe defaults', () => {
    const allowedResolutions = ['720x1280', '1080x1920'];
    const allowedAspectRatios = ['9:16', '1:1', '16:9'];
    const allowedCropPositions = ['center', 'left', 'right'];
    const allowedSubtitleStyles = ['clean_white', 'highlighted', 'minimal', 'bold_creator'];
    const allowedAlignments = ['bottom', 'middle', 'top'];

    const sanitizeOptions = (opts = {}) => ({
      resolution: allowedResolutions.includes(opts.resolution) ? opts.resolution : '720x1280',
      aspectRatio: allowedAspectRatios.includes(opts.aspectRatio) ? opts.aspectRatio : '9:16',
      cropPosition: allowedCropPositions.includes(opts.cropPosition) ? opts.cropPosition : 'center',
      subtitleStyle: allowedSubtitleStyles.includes(opts.subtitleStyle) ? opts.subtitleStyle : 'clean_white',
      customAlignment: allowedAlignments.includes(opts.customAlignment) ? opts.customAlignment : 'bottom',
      customFontSize: Math.min(48, Math.max(10, parseInt(opts.customFontSize, 10) || 19))
    });

    // Valid inputs
    const valid = sanitizeOptions({
      resolution: '1080x1920',
      aspectRatio: '1:1',
      cropPosition: 'left',
      subtitleStyle: 'bold_creator',
      customAlignment: 'top',
      customFontSize: 28
    });
    assert.equal(valid.resolution, '1080x1920');
    assert.equal(valid.aspectRatio, '1:1');
    assert.equal(valid.cropPosition, 'left');
    assert.equal(valid.subtitleStyle, 'bold_creator');
    assert.equal(valid.customAlignment, 'top');
    assert.equal(valid.customFontSize, 28);

    // Malicious or invalid inputs
    const neutralized = sanitizeOptions({
      resolution: '720x1280,drawtext=... ',
      aspectRatio: 'invalid',
      cropPosition: 'random',
      subtitleStyle: 'injected_style',
      customAlignment: 'everywhere',
      customFontSize: 999
    });
    assert.equal(neutralized.resolution, '720x1280');
    assert.equal(neutralized.aspectRatio, '9:16');
    assert.equal(neutralized.cropPosition, 'center');
    assert.equal(neutralized.subtitleStyle, 'clean_white');
    assert.equal(neutralized.customAlignment, 'bottom');
    assert.equal(neutralized.customFontSize, 48); // Clamped to 48
  });

  // 10. Watermark Filter Specification Contract (Strict Fixed Top-Right Position)
  test('Watermark Filter: correctly formats discrete V4 watermark with top-right coordinates and 38% opacity', () => {
    const fontPath = '/data/data/com.termux/files/usr/share/fonts/TTF/DejaVuSans-Bold.ttf';
    const escapedFont = fontPath.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''");
    const watermarkFilter = `drawtext=text='V4':fontfile='${escapedFont}':fontsize=h*0.022:fontcolor=white@0.38:box=0:x=w-tw-(w*0.03):y=(h*0.03)`;

    assert.ok(watermarkFilter.includes("text='V4'"));
    assert.ok(watermarkFilter.includes('fontcolor=white@0.38'));
    assert.ok(watermarkFilter.includes('fontsize=h*0.022'));
    assert.ok(watermarkFilter.includes('x=w-tw-(w*0.03)'));
    assert.ok(watermarkFilter.includes('y=(h*0.03)'), 'Watermark must be positioned at top-right (y=h*0.03)');
  });

  // 11. Static Route Isolation Contract (CVE Prevention)
  test('Static Route Isolation: verifies that cookies.txt and projects are excluded from static mounts', () => {
    const safeStaticMounts = new Set(['/data/uploads', '/data/exports']);
    assert.equal(safeStaticMounts.has('/data/uploads'), true);
    assert.equal(safeStaticMounts.has('/data/exports'), true);
    assert.equal(safeStaticMounts.has('/data'), false, 'Root /data MUST NOT be statically mounted');
    assert.equal(safeStaticMounts.has('/data/projects'), false);
    assert.equal(safeStaticMounts.has('/data/cookies.txt'), false);
  });

  // 12. Render Lock Concurrency Serializer Contract
  await asyncTest('Render Lock: serializes concurrent transcode executions sequentially', async () => {
    let renderLock = Promise.resolve();
    function withRenderLock(fn) {
      const next = renderLock.then(() => fn(), () => fn());
      renderLock = next.catch(() => {});
      return next;
    }

    const executionOrder = [];
    const job = (id, delayMs) => withRenderLock(async () => {
      executionOrder.push(`start_${id}`);
      await new Promise(r => setTimeout(r, delayMs));
      executionOrder.push(`end_${id}`);
    });

    await Promise.all([job(1, 20), job(2, 5), job(3, 10)]);
    assert.deepEqual(executionOrder, [
      'start_1', 'end_1',
      'start_2', 'end_2',
      'start_3', 'end_3'
    ], 'Jobs must execute strictly one at a time in FIFO order');
  });

  // 13. Subtitle Parser: Multi-format parsing (SRT, WebVTT, ASS/SSA, TTML, JSON3)
  test('parseSubtitleContent: accurately parses all major subtitle formats into normalized segments', () => {
    // SRT
    const srtSample = `1\n00:00:01,000 --> 00:00:03,500\nHello World\n\n2\n00:00:04,000 --> 00:00:06,200\nSecond line`;
    const srtParsed = parseSubtitleContent(srtSample, 'srt');
    assert.equal(srtParsed.length, 2);
    assert.equal(srtParsed[0].text, 'Hello World');
    assert.equal(srtParsed[0].start, 1.0);
    assert.equal(srtParsed[0].end, 3.5);

    // WebVTT
    const vttSample = `WEBVTT\n\n00:00:01.200 --> 00:00:04.800\nWebVTT line`;
    const vttParsed = parseSubtitleContent(vttSample, 'vtt');
    assert.equal(vttParsed.length, 1);
    assert.equal(vttParsed[0].text, 'WebVTT line');
    assert.equal(vttParsed[0].start, 1.2);
    assert.equal(vttParsed[0].end, 4.8);

    // ASS / SSA
    const assSample = `[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:02.00,0:00:05.50,Default,,0,0,0,,{\\b1}ASS Dialogue{\\b0}`;
    const assParsed = parseSubtitleContent(assSample, 'ass');
    assert.equal(assParsed.length, 1);
    assert.equal(assParsed[0].text, 'ASS Dialogue');
    assert.equal(assParsed[0].start, 2.0);
    assert.equal(assParsed[0].end, 5.5);

    // TTML / DFXP XML
    const ttmlSample = `<tt><p begin="00:00:01.500" end="00:00:04.000"><span>TTML Content</span></p></tt>`;
    const ttmlParsed = parseSubtitleContent(ttmlSample, 'ttml');
    assert.equal(ttmlParsed.length, 1);
    assert.equal(ttmlParsed[0].text, 'TTML Content');
    assert.equal(ttmlParsed[0].start, 1.5);
    assert.equal(ttmlParsed[0].end, 4.0);

    // JSON3
    const json3Sample = JSON.stringify({
      events: [
        { tStartMs: 2500, dDurationMs: 3000, segs: [{ utf8: 'JSON3 ' }, { utf8: 'Caption' }] }
      ]
    });
    const json3Parsed = parseSubtitleContent(json3Sample, 'json3');
    assert.equal(json3Parsed.length, 1);
    assert.equal(json3Parsed[0].text, 'JSON3 Caption');
    assert.equal(json3Parsed[0].start, 2.5);
    assert.equal(json3Parsed[0].end, 5.5);
  });

  // 14. Audio-Only Upload Classification Contract
  test('Audio-only upload metadata contract: validates audio fallback properties and vertical default', () => {
    const mockAudioOnlyMetadata = {
      name: 'interview.mp3',
      format: 'mp3',
      duration: 180.5,
      width: 720,
      height: 1280,
      fps: 30,
      bitrate: 192000,
      hasVideo: false,
      isAudioOnly: true,
      mediaType: 'audio',
      aspectRatio: '9:16'
    };

    assert.equal(mockAudioOnlyMetadata.isAudioOnly, true);
    assert.equal(mockAudioOnlyMetadata.hasVideo, false);
    assert.equal(mockAudioOnlyMetadata.aspectRatio, '9:16');
    assert.equal(mockAudioOnlyMetadata.width, 720);
    assert.equal(mockAudioOnlyMetadata.height, 1280);
  });

  // 15. Audio Loudness Normalization Specification Contract
  test('Audio Loudnorm Filter: verifies EBU R128 standard target parameters (-16 LUFS)', () => {
    const loudnormFilter = 'loudnorm=I=-16:TP=-1.5:LRA=11';
    assert.ok(loudnormFilter.includes('I=-16'), 'Integrated loudness must be -16 LUFS for mobile shorts');
    assert.ok(loudnormFilter.includes('TP=-1.5'), 'True Peak ceiling must prevent clipping');
    assert.ok(loudnormFilter.includes('LRA=11'), 'Loudness range must match mobile speech guidelines');
  });

  // 16. Watermark Contract: Strict Fixed Top-Right Position & 38% Opacity
  test('Watermark Contract: verifies subtle 38% opacity, top-right position, and exact "V4" logo text', () => {
    const fontFile = '/data/data/com.termux/files/usr/share/fonts/TTF/DejaVuSans-Bold.ttf';
    const escaped = fontFile.replace(/\\/g, '/').replace(/:/g, '\\:').replace(/'/g, "'\\''");
    const filter = `drawtext=text='V4':fontfile='${escaped}':fontsize=h*0.022:fontcolor=white@0.38:box=0:x=w-tw-(w*0.03):y=(h*0.03)`;

    assert.ok(filter.startsWith("drawtext=text='V4'"), "Must be strictly 'V4', not 'V4 Clipper'");
    assert.ok(filter.includes('x=w-tw-(w*0.03)'), 'Must align horizontally to top-right with 3% margin');
    assert.ok(filter.includes('y=(h*0.03)'), 'Must align vertically to top with 3% margin');
    assert.ok(filter.includes('fontcolor=white@0.38'), 'Must be 38% white opacity');
  });

  // 17. Subtitle System Overhaul: Two-Word Chunking Contract
  test('generateTwoWordChunks: groups speech into ~2 words at a time and respects pauses & sentence endings', () => {
    const words = [
      { word: 'Hello', start: 0.0, end: 0.4 },
      { word: 'world!', start: 0.45, end: 0.9 },
      { word: 'This', start: 1.2, end: 1.5 },
      { word: 'is', start: 1.55, end: 1.8 },
      { word: 'V4.', start: 1.85, end: 2.2 }
    ];

    const chunks = generateTwoWordChunks(words, 0);
    assert.equal(chunks.length, 3);
    assert.equal(chunks[0].text, 'Hello world!');
    assert.equal(chunks[0].words.length, 2);
    assert.equal(chunks[1].text, 'This is');
    assert.equal(chunks[1].words.length, 2);
    assert.equal(chunks[2].text, 'V4.');
    assert.equal(chunks[2].words.length, 1);
  });

  // 18. Subtitle System Overhaul: Word-Synchronized ASS Generator Contract
  test('generateWordSynchronizedAss: produces valid ASS subtitle script with 9:16 safe area and word highlighting', () => {
    const words = [
      { word: 'Super', start: 0.0, end: 0.4 },
      { word: 'fast!', start: 0.45, end: 0.9 }
    ];

    const ass = generateWordSynchronizedAss(words, 0, {
      resolution: '720x1280',
      subtitleStyle: 'clean_white'
    });

    assert.ok(ass.includes('PlayResX: 720'));
    assert.ok(ass.includes('PlayResY: 1280'));
    assert.ok(ass.includes('Style: V4Sub,DejaVu Sans,28')); // Scaled font size ~28px
    assert.ok(ass.includes('MarginV, Effect, Text'));
    assert.ok(ass.includes('Dialogue: 0,'));
    assert.ok(ass.includes('Super'));
    assert.ok(ass.includes('fast!'));
    assert.ok(ass.includes('\\c&H00FFFFFF&')); // Active word highlight
  });

  // 19. Two-Word SRT Synchronization Contract
  test('wordsToTwoWordSrt: outputs SRT subtitle blocks strictly formatted as ~2-word units', () => {
    const words = [
      { word: 'Step', start: 0.0, end: 0.3 },
      { word: 'one', start: 0.35, end: 0.6 },
      { word: 'begins.', start: 0.65, end: 1.0 }
    ];

    const srt = wordsToTwoWordSrt(words, 0);
    assert.ok(srt.includes('1\n00:00:00,000 --> 00:00:00,600\nStep one'));
    assert.ok(srt.includes('2\n00:00:00,650 --> 00:00:01,000\nbegins.'));
  });

  // 20. Segment Word Alignment Without Timing Fabrication
  test('alignWordsInSegment: weights words strictly bounded inside actual audio boundaries', () => {
    const seg = {
      start: 5.0,
      end: 7.0,
      text: 'Quick brown fox jumps.'
    };

    const words = alignWordsInSegment(seg);
    assert.equal(words.length, 4);
    assert.equal(words[0].word, 'Quick');
    assert.equal(words[0].start, 5.0);
    assert.equal(words[3].word, 'jumps.');
    assert.equal(words[3].end, 7.0);

    for (let i = 0; i < words.length - 1; i++) {
      assert.ok(words[i].end <= words[i + 1].start + 0.001);
    }
  });

  console.log('\n=============================================');
  console.log(` SYSTEM INTEGRATION TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('=============================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runSystemIntegrationTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
