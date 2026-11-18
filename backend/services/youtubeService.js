const { execFile } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');

const execFilePromise = util.promisify(execFile);

const YT_DLP_BIN = process.env.YT_DLP_BIN || 'yt-dlp';
const NODE_BIN = process.env.NODE_BIN || process.execPath || '/data/data/com.termux/files/usr/bin/node';

/**
 * Universal YouTube URL parser.
 * Accurately recognizes and categorizes all standard, mobile, short, live, embed, clip,
 * channel, and playlist URLs.
 * Uses native WHATWG URL parsing without fragile regex patterns.
 */
function parseYouTubeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return {
      isValid: false,
      url: null,
      type: null,
      id: null,
      error: 'Please provide a YouTube URL.'
    };
  }

  const clean = rawUrl.trim();
  if (!clean) {
    return {
      isValid: false,
      url: null,
      type: null,
      id: null,
      error: 'URL cannot be empty.'
    };
  }

  // Prepend https:// if protocol is missing (e.g. youtube.com/watch?v=...)
  let urlString = clean;
  if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(urlString)) {
    urlString = 'https://' + urlString;
  }

  let parsed;
  try {
    parsed = new URL(urlString);
  } catch (_) {
    return {
      isValid: false,
      url: null,
      type: null,
      id: null,
      error: 'Unsupported URL format: Invalid URL syntax.'
    };
  }

  // Validate protocol
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      isValid: false,
      url: null,
      type: null,
      id: null,
      error: 'Unsupported URL format: Only HTTP and HTTPS YouTube URLs are supported.'
    };
  }

  const host = parsed.hostname.toLowerCase();

  // Recognize valid YouTube domains & subdomains
  const isYouTubeHost = host === 'youtube.com' ||
                        host.endsWith('.youtube.com') ||
                        host === 'youtu.be' ||
                        host.endsWith('.youtu.be') ||
                        host === 'youtube-nocookie.com' ||
                        host.endsWith('.youtube-nocookie.com');

  if (!isYouTubeHost) {
    return {
      isValid: false,
      url: null,
      type: null,
      id: null,
      error: 'Unsupported URL format: Not a YouTube URL. Please provide a link from youtube.com or youtu.be.'
    };
  }

  const pathname = parsed.pathname.replace(/\/+$/, ''); // Strip trailing slashes
  const searchParams = parsed.searchParams;

  // 1. youtu.be short URLs: https://youtu.be/VIDEO_ID
  if (host === 'youtu.be' || host.endsWith('.youtu.be')) {
    const videoId = pathname.replace(/^\/+/, '').split('/')[0];
    if (!videoId || videoId.length < 11) {
      return {
        isValid: false,
        url: urlString,
        type: null,
        id: null,
        error: 'Unsupported URL format: Missing or invalid video ID in youtu.be link.'
      };
    }
    return {
      isValid: true,
      url: urlString,
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
      type: 'video',
      id: videoId,
      videoId,
      isShortUrl: true,
      timestamp: searchParams.get('t') || null
    };
  }

  // 2. youtube.com / watch URLs: /watch?v=VIDEO_ID or /watch_popup?v=VIDEO_ID
  if (pathname === '/watch' || pathname === '/watch_popup') {
    const videoId = searchParams.get('v');
    const playlistId = searchParams.get('list');
    if (videoId) {
      return {
        isValid: true,
        url: urlString,
        canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
        type: 'video',
        id: videoId,
        videoId,
        playlistId: playlistId || null,
        hasPlaylist: Boolean(playlistId),
        timestamp: searchParams.get('t') || searchParams.get('time_continue') || null
      };
    } else if (playlistId) {
      // Pure playlist link without video ID
      return {
        isValid: true,
        url: urlString,
        canonicalUrl: `https://www.youtube.com/playlist?list=${playlistId}`,
        type: 'playlist',
        id: playlistId,
        playlistId,
        isPlaylistOnly: true
      };
    } else {
      return {
        isValid: false,
        url: urlString,
        type: null,
        id: null,
        error: 'Unsupported URL format: Missing "v" video parameter in YouTube watch link.'
      };
    }
  }

  // 3. Shorts: /shorts/VIDEO_ID
  const shortsMatch = pathname.match(/^\/shorts\/([a-zA-Z0-9_-]+)/);
  if (shortsMatch) {
    const videoId = shortsMatch[1];
    return {
      isValid: true,
      url: urlString,
      canonicalUrl: `https://www.youtube.com/shorts/${videoId}`,
      type: 'short',
      id: videoId,
      videoId,
      isShort: true
    };
  }

  // 4. Live: /live/VIDEO_ID
  const liveMatch = pathname.match(/^\/live\/([a-zA-Z0-9_-]+)/);
  if (liveMatch) {
    const videoId = liveMatch[1];
    return {
      isValid: true,
      url: urlString,
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
      type: 'live',
      id: videoId,
      videoId,
      isLive: true
    };
  }

  // 5. Embed: /embed/VIDEO_ID
  const embedMatch = pathname.match(/^\/embed\/([a-zA-Z0-9_-]+)/);
  if (embedMatch) {
    const videoId = embedMatch[1];
    return {
      isValid: true,
      url: urlString,
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
      type: 'embed',
      id: videoId,
      videoId,
      isEmbed: true
    };
  }

  // 6. Legacy /v/: /v/VIDEO_ID
  const vMatch = pathname.match(/^\/v\/([a-zA-Z0-9_-]+)/);
  if (vMatch) {
    const videoId = vMatch[1];
    return {
      isValid: true,
      url: urlString,
      canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
      type: 'video',
      id: videoId,
      videoId
    };
  }

  // 7. Clips: /clip/CLIP_ID
  const clipMatch = pathname.match(/^\/clip\/([a-zA-Z0-9_-]+)/);
  if (clipMatch) {
    const clipId = clipMatch[1];
    return {
      isValid: true,
      url: urlString,
      canonicalUrl: `https://www.youtube.com/clip/${clipId}`,
      type: 'clip',
      id: clipId,
      clipId,
      isClip: true
    };
  }

  // 8. Playlists: /playlist?list=PLAYLIST_ID
  if (pathname === '/playlist') {
    const playlistId = searchParams.get('list');
    if (playlistId) {
      return {
        isValid: true,
        url: urlString,
        canonicalUrl: `https://www.youtube.com/playlist?list=${playlistId}`,
        type: 'playlist',
        id: playlistId,
        playlistId,
        isPlaylistOnly: true
      };
    }
    return {
      isValid: false,
      url: urlString,
      type: null,
      id: null,
      error: 'Unsupported URL format: Missing playlist ID parameter.'
    };
  }

  // 9. Channel Live: /@CHANNEL/live, /channel/CHANNEL_ID/live, /c/NAME/live, /user/NAME/live
  const channelLiveMatch = pathname.match(/^\/(@[a-zA-Z0-9_.-]+|channel\/[a-zA-Z0-9_-]+|c\/[a-zA-Z0-9_.-]+|user\/[a-zA-Z0-9_.-]+)\/live$/i);
  if (channelLiveMatch) {
    const channelIdentifier = channelLiveMatch[1];
    return {
      isValid: true,
      url: urlString,
      canonicalUrl: `https://www.youtube.com/${channelIdentifier}/live`,
      type: 'channel_live',
      id: channelIdentifier,
      channelIdentifier,
      isLive: true,
      isChannel: true
    };
  }

  // 10. Channel general URLs: /@CHANNEL, /channel/CHANNEL_ID, /c/NAME, /user/NAME
  const channelMatch = pathname.match(/^\/(@[a-zA-Z0-9_.-]+|channel\/[a-zA-Z0-9_-]+|c\/[a-zA-Z0-9_.-]+|user\/[a-zA-Z0-9_.-]+)(?:\/.*)?$/i);
  if (channelMatch) {
    const channelIdentifier = channelMatch[1];
    return {
      isValid: true,
      url: urlString,
      canonicalUrl: `https://www.youtube.com/${channelIdentifier}`,
      type: 'channel',
      id: channelIdentifier,
      channelIdentifier,
      isChannel: true
    };
  }

  // Root or unhandled YouTube page (e.g. /feed/trending, /about, /)
  return {
    isValid: false,
    url: urlString,
    type: null,
    id: null,
    error: 'Unsupported YouTube URL format. Please provide a video, Short, Live stream, channel, or playlist link.'
  };
}

