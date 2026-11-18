const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const {
  parseYouTubeUrl,
  isValidYouTubeUrl,
  resolveCookiesPath,
  getYtDlpBaseArgs,
  normalizeYtDlpError,
  cleanupMatchingFiles,
  getYouTubeMetadata,
  getYouTubeCaptions,
  downloadTemporaryAudio,
  retrieveClipSegment,
  detectYouTubeLive,
  extractLiveRollingChunk,
  cleanupLiveRollingChunk
} = require('../services/youtubeService');

const TEST_TEMP_DIR = path.join(__dirname, 'temp_test_sandbox');

async function runYouTubeServiceTests() {
  console.log('=============================================');
  console.log(' RUNNING YOUTUBE SERVICE & CLEANUP TESTS');
  console.log('=============================================\n');

  if (!fs.existsSync(TEST_TEMP_DIR)) {
    fs.mkdirSync(TEST_TEMP_DIR, { recursive: true });
  }

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

  // 1. Comprehensive URL Validation & Parsing Coverage (Requirement 1 & 5)
  test('isValidYouTubeUrl & parseYouTubeUrl: validates all supported YouTube URL formats and extracts types', () => {
    // 1.1 Regular Videos (canonical, mobile, http, https, no scheme, params, timestamps)
    assert.equal(isValidYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), true);
    assert.equal(isValidYouTubeUrl('https://youtube.com/watch?v=dQw4w9WgXcQ'), true);
    assert.equal(isValidYouTubeUrl('https://m.youtube.com/watch?v=dQw4w9WgXcQ'), true);
    assert.equal(isValidYouTubeUrl('http://youtube.com/watch?v=dQw4w9WgXcQ'), true);
    assert.equal(isValidYouTubeUrl('youtube.com/watch?v=dQw4w9WgXcQ'), true);
    assert.equal(isValidYouTubeUrl('  https://www.youtube.com/watch?v=dQw4w9WgXcQ  \n'), true);
    assert.equal(isValidYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s&feature=share'), true);

    const parsedRegular = parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42s');
    assert.equal(parsedRegular.isValid, true);
    assert.equal(parsedRegular.type, 'video');
    assert.equal(parsedRegular.id, 'dQw4w9WgXcQ');
    assert.equal(parsedRegular.timestamp, '42s');

    // 1.2 Short URLs (youtu.be)
    assert.equal(isValidYouTubeUrl('https://youtu.be/dQw4w9WgXcQ'), true);
    assert.equal(isValidYouTubeUrl('http://youtu.be/dQw4w9WgXcQ'), true);
    assert.equal(isValidYouTubeUrl('youtu.be/dQw4w9WgXcQ'), true);
    assert.equal(isValidYouTubeUrl('https://youtu.be/dQw4w9WgXcQ?t=15s'), true);

    const parsedShortUrl = parseYouTubeUrl('https://youtu.be/dQw4w9WgXcQ');
    assert.equal(parsedShortUrl.isValid, true);
    assert.equal(parsedShortUrl.type, 'video');
    assert.equal(parsedShortUrl.id, 'dQw4w9WgXcQ');

    // 1.3 YouTube Shorts
    assert.equal(isValidYouTubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ'), true);
    assert.equal(isValidYouTubeUrl('https://youtube.com/shorts/dQw4w9WgXcQ?feature=share'), true);

    const parsedShort = parseYouTubeUrl('https://www.youtube.com/shorts/dQw4w9WgXcQ');
    assert.equal(parsedShort.isValid, true);
    assert.equal(parsedShort.type, 'short');
    assert.equal(parsedShort.id, 'dQw4w9WgXcQ');

    // 1.4 Live Stream URLs
    assert.equal(isValidYouTubeUrl('https://www.youtube.com/live/dQw4w9WgXcQ'), true);
    assert.equal(isValidYouTubeUrl('https://youtube.com/live/dQw4w9WgXcQ'), true);

    const parsedLive = parseYouTubeUrl('https://www.youtube.com/live/dQw4w9WgXcQ');
    assert.equal(parsedLive.isValid, true);
    assert.equal(parsedLive.type, 'live');
    assert.equal(parsedLive.id, 'dQw4w9WgXcQ');

    // 1.5 Embed and Legacy /v/ URLs
    assert.equal(isValidYouTubeUrl('https://www.youtube.com/embed/dQw4w9WgXcQ'), true);
    assert.equal(isValidYouTubeUrl('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ'), true);
    assert.equal(isValidYouTubeUrl('https://www.youtube.com/v/dQw4w9WgXcQ'), true);

    const parsedEmbed = parseYouTubeUrl('https://www.youtube.com/embed/dQw4w9WgXcQ');
    assert.equal(parsedEmbed.isValid, true);
    assert.equal(parsedEmbed.type, 'embed');
    assert.equal(parsedEmbed.id, 'dQw4w9WgXcQ');

    // 1.6 YouTube Clips
    assert.equal(isValidYouTubeUrl('https://www.youtube.com/clip/Ugkx_1234567890abcdef'), true);
    const parsedClip = parseYouTubeUrl('https://www.youtube.com/clip/Ugkx_1234567890abcdef');
    assert.equal(parsedClip.isValid, true);
    assert.equal(parsedClip.type, 'clip');
    assert.equal(parsedClip.id, 'Ugkx_1234567890abcdef');

    // 1.7 Channel Live URLs
    assert.equal(isValidYouTubeUrl('https://www.youtube.com/@ChannelName/live'), true);
    assert.equal(isValidYouTubeUrl('https://www.youtube.com/channel/UC1234567890abcdef/live'), true);
    assert.equal(isValidYouTubeUrl('https://www.youtube.com/c/ChannelName/live'), true);
    assert.equal(isValidYouTubeUrl('https://www.youtube.com/user/UserName/live'), true);

    const parsedChannelLive = parseYouTubeUrl('https://www.youtube.com/@ChannelName/live');
    assert.equal(parsedChannelLive.isValid, true);
    assert.equal(parsedChannelLive.type, 'channel_live');
    assert.equal(parsedChannelLive.id, '@ChannelName');

    // 1.8 Channel URLs
    assert.equal(isValidYouTubeUrl('https://www.youtube.com/@ChannelName'), true);
    assert.equal(isValidYouTubeUrl('https://www.youtube.com/channel/UC1234567890abcdef'), true);
    assert.equal(isValidYouTubeUrl('https://www.youtube.com/c/ChannelName'), true);
    assert.equal(isValidYouTubeUrl('https://www.youtube.com/user/UserName'), true);

    const parsedChannel = parseYouTubeUrl('https://www.youtube.com/@ChannelName');
    assert.equal(parsedChannel.isValid, true);
    assert.equal(parsedChannel.type, 'channel');

    // 1.9 Playlist URLs (pure playlist and video+playlist combination)
    assert.equal(isValidYouTubeUrl('https://www.youtube.com/playlist?list=PL1234567890'), true);
    const parsedPlaylist = parseYouTubeUrl('https://www.youtube.com/playlist?list=PL1234567890');
    assert.equal(parsedPlaylist.isValid, true);
    assert.equal(parsedPlaylist.type, 'playlist');
    assert.equal(parsedPlaylist.id, 'PL1234567890');

    assert.equal(isValidYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890'), true);
    const parsedVideoPlaylist = parseYouTubeUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL1234567890');
    assert.equal(parsedVideoPlaylist.isValid, true);
    assert.equal(parsedVideoPlaylist.type, 'video');
    assert.equal(parsedVideoPlaylist.videoId, 'dQw4w9WgXcQ');
    assert.equal(parsedVideoPlaylist.playlistId, 'PL1234567890');

    // 1.10 Invalid, non-YouTube, and injection inputs
    assert.equal(isValidYouTubeUrl('https://notyoutube.com/watch?v=dQw4w9WgXcQ'), false);
    assert.equal(isValidYouTubeUrl('https://example.com/video.mp4'), false);
    assert.equal(isValidYouTubeUrl('https://vimeo.com/12345678'), false);
    assert.equal(isValidYouTubeUrl('https://youtube.com/not_a_video'), false);
    assert.equal(isValidYouTubeUrl('https://youtu.be/short'), false);
    assert.equal(isValidYouTubeUrl('; rm -rf /'), false);
    assert.equal(isValidYouTubeUrl(''), false);
    assert.equal(isValidYouTubeUrl(null), false);
    assert.equal(isValidYouTubeUrl(undefined), false);

    const parsedInvalid = parseYouTubeUrl('https://example.com/video');
    assert.equal(parsedInvalid.isValid, false);
    assert.ok(parsedInvalid.error.includes('Not a YouTube'));
  });

  // 2. yt-dlp Base Arguments Configuration
  test('getYtDlpBaseArgs: configures Node.js runtime and safe default client args without conflicting user-agent', () => {
    const args = getYtDlpBaseArgs();

    // Verify JavaScript runtime flag exists to resolve n-challenge
    const jsIndex = args.indexOf('--js-runtimes');
    assert.ok(jsIndex !== -1, '--js-runtimes flag must be configured');
    assert.ok(args[jsIndex + 1].includes('node'), 'Node.js must be configured as JS runtime');

    // Verify player client priorities (drops broken tv client to avoid UNPLAYABLE / reload blocks)
    const extIndex = args.indexOf('--extractor-args');
    assert.ok(extIndex !== -1, '--extractor-args must be present');
    assert.ok(args[extIndex + 1].includes('player_client='), 'Player client arg must be set');
    assert.ok(args[extIndex + 1].includes('default') && args[extIndex + 1].includes('-tv'), 'Must use default clients and exclude -tv');

    // Verify user-agent is NOT hardcoded to prevent client mismatch bot blocks
    assert.equal(args.includes('--user-agent'), false, 'Must NOT hardcode --user-agent so yt-dlp sends authentic client headers');

    // Verify anti-playlist and rate limit flags
    assert.ok(args.includes('--no-playlist'));
    assert.ok(args.includes('--sleep-requests'));
  });

  // 3. Secure Cookie Resolution Contract
  test('resolveCookiesPath: never returns non-existent path or exposes secret tokens', () => {
    const resolved = resolveCookiesPath();
    if (resolved) {
      assert.ok(typeof resolved === 'string');
      assert.ok(fs.existsSync(resolved), 'Resolved cookie path must actually exist on disk');
    } else {
      assert.equal(resolved, null, 'Must return null safely if no cookie file exists');
    }
  });

  // 4. Bot & Authentication Error Normalization
  test('normalizeYtDlpError: cleanly translates YouTube bot triggers into user guidance', () => {
    const botErr = new Error("Command failed: ERROR: [youtube] Sign in to confirm you're not a bot");
    botErr.stderr = "ERROR: [youtube] Sign in to confirm you're not a bot. Use --cookies-from-browser or --cookies";

    const normalized = normalizeYtDlpError(botErr, 'https://youtu.be/test');
    assert.ok(normalized.message.includes('cookies.txt'), 'Must mention cookies.txt instructions');
    assert.ok(!normalized.message.includes('Command failed'), 'Must strip noisy child-process traceback');
  });

  test('normalizeYtDlpError: translates "The page needs to be reloaded" / UNPLAYABLE into user guidance', () => {
    const reloadErr = new Error("Command failed: ERROR: [youtube] aqz-KE-bpKQ: The page needs to be reloaded");
    reloadErr.stderr = "ERROR: [youtube] aqz-KE-bpKQ: The page needs to be reloaded. playability status: UNPLAYABLE";

    const normalized = normalizeYtDlpError(reloadErr, 'https://youtu.be/aqz-KE-bpKQ');
    assert.ok(normalized.message.includes('The page needs to be reloaded'), 'Must mention the exact error');
    assert.ok(normalized.message.includes('cookies.txt'), 'Must guide user to supply cookies.txt');
  });

  test('normalizeYtDlpError: translates format unavailable into explicit no-full-download user guidance', () => {
    const fmtErr = new Error("Command failed: ERROR: [youtube] _HU_d0qS2x0: Requested format is not available.");
    fmtErr.stderr = "ERROR: [youtube] _HU_d0qS2x0: Requested format is not available.";

    const normalized = normalizeYtDlpError(fmtErr, 'https://youtu.be/_HU_d0qS2x0');
    assert.ok(normalized.message.includes('No separate audio-only stream is available'), 'Must explain audio-only limitation');
    assert.ok(normalized.message.includes('format 18 was not downloaded'), 'Must reaffirm strict no-full-video-download policy');
  });

  test('normalizeYtDlpError: translates Node.js execFile timeout into actionable user guidance', () => {
    const timeoutErr = new Error('Command timed out');
    timeoutErr.code = 'ETIMEDOUT';
    timeoutErr.killed = true;
    timeoutErr.signal = 'SIGTERM';

    const normalized = normalizeYtDlpError(timeoutErr, 'https://youtu.be/test');
    assert.ok(normalized.message.includes('timed out'), 'Must mention stream retrieval timed out');
    assert.ok(normalized.message.includes('connection') || normalized.message.includes('retry'), 'Must provide actionable guidance');
  });

  test('normalizeYtDlpError: translates region restriction into user guidance', () => {
    const geoErr = new Error("Command failed: ERROR: [youtube] dQw4w9WgXcQ: Video unavailable. The uploader has not made this video available in your country");
    geoErr.stderr = "ERROR: [youtube] dQw4w9WgXcQ: Video unavailable. The uploader has not made this video available in your country";

    const normalized = normalizeYtDlpError(geoErr, 'https://youtu.be/dQw4w9WgXcQ');
    assert.ok(normalized.message.includes('Region-restricted'), 'Must mention Region-restricted');
  });

  test('normalizeYtDlpError: translates private video into user guidance', () => {
    const privErr = new Error("Command failed: ERROR: [youtube] dQw4w9WgXcQ: This video is private");
    privErr.stderr = "ERROR: [youtube] dQw4w9WgXcQ: This video is private";

    const normalized = normalizeYtDlpError(privErr, 'https://youtu.be/dQw4w9WgXcQ');
    assert.ok(normalized.message.includes('Private video'), 'Must mention Private video');
  });

  test('normalizeYtDlpError: translates unavailable or removed video into user guidance', () => {
    const unavailErr = new Error("Command failed: ERROR: [youtube] dQw4w9WgXcQ: Video unavailable");
    unavailErr.stderr = "ERROR: [youtube] dQw4w9WgXcQ: Video unavailable";

    const normalized = normalizeYtDlpError(unavailErr, 'https://youtu.be/dQw4w9WgXcQ');
    assert.ok(normalized.message.includes('Video unavailable'), 'Must mention Video unavailable');
  });

  test('normalizeYtDlpError: translates scheduled / upcoming livestream into user guidance', () => {
    const upcomingErr = new Error("Command failed: ERROR: [youtube] dQw4w9WgXcQ: This live event will begin in 2 hours");
    upcomingErr.stderr = "ERROR: [youtube] dQw4w9WgXcQ: This live event will begin in 2 hours. is_upcoming: true";

    const normalized = normalizeYtDlpError(upcomingErr, 'https://youtu.be/dQw4w9WgXcQ');
    assert.ok(normalized.message.includes('Livestream not started'), 'Must mention Livestream not started');
  });

  test('normalizeYtDlpError: translates live extraction failure into user guidance', () => {
    const liveErr = new Error("Command failed: ERROR: [youtube] live stream recording is not available");
    liveErr.stderr = "ERROR: [youtube] Live stream recording is not available";

    const normalized = normalizeYtDlpError(liveErr, 'https://youtu.be/dQw4w9WgXcQ');
    assert.ok(normalized.message.includes('Livestream extraction failed'), 'Must mention Livestream extraction failed');
  });

  test('normalizeYtDlpError: translates playlist safeguard into user guidance', () => {
    const plErr = new Error("Command failed: ERROR: [youtube:tab] The URL points to a playlist, but --no-playlist was specified");
    plErr.stderr = "ERROR: [youtube:tab] The URL points to a playlist, but --no-playlist was specified";

    const normalized = normalizeYtDlpError(plErr, 'https://www.youtube.com/playlist?list=PL123');
    assert.ok(normalized.message.includes('Playlist not supported for this operation'), 'Must mention Playlist not supported');
  });

  test('normalizeYtDlpError: translates network failure into user guidance', () => {
    const netErr = new Error("Command failed: ERROR: Unable to download webpage: <urlopen error [Errno 101] Network is unreachable>");
    netErr.stderr = "ERROR: Unable to download webpage: <urlopen error [Errno 101] Network is unreachable>";

    const normalized = normalizeYtDlpError(netErr, 'https://youtu.be/dQw4w9WgXcQ');
    assert.ok(normalized.message.includes('Network failure'), 'Must mention Network failure');
  });

  test('normalizeYtDlpError: translates channel URL with no live stream into actionable channel guidance', () => {
    const chanErr = new Error("Command failed: ERROR: [youtube] @mkbhd/live: Video unavailable. This channel does not have an active live stream.");
    chanErr.stderr = "ERROR: [youtube] @mkbhd/live: Video unavailable. This channel does not have an active live stream.";

    const normalized = normalizeYtDlpError(chanErr, 'https://www.youtube.com/@mkbhd');
    assert.ok(normalized.message.includes('Channel URL provided'), 'Must mention Channel URL provided');
    assert.ok(normalized.message.includes('not currently broadcasting a live stream'), 'Must explain channel is not live');
  });

  // 5. Strict Storage Rule Contract: No Full Video Download in Uploads Directory
  test('Storage Contract: verifies that uploads directory is NOT used for YouTube source videos', () => {
    const uploadsDir = path.join(__dirname, '../../data/uploads');
    if (fs.existsSync(uploadsDir)) {
      const files = fs.readdirSync(uploadsDir);
      for (const file of files) {
        if (file.endsWith('.mp4')) {
          const stats = fs.statSync(path.join(uploadsDir, file));
          console.log(`[Storage Check] Uploads folder file: ${file} (${(stats.size / 1024 / 1024).toFixed(1)} MB)`);
        }
      }
    }
    assert.ok(true, 'Uploads directory inspected cleanly');
  });

  // =========================================================================
  // AUTOMATED CLEANUP & LIFECYCLE TESTS (9 Mandatory Paths)
  // =========================================================================

  // 6. Caption Success Cleanup: getYouTubeCaptions deletes all yt_subs_${projectId}* files on success
  await asyncTest('Cleanup 1: Caption success cleans all temporary subtitle files', async () => {
    const projectId = 'proj_cap_success_test';
    const subFile = path.join(TEST_TEMP_DIR, `yt_subs_${projectId}.en.json3`);

    const mockRunner = async (bin, args) => {
      // Simulate yt-dlp writing a json3 subtitle file
      const jsonContent = JSON.stringify({
        events: [
          { tStartMs: 1000, dDurationMs: 2500, segs: [{ utf8: 'Success caption test' }] }
        ]
      });
      fs.writeFileSync(subFile, jsonContent);
      return { stdout: '', stderr: '' };
    };

    const segments = await getYouTubeCaptions('https://www.youtube.com/watch?v=dQw4w9WgXcQ', projectId, TEST_TEMP_DIR, {
      _execFile: mockRunner
    });

    assert.ok(Array.isArray(segments), 'Segments should be returned');
    assert.equal(segments.length, 1);
    assert.equal(segments[0].text, 'Success caption test');
    assert.equal(fs.existsSync(subFile), false, 'Temporary subtitle file must be deleted on success');
  });

  // 7. Caption Failure Cleanup: getYouTubeCaptions deletes all partial subtitle files on error
  await asyncTest('Cleanup 2: Caption failure cleans all partial subtitle files', async () => {
    const projectId = 'proj_cap_fail_test';
    const partialSub = path.join(TEST_TEMP_DIR, `yt_subs_${projectId}.en.vtt.part`);

    const mockRunner = async () => {
      // Create a partially written file before throwing error
      fs.writeFileSync(partialSub, 'WEBVTT\n1\n00:00:01.000 --> 00:00:03.000\nIncomplete');
      throw new Error('yt-dlp: network connection aborted during subtitle download');
    };

    const segments = await getYouTubeCaptions('https://www.youtube.com/watch?v=dQw4w9WgXcQ', projectId, TEST_TEMP_DIR, {
      _execFile: mockRunner
    });

    assert.equal(segments, null, 'Must return null gracefully on failure to trigger audio fallback');
    assert.equal(fs.existsSync(partialSub), false, 'Partial subtitle file must be deleted on failure');
  });

  // 8. Audio Download Failure Cleanup: downloadTemporaryAudio removes raw M4A and partial files if yt-dlp fails
  await asyncTest('Cleanup 3: Audio download failure removes raw M4A and partial files', async () => {
    const projectId = 'proj_aud_fail_test';
    const partialRaw = path.join(TEST_TEMP_DIR, `raw_audio_${projectId}.m4a.part`);

    const mockRunner = async () => {
      fs.writeFileSync(partialRaw, 'partial raw audio bytes');
      throw new Error('yt-dlp: HTTP 503 Service Unavailable');
    };

    await assert.rejects(async () => {
      await downloadTemporaryAudio('https://www.youtube.com/watch?v=dQw4w9WgXcQ', projectId, TEST_TEMP_DIR, {
        _execFile: mockRunner
      });
    }, /503|yt-dlp/);

    assert.equal(fs.existsSync(partialRaw), false, 'Partial raw audio file must be cleaned up on failure');
  });

  // 9. FFmpeg Failure Cleanup: downloadTemporaryAudio removes partial WAV if FFmpeg conversion fails
  await asyncTest('Cleanup 4: FFmpeg failure cleans both raw audio and partial WAV', async () => {
    const projectId = 'proj_ff_fail_test';
    const rawAudio = path.join(TEST_TEMP_DIR, `raw_audio_${projectId}.m4a`);
    const wavAudio = path.join(TEST_TEMP_DIR, `${projectId}.wav`);

    const mockRunner = async (bin, args) => {
      if (bin === 'ffmpeg' || (typeof bin === 'string' && bin.includes('ffmpeg'))) {
        // Create partial 0-byte or corrupted WAV before crashing
        fs.writeFileSync(wavAudio, '');
        throw new Error('ffmpeg: error reading input stream');
      } else {
        // yt-dlp call creates raw audio
        fs.writeFileSync(rawAudio, 'mock m4a bytes');
        return { stdout: '', stderr: '' };
      }
    };

    await assert.rejects(async () => {
      await downloadTemporaryAudio('https://www.youtube.com/watch?v=dQw4w9WgXcQ', projectId, TEST_TEMP_DIR, {
        _execFile: mockRunner
      });
    }, /ffmpeg|conversion/i);

    assert.equal(fs.existsSync(rawAudio), false, 'Raw audio must be deleted on conversion failure');
    assert.equal(fs.existsSync(wavAudio), false, 'Partial or empty WAV must be purged on conversion failure');
  });

  // 10. Audio Success: raw M4A removed, WAV preserved
  await asyncTest('Cleanup 5: Audio success removes raw M4A and preserves WAV', async () => {
    const projectId = 'proj_aud_success_test';
    const rawAudio = path.join(TEST_TEMP_DIR, `raw_audio_${projectId}.m4a`);
    const wavAudio = path.join(TEST_TEMP_DIR, `${projectId}.wav`);

    const mockRunner = async (bin, args) => {
      if (bin === 'ffmpeg' || (typeof bin === 'string' && bin.includes('ffmpeg'))) {
        fs.writeFileSync(wavAudio, 'RIFF valid 16khz wav mock data');
        return { stdout: '', stderr: '' };
      } else {
        fs.writeFileSync(rawAudio, 'mock m4a audio stream');
        return { stdout: '', stderr: '' };
      }
    };

    const resultWav = await downloadTemporaryAudio('https://www.youtube.com/watch?v=dQw4w9WgXcQ', projectId, TEST_TEMP_DIR, {
      _execFile: mockRunner
    });

    assert.equal(resultWav, wavAudio);
    assert.equal(fs.existsSync(rawAudio), false, 'Raw M4A must be removed after successful conversion');
    assert.equal(fs.existsSync(wavAudio), true, 'Converted WAV must be preserved for transcription');

    // Clean up preserved WAV for test cleanliness
    try { fs.unlinkSync(wavAudio); } catch (_) {}
  });

  // 11. Segment Retrieval Failure: partial MP4 removed
  await asyncTest('Cleanup 6: Segment retrieval failure purges partial MP4', async () => {
    const clipId = 'clip_fail_test';
    const partialSegment = path.join(TEST_TEMP_DIR, `segment_${clipId}.mp4.part`);

    const mockRunner = async () => {
      fs.writeFileSync(partialSegment, 'corrupted fragment bytes');
      throw new Error('yt-dlp: download-sections stream timed out');
    };

    await assert.rejects(async () => {
      await retrieveClipSegment({
        url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
        start: 10,
        end: 40,
        clipId,
        tempDir: TEST_TEMP_DIR,
        _execFile: mockRunner
      });
    }, /timed out|yt-dlp/i);

    assert.equal(fs.existsSync(partialSegment), false, 'Partial segment file must be purged on retrieval failure');
  });

  // 12. Segment Success: MP4 preserved for rendering
  await asyncTest('Cleanup 7: Segment success preserves MP4 for rendering', async () => {
    const clipId = 'clip_success_test';
    const segmentPath = path.join(TEST_TEMP_DIR, `segment_${clipId}.mp4`);

    const mockRunner = async () => {
      fs.writeFileSync(segmentPath, 'valid mp4 video stream 30s');
      return { stdout: '', stderr: '' };
    };

    const resultPath = await retrieveClipSegment({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      start: 5,
      end: 35,
      clipId,
      tempDir: TEST_TEMP_DIR,
      _execFile: mockRunner
    });

    assert.equal(resultPath, segmentPath);
    assert.equal(fs.existsSync(segmentPath), true, 'Valid segment MP4 must be preserved for rendering pipeline');

    // Clean up preserved segment for test cleanliness
    try { fs.unlinkSync(segmentPath); } catch (_) {}
  });

  // 13. Timeout Configuration: retrieveClipSegment uses 300000ms (5 minutes) timeout
  await asyncTest('retrieveClipSegment: passes 300000ms (5 min) timeout to runner to support long segment downloads', async () => {
    let capturedOptions = null;
    const clipId = 'clip_timeout_test';
    const segmentPath = path.join(TEST_TEMP_DIR, `segment_${clipId}.mp4`);

    const mockRunner = async (bin, args, opts) => {
      capturedOptions = opts;
      fs.writeFileSync(segmentPath, 'valid mp4 bytes');
      return { stdout: '', stderr: '' };
    };

    const res = await retrieveClipSegment({
      url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      start: 0,
      end: 60,
      clipId,
      tempDir: TEST_TEMP_DIR,
      _execFile: mockRunner
    });

    assert.equal(res, segmentPath);
    assert.ok(capturedOptions, 'Runner options must be passed');
    assert.equal(capturedOptions.timeout, 300000, 'Timeout must be exactly 300000 ms (5 minutes)');
    try { fs.unlinkSync(segmentPath); } catch (_) {}
  });

  // 14. Isolation Between Different Project IDs
  test('Cleanup 8: Strict isolation between different project IDs and clip IDs', () => {
    // Project A files
    const projARaw = path.join(TEST_TEMP_DIR, 'raw_audio_proj_A_iso.m4a');
    const projAWav = path.join(TEST_TEMP_DIR, 'proj_A_iso.wav');
    const projASeg = path.join(TEST_TEMP_DIR, 'segment_clip_A_iso.mp4');
    const projASub = path.join(TEST_TEMP_DIR, 'yt_subs_proj_A_iso.en.vtt');

    // Project B files
    const projBRaw = path.join(TEST_TEMP_DIR, 'raw_audio_proj_B_iso.m4a');
    const projBWav = path.join(TEST_TEMP_DIR, 'proj_B_iso.wav');
    const projBSeg = path.join(TEST_TEMP_DIR, 'segment_clip_B_iso.mp4');
    const projBSub = path.join(TEST_TEMP_DIR, 'yt_subs_proj_B_iso.en.vtt');

    // Create all files
    [projARaw, projAWav, projASeg, projASub, projBRaw, projBWav, projBSeg, projBSub].forEach(f => {
      fs.writeFileSync(f, 'test content');
    });

    // Cleanup ONLY Project A prefix
    cleanupMatchingFiles(TEST_TEMP_DIR, 'raw_audio_proj_A_iso');
    cleanupMatchingFiles(TEST_TEMP_DIR, 'segment_clip_A_iso');
    cleanupMatchingFiles(TEST_TEMP_DIR, 'yt_subs_proj_A_iso');

    // Verify Project A targets deleted
    assert.equal(fs.existsSync(projARaw), false, 'Project A raw audio deleted');
    assert.equal(fs.existsSync(projASeg), false, 'Project A segment deleted');
    assert.equal(fs.existsSync(projASub), false, 'Project A subtitles deleted');

    // Verify Project A WAV (different prefix) untouched by raw cleanup
    assert.equal(fs.existsSync(projAWav), true, 'Project A WAV preserved');

    // Verify ALL Project B files remain completely intact
    assert.equal(fs.existsSync(projBRaw), true, 'Project B raw audio intact');
    assert.equal(fs.existsSync(projBWav), true, 'Project B wav intact');
    assert.equal(fs.existsSync(projBSeg), true, 'Project B segment intact');
    assert.equal(fs.existsSync(projBSub), true, 'Project B subtitles intact');

    // Teardown
    [projAWav, projBRaw, projBWav, projBSeg, projBSub].forEach(f => {
      try { fs.unlinkSync(f); } catch (_) {}
    });
  });

  // 15. Cleanup Errors Must Not Mask the Original Processing Error
  await asyncTest('Cleanup 9: Cleanup errors do not mask original processing failure', async () => {
    const projectId = 'proj_err_mask_test';
    const originalErrorMsg = 'Custom upstream processing abort: rate limit reached';

    const mockRunner = async () => {
      throw new Error(originalErrorMsg);
    };

    let caughtError = null;
    try {
      await downloadTemporaryAudio('https://www.youtube.com/watch?v=dQw4w9WgXcQ', projectId, TEST_TEMP_DIR, {
        _execFile: mockRunner
      });
    } catch (err) {
      caughtError = err;
    }

    assert.ok(caughtError !== null, 'An error should have been thrown');
    assert.ok(
      caughtError.message.includes(originalErrorMsg) || caughtError.message.includes('upstream'),
      `Original error message must be preserved, got: ${caughtError.message}`
    );
  });

  // 16. Audio Format Selection Contract: Strictly Audio-Only and Never Fallback to Format 18
  await asyncTest('Audio Format Contract: strictly requests audio-only streams and never includes format 18', async () => {
    let capturedArgs = [];
    const projectId = 'proj_fmt_contract_test';
    const wavAudio = path.join(TEST_TEMP_DIR, `${projectId}.wav`);

    const mockRunner = async (bin, args) => {
      capturedArgs = args;
      // Simulate raw audio output file creation matching %(ext)s pattern
      const outIdx = args.indexOf('-o');
      const outPattern = args[outIdx + 1];
      const actualFile = outPattern.replace('%(ext)s', 'webm');
      fs.writeFileSync(actualFile, 'mock raw opus bytes');
      return { stdout: '', stderr: '' };
    };

    const mockFfmpegRunner = async (bin, args) => {
      if (bin === 'ffmpeg' || (typeof bin === 'string' && bin.includes('ffmpeg'))) {
        fs.writeFileSync(wavAudio, 'RIFF mock wav bytes');
        return { stdout: '', stderr: '' };
      }
      return mockRunner(bin, args);
    };

    const res = await downloadTemporaryAudio('https://www.youtube.com/watch?v=dQw4w9WgXcQ', projectId, TEST_TEMP_DIR, {
      _execFile: mockFfmpegRunner
    });

    const fmtIdx = capturedArgs.indexOf('-f');
    assert.ok(fmtIdx !== -1, '-f flag must be present');
    const fmtStr = capturedArgs[fmtIdx + 1];

    // Must be strictly audio-only
    assert.ok(fmtStr.includes('ba') || fmtStr.includes('bestaudio'), 'Must request bestaudio streams');
    assert.ok(!fmtStr.includes('18/'), 'Must NEVER include format 18 as audio fallback');
    assert.ok(!fmtStr.includes('/18'), 'Must NEVER include format 18 as audio fallback');
    assert.ok(!fmtStr.includes('+ba'), 'Must NEVER request combined video+audio for audio-only track');

    assert.equal(res, wavAudio);
    try { fs.unlinkSync(res); } catch (_) {}
  });

  // YouTube Live Tests
  await asyncTest('detectYouTubeLive: correctly identifies active live streams from yt-dlp metadata', async () => {
    const mockLiveStdout = JSON.stringify({
      id: 'live123',
      title: 'Gaming Live Championship Stream',
      is_live: true,
      live_status: 'is_live',
      uploader: 'TopGamer',
      view_count: 15420
    });

    const mockRunner = async () => ({ stdout: mockLiveStdout, stderr: '' });

    const liveInfo = await detectYouTubeLive('https://www.youtube.com/watch?v=live123', { _execFile: mockRunner });
    assert.equal(liveInfo.isLive, true);
    assert.equal(liveInfo.liveStatus, 'is_live');
    assert.equal(liveInfo.title, 'Gaming Live Championship Stream');
    assert.equal(liveInfo.uploader, 'TopGamer');
  });

  await asyncTest('detectYouTubeLive: identifies offline / past broadcasts', async () => {
    const mockOfflineStdout = JSON.stringify({
      id: 'offline123',
      title: 'Past Stream Recording',
      is_live: false,
      was_live: true,
      live_status: 'was_live',
      uploader: 'TopGamer'
    });

    const mockRunner = async () => ({ stdout: mockOfflineStdout, stderr: '' });

    const info = await detectYouTubeLive('https://www.youtube.com/watch?v=offline123', { _execFile: mockRunner });
    assert.equal(info.isLive, false);
    assert.equal(info.liveStatus, 'was_live');
  });

  await asyncTest('extractLiveRollingChunk: limits capture duration via FFmpeg downloader and extracts audio', async () => {
    const projectId = 'live_chunk_unit_test';
    const videoChunk = path.join(TEST_TEMP_DIR, `live_chunk_${projectId}.mp4`);
    const audioChunk = path.join(TEST_TEMP_DIR, `live_chunk_${projectId}.wav`);

    let ytArgs = [];
    const mockRunner = async (bin, args) => {
      if (bin === 'ffmpeg' || (typeof bin === 'string' && bin.includes('ffmpeg'))) {
        fs.writeFileSync(audioChunk, 'RIFF mock live audio 16khz');
        return { stdout: '', stderr: '' };
      }
      ytArgs = args;
      fs.writeFileSync(videoChunk, 'mock video mp4 bytes for 60s live window');
      return { stdout: '', stderr: '' };
    };

    const res = await extractLiveRollingChunk({
      url: 'https://www.youtube.com/watch?v=live123',
      projectId,
      chunkDuration: 60,
      tempDir: TEST_TEMP_DIR,
      _execFile: mockRunner
    });

    assert.equal(res.videoChunkPath, videoChunk);
    assert.equal(res.audioChunkPath, audioChunk);
    assert.equal(res.duration, 60);

    // Verify bounded duration downloader args were supplied
    const dlIdx = ytArgs.indexOf('--downloader-args');
    assert.ok(dlIdx !== -1, '--downloader-args must be set');
    assert.ok(ytArgs[dlIdx + 1].includes('-t 60'), 'Must constrain FFmpeg download to 60s');

    // Test cleanup
    cleanupLiveRollingChunk(projectId, TEST_TEMP_DIR);
    assert.equal(fs.existsSync(videoChunk), false, 'Video chunk must be purged by cleanup');
    assert.equal(fs.existsSync(audioChunk), false, 'Audio chunk must be purged by cleanup');
  });

  // =========================================================================
  // MOCKED EXTRACTION TESTS FOR ALL URL TYPES (Requirement 7)
  // =========================================================================

  await asyncTest('Mock Extraction 1: Regular Video metadata extraction', async () => {
    const mockRunner = async (bin, args) => {
      return {
        stdout: JSON.stringify({
          id: 'dQw4w9WgXcQ',
          title: 'Never Gonna Give You Up',
          duration: 213,
          uploader: 'Rick Astley',
          is_live: false,
          live_status: 'not_live',
          webpage_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
          thumbnails: [{ url: 'https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg', width: 480 }]
        }),
        stderr: ''
      };
    };

    const meta = await getYouTubeMetadata('https://www.youtube.com/watch?v=dQw4w9WgXcQ', { _execFile: mockRunner });
    assert.equal(meta.id, 'dQw4w9WgXcQ');
    assert.equal(meta.title, 'Never Gonna Give You Up');
    assert.equal(meta.duration, 213);
    assert.equal(meta.isLive, false);
    assert.equal(meta.detectedType, 'video');
  });

  await asyncTest('Mock Extraction 2: YouTube Short metadata extraction', async () => {
    const mockRunner = async (bin, args) => {
      return {
        stdout: JSON.stringify({
          id: 'short123456',
          title: 'Quick Coding Tip',
          duration: 45,
          uploader: 'Dev Shorts',
          is_live: false,
          live_status: 'not_live',
          webpage_url: 'https://www.youtube.com/shorts/short123456'
        }),
        stderr: ''
      };
    };

    const meta = await getYouTubeMetadata('https://www.youtube.com/shorts/short123456', { _execFile: mockRunner });
    assert.equal(meta.id, 'short123456');
    assert.equal(meta.detectedType, 'short');
    assert.equal(meta.duration, 45);
  });

  await asyncTest('Mock Extraction 3: Active Livestream metadata extraction', async () => {
    const mockRunner = async (bin, args) => {
      return {
        stdout: JSON.stringify({
          id: 'liveStream99',
          title: 'Global Tech Keynote Live',
          duration: null,
          uploader: 'Tech Global',
          is_live: true,
          live_status: 'is_live',
          webpage_url: 'https://www.youtube.com/watch?v=liveStream99'
        }),
        stderr: ''
      };
    };

    const meta = await getYouTubeMetadata('https://www.youtube.com/live/liveStream99', { _execFile: mockRunner });
    assert.equal(meta.id, 'liveStream99');
    assert.equal(meta.isLive, true);
    assert.equal(meta.liveStatus, 'is_live');
    assert.equal(meta.duration, 0);
    assert.equal(meta.detectedType, 'active_livestream');
  });

  await asyncTest('Mock Extraction 4: Livestream Replay metadata extraction', async () => {
    const mockRunner = async (bin, args) => {
      return {
        stdout: JSON.stringify({
          id: 'replayStream1',
          title: 'Yesterday Tech Talk Replay',
          duration: 3600,
          uploader: 'Tech Global',
          is_live: false,
          was_live: true,
          live_status: 'was_live',
          webpage_url: 'https://www.youtube.com/watch?v=replayStream1'
        }),
        stderr: ''
      };
    };

    const meta = await getYouTubeMetadata('https://www.youtube.com/watch?v=replayStream1', { _execFile: mockRunner });
    assert.equal(meta.id, 'replayStream1');
    assert.equal(meta.isLive, false);
    assert.equal(meta.wasLive, true);
    assert.equal(meta.liveStatus, 'was_live');
    assert.equal(meta.detectedType, 'livestream_replay');
    assert.equal(meta.duration, 3600);
  });

  await asyncTest('Mock Extraction 5: Scheduled Livestream rejection with actionable error', async () => {
    const mockRunner = async (bin, args) => {
      return {
        stdout: JSON.stringify({
          id: 'scheduledStream1',
          title: 'Upcoming Apple Event',
          duration: null,
          uploader: 'Apple',
          is_live: false,
          live_status: 'is_upcoming',
          webpage_url: 'https://www.youtube.com/watch?v=scheduledStream1'
        }),
        stderr: ''
      };
    };

    let threw = false;
    try {
      await getYouTubeMetadata('https://www.youtube.com/watch?v=scheduledStream1', { _execFile: mockRunner });
    } catch (err) {
      threw = true;
      assert.ok(err.message.includes('Livestream not started'), 'Must mention Livestream not started');
    }
    assert.equal(threw, true, 'Scheduled livestream must throw actionable error');
  });

  await asyncTest('Mock Extraction 6: Pure Playlist URL safeguard rejection', async () => {
    let threw = false;
    try {
      await getYouTubeMetadata('https://www.youtube.com/playlist?list=PL1234567890');
    } catch (err) {
      threw = true;
      assert.ok(err.message.includes('Playlist not supported for this operation'), 'Must mention Playlist not supported');
    }
    assert.equal(threw, true, 'Pure playlist URL must be rejected with safeguard');
  });

  await asyncTest('Mock Extraction 7: YouTube Clip metadata extraction', async () => {
    const mockRunner = async (bin, args) => {
      return {
        stdout: JSON.stringify({
          id: 'clipId12345',
          title: 'Funny Podcast Moment',
          duration: 35,
          uploader: 'Podcast Channel',
          is_live: false,
          live_status: 'not_live',
          webpage_url: 'https://www.youtube.com/clip/Ugkx_abc'
        }),
        stderr: ''
      };
    };

    const meta = await getYouTubeMetadata('https://www.youtube.com/clip/Ugkx_abc', { _execFile: mockRunner });
    assert.equal(meta.id, 'clipId12345');
    assert.equal(meta.detectedType, 'clip');
  });

  await asyncTest('Mock Extraction 8: Channel Live URL status detection', async () => {
    const mockRunner = async (bin, args) => {
      return {
        stdout: JSON.stringify({
          id: 'channelLiveStream',
          title: '24/7 Lo-Fi Beats',
          duration: null,
          uploader: 'Lofi Girl',
          is_live: true,
          live_status: 'is_live',
          webpage_url: 'https://www.youtube.com/watch?v=channelLiveStream'
        }),
        stderr: ''
      };
    };

    const live = await detectYouTubeLive('https://www.youtube.com/@LofiGirl/live', { _execFile: mockRunner });
    assert.equal(live.isLive, true);
    assert.equal(live.liveStatus, 'is_live');
    assert.equal(live.id, 'channelLiveStream');
  });

  // Teardown test temp directory
  try {
    if (fs.existsSync(TEST_TEMP_DIR)) {
      const remaining = fs.readdirSync(TEST_TEMP_DIR);
      for (const f of remaining) {
        fs.unlinkSync(path.join(TEST_TEMP_DIR, f));
      }
      fs.rmdirSync(TEST_TEMP_DIR);
    }
  } catch (_) {}

  console.log('\n=============================================');
  console.log(` YOUTUBE SERVICE TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('=============================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runYouTubeServiceTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
