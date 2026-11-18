const assert = require('node:assert/strict');
const {
  safeParseJson,
  normalizeText,
  validateTranscriptEvidence,
  analyzeWithLocalHeuristics,
  analyzeTranscript
} = require('../services/analysisService');
const { isValidYouTubeUrl } = require('../services/youtubeService');
const { getSubtitleStyleParams, hexToBgr } = require('../services/videoProcessingService');

async function runTests() {
  console.log('=============================================');
  console.log(' RUNNING ANALYSIS ENGINE UNIT TEST SUITE');
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

  // 1. JSON Parsing Tests
  test('safeParseJson: parses clean raw JSON', () => {
    const raw = '{"clips": [{"start": 10, "end": 45, "title": "Test"}]}';
    const parsed = safeParseJson(raw);
    assert.equal(parsed.clips.length, 1);
    assert.equal(parsed.clips[0].title, 'Test');
  });

  test('safeParseJson: parses Markdown fenced JSON', () => {
    const raw = '```json\n{"clips": [{"start": 12, "end": 48}]}\n```';
    const parsed = safeParseJson(raw);
    assert.equal(parsed.clips.length, 1);
    assert.equal(parsed.clips[0].start, 12);
  });

  test('safeParseJson: rejects malformed JSON without outer object', () => {
    assert.throws(() => {
      safeParseJson('Sorry, I cannot generate the clips requested.');
    }, /No valid JSON object found/);
  });

  test('safeParseJson: rejects malformed inner JSON syntax safely', () => {
    assert.throws(() => {
      safeParseJson('{"clips": [ invalid json content }');
    }, /Malformed JSON structure/);
  });

  // 2. Transcript Evidence Validation Tests
  test('validateTranscriptEvidence: accepts exact contiguous quote with case & punctuation variations', () => {
    const segments = [
      { start: 0, end: 5, text: 'Hello world, this is a demonstration!' },
      { start: 5, end: 10, text: 'We are testing evidence validation.' }
    ];
    const evidence = 'this is a demonstration';
    assert.equal(validateTranscriptEvidence(evidence, segments), true);
  });

  test('validateTranscriptEvidence: rejects quote not present in segments', () => {
    const segments = [
      { start: 0, end: 5, text: 'The topic is artificial intelligence.' },
      { start: 5, end: 10, text: 'It creates automated workflows.' }
    ];
    const fabricatedEvidence = 'secret formula for viral videos';
    assert.equal(validateTranscriptEvidence(fabricatedEvidence, segments), false);
  });

  test('validateTranscriptEvidence: rejects evidence with fewer than 3 words', () => {
    const segments = [
      { start: 0, end: 5, text: 'The topic is artificial intelligence.' }
    ];
    assert.equal(validateTranscriptEvidence('artificial intelligence', segments), false);
  });

  // 3. Local Heuristic & Duration Boundary Tests
  test('analyzeWithLocalHeuristics: respects minDuration and maxDuration boundaries', () => {
    // Generate 120 seconds of synthetic dialogue
    const segments = [];
    for (let i = 0; i < 24; i++) {
      segments.push({
        id: i + 1,
        start: i * 5,
        end: (i + 1) * 5,
        text: `Why is sentence number ${i + 1} an incredible secret to understand? Actually, notice this key fact.`
      });
    }

    const minDur = 30;
    const maxDur = 50;
    const result = analyzeWithLocalHeuristics(segments, 120, 3, [minDur, maxDur]);

    assert.ok(result.clips.length > 0, 'Should find at least 1 clip');
    for (const clip of result.clips) {
      assert.ok(clip.duration >= (minDur - 0.5), `Clip duration ${clip.duration} should be >= minDuration`);
      assert.ok(clip.duration <= (maxDur + 0.5), `Clip duration ${clip.duration} should be <= maxDuration`);
    }
  });

  test('analyzeWithLocalHeuristics: enforces non-overlapping clips', () => {
    const segments = [];
    for (let i = 0; i < 30; i++) {
      segments.push({
        id: i + 1,
        start: i * 5,
        end: (i + 1) * 5,
        text: `Important discussion point ${i} regarding amazing viral moments and reasons.`
      });
    }

    const result = analyzeWithLocalHeuristics(segments, 150, 4, [30, 60]);

    for (let i = 0; i < result.clips.length; i++) {
      for (let j = i + 1; j < result.clips.length; j++) {
        const a = result.clips[i];
        const b = result.clips[j];
        const overlaps = (a.start < b.end && a.end > b.start);
        assert.equal(overlaps, false, `Clip ${i} [${a.start}-${a.end}] overlaps with Clip ${j} [${b.start}-${b.end}]`);
      }
    }
  });

  test('analyzeWithLocalHeuristics: clipCount matches clips.length and <= targetClipCount', () => {
    const segments = [];
    for (let i = 0; i < 30; i++) {
      segments.push({
        id: i + 1,
        start: i * 5,
        end: (i + 1) * 5,
        text: `Here is dialogue segment ${i} with interesting keywords like why and secret.`
      });
    }

    const targetCount = 2;
    const result = analyzeWithLocalHeuristics(segments, 150, targetCount, [30, 60]);

    assert.equal(result.clipCount, result.clips.length);
    assert.ok(result.clips.length <= targetCount);
  });

  test('analyzeWithLocalHeuristics: rejects clips when video is shorter than minDuration', () => {
    const shortSegments = [
      { id: 1, start: 0, end: 5, text: 'Short video.' },
      { id: 2, start: 5, end: 10, text: 'Ending here.' }
    ];

    // Request 30-60s clips on a 10s video
    const result = analyzeWithLocalHeuristics(shortSegments, 10, 3, [30, 60]);
    assert.equal(result.clips.length, 0, 'Must reject clips outside duration range');
    assert.equal(result.clipCount, 0);
  });

  // 4. Fallback Handling
  await asyncTest('analyzeTranscript: seamless local fallback when Groq key is absent or empty', async () => {
    const originalKey = process.env.GROQ_API_KEY;
    delete process.env.GROQ_API_KEY;

    const segments = [];
    for (let i = 0; i < 20; i++) {
      segments.push({
        id: i + 1,
        start: i * 5,
        end: (i + 1) * 5,
        text: `Sentence ${i} why does this secret always amaze creators with emotion?`
      });
    }

    const result = await analyzeTranscript(segments, 100, 3, [30, 60]);

    assert.equal(result.engine, 'local_heuristic_nlp');
    assert.ok(result.clips.length > 0);
    assert.equal(result.clipCount, result.clips.length);

    if (originalKey) process.env.GROQ_API_KEY = originalKey;
  });

  // 5. YouTube URL Validation Tests
  test('isValidYouTubeUrl: correctly identifies valid and invalid YouTube URLs', () => {
    assert.equal(isValidYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), true);
    assert.equal(isValidYouTubeUrl('http://youtube.com/watch?v=dQw4w9WgXcQ'), true);
    assert.equal(isValidYouTubeUrl('https://youtu.be/dQw4w9WgXcQ'), true);
    assert.equal(isValidYouTubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ'), true);
    assert.equal(isValidYouTubeUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ'), true);

    assert.equal(isValidYouTubeUrl('https://example.com/video.mp4'), false);
    assert.equal(isValidYouTubeUrl('https://vimeo.com/12345678'), false);
    assert.equal(isValidYouTubeUrl(''), false);
    assert.equal(isValidYouTubeUrl(null), false);
  });

  // 6. Subtitle Preset and Custom Override Tests
  test('getSubtitleStyleParams: returns correct libass style string with overrides', () => {
    const cleanWhite = getSubtitleStyleParams('clean_white');
    assert.ok(cleanWhite.includes('PrimaryColour=&H00FFFFFF'));
    assert.ok(cleanWhite.includes('FontSize=19'));

    const highlighted = getSubtitleStyleParams('highlighted');
    assert.ok(highlighted.includes('PrimaryColour=&H001B79FF'));

    const customOverrides = getSubtitleStyleParams('clean_white', {
      customFontSize: 26,
      customFontColor: '#00FF00',
      customAlignment: 'top'
    });
    assert.ok(customOverrides.includes('FontSize=26'));
    assert.ok(customOverrides.includes('PrimaryColour=&H0000FF00'));
    assert.ok(customOverrides.includes('Alignment=6'));
  });

  // 7. Dynamic duration adaptation test for short videos
  test('analyzeWithLocalHeuristics: extracts clips from short video when duration range is adapted', () => {
    const shortSegments = [
      { id: 1, start: 0, end: 5, text: 'This secret hook grabs your attention immediately!' },
      { id: 2, start: 5, end: 10, text: 'Why does this technique work every time?' },
      { id: 3, start: 10, end: 15, text: 'The result will surprise every creator.' }
    ];

    // Adapted duration [5, 15] for 15s total video
    const result = analyzeWithLocalHeuristics(shortSegments, 15, 2, [5, 15]);
    assert.ok(result.clips.length > 0, 'Should find clips when range is adapted to video duration');
    assert.ok(result.clips[0].duration >= 5 && result.clips[0].duration <= 15);
  });

  // 8. Hex Color Sanitization & Injection Defense
  test('hexToBgr: safely parses valid hex colors and neutralizes injection attempts', () => {
    assert.equal(hexToBgr('#FFFFFF'), '&H00FFFFFF');
    assert.equal(hexToBgr('FFFFFF'), '&H00FFFFFF');
    assert.equal(hexToBgr('#FF791B'), '&H001B79FF'); // Converts RGB to BGR for libass
    assert.equal(hexToBgr('#00FF00'), '&H0000FF00');

    // Neutralize injection payloads
    assert.equal(hexToBgr('#000000,drawtext=text=pwnd'), '&H00FFFFFF');
    assert.equal(hexToBgr('"><script>'), '&H00FFFFFF');
    assert.equal(hexToBgr(''), '&H00FFFFFF');
    assert.equal(hexToBgr(null), '&H00FFFFFF');
    assert.equal(hexToBgr(123456), '&H00FFFFFF');
  });

  // 9. Project ID Path Traversal Defense Pattern Test
  test('ID regex: correctly rejects path traversal sequences and accepts safe IDs', () => {
    const isValidId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(id);

    assert.equal(isValidId('48ea43dd-63bd-4b90-bc29-a9a40ea9bb10'), true);
    assert.equal(isValidId('clip_123_test'), true);
    assert.equal(isValidId('project-99'), true);

    // Reject path traversal attempts
    assert.equal(isValidId('../etc/passwd'), false);
    assert.equal(isValidId('../../data'), false);
    assert.equal(isValidId('foo/bar'), false);
    assert.equal(isValidId('test\\path'), false);
    assert.equal(isValidId('id;rm -rf /'), false);
    assert.equal(isValidId(''), false);
    assert.equal(isValidId(null), false);
  });

  console.log('\n=============================================');
  console.log(` TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('=============================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test runner fatal error:', err);
  process.exit(1);
});
