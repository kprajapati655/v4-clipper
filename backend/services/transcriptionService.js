const { execFile } = require('child_process');
const util = require('util');
const path = require('path');
const fs = require('fs');

const execFilePromise = util.promisify(execFile);

const WHISPER_CLI = process.env.WHISPER_CLI || '/data/data/com.termux/files/home/whisper.cpp/build/bin/whisper-cli';
const WHISPER_MODEL = process.env.WHISPER_MODEL || '/data/data/com.termux/files/home/whisper.cpp/models/ggml-tiny.bin';

// Auto-load secrets if not yet in process.env
if (!process.env.GROQ_API_KEY) {
  const secretsPath = path.join(process.env.HOME || '/data/data/com.termux/files/home', '.config/ai-video-workstation/secrets.sh');
  if (fs.existsSync(secretsPath)) {
    try {
      const content = fs.readFileSync(secretsPath, 'utf8');
      const match = content.match(/export\s+GROQ_API_KEY=["']?([^"'\s\n]+)["']?/);
      if (match && match[1]) process.env.GROQ_API_KEY = match[1];
    } catch (_) {}
  }
}

/**
 * Extracts 16kHz mono WAV audio required for speech-to-text.
 */
async function extractAudio(videoPath, audioPath) {
  const args = ['-y', '-i', videoPath, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_s16le', audioPath];
  await execFilePromise('ffmpeg', args, { timeout: 120000, maxBuffer: 10 * 1024 * 1024 });
  if (!fs.existsSync(audioPath)) {
    throw new Error('Audio extraction failed: output WAV not found');
  }
}

/**
 * Transcribes audio using Groq Whisper API (fast cloud) or local whisper-cli fallback.
 */
async function transcribeAudio(audioPath, options = {}) {
  const groqApiKey = process.env.GROQ_API_KEY;

  if (groqApiKey && !options.forceLocal) {
    try {
      console.log('Attempting Groq Whisper API transcription...');
      return await transcribeWithGroq(audioPath, groqApiKey);
    } catch (err) {
      console.warn('Groq Whisper failed, falling back to local Whisper:', err.message);
    }
  }

  // Local fallback using whisper.cpp
  return await transcribeWithLocalWhisper(audioPath);
}

/**
 * Groq Whisper Cloud API transcription with word-level timestamp granularity.
 */
async function transcribeWithGroq(audioPath, apiKey) {
  const stats = fs.statSync(audioPath);
  if (stats.size > 25 * 1024 * 1024) {
    throw new Error('Audio file exceeds 25MB Groq API limit');
  }

  const formData = new FormData();
  let fileBuffer = fs.readFileSync(audioPath);
  const blob = new Blob([fileBuffer], { type: 'audio/wav' });
  fileBuffer = null; // Allow GC to reclaim raw buffer
  formData.append('file', blob, path.basename(audioPath));
  formData.append('model', 'whisper-large-v3-turbo');
  formData.append('response_format', 'verbose_json');
  // Request both word-level and segment-level timestamps
  formData.append('timestamp_granularities[]', 'word');
  formData.append('timestamp_granularities[]', 'segment');

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`
    },
    body: formData
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Groq Whisper API returned ${response.status}: ${errorText}`);
  }

  const data = await response.json();

  // Extract raw word timestamps if provided by Groq
  const rawWords = Array.isArray(data.words)
    ? data.words.map(w => ({
        word: (w.word || '').trim(),
        start: Math.round(parseFloat(w.start) * 1000) / 1000,
        end: Math.round(parseFloat(w.end) * 1000) / 1000
      })).filter(w => w.word.length > 0 && w.end >= w.start)
    : [];

  const segments = (data.segments || []).map((seg, idx) => {
    const sStart = Math.round(parseFloat(seg.start) * 1000) / 1000;
    const sEnd = Math.round(parseFloat(seg.end) * 1000) / 1000;
    const sText = (seg.text || '').trim();

    // Attach words that fall within this segment
    let segWords = rawWords.filter(w => w.start >= (sStart - 0.05) && w.end <= (sEnd + 0.05));
    if (segWords.length === 0 && sText.length > 0) {
      segWords = alignWordsInSegment({ start: sStart, end: sEnd, text: sText });
    }

    return {
      id: idx + 1,
      start: sStart,
      end: sEnd,
      text: sText,
      words: segWords
    };
  });

  return {
    engine: 'groq-whisper-large-v3',
    language: data.language || 'en',
    duration: data.duration,
    fullText: data.text || '',
    words: rawWords,
    segments
  };
}