/**
 * Validates whether a given string is any supported YouTube URL format.
 * Accurately accepts regular videos, Shorts, live streams, live stream replays,
 * channels, playlists, embeds, clips, timestamped URLs, and custom query params.
 */
function isValidYouTubeUrl(url) {
  const result = parseYouTubeUrl(url);
  return Boolean(result && result.isValid);
}

/**
 * Resolves the path to YouTube authentication cookies if securely provided by the user.
 * Never logs credentials or exposes secret contents to frontend code.
 */
function resolveCookiesPath() {
  const customPath = process.env.YOUTUBE_COOKIES_PATH;
  if (customPath && fs.existsSync(customPath)) {
    try {
      const stats = fs.statSync(customPath);
      if (stats.isFile() && stats.size > 0) return customPath;
    } catch (_) {}
  }

  const projectCookies = path.join(__dirname, '../../data/cookies.txt');
  if (fs.existsSync(projectCookies)) {
    try {
      const stats = fs.statSync(projectCookies);
      if (stats.isFile() && stats.size > 0) return projectCookies;
    } catch (_) {}
  }

  const homeCookies = path.join(process.env.HOME || '/data/data/com.termux/files/home', '.config/yt-dlp/cookies.txt');
  if (fs.existsSync(homeCookies)) {
    try {
      const stats = fs.statSync(homeCookies);
      if (stats.isFile() && stats.size > 0) return homeCookies;
    } catch (_) {}
  }

  return null;
}

