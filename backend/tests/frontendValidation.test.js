const assert = require('node:assert/strict');
const path = require('node:path');

async function runFrontendValidationTests() {
  console.log('=============================================');
  console.log(' RUNNING FRONTEND URL VALIDATION TESTS');
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

  const frontendUtilPath = path.join(__dirname, '../../frontend/src/utils/youtubeUrl.js');
  const { parseYouTubeUrl, isValidYouTubeUrl, getYoutubeTypeLabel } = await import(`file://${frontendUtilPath}`);

  // Test 1: All valid YouTube formats
  test('frontend: validates regular video URLs', () => {
    assert.equal(isValidYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), true);
    assert.equal(isValidYouTubeUrl('https://youtube.com/watch?v=dQw4w9WgXcQ'), true);
    assert.equal(isValidYouTubeUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ'), true);
    assert.equal(isValidYouTubeUrl('http://youtube.com/watch?v=dQw4w9WgXcQ'), true);
    assert.equal(isValidYouTubeUrl('youtube.com/watch?v=dQw4w9WgXcQ'), true);
    assert.equal(isValidYouTubeUrl('  youtube.com/watch?v=dQw4w9WgXcQ  '), true);
  });

  test('frontend: validates short URLs (youtu.be)', () => {
    assert.equal(isValidYouTubeUrl('https://youtu.be/dQw4w9WgXcQ'), true);
    assert.equal(isValidYouTubeUrl('http://youtu.be/dQw4w9WgXcQ'), true);
    assert.equal(isValidYouTubeUrl('youtu.be/dQw4w9WgXcQ'), true);
    assert.equal(isValidYouTubeUrl('https://youtu.be/short'), false);
  });

  test('frontend: validates Shorts URLs', () => {
    assert.equal(isValidYouTubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ'), true);
    assert.equal(isValidYouTubeUrl('https://youtube.com/shorts/dQw4w9WgXcQ?feature=share'), true);
    const parsed = parseYouTubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ');
    assert.equal(parsed.type, 'short');
    assert.equal(getYoutubeTypeLabel(parsed.type), 'YouTube Short');
  });

  test('frontend: validates Live URLs', () => {
    assert.equal(isValidYouTubeUrl('https://www.youtube.com/live/dQw4w9WgXcQ'), true);
    const parsed = parseYouTubeUrl('https://www.youtube.com/live/dQw4w9WgXcQ');
    assert.equal(parsed.type, 'live');
    assert.equal(getYoutubeTypeLabel(parsed.type), 'YouTube Live');
  });

  test('frontend: validates Embed and legacy /v/ URLs', () => {
    assert.equal(isValidYouTubeUrl('https://www.youtube.com/embed/dQw4w9WgXcQ'), true);
    assert.equal(isValidYouTubeUrl('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'), true);
    assert.equal(isValidYouTubeUrl('https://www.youtube.com/v/dQw4w9WgXcQ'), true);
  });

  test('frontend: validates YouTube Clip URLs', () => {
    assert.equal(isValidYouTubeUrl('https://www.youtube.com/clip/Ugkx_1234567890abcdef'), true);
    const parsed = parseYouTubeUrl('https://www.youtube.com/clip/Ugkx_1234567890abcdef');
    assert.equal(parsed.type, 'clip');
    assert.equal(getYoutubeTypeLabel(parsed.type), 'YouTube Clip');
  });

  test('frontend: validates Channel URLs and Channel Live URLs', () => {
    assert.equal(isValidYouTubeUrl('https://www.youtube.com/@ChannelName'), true);
    assert.equal(isValidYouTubeUrl('https://www.youtube.com/@ChannelName/live'), true);
    assert.equal(isValidYouTubeUrl('https://www.youtube.com/channel/UC1234567890abcdef'), true);
    assert.equal(isValidYouTubeUrl('https://www.youtube.com/c/ChannelName'), true);
    assert.equal(isValidYouTubeUrl('https://www.youtube.com/user/UserName'), true);

    const parsedLive = parseYouTubeUrl('https://www.youtube.com/@ChannelName/live');
    assert.equal(parsedLive.type, 'channel_live');
    assert.equal(getYoutubeTypeLabel(parsedLive.type), 'Channel Live');
  });

  test('frontend: validates Playlist URLs', () => {
    assert.equal(isValidYouTubeUrl('https://www.youtube.com/playlist?list=PL1234567890'), true);
    assert.equal(isValidYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890'), true);

    const parsedPure = parseYouTubeUrl('https://www.youtube.com/playlist?list=PL1234567890');
    assert.equal(parsedPure.type, 'playlist');
    assert.equal(getYoutubeTypeLabel(parsedPure.type), 'Playlist');

    const parsedWithVideo = parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890');
    assert.equal(parsedWithVideo.type, 'video');
    assert.equal(parsedWithVideo.videoId, 'dQw4w9WgXcQ');
  });

  test('frontend: rejects non-YouTube, invalid, or malicious inputs', () => {
    assert.equal(isValidYouTubeUrl('https://notyoutube.com/watch?v=dQw4w9WgXcQ'), false);
    assert.equal(isValidYouTubeUrl('https://vimeo.com/123456'), false);
    assert.equal(isValidYouTubeUrl('; rm -rf /'), false);
    assert.equal(isValidYouTubeUrl(''), false);
    assert.equal(isValidYouTubeUrl(null), false);
    assert.equal(isValidYouTubeUrl(undefined), false);

    const invalid = parseYouTubeUrl('https://example.com/test');
    assert.equal(invalid.isValid, false);
    assert.ok(invalid.error.includes('Not a YouTube link'));
  });

  console.log('\n=============================================');
  console.log(` FRONTEND VALIDATION TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('=============================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runFrontendValidationTests().catch(err => {
  console.error('Fatal frontend test error:', err);
  process.exit(1);
});