/**
 * Local whisper.cpp CLI transcription.
 */
async function transcribeWithLocalWhisper(audioPath) {
  if (!fs.existsSync(WHISPER_CLI)) {
    throw new Error(`Whisper CLI binary not found at ${WHISPER_CLI}`);
  }
  if (!fs.existsSync(WHISPER_MODEL)) {
    throw new Error(`Whisper model not found at ${WHISPER_MODEL}`);
  }

  const baseOutput = audioPath.replace(/\.wav$/i, '');
  const jsonPath = `${baseOutput}.json`;
  const args = ['-m', WHISPER_MODEL, '-f', audioPath, '-oj', '-of', baseOutput, '-t', '4'];

  try {
    await execFilePromise(WHISPER_CLI, args, { timeout: 300000, maxBuffer: 10 * 1024 * 1024 });

    if (!fs.existsSync(jsonPath)) {
      throw new Error('Whisper local transcription failed: JSON output missing');
    }

    const rawData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
    const rawSegments = rawData.transcription || [];

    const segments = rawSegments.map((seg, idx) => {
      const startSec = (seg.offsets ? seg.offsets.from : (seg.timestamps ? seg.timestamps.from : 0)) / 1000;
      const endSec = (seg.offsets ? seg.offsets.to : (seg.timestamps ? seg.timestamps.to : 0)) / 1000;
      const sStart = Math.round(startSec * 1000) / 1000;
      const sEnd = Math.round(endSec * 1000) / 1000;
      const sText = (seg.text || '').trim();

      const segWords = alignWordsInSegment({ start: sStart, end: sEnd, text: sText });

      return {
        id: idx + 1,
        start: sStart,
        end: sEnd,
        text: sText,
        words: segWords
      };
    }).filter(s => s.end > s.start && s.text.length > 0);

    const fullText = segments.map(s => s.text).join(' ');

    return {
      engine: 'local-whisper-cpp',
      fullText,
      segments
    };
  } finally {
    if (fs.existsSync(jsonPath)) {
      try { fs.unlinkSync(jsonPath); } catch (e) {}
    }
  }
}

/**
 * Speech-rate and natural punctuation word alignment for segment-level captions.
 * Guarantees every word timing is strictly bounded by the speaker's actual audio segment [start, end].
 * Weights word duration by syllable/character complexity and punctuation pauses.
 */
function alignWordsInSegment(segment) {
  if (Array.isArray(segment.words) && segment.words.length > 0) {
    return segment.words;
  }

  const text = (segment.text || '').trim();
  if (!text) return [];

  const rawTokens = text.split(/\s+/).filter(Boolean);
  if (rawTokens.length === 0) return [];

  const start = parseFloat(segment.start) || 0;
  const end = Math.max(start + 0.1, parseFloat(segment.end) || (start + 0.1));
  const totalDuration = end - start;

  if (rawTokens.length === 1) {
    return [{ word: rawTokens[0], start, end }];
  }

  // Weight each token by character length and punctuation pause
  const weights = rawTokens.map(w => {
    const letters = w.replace(/[^\p{L}\p{N}]/gu, '');
    const charWeight = Math.max(1, letters.length);
    let pauseWeight = 0;
    if (/[.!?]$/.test(w)) {
      pauseWeight = 2.0; // Sentence boundary pause
    } else if (/[,;:]$/.test(w)) {
      pauseWeight = 1.0; // Clause/comma pause
    }
    return charWeight + pauseWeight;
  });

  const sumWeights = weights.reduce((acc, v) => acc + v, 0) || 1;
  let currentStart = start;
  const aligned = [];

  for (let i = 0; i < rawTokens.length; i++) {
    const tokenDuration = (weights[i] / sumWeights) * totalDuration;
    const tokenEnd = (i === rawTokens.length - 1)
      ? end
      : Math.round((currentStart + tokenDuration) * 1000) / 1000;

    aligned.push({
      word: rawTokens[i],
      start: Math.round(currentStart * 1000) / 1000,
      end: Math.max(Math.round(currentStart * 1000) / 1000 + 0.05, tokenEnd)
    });

    currentStart = tokenEnd;
  }

  return aligned;
}