/**
 * Returns base arguments for yt-dlp including JavaScript runtime solving,
 * mobile/iOS fallback client headers, and optional authentication cookies.
 */
function getYtDlpBaseArgs() {
  const playerClients = process.env.YOUTUBE_PLAYER_CLIENT || 'default,-tv,web_safari,web_embedded';
  const args = [
    '--no-playlist',
    // 1. Solve YouTube EJS n-challenge using Node.js runtime
    '--js-runtimes', `node:${NODE_BIN}`,
    '--js-runtimes', 'node',
    // 2. Client fallback priority (drops broken tv client to avoid UNPLAYABLE / reload blocks)
    '--extractor-args', `youtube:player_client=${playerClients}`,
    // 3. Anti-bot throttling protection
    '--sleep-requests', '1.5'
  ];

  if (process.env.YOUTUBE_PO_TOKEN) {
    args.push('--extractor-args', `youtube:po_token=${process.env.YOUTUBE_PO_TOKEN}`);
  }

  const cookiesPath = resolveCookiesPath();
  if (cookiesPath) {
    args.push('--cookies', cookiesPath);
  }

  return args;
}

/**
 * Normalizes yt-dlp errors into clear, actionable messages.
 * Maps error output to specific categories: region restrictions, private videos,
 * scheduled broadcasts, live extraction issues, auth/bot challenges, and network issues.
 */
function normalizeYtDlpError(err, url) {
  const msg = err.stderr || err.message || '';

  const isTimeout = err.code === 'ETIMEDOUT' ||
                    Boolean(err.killed && (err.signal === 'SIGTERM' || err.signal === 'SIGKILL')) ||
                    msg.includes('timed out') ||
                    msg.includes('ETIMEDOUT') ||
                    msg.includes('timeout');

  if (isTimeout) {
    return new Error(
      'YouTube stream retrieval timed out. The download took longer than the allotted time limit. ' +
      'Please verify your network connection, try a shorter clip segment, or retry.'
    );
  }

  // 1. Scheduled / Upcoming Livestream (Not Started)
  if (msg.includes('is_upcoming') || msg.includes('Premieres in') || msg.includes('Live stream will begin') || msg.includes('Livestream not started') || msg.includes('This live event will begin')) {
    return new Error('Livestream not started: This scheduled broadcast has not started yet. Please wait until the stream goes live before generating clips.');
  }

  // 2. Region Restriction
  if (msg.includes('not available in your country') || msg.includes('GeoRestricted') || msg.includes('blocked it in your country') || msg.includes('The uploader has not made this video available in your country') || msg.includes('geographic restriction')) {
    return new Error('Region-restricted: This video is not available in your region due to geographic restrictions.');
  }

  // 3. Private Video
  if (msg.includes('This video is private') || msg.includes('Private video')) {
    return new Error('Private video: This video is private and cannot be accessed.');
  }

  // 4. Channel URL guidance (must precede generic Video Unavailable)
  if (url && (url.includes('/@') || url.includes('/channel/') || url.includes('/c/') || url.includes('/user/')) && !url.includes('/watch')) {
    if (msg.includes('not currently live') || msg.includes('does not have a live stream') || msg.includes('does not have an active live stream') || msg.includes('no live stream') || msg.includes('ended') || msg.includes('Not a video') || msg.includes('This live event has ended') || msg.includes('Video unavailable') || msg.includes('not available')) {
      return new Error('Channel URL provided: This channel is not currently broadcasting a live stream. To clip an individual video, please provide the video link.');
    }
  }

  // 5. Video Unavailable / Removed / Non-existent
  if (msg.includes('Video unavailable') || msg.includes('This video is not available') || msg.includes('has been removed') || msg.includes('does not exist')) {
    return new Error('Video unavailable: This video is unavailable or has been removed from YouTube.');
  }

  // 5. Bot & Age-restriction verification
  if (msg.includes("Sign in to confirm you're not a bot") || msg.includes('Sign in to confirm your age') || msg.includes('LOGIN_REQUIRED') || msg.includes('confirm your age')) {
    return new Error(
      'Authentication required: YouTube requires sign-in verification (age-restriction or anti-bot challenge). ' +
      'Please export your YouTube cookies.txt file into ~/v4-clipper/data/cookies.txt (or set YOUTUBE_COOKIES_PATH) to authenticate this session.'
    );
  }

  // 6. Anti-bot reload block
  if (msg.includes('The page needs to be reloaded') || msg.includes('UNPLAYABLE')) {
    return new Error(
      'YouTube blocked this request ("The page needs to be reloaded" / UNPLAYABLE). ' +
      'YouTube anti-bot mitigation challenges unauthenticated access on this network. ' +
      'Please export your YouTube cookies.txt file into ~/v4-clipper/data/cookies.txt to authenticate the session.'
    );
  }

  // 7. Format unavailable
  if (msg.includes('Requested format is not available') || msg.includes('format is not available')) {
    return new Error(
      'No separate audio-only stream is available for this YouTube video without account authentication or a GVS PO Token. ' +
      'To protect your phone storage and comply with strict no-full-video-download policy, combined video format 18 was not downloaded. ' +
      'Please provide a cookies.txt file in ~/v4-clipper/data/cookies.txt or use a video with available captions/audio streams.'
    );
  }

  // 8. Playlist safeguard error
  if (msg.includes('The URL points to a playlist') || msg.includes('points to a playlist') || msg.includes('Playlist not supported')) {
    return new Error('Playlist not supported for this operation: V4 Clipper generates vertical shorts from individual videos. Please provide a link to a specific video in the playlist.');
  }

  // 9. Live extraction failure
  if (msg.includes('Live stream recording is not available') || (msg.includes('live stream') && (msg.includes('failed') || msg.includes('interrupted') || msg.includes('offline') || msg.includes('not currently live')))) {
    return new Error('Livestream extraction failed: Unable to connect to or capture live stream. The stream may be offline or connection was interrupted.');
  }

  // 11. Network error
  if (msg.includes('ENOTFOUND') || msg.includes('ECONNRESET') || msg.includes('ECONNREFUSED') || msg.includes('Unable to download webpage') || msg.includes('Network is unreachable')) {
    return new Error('Network failure: Could not connect to YouTube. Please check your internet connection and verify the URL.');
  }

  if (msg.includes('No supported JavaScript runtime')) {
    return new Error('No JavaScript runtime could be configured for yt-dlp. Ensure Node.js is installed.');
  }

  const cleanMsg = msg.replace(/^Command failed:.*?(ERROR:\s*)?/is, '').split('\n')[0].trim();
  return new Error(cleanMsg || err.message || 'Failed to interact with YouTube via yt-dlp.');
}

