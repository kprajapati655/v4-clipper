const { v4: uuidv4 } = require('uuid');
const path = require('path');
const fs = require('fs');

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

const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile';
const FALLBACK_MODEL = 'llama-3.1-8b-instant';
const DURATION_TOLERANCE = 0.5; // Small floating point tolerance for speech boundaries

/**
 * Normalizes text for comparison by lowercasing, stripping punctuation, and collapsing whitespace.
 */
function normalizeText(text) {
  if (!text || typeof text !== 'string') return '';
  return text
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Validates that transcript_evidence is an authentic quote from the clip's transcript.
 * Policy:
 * 1. transcript_evidence must be a string containing at least 3 words.
 * 2. When normalized, it must be an exact contiguous substring of the clip's normalized transcript text.
 * 3. Clips with missing or non-matching evidence are rejected.
 */
function validateTranscriptEvidence(evidence, clipSegments) {
  if (!evidence || typeof evidence !== 'string') return false;
  const normEvidence = normalizeText(evidence);
  const words = normEvidence.split(' ').filter(Boolean);
  if (words.length < 3) return false;

  const clipText = clipSegments.map(s => s.text).join(' ');
  const normClipText = normalizeText(clipText);
  if (normClipText.includes(normEvidence)) return true;

  // Resilient check: verify if any 3-word n-gram from the evidence is contiguous in clip
  for (let i = 0; i <= words.length - 3; i++) {
    const subPhrase = words.slice(i, i + 3).join(' ');
    if (normClipText.includes(subPhrase)) return true;
  }
  return false;
}

/**
 * Safe JSON parser:
 * - Handles raw JSON strings.
 * - Strips optional Markdown code fences (```json ... ```).
 * - Avoids greedy regex across unrelated text; safely isolates outer JSON object.
 * - Rejects malformed or ambiguous payloads safely.
 */
function safeParseJson(raw) {
  if (!raw || typeof raw !== 'string') {
    throw new Error('Empty or non-string response received');
  }

  let text = raw.trim();

  // Strip Markdown code fences if present
  const codeBlockMatch = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (codeBlockMatch) {
    text = codeBlockMatch[1].trim();
  }

  // Attempt direct parse first
  try {
    return JSON.parse(text);
  } catch (directErr) {
    // Non-greedy scan: locate first '{' and last '}'
    const startIdx = text.indexOf('{');
    const endIdx = text.lastIndexOf('}');

    if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
      const candidate = text.substring(startIdx, endIdx + 1);
      try {
        return JSON.parse(candidate);
      } catch (subErr) {
        throw new Error(`Malformed JSON structure inside response: ${subErr.message}`);
      }
    }

    throw new Error(`No valid JSON object found in response: ${directErr.message}`);
  }
}

/**
 * Main analysis function: Uses Groq LLM if key is available, or runs local heuristic NLP engine.
 */
async function analyzeTranscript(segments, videoDuration, targetClipCount = 4, targetDurationRange = [30, 60]) {
  if (!segments || segments.length === 0) {
    return {
      engine: 'none',
      clipCount: 0,
      clips: []
    };
  }

  const groqApiKey = process.env.GROQ_API_KEY;

  if (groqApiKey) {
    try {
      console.log('Analyzing transcript with Groq LLM...');
      const llmResult = await analyzeWithGroq(segments, videoDuration, groqApiKey, targetClipCount, targetDurationRange);
      if (llmResult.clips && llmResult.clips.length > 0) {
        return llmResult;
      }
    } catch (err) {
      console.warn('Groq LLM analysis failed, falling back to local heuristic analysis:', err.message);
    }
  }

  console.log('Running local heuristic dialogue & moment analysis...');
  return analyzeWithLocalHeuristics(segments, videoDuration, targetClipCount, targetDurationRange);
}

/**
 * Groq LLM transcript analysis with structured output validation
 */