/**
 * Universal Subtitle Parser: Parses SRT, WebVTT, ASS/SSA, TTML/DFXP, SAMI, and JSON3 subtitle strings into normalized segments.
 * In JSON3, extracts word-level timing from event segments (tOffsetMs) whenever present.
 */
function parseSubtitleContent(content, ext = 'srt') {
  if (!content || typeof content !== 'string') return [];
  const cleanExt = (ext || 'srt').toLowerCase().replace(/^\./, '');

  // 1. JSON3 (YouTube word-level / token format)
  if (cleanExt === 'json3' || content.trim().startsWith('{')) {
    try {
      const data = JSON.parse(content);
      const events = data.events || [];
      const segments = [];
      let segId = 1;

      for (const evt of events) {
        if (!evt.segs || evt.tStartMs === undefined) continue;

        const evtStart = Math.round((evt.tStartMs / 1000) * 1000) / 1000;
        const evtDuration = Math.round(((evt.dDurationMs || 2500) / 1000) * 1000) / 1000;
        const evtEnd = Math.round((evtStart + evtDuration) * 1000) / 1000;

        // Parse word-level segments
        const words = [];
        let fullTextParts = [];

        for (let i = 0; i < evt.segs.length; i++) {
          const s = evt.segs[i];
          const rawWord = s.utf8 || '';
          const trimmed = rawWord.trim();
          if (!trimmed || trimmed === '\n') continue;

          fullTextParts.push(trimmed);

          const wordOffsetMs = s.tOffsetMs !== undefined ? s.tOffsetMs : 0;
          const wordStart = Math.round((evt.tStartMs + wordOffsetMs) / 1000 * 1000) / 1000;

          // Estimate word end from next seg's offset or event end
          let wordEnd = evtEnd;
          if (i + 1 < evt.segs.length && evt.segs[i + 1].tOffsetMs !== undefined) {
            wordEnd = Math.round((evt.tStartMs + evt.segs[i + 1].tOffsetMs) / 1000 * 1000) / 1000;
          }
          if (wordEnd <= wordStart) {
            wordEnd = Math.round((wordStart + 0.25) * 1000) / 1000;
          }

          words.push({
            word: trimmed,
            start: wordStart,
            end: Math.min(evtEnd, wordEnd)
          });
        }

        const fullText = fullTextParts.join(' ');
        if (!fullText) continue;

        segments.push({
          id: segId++,
          start: evtStart,
          end: evtEnd,
          text: fullText,
          words: words.length > 0 ? words : alignWordsInSegment({ start: evtStart, end: evtEnd, text: fullText })
        });
      }

      if (segments.length > 0) return segments;
    } catch (_) {}
  }

  // 2. ASS / SSA
  if (cleanExt === 'ass' || cleanExt === 'ssa' || content.includes('[Events]')) {
    const lines = content.split(/\r?\n/);
    const segments = [];
    let segId = 1;
    for (const line of lines) {
      if (line.startsWith('Dialogue:')) {
        const parts = line.substring(9).split(',');
        if (parts.length >= 10) {
          const startStr = parts[1].trim();
          const endStr = parts[2].trim();
          const text = parts.slice(9).join(',').replace(/\{[^}]+\}/g, '').replace(/\\N/g, ' ').trim();
          const parseAssTime = (t) => {
            const p = t.split(':').map(Number);
            return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : 0;
          };
          const start = Math.round(parseAssTime(startStr) * 100) / 100;
          const end = Math.round(parseAssTime(endStr) * 100) / 100;
          if (text && end > start) {
            segments.push({
              id: segId++,
              start,
              end,
              text,
              words: alignWordsInSegment({ start, end, text })
            });
          }
        }
      }
    }
    if (segments.length > 0) return segments;
  }

  // 3. TTML / DFXP / XML
  if (cleanExt === 'ttml' || cleanExt === 'dfxp' || cleanExt === 'xml' || content.includes('<tt') || content.includes('<p begin=')) {
    const pRegex = /<p[^>]+begin=["']([^"']+)["'][^>]+end=["']([^"']+)["'][^>]*>([\s\S]*?)<\/p>/gi;
    const segments = [];
    let match;
    let segId = 1;
    const parseClock = (c) => {
      if (c.endsWith('s')) return parseFloat(c);
      const p = c.replace(/,/g, '.').split(':').map(Number);
      if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
      if (p.length === 2) return p[0] * 60 + p[1];
      return parseFloat(c) || 0;
    };
    while ((match = pRegex.exec(content)) !== null) {
      const start = Math.round(parseClock(match[1]) * 100) / 100;
      const end = Math.round(parseClock(match[2]) * 100) / 100;
      const text = match[3].replace(/<[^>]+>/g, '').trim();
      if (text && end > start) {
        segments.push({
          id: segId++,
          start,
          end,
          text,
          words: alignWordsInSegment({ start, end, text })
        });
      }
    }
    if (segments.length > 0) return segments;
  }

  // 4. Standard SRT and WebVTT
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
            text,
            words: alignWordsInSegment({ start: currentStart, end: currentEnd, text })
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
        text,
        words: alignWordsInSegment({ start: currentStart, end: currentEnd, text })
      });
    }
  }

  return segments;
}