/**
 * Retrieves comprehensive YouTube video metadata WITHOUT downloading any video bytes.
 * Handles normal videos, Shorts, live streams, replays, embeds, clips, channels, and playlists.
 * Automatically classifies the link type:
 * 'regular_video', 'short', 'active_livestream', 'livestream_replay', 'scheduled_livestream', 'playlist', 'channel', 'clip'.
 */
async function getYouTubeMetadata(url, options = {}) {
  const runner = (options && options._execFile) || execFilePromise;
  const parsed = parseYouTubeUrl(url);
  if (!parsed.isValid) {
    throw new Error(parsed.error || 'Unsupported URL format: Invalid YouTube URL provided.');
  }

  // Safeguard: pure playlist without video ID
  if (parsed.type === 'playlist') {
    throw new Error('Playlist not supported for this operation: V4 Clipper generates vertical shorts from individual videos. Please provide a link to a specific video in the playlist.');
  }

  // Target URL to inspect with yt-dlp
  let targetUrl = parsed.canonicalUrl || parsed.url;
  if (parsed.type === 'channel') {
    // If a channel root is provided, target its live stream
    targetUrl = `https://www.youtube.com/${parsed.channelIdentifier}/live`;
  }

  const args = [
    ...getYtDlpBaseArgs(),
    '--dump-json',
    targetUrl
  ];

  try {
    const { stdout } = await runner(YT_DLP_BIN, args, { timeout: 45000, maxBuffer: 10 * 1024 * 1024 });
    const data = JSON.parse(stdout);

    const isLive = Boolean(data.is_live === true || data.live_status === 'is_live');
    const isUpcoming = Boolean(data.live_status === 'is_upcoming');
    const wasLive = Boolean(data.was_live === true || data.live_status === 'was_live');
    const liveStatus = data.live_status || (isLive ? 'is_live' : (wasLive ? 'was_live' : (isUpcoming ? 'is_upcoming' : 'not_live')));

    // Safeguard: Scheduled broadcast that has not yet started
    if (isUpcoming) {
      throw new Error('Livestream not started: This scheduled broadcast has not started yet. Please wait until the stream goes live before generating clips.');
    }

    // Determine semantic link type automatically
    let detectedType = 'video';
    if (isLive) {
      detectedType = 'active_livestream';
    } else if (wasLive) {
      detectedType = 'livestream_replay';
    } else if (parsed.type === 'short' || (data.webpage_url && data.webpage_url.includes('/shorts/'))) {
      detectedType = 'short';
    } else if (parsed.type === 'clip' || (data.webpage_url && data.webpage_url.includes('/clip/'))) {
      detectedType = 'clip';
    } else if (parsed.type === 'playlist') {
      detectedType = 'playlist';
    } else if (parsed.type === 'channel' || parsed.type === 'channel_live') {
      detectedType = isLive ? 'active_livestream' : 'channel';
    }

    // Find best thumbnail
    let thumbnail = data.thumbnail || null;
    if (Array.isArray(data.thumbnails) && data.thumbnails.length > 0) {
      const sorted = [...data.thumbnails].sort((a, b) => (b.width || 0) - (a.width || 0));
      thumbnail = sorted[0].url || thumbnail;
    }

    return {
      id: data.id,
      title: (data.title || 'YouTube Video').trim(),
      duration: isLive ? 0 : Math.max(0, parseFloat(data.duration) || 0),
      thumbnail,
      uploader: data.uploader || data.channel || 'Creator',
      description: data.description || '',
      viewCount: data.view_count || data.concurrent_view_count || 0,
      hasCaptions: Boolean((data.subtitles && Object.keys(data.subtitles).length > 0) ||
                           (data.automatic_captions && Object.keys(data.automatic_captions).length > 0)),
      isLive,
      isUpcoming,
      wasLive,
      liveStatus,
      detectedType,
      urlType: detectedType,
      canonicalUrl: data.webpage_url || targetUrl
    };
  } catch (err) {
    if (err.message && (err.message.startsWith('Livestream not started') || err.message.startsWith('Playlist not supported') || err.message.startsWith('Unsupported URL format'))) {
      throw err;
    }
    console.error('getYouTubeMetadata error:', err.message);
    throw normalizeYtDlpError(err, targetUrl);
  }
}