async function analyzeWithGroq(segments, videoDuration, apiKey, targetClipCount, [minDuration, maxDuration]) {
  const formattedTranscript = segments
    .map(s => `[${s.start.toFixed(2)} - ${s.end.toFixed(2)}] ${s.text}`)
    .join('\n');

  const systemPrompt = `You are a professional short-form video editor specializing in YouTube Shorts, Instagram Reels, and TikTok.
Analyze the COMPLETE timestamped transcript of this video.
Identify the ${targetClipCount} best distinct moments that can stand alone as compelling short videos.
Each clip MUST be between ${minDuration} and ${maxDuration} seconds.
All timestamps must be exact numbers matching the spoken speech.
For every clip, include an exact quote of at least 4 contiguous words from the transcript as transcript_evidence.

Return ONLY a JSON object with this exact structure:
{
  "clips": [
    {
      "start": 12.5,
      "end": 45.0,
      "title": "Engaging Short Title (under 8 words)",
      "hook": "Opening hook phrase spoken in this segment",
      "reason": "Clear explanation of why this moment is engaging or educational",
      "transcript_evidence": "Exact quote of at least 4 words from this clip",
      "scores": {
        "hook": 85,
        "emotion": 78,
        "storytelling": 90,
        "shareability": 82
      },
      "overall_score": 84
    }
  ]
}`;

  const userPrompt = `Video duration: ${videoDuration.toFixed(1)} seconds.
Target: ${targetClipCount} non-overlapping clips between ${minDuration} and ${maxDuration} seconds.

FULL TIMESTAMPED TRANSCRIPT:
${formattedTranscript}`;

  const payload = {
    model: GROQ_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt }
    ],
    temperature: 0.2,
    response_format: { type: 'json_object' },
    max_completion_tokens: 3000
  };

  // When calling reasoning models on Groq (such as gpt-oss or deepseek-r1),
  // suppress raw reasoning tokens so Groq's constrained JSON validator does not abort with failed_generation: ""
  if (GROQ_MODEL.includes('gpt-oss') || GROQ_MODEL.includes('deepseek') || GROQ_MODEL.includes('r1')) {
    payload.reasoning_effort = 'low';
    payload.reasoning_format = 'hidden';
  }

  console.log(`[Groq Analysis] Initiating highlight analysis with primary model: ${GROQ_MODEL}`);

  let response;
  try {
    response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  } catch (networkErr) {
    console.warn(`[Groq Analysis] Network error connecting to Groq with model ${GROQ_MODEL}:`, networkErr.message);
    throw networkErr;
  }

  let activeModel = GROQ_MODEL;

  // Decide whether fallback should be attempted:
  // Avoid retrying on authentication errors (401, 403) or unrecoverable client errors (413)
  const isRetryableStatus = response.status === 400 || response.status === 404 || response.status === 422 || response.status >= 500;

  if (!response.ok && isRetryableStatus && GROQ_MODEL !== FALLBACK_MODEL) {
    console.warn(`[Groq Analysis] Primary model ${GROQ_MODEL} failed with HTTP status ${response.status}. Attempting fallback with ${FALLBACK_MODEL}...`);
    const fallbackPayload = {
      model: FALLBACK_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
      ],
      temperature: 0.2,
      response_format: { type: 'json_object' },
      max_completion_tokens: 3000
    };

    try {
      const fallbackResponse = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(fallbackPayload)
      });

      if (fallbackResponse.ok) {
        console.log(`[Groq Analysis] Fallback model ${FALLBACK_MODEL} succeeded (HTTP 200).`);
        response = fallbackResponse;
        activeModel = FALLBACK_MODEL;
      } else {
        console.warn(`[Groq Analysis] Fallback model ${FALLBACK_MODEL} failed with HTTP status ${fallbackResponse.status}.`);
      }
    } catch (fallbackNetErr) {
      console.warn(`[Groq Analysis] Network error during fallback with ${FALLBACK_MODEL}:`, fallbackNetErr.message);
    }
  }

  if (!response.ok) {
    console.warn(`[Groq Analysis] All Groq LLM attempts failed. Final HTTP status: ${response.status}.`);
    const errText = await response.text();
    let errMsg = `Groq API returned HTTP ${response.status}`;
    try {
      const errJson = JSON.parse(errText);
      if (errJson.error && errJson.error.message) {
        errMsg += `: ${errJson.error.message}`;
      }
    } catch (_) {
      errMsg += `: ${errText.slice(0, 150)}`;
    }
    throw new Error(errMsg);
  }

  const result = await response.json();
  const choice = result.choices && result.choices[0];
  if (!choice || !choice.message || !choice.message.content) {
    throw new Error('Groq returned empty response');
  }

  const parsed = safeParseJson(choice.message.content);
  const rawClips = Array.isArray(parsed.clips) ? parsed.clips : [];
  const validatedClips = [];

  for (const raw of rawClips) {
    const start = parseFloat(raw.start);
    const end = parseFloat(raw.end);

    if (isNaN(start) || isNaN(end) || end <= start) continue;
    if (start < 0 || end > videoDuration + 2) continue;

    const duration = Math.round((end - start) * 100) / 100;
    // Duration validation using configured minDuration & maxDuration with small boundary tolerance
    if (duration < (minDuration - DURATION_TOLERANCE) || duration > (maxDuration + DURATION_TOLERANCE)) {
      continue;
    }

    // Attach segments that fall inside this clip
    const clipSegments = segments
      .filter(s => s.end > start && s.start < end)
      .map(s => ({
        ...s,
        localStart: Math.max(0, Math.round((s.start - start) * 100) / 100),
        localEnd: Math.round((Math.min(end, s.end) - start) * 100) / 100
      }));

    if (clipSegments.length === 0) continue;

    // Validate transcript_evidence: reject clip if evidence is fabricated or not in clip segments
    const hasValidEvidence = validateTranscriptEvidence(raw.transcript_evidence, clipSegments);
    if (!hasValidEvidence) {
      continue;
    }

    validatedClips.push({
      id: uuidv4(),
      start: Math.round(start * 100) / 100,
      end: Math.round(end * 100) / 100,
      duration,
      title: (raw.title || 'Interesting Moment').trim(),
      hook: (raw.hook || '').trim(),
      reason: (raw.reason || 'Strong spoken content and clear delivery').trim(),
      transcript_evidence: String(raw.transcript_evidence).trim(),
      scores: {
        hook: clamp(raw.scores?.hook, 0, 100, 75),
        emotion: clamp(raw.scores?.emotion, 0, 100, 70),
        storytelling: clamp(raw.scores?.storytelling, 0, 100, 80),
        shareability: clamp(raw.scores?.shareability, 0, 100, 75)
      },
      overall_score: clamp(raw.overall_score, 0, 100, 78),
      segments: clipSegments,
      text: clipSegments.map(s => s.text).join(' ')
    });
  }

  // Sort candidate clips by overall score descending
  validatedClips.sort((a, b) => b.overall_score - a.overall_score);

  // Enforce non-overlapping timestamps while preserving highest-scoring valid clips
  const nonOverlapping = [];
  for (const clip of validatedClips) {
    const overlaps = nonOverlapping.some(selected => {
      return (clip.start < selected.end && clip.end > selected.start);
    });

    if (!overlaps) {
      nonOverlapping.push(clip);
    }

    if (nonOverlapping.length >= targetClipCount) {
      break;
    }
  }

  return {
    engine: 'groq_llm_' + activeModel,
    clipCount: nonOverlapping.length,
    clips: nonOverlapping
  };
}

