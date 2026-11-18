/**
 * Frontend YouTube URL Parser and Validator for V4 Clipper.
 * Supports all standard, mobile, short, live, embed, clip,
 * channel, and playlist URLs.
 * Pure JavaScript, standard WHATWG URL parsing.
 */

export function parseYouTubeUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return {
      isValid: false,
      url: null,
      type: null,
      id: null,
      error: 'Please provide a YouTube link.'
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

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return {
      isValid: false,
      url: null,
      type: null,
      id: null,
      error: 'Unsupported URL format: Only HTTP and HTTPS links are supported.'
    };
  }

  const host = parsed.hostname.toLowerCase();
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
      error: 'Unsupported URL format: Not a YouTube link. Please provide a link from youtube.com or youtu.be.'
    };
  }

  const pathname = parsed.pathname.replace(/\/+$/, '');
  const searchParams = parsed.searchParams;

  // 1. youtu.be short URLs
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

  // 2. watch URLs
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
        error: 'Unsupported URL format: Missing video "v" parameter in YouTube link.'
      };
    }
  }

  // 3. Shorts
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

  // 4. Live
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

  // 5. Embed
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

  // 6. Legacy /v/
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

  // 7. Clips
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

  // 8. Playlists
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

  // 9. Channel Live
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

  // 10. Channel general URLs
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

  return {
    isValid: false,
    url: urlString,
    type: null,
    id: null,
    error: 'Unsupported YouTube URL format. Please provide a video, Short, Live stream, channel, or playlist link.'
  };
}

export function isValidYouTubeUrl(rawUrl) {
  const result = parseYouTubeUrl(rawUrl);
  return Boolean(result && result.isValid);
}

export function getYoutubeTypeLabel(type) {
  switch (type) {
    case 'short':
      return 'YouTube Short';
    case 'live':
      return 'YouTube Live';
    case 'channel_live':
      return 'Channel Live';
    case 'clip':
      return 'YouTube Clip';
    case 'playlist':
      return 'Playlist';
    case 'channel':
      return 'Channel';
    case 'embed':
      return 'Embedded Video';
    case 'active_livestream':
      return 'Active Livestream';
    case 'livestream_replay':
      return 'Livestream Replay';
    case 'scheduled_livestream':
      return 'Scheduled Livestream';
    case 'video':
    default:
      return 'YouTube Video';
  }
}