/**
 * Safely removes all files in a directory matching a specific prefix.
 * Strictly ignores files belonging to other prefixes/projects.
 * Errors during deletion are caught safely and never thrown to the caller.
 */
function cleanupMatchingFiles(dir, prefix) {
  if (!dir || !prefix || !fs.existsSync(dir)) return;
  try {
    const entries = fs.readdirSync(dir);
    for (const entry of entries) {
      if (entry.startsWith(prefix)) {
        const fullPath = path.join(dir, entry);
        try {
          if (fs.existsSync(fullPath)) {
            const stats = fs.statSync(fullPath);
            if (stats.isFile()) {
              fs.unlinkSync(fullPath);
            }
          }
        } catch (_) {}
      }
    }
  } catch (_) {}
}

/**
 * Attempts to retrieve transcript directly from YouTube subtitles / automatic captions.
 * Downloads ZERO video or audio media — consumes minimal bandwidth (~50KB) and finishes in < 2 seconds.
 * Returns array of segments: [{ id, start, end, text }] or null if no captions found.
 *
 * Cleanup Guarantee:
 * All temporary subtitle files (.json3, .vtt, .srt, .part, language suffixes) matching this
 * project ID are ALWAYS purged on both success and failure paths, without touching other projects.
 */
async function getYouTubeCaptions(url, projectId, tempDir, options = {}) {
  const runner = (options && options._execFile) || execFilePromise;
  const cleanUrl = url.trim();
  const filePrefix = `yt_subs_${projectId}`;
  const basePrefix = path.join(tempDir, filePrefix);

  const args = [
    ...getYtDlpBaseArgs(),
    '--skip-download',
    '--write-subs',
    '--write-auto-subs',
    '--sub-langs', 'en.*,en,hi.*,hi,orig,default,-live_chat',
    '--sub-format', 'json3/vtt/srt',
    '-o', `${basePrefix}.%(ext)s`,
    cleanUrl
  ];

  let segments = null;
  try {
    await runner(YT_DLP_BIN, args, { timeout: 45000 });

    // Look for generated caption file matching this specific project
    let foundFile = null;
    if (fs.existsSync(tempDir)) {
      const dirEntries = fs.readdirSync(tempDir);
      const matches = dirEntries.filter(entry =>
        entry.startsWith(filePrefix) && (entry.endsWith('.json3') || entry.endsWith('.vtt') || entry.endsWith('.srt'))
      );
      // Prioritize json3 (word/timing accuracy), then English vtt/srt
      matches.sort((a, b) => {
        if (a.endsWith('.json3') && !b.endsWith('.json3')) return -1;
        if (!a.endsWith('.json3') && b.endsWith('.json3')) return 1;
        if (a.includes('.en') && !b.includes('.en')) return -1;
        if (!a.includes('.en') && b.includes('.en')) return 1;
        return 0;
      });
      if (matches.length > 0) {
        foundFile = path.join(tempDir, matches[0]);
      }
    }

    if (foundFile) {
      const parsed = parseSubtitleFile(foundFile);
      if (parsed && parsed.length > 0) {
        segments = parsed;
      }
    }

    return segments;
  } catch (err) {
    console.warn(`[${projectId}] YouTube direct caption fetch failed, falling back to audio transcription:`, err.message);
    return null;
  } finally {
    // ALWAYS remove all temporary subtitle files generated for this project on both success and failure paths
    cleanupMatchingFiles(tempDir, filePrefix);
  }
}