/**
 * Extracts a continuous flat list of words with timing from either words arrays or segments.
 */
function extractWordList(segmentsOrWords) {
  if (!Array.isArray(segmentsOrWords)) return [];
  const words = [];

  for (const item of segmentsOrWords) {
    if (item.word && item.start !== undefined) {
      words.push({
        word: String(item.word).trim(),
        start: parseFloat(item.start) || 0,
        end: parseFloat(item.end) || (parseFloat(item.start) + 0.1)
      });
    } else if (Array.isArray(item.words) && item.words.length > 0) {
      for (const w of item.words) {
        words.push({
          word: String(w.word).trim(),
          start: parseFloat(w.start) || 0,
          end: parseFloat(w.end) || (parseFloat(w.start) + 0.1)
        });
      }
    } else if (item.text) {
      const aligned = alignWordsInSegment(item);
      for (const w of aligned) {
        words.push(w);
      }
    }
  }

  // Ensure chronological ordering
  words.sort((a, b) => a.start - b.start);
  return words.filter(w => w.word.length > 0);
}

/**
 * Groups words into compact ~2-word synchronized display units.
 * Never displays long sentences.
 * Respects sentence boundaries, punctuation, and speech pauses (> 0.35s).
 */
function generateTwoWordChunks(segmentsOrWords, offsetStart = 0) {
  const words = extractWordList(segmentsOrWords);
  if (words.length === 0) return [];

  const chunks = [];
  let i = 0;

  while (i < words.length) {
    const w1 = words[i];
    const w2 = (i + 1 < words.length) ? words[i + 1] : null;

    const w1EndsSentence = /[.!?]$/.test(w1.word.trim());
    const pauseBeforeW2 = w2 ? (w2.start - w1.end) : 0;
    const hasLongPause = pauseBeforeW2 > 0.35;

    let chunkWords = [];
    if (!w2 || w1EndsSentence || hasLongPause) {
      chunkWords = [w1];
      i += 1;
    } else {
      chunkWords = [w1, w2];
      i += 2;
    }

    const chunkStart = Math.max(0, chunkWords[0].start - offsetStart);
    const chunkEnd = Math.max(chunkStart + 0.08, chunkWords[chunkWords.length - 1].end - offsetStart);

    chunks.push({
      id: chunks.length + 1,
      start: Math.round(chunkStart * 1000) / 1000,
      end: Math.round(chunkEnd * 1000) / 1000,
      text: chunkWords.map(cw => cw.word).join(' '),
      words: chunkWords.map(cw => ({
        word: cw.word,
        start: Math.max(0, Math.round((cw.start - offsetStart) * 1000) / 1000),
        end: Math.max(0.05, Math.round((cw.end - offsetStart) * 1000) / 1000)
      }))
    });
  }

  return chunks;
}