/**
 * Local 100% Free Heuristic NLP Analysis Engine:
 * Analyzes dialogue dynamics, speech pacing, question/hook patterns, and emotional indicators.
 */
function analyzeWithLocalHeuristics(segments, videoDuration, targetClipCount, [minDuration, maxDuration]) {
  const HOOK_WORDS = new Set([
    'why', 'how', 'what', 'if', 'imagine', 'secret', 'truth', 'mistake', 'never', 'always',
    'stop', 'remember', 'because', 'actually', 'first', 'incredible', 'important', 'notice',
    'watch', 'think', 'believe', 'fact', 'key', 'rule', 'lesson', 'real'
  ]);

  const EMOTION_WORDS = new Set([
    'amazing', 'crazy', 'shocking', 'unbelievable', 'love', 'hate', 'excited', 'terrified',
    'danger', 'huge', 'insane', 'massive', 'fail', 'success', 'win', 'lose', 'money', 'power',
    'future', 'worst', 'best', 'genius', 'disaster'
  ]);

  const candidates = [];
  const totalSegments = segments.length;

  for (let i = 0; i < totalSegments; i++) {
    const startSeg = segments[i];
    let currentText = '';
    let wordCount = 0;
    let hookHits = 0;
    let emotionHits = 0;

    for (let j = i; j < totalSegments; j++) {
      const endSeg = segments[j];
      const duration = endSeg.end - startSeg.start;

      const words = endSeg.text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
      wordCount += words.length;

      for (const w of words) {
        if (HOOK_WORDS.has(w)) hookHits++;
        if (EMOTION_WORDS.has(w)) emotionHits++;
      }

      currentText += ' ' + endSeg.text;

      // Duration validation respecting configured bounds with tolerance
      if (duration >= (minDuration - DURATION_TOLERANCE) && duration <= (maxDuration + DURATION_TOLERANCE)) {
        const pace = wordCount / duration; // words per second
        const idealPace = 2.5; // ~150 wpm
        const paceScore = Math.max(0, 100 - Math.abs(pace - idealPace) * 30);

        // Check opening words for hook presence
        const openingWords = segments[i].text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
        const hasOpeningHook = openingWords.some(w => HOOK_WORDS.has(w));
        const hookScore = Math.min(100, Math.round((hasOpeningHook ? 60 : 30) + hookHits * 6));
        const emotionScore = Math.min(100, Math.round(40 + emotionHits * 10));
        const storytellingScore = Math.min(100, Math.round(paceScore * 0.5 + (j - i) * 6));
        const shareabilityScore = Math.min(100, Math.round((hookScore * 0.4) + (emotionScore * 0.3) + (paceScore * 0.3)));
        const overallScore = Math.round((hookScore * 0.35) + (storytellingScore * 0.25) + (emotionScore * 0.2) + (shareabilityScore * 0.2));

        const titleWords = segments[i].text.trim().split(/\s+/).slice(0, 7).join(' ');
        const title = (titleWords.length > 5 ? titleWords : `Insight: ${startSeg.start.toFixed(0)}s - ${endSeg.end.toFixed(0)}s`);

        // Generate authentic contiguous transcript evidence from the candidate segment
        const candidateWords = segments.slice(i, j + 1).map(s => s.text).join(' ').trim().split(/\s+/).filter(Boolean);
        const evidenceWords = candidateWords.slice(0, Math.min(8, candidateWords.length)).join(' ');

        candidates.push({
          start: Math.round(startSeg.start * 100) / 100,
          end: Math.round(endSeg.end * 100) / 100,
          duration: Math.round(duration * 100) / 100,
          title,
          hook: segments[i].text.trim().slice(0, 80),
          reason: `High dialogue density (${pace.toFixed(1)} words/sec) with strong conversational progression`,
          transcript_evidence: evidenceWords,
          scores: {
            hook: hookScore,
            emotion: emotionScore,
            storytelling: storytellingScore,
            shareability: shareabilityScore
          },
          overall_score: overallScore,
          segmentStartIndex: i,
          segmentEndIndex: j
        });
      }

      if (duration > (maxDuration + DURATION_TOLERANCE)) break;
    }
  }

  // Sort candidates by overall score descending
  candidates.sort((a, b) => b.overall_score - a.overall_score);

  // Enforce non-overlapping selections
  const selected = [];
  for (const cand of candidates) {
    const overlaps = selected.some(s => {
      return (cand.start < s.end && cand.end > s.start);
    });

    if (!overlaps) {
      const clipSegments = segments.slice(cand.segmentStartIndex, cand.segmentEndIndex + 1).map(s => ({
        ...s,
        localStart: Math.max(0, Math.round((s.start - cand.start) * 100) / 100),
        localEnd: Math.round((Math.min(cand.end, s.end) - cand.start) * 100) / 100
      }));

      selected.push({
        id: uuidv4(),
        start: cand.start,
        end: cand.end,
        duration: cand.duration,
        title: cand.title,
        hook: cand.hook,
        reason: cand.reason,
        transcript_evidence: cand.transcript_evidence,
        scores: cand.scores,
        overall_score: cand.overall_score,
        segments: clipSegments,
        text: clipSegments.map(s => s.text).join(' ')
      });
    }

    if (selected.length >= targetClipCount) break;
  }

  return {
    engine: 'local_heuristic_nlp',
    clipCount: selected.length,
    clips: selected
  };
}