/**
 * Parses JSON3, VTT, or SRT subtitle files into standard normalized segments.
 */
function parseSubtitleFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');

  if (filePath.endsWith('.json3')) {
    try {
      const data = JSON.parse(content);
      const events = data.events || [];
      const segments = [];
      let segId = 1;

      for (const evt of events) {
        if (!evt.segs || evt.tStartMs === undefined) continue;
        const text = evt.segs.map(s => s.utf8 || '').join('').trim();
        if (!text || text === '\n') continue;

        const start = Math.round((evt.tStartMs / 1000) * 100) / 100;
        const dur = Math.round(((evt.dDurationMs || 2500) / 1000) * 100) / 100;
        const end = Math.round((start + dur) * 100) / 100;

        segments.push({
          id: segId++,
          start,
          end,
          text
        });
      }
      return segments;
    } catch (e) {
      console.warn('Failed to parse json3 captions:', e.message);
    }
  }

  // Parse VTT or SRT
  return parseVttOrSrt(content);
}

/**
 * Basic robust WebVTT and SRT parser.
 */
function parseVttOrSrt(content) {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const segments = [];
  let segId = 1;

  const timeRegex = /(?:(\d{2}):)?(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(?:(\d{2}):)?(\d{2}):(\d{2})[.,](\d{3})/;

  let currentStart = null;
  let currentEnd = null;
  let currentText = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) {
      if (currentStart !== null && currentEnd !== null && currentText.length > 0) {
        const text = currentText.join(' ').replace(/<[^>]+>/g, '').trim();
        if (text) {
          segments.push({
            id: segId++,
            start: currentStart,
            end: currentEnd,
            text
          });
        }
      }
      currentStart = null;
      currentEnd = null;
      currentText = [];
      continue;
    }

    const match = line.match(timeRegex);
    if (match) {
      const h1 = parseInt(match[1] || '0', 10);
      const m1 = parseInt(match[2], 10);
      const s1 = parseInt(match[3], 10);
      const ms1 = parseInt(match[4], 10);

      const h2 = parseInt(match[5] || '0', 10);
      const m2 = parseInt(match[6], 10);
      const s2 = parseInt(match[7], 10);
      const ms2 = parseInt(match[8], 10);

      currentStart = Math.round((h1 * 3600 + m1 * 60 + s1 + ms1 / 1000) * 100) / 100;
      currentEnd = Math.round((h2 * 3600 + m2 * 60 + s2 + ms2 / 1000) * 100) / 100;
      currentText = [];
    } else if (currentStart !== null && !/^\d+$/.test(line) && !line.startsWith('WEBVTT') && !line.startsWith('NOTE')) {
      currentText.push(line);
    }
  }

  if (currentStart !== null && currentEnd !== null && currentText.length > 0) {
    const text = currentText.join(' ').replace(/<[^>]+>/g, '').trim();
    if (text) {
      segments.push({
        id: segId++,
        start: currentStart,
        end: currentEnd,
        text
      });
    }
  }

  return segments;
}

/**
 * Downloads ONLY temporary lightweight audio for speech-to-text when captions are unavailable.
 * Converts to 16kHz WAV, then unlinks raw downloaded audio immediately.
 * Zero full video media is downloaded.
 *
 * Cleanup Guarantee:
 * - Always removes all temporary raw audio files (e.g. raw_audio_*, .part, .webm, .m4a) in finally.
 * - If FFmpeg conversion fails or download fails, removes any partially generated WAV file.
 * - If conversion succeeds, preserves the WAV file and returns its path for transcription.
 * - Isolation: Does not delete other project audio or files.
 * - Non-masking: Cleanup errors never mask the original processing error.
 */