/**
 * Formats seconds into standard SRT timestamp (00:00:00,000).
 */
function formatSrtTimestamp(seconds) {
  const totalMs = Math.round(seconds * 1000);
  const hrs = Math.floor(totalMs / 3600000);
  const mins = Math.floor((totalMs % 3600000) / 60000);
  const secs = Math.floor((totalMs % 60000) / 1000);
  const ms = totalMs % 1000;
  return `${String(hrs).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

/**
 * Formats seconds into standard ASS timestamp (0:00:00.00).
 */
function formatAssTimestamp(seconds) {
  const totalCs = Math.max(0, Math.round(seconds * 100)); // Centiseconds
  const hrs = Math.floor(totalCs / 360000);
  const mins = Math.floor((totalCs % 360000) / 6000);
  const secs = Math.floor((totalCs % 6000) / 100);
  const cs = totalCs % 100;
  return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

/**
 * Converts segments into standard SRT format.
 * If options.twoWordSync is true, automatically converts into 2-word units first.
 */
function segmentsToSrt(segments, offsetStart = 0, options = {}) {
  const targetSegments = (options && options.twoWordSync === true)
    ? generateTwoWordChunks(segments, offsetStart)
    : segments;

  return targetSegments.map((seg, idx) => {
    const rawStart = (options && options.twoWordSync === true) ? seg.start : (seg.start - offsetStart);
    const rawEnd = (options && options.twoWordSync === true) ? seg.end : (seg.end - offsetStart);
    const start = Math.max(0, rawStart);
    const end = Math.max(start + 0.1, rawEnd);
    return `${idx + 1}\n${formatSrtTimestamp(start)} --> ${formatSrtTimestamp(end)}\n${seg.text}\n`;
  }).join('\n');
}

/**
 * Converts word tokens or segments into tightly synchronized ~2-word SRT subtitle blocks.
 */
function wordsToTwoWordSrt(segmentsOrWords, offsetStart = 0) {
  const chunks = generateTwoWordChunks(segmentsOrWords, offsetStart);
  return segmentsToSrt(chunks, 0, { twoWordSync: false });
}

/**
 * Generates ASS (Advanced SubStation Alpha) script content for pixel-perfect word-synchronized subtitles.
 * Features:
 * - Displays ~2 words at a time.
 * - Highlights the currently spoken word with restrained styling.
 * - Respects safe area of 9:16 vertical video (never covers faces or native UI).
 * - Compact, readable typography.
 */
function generateWordSynchronizedAss(segmentsOrWords, offsetStart = 0, options = {}) {
  const resolution = options.resolution || '720x1280';
  const [resW, resH] = resolution.split('x').map(Number);
  const style = options.subtitleStyle || 'clean_white';

  // Sizing and positioning parameters calculated for 9:16 safe vertical area
  // Safe zone: lower third, centered, above bottom UI (~15-18% above bottom)
  let fontSize = Math.round(resH * 0.022); // ~28px at 1280h, ~42px at 1920h
  let marginV = Math.round(resH * 0.145);  // ~185px at 1280h (safe from bottom UI, well below face)
  let activeColor = '&H00FFFFFF';
  let inactiveColor = '&H009E9E9E';
  let outlineColor = '&H00151515';
  let outlineWidth = 2.2;
  let bold = 1;

  switch (style) {
    case 'highlighted':
      activeColor = '&H001B79FF';  // Vibrant Amber in BGR (&H00BBGGRR)
      inactiveColor = '&H00FFFFFF'; // Crisp white for inactive
      outlineColor = '&H000A0A0A';
      outlineWidth = 2.5;
      break;

    case 'minimal':
      activeColor = '&H00F5F5F5';
      inactiveColor = '&H00707070';
      outlineColor = '&H00202020';
      outlineWidth = 1.2;
      bold = 0;
      fontSize = Math.round(fontSize * 0.88);
      break;

    case 'bold_creator':
      activeColor = '&H0000E5FF';  // Vibrant Yellow in BGR (&H0000E5FF)
      inactiveColor = '&H00FFFFFF';
      outlineColor = '&H00000000';
      outlineWidth = 3.0;
      break;

    case 'clean_white':
    default:
      activeColor = '&H00FFFFFF';   // Bright white
      inactiveColor = '&H008E8E93'; // Apple subtle grey
      outlineColor = '&H00121212';
      outlineWidth = 2.2;
      break;
  }

  // Custom overrides
  if (options.customFontSize) {
    fontSize = parseInt(options.customFontSize, 10) || fontSize;
  }
  if (options.customAlignment === 'middle') {
    marginV = Math.round(resH * 0.45);
  } else if (options.customAlignment === 'top') {
    marginV = Math.round(resH * 0.78);
  }

  const chunks = generateTwoWordChunks(segmentsOrWords, offsetStart);

  const header = `[Script Info]
ScriptType: v4.00+
PlayResX: ${resW}
PlayResY: ${resH}
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: V4Sub,DejaVu Sans,${fontSize},${activeColor},&H00000000,${outlineColor},&H80000000,${bold},0,0,0,100,100,0,0,1,${outlineWidth},0,2,40,40,${marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
`;

  const dialogueLines = [];

  for (const chunk of chunks) {
    const chunkWords = chunk.words;
    if (!chunkWords || chunkWords.length === 0) continue;

    if (chunkWords.length === 1) {
      // Single-word chunk
      const w = chunkWords[0];
      const startT = formatAssTimestamp(chunk.start);
      const endT = formatAssTimestamp(chunk.end);
      dialogueLines.push(
        `Dialogue: 0,${startT},${endT},V4Sub,,0,0,0,,{\\c${activeColor}&}${escapeAssText(w.word)}{\\c}`
      );
    } else {
      // 2-word chunk: highlight each word in its speech window
      for (let activeIdx = 0; activeIdx < chunkWords.length; activeIdx++) {
        const curWord = chunkWords[activeIdx];
        const nextWord = (activeIdx + 1 < chunkWords.length) ? chunkWords[activeIdx + 1] : null;

        const subStart = Math.max(chunk.start, curWord.start);
        const subEnd = nextWord
          ? Math.max(subStart + 0.05, nextWord.start)
          : chunk.end;

        if (subEnd <= subStart) continue;

        const formattedWords = chunkWords.map((cw, idx) => {
          const color = (idx === activeIdx) ? activeColor : inactiveColor;
          return `{\\c${color}&}${escapeAssText(cw.word)}{\\c}`;
        }).join(' ');

        dialogueLines.push(
          `Dialogue: 0,${formatAssTimestamp(subStart)},${formatAssTimestamp(subEnd)},V4Sub,,0,0,0,,${formattedWords}`
        );
      }
    }
  }

  return header + dialogueLines.join('\n') + '\n';
}

function escapeAssText(text) {
  if (!text) return '';
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}');
}

module.exports = {
  extractAudio,
  transcribeAudio,
  transcribeWithGroq,
  transcribeWithLocalWhisper,
  alignWordsInSegment,
  extractWordList,
  generateTwoWordChunks,
  generateWordSynchronizedAss,
  segmentsToSrt,
  wordsToTwoWordSrt,
  formatSrtTimestamp,
  formatAssTimestamp,
  parseSubtitleContent
};