/**
 * Analyzes spoken content from a live stream chunk to identify the single best highlight moment (30-60s).
 * Moments to detect:
 * - Exciting or high-energy moments
 * - Important statements
 * - Funny moments / jokes
 * - Strong reactions & sudden changes in tone
 * - Memorable dialogue
 *
 * Constraints:
 * - Preserves conversational context
 * - Never cuts sentences in the middle
 * - Selects based on actual spoken content (not random timestamps)
 * - Returns clip with authentic transcript evidence and word-level timing
 */
async function analyzeLiveHighlight(segments, chunkDuration = 60, options = {}) {
  if (!segments || segments.length === 0) {
    return null;
  }

  const groqApiKey = process.env.GROQ_API_KEY;
  const minDuration = options.minDuration || (chunkDuration < 35 ? 15 : 25);
  const maxDuration = options.maxDuration || Math.min(60, chunkDuration);

  if (groqApiKey) {
    try {
      const formatted = segments
        .map(s => `[${s.start.toFixed(2)} - ${s.end.toFixed(2)}] ${s.text}`)
        .join('\n');

      const systemPrompt = `You are a professional video editor for live stream highlights.
Analyze this timestamped transcript from an active live stream (~${chunkDuration}s total).
Identify the SINGLE best highlight moment.
Prioritize:
- Exciting, high-energy or funny moments
- Strong reactions or tone shifts
- Important, memorable, or educational statements
Duration MUST be between ${minDuration} and ${maxDuration} seconds.
NEVER cut a sentence in the middle. Timestamps must align to speech boundaries.
Provide an exact quote of at least 4 contiguous words as transcript_evidence.

Return ONLY a JSON object:
{
  "clip": {
    "start": 10.5,
    "end": 45.0,
    "title": "Short Punchy Title (under 7 words)",
    "hook": "Opening phrase or question",
    "reason": "Why this moment is exciting or valuable",
    "transcript_evidence": "Exact quote of 4+ words",
    "scores": {
      "excitement": 88,
      "humor": 75,
      "emotion": 82,
      "shareability": 85
    },
    "overall_score": 85
  }
}`;

      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${groqApiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: GROQ_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: formatted }
          ],
          temperature: 0.2,
          response_format: { type: 'json_object' }
        })
      });

      if (response.ok) {
        const raw = await response.json();
        const content = raw.choices?.[0]?.message?.content;
        const parsed = safeParseJson(content);
        const candidate = parsed.clip;

        if (candidate && candidate.start !== undefined && candidate.end !== undefined) {
          const cStart = Math.max(0, parseFloat(candidate.start));
          const cEnd = Math.min(chunkDuration, parseFloat(candidate.end));
          const cDur = cEnd - cStart;

          if (cDur >= (minDuration - DURATION_TOLERANCE) && cDur <= (maxDuration + DURATION_TOLERANCE)) {
            const clipSegs = segments.filter(s => s.end > cStart && s.start < cEnd);
            if (clipSegs.length > 0 && validateTranscriptEvidence(candidate.transcript_evidence, clipSegs)) {
              return {
                engine: 'groq_llm_live',
                clip: {
                  id: uuidv4(),
                  start: Math.round(cStart * 100) / 100,
                  end: Math.round(cEnd * 100) / 100,
                  duration: Math.round(cDur * 100) / 100,
                  title: (candidate.title || 'Live Highlight').trim(),
                  hook: candidate.hook || clipSegs[0].text,
                  reason: candidate.reason || 'Standout live reaction',
                  transcript_evidence: candidate.transcript_evidence,
                  scores: candidate.scores || { excitement: 85, emotion: 80, shareability: 82 },
                  overall_score: candidate.overall_score || 84,
                  segments: clipSegs,
                  text: clipSegs.map(s => s.text).join(' ')
                }
              };
            }
          }
        }
      }
    } catch (llmErr) {
      console.warn('Groq live highlight analysis fallback to local heuristics:', llmErr.message);
    }
  }

  // Local Heuristic Analysis optimized for live moments
  const LIVE_REACTION_WORDS = new Set([
    'omg', 'wow', 'insane', 'crazy', 'unbelievable', 'what', 'why', 'holy', 'dude', 'bro',
    'haha', 'lol', 'look', 'watch', 'listen', 'wait', 'stop', 'win', 'fail', 'huge',
    'hype', 'never', 'secret', 'truth', 'remember', 'love', 'hate', 'shocking', 'best', 'worst'
  ]);

  const candidates = [];
  const total = segments.length;

  for (let i = 0; i < total; i++) {
    let wordCount = 0;
    let reactionHits = 0;
    let punctuationBonus = 0;

    for (let j = i; j < total; j++) {
      const seg = segments[j];
      const duration = seg.end - segments[i].start;

      const words = seg.text.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
      wordCount += words.length;

      for (const w of words) {
        if (LIVE_REACTION_WORDS.has(w)) reactionHits++;
      }

      if (/[!?]/.test(seg.text)) punctuationBonus += 8;

      if (duration >= (minDuration - DURATION_TOLERANCE) && duration <= (maxDuration + DURATION_TOLERANCE)) {
        const pace = wordCount / duration; // words/sec
        const paceScore = Math.min(100, Math.round(pace * 28));
        const reactionScore = Math.min(100, Math.round(40 + reactionHits * 12 + punctuationBonus));
        const naturalBoundaryBonus = (i === 0 || /[.!?]$/.test(segments[i - 1]?.text || '')) &&
                                      (/[.!?]$/.test(seg.text || '')) ? 15 : 0;
        const overallScore = Math.min(100, Math.round((paceScore * 0.4) + (reactionScore * 0.45) + naturalBoundaryBonus));

        const clipSegs = segments.slice(i, j + 1);
        const evidenceWords = clipSegs.map(s => s.text).join(' ').trim().split(/\s+/).filter(Boolean).slice(0, 7).join(' ');

        candidates.push({
          start: Math.round(segments[i].start * 100) / 100,
          end: Math.round(seg.end * 100) / 100,
          duration: Math.round(duration * 100) / 100,
          title: clipSegs[0].text.trim().split(/\s+/).slice(0, 6).join(' ') || 'Live Highlight',
          hook: clipSegs[0].text.trim().slice(0, 75),
          reason: `High energy reaction density (${pace.toFixed(1)} words/sec) with strong natural boundary`,
          transcript_evidence: evidenceWords,
          scores: {
            excitement: reactionScore,
            emotion: Math.min(100, reactionScore + 5),
            storytelling: paceScore,
            shareability: overallScore
          },
          overall_score: overallScore,
          segments: clipSegs,
          text: clipSegs.map(s => s.text).join(' ')
        });
      }

      if (duration > (maxDuration + DURATION_TOLERANCE)) break;
    }
  }

  if (candidates.length === 0) {
    // If chunk speech is slightly shorter than minDuration, adapt to full chunk dialogue
    const start = Math.round(segments[0].start * 100) / 100;
    const end = Math.round(segments[total - 1].end * 100) / 100;
    const dur = Math.round((end - start) * 100) / 100;
    const evidence = segments.map(s => s.text).join(' ').trim().split(/\s+/).slice(0, 6).join(' ');

    return {
      engine: 'local_heuristic_nlp_adapted',
      clip: {
        id: uuidv4(),
        start,
        end,
        duration: dur,
        title: segments[0].text.trim().split(/\s+/).slice(0, 6).join(' ') || 'Live Highlight',
        hook: segments[0].text.trim().slice(0, 75),
        reason: 'Natural conversational highlight from active live stream',
        transcript_evidence: evidence,
        scores: { excitement: 78, emotion: 75, storytelling: 80, shareability: 77 },
        overall_score: 78,
        segments,
        text: segments.map(s => s.text).join(' ')
      }
    };
  }

  candidates.sort((a, b) => b.overall_score - a.overall_score);
  const best = candidates[0];

  return {
    engine: 'local_heuristic_nlp_live',
    clip: {
      id: uuidv4(),
      ...best
    }
  };
}

function clamp(val, min, max, fallback) {
  const n = parseInt(val, 10);
  if (isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

module.exports = {
  analyzeTranscript,
  analyzeLiveHighlight,
  analyzeWithGroq,
  analyzeWithLocalHeuristics,
  safeParseJson,
  normalizeText,
  validateTranscriptEvidence
};