async function downloadTemporaryAudio(url, projectId, tempDir, options = {}) {
  const runner = (options && options._execFile) || execFilePromise;
  const cleanUrl = url.trim();
  const rawAudioPrefix = `raw_audio_${projectId}`;
  const wavAudioOutput = path.join(tempDir, `${projectId}.wav`);

  const args = [
    ...getYtDlpBaseArgs(),
    '-f', 'ba[ext=m4a]/258/140/ba[ext=webm]/251/250/249/ba/bestaudio',
    '-o', path.join(tempDir, `${rawAudioPrefix}.%(ext)s`),
    cleanUrl
  ];

  let conversionSucceeded = false;
  try {
    console.log(`[${projectId}] Fetching audio track only (no video download)...`);
    await runner(YT_DLP_BIN, args, { timeout: 120000 });

    // In case yt-dlp downloaded with a different audio extension (e.g. .opus, .webm, .m4a, .part)
    let actualRawAudio = null;
    if (fs.existsSync(tempDir)) {
      const entries = fs.readdirSync(tempDir);
      const match = entries.find(e => e.startsWith(rawAudioPrefix) && !e.endsWith('.part'));
      if (match) actualRawAudio = path.join(tempDir, match);
    }

    if (!actualRawAudio || !fs.existsSync(actualRawAudio)) {
      throw new Error('Temporary audio download completed but output file was not found.');
    }

    // Convert to 16kHz mono WAV for Whisper
    const ffmpegArgs = [
      '-y',
      '-i', actualRawAudio,
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-c:a', 'pcm_s16le',
      wavAudioOutput
    ];
    await runner('ffmpeg', ffmpegArgs, { timeout: 60000 });

    if (!fs.existsSync(wavAudioOutput) || fs.statSync(wavAudioOutput).size === 0) {
      throw new Error('FFmpeg conversion failed: output WAV file was empty or missing.');
    }

    conversionSucceeded = true;
    return wavAudioOutput;
  } catch (err) {
    console.error(`[${projectId}] Temporary audio fetch failed:`, err.message);
    // Remove partially written or corrupt WAV file if conversion failed
    try {
      if (fs.existsSync(wavAudioOutput)) {
        fs.unlinkSync(wavAudioOutput);
      }
    } catch (_) {}
    throw normalizeYtDlpError(err, cleanUrl);
  } finally {
    // ALWAYS remove all temporary raw audio files for this project
    cleanupMatchingFiles(tempDir, rawAudioPrefix);
    // If conversion did not complete successfully, guarantee partial WAV is cleaned up
    if (!conversionSucceeded) {
      try {
        if (fs.existsSync(wavAudioOutput)) {
          fs.unlinkSync(wavAudioOutput);
        }
      } catch (_) {}
    }
  }
}

/**
 * Selectively retrieves ONLY the 30-60 second segment between start and end.
 * Uses yt-dlp --download-sections so the full video is NEVER fetched or stored on phone.
 * Returns the path to the temporary segment file.
 *
 * Cleanup Guarantee:
 * - On failure (network interruption, timeout, corrupt output), all matching segment files
 *   (e.g. segment_<clipId>.mp4, .part) are immediately purged.
 * - On success, the valid segment is preserved and returned for rendering (caller purges on render completion).
 * - Isolation: Only targets segment_<clipId>*, never touches other clips or projects.
 */
async function retrieveClipSegment({ url, start, end, clipId, tempDir, _execFile }) {
  const runner = _execFile || execFilePromise;
  const cleanUrl = url.trim();
  const segmentPrefix = `segment_${clipId}`;
  const segmentOutput = path.join(tempDir, `${segmentPrefix}.mp4`);

  // Format start and end as seconds: *start-end
  const sectionSpec = `*${parseFloat(start).toFixed(2)}-${parseFloat(end).toFixed(2)}`;

  const args = [
    ...getYtDlpBaseArgs(),
    '--download-sections', sectionSpec,
    '-f', 'bestvideo[height<=1080]+bestaudio/best[height<=1080]/best',
    '--merge-output-format', 'mp4',
    '-o', segmentOutput,
    cleanUrl
  ];

  let segmentSucceeded = false;
  console.log(`[${clipId}] Selectively retrieving segment ${start}s - ${end}s via HTTP range...`);
  try {
    await runner(YT_DLP_BIN, args, { timeout: 300000 });

    if (!fs.existsSync(segmentOutput) || fs.statSync(segmentOutput).size === 0) {
      throw new Error(`Selective segment retrieval failed for range ${start}s - ${end}s.`);
    }

    segmentSucceeded = true;
    return segmentOutput;
  } catch (err) {
    console.error(`[${clipId}] Selective segment retrieval failed:`, err.message);
    throw normalizeYtDlpError(err, cleanUrl);
  } finally {
    // If retrieval failed or was incomplete, purge all partial segment files for this clipId
    if (!segmentSucceeded) {
      cleanupMatchingFiles(tempDir, segmentPrefix);
    }
  }
}

/**
 * Detects whether a YouTube URL is currently an active live stream.
 * Inspects yt-dlp metadata for is_live / live_status flags.
 * Returns { isLive: boolean, liveStatus: string, id: string, title: string, uploader: string, thumbnail: string, viewCount: number }
 */
async function detectYouTubeLive(url, options = {}) {
  const runner = (options && options._execFile) || execFilePromise;
  const parsed = parseYouTubeUrl(url);
  if (!parsed.isValid) {
    throw new Error(parsed.error || 'Unsupported URL format: Invalid YouTube URL provided.');
  }

  let cleanUrl = parsed.canonicalUrl || parsed.url;
  if (parsed.type === 'channel') {
    cleanUrl = `https://www.youtube.com/${parsed.channelIdentifier}/live`;
  }

  const args = [
    ...getYtDlpBaseArgs(),
    '--dump-json',
    cleanUrl
  ];

  try {
    const { stdout } = await runner(YT_DLP_BIN, args, { timeout: 45000, maxBuffer: 10 * 1024 * 1024 });
    const data = JSON.parse(stdout);

    const isLive = Boolean(data.is_live === true || data.live_status === 'is_live');
    const isUpcoming = Boolean(data.live_status === 'is_upcoming');
    const wasLive = Boolean(data.was_live === true || data.live_status === 'was_live');
    const liveStatus = data.live_status || (isLive ? 'is_live' : (wasLive ? 'was_live' : (isUpcoming ? 'is_upcoming' : 'not_live')));

    let thumbnail = data.thumbnail || null;
    if (Array.isArray(data.thumbnails) && data.thumbnails.length > 0) {
      const sorted = [...data.thumbnails].sort((a, b) => (b.width || 0) - (a.width || 0));
      thumbnail = sorted[0].url || thumbnail;
    }

    return {
      isLive,
      isUpcoming,
      wasLive,
      liveStatus,
      id: data.id,
      title: (data.title || 'YouTube Live Stream').trim(),
      uploader: data.uploader || data.channel || 'Creator',
      thumbnail,
      viewCount: data.view_count || data.concurrent_view_count || 0,
      canonicalUrl: data.webpage_url || cleanUrl
    };
  } catch (err) {
    console.error('detectYouTubeLive error:', err.message);
    throw normalizeYtDlpError(err, cleanUrl);
  }
}

/**
 * Captures a manageable rolling chunk (30-60s) from an active YouTube Live stream.
 * NEVER downloads or stores the full live stream on the device.
 * Extracts:
 * 1. Rolling video MP4 (up to 720p) bounded to chunkDuration seconds.
 * 2. 16kHz mono audio WAV for speech recognition.
 *
 * Cleanup Guarantee:
 * - On failure, all partial files matching live_chunk_<projectId>* are cleaned up immediately.
 * - On success, returns paths for immediate highlight cut, after which caller purges them.
 */
async function extractLiveRollingChunk({ url, projectId, chunkDuration = 60, tempDir, _execFile }) {
  const runner = _execFile || execFilePromise;
  const cleanUrl = url.trim();
  const chunkPrefix = `live_chunk_${projectId}`;
  const videoChunkPath = path.join(tempDir, `${chunkPrefix}.mp4`);
  const audioChunkPath = path.join(tempDir, `${chunkPrefix}.wav`);

  const safeDuration = Math.min(120, Math.max(15, parseInt(chunkDuration, 10) || 60));

  let chunkSucceeded = false;
  console.log(`[${projectId}] Capturing rolling live stream chunk (${safeDuration}s) without full download...`);

  try {
    const args = [
      ...getYtDlpBaseArgs(),
      '-f', 'bestvideo[height<=720]+bestaudio/best[height<=720]/best',
      '--downloader', 'ffmpeg',
      '--downloader-args', `ffmpeg_i:-t ${safeDuration}`,
      '--merge-output-format', 'mp4',
      '-o', videoChunkPath,
      cleanUrl
    ];

    await runner(YT_DLP_BIN, args, { timeout: (safeDuration + 60) * 1000 });

    if (!fs.existsSync(videoChunkPath) || fs.statSync(videoChunkPath).size === 0) {
      throw new Error(`Live stream capture produced empty or missing file for ${cleanUrl}`);
    }

    // Extract 16kHz mono WAV for Whisper speech recognition
    const ffmpegAudioArgs = [
      '-y',
      '-i', videoChunkPath,
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-c:a', 'pcm_s16le',
      audioChunkPath
    ];

    await runner('ffmpeg', ffmpegAudioArgs, { timeout: 60000 });

    if (!fs.existsSync(audioChunkPath) || fs.statSync(audioChunkPath).size === 0) {
      throw new Error('Failed to extract audio track from live rolling chunk.');
    }

    chunkSucceeded = true;
    return {
      videoChunkPath,
      audioChunkPath,
      duration: safeDuration
    };
  } catch (err) {
    console.error(`[${projectId}] Live rolling chunk extraction failed:`, err.message);
    throw normalizeYtDlpError(err, cleanUrl);
  } finally {
    if (!chunkSucceeded) {
      cleanupMatchingFiles(tempDir, chunkPrefix);
    }
  }
}

/**
 * Safely purges temporary rolling live chunk files for a given project.
 */
function cleanupLiveRollingChunk(projectId, tempDir) {
  cleanupMatchingFiles(tempDir, `live_chunk_${projectId}`);
}

module.exports = {
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
};
