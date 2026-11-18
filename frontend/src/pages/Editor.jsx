import React, { useState, useEffect, useRef, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import {
  ArrowLeft, Play, Pause, RotateCcw, Download, Sparkles, Scissors,
  Subtitles, Crop, Settings, Check, RefreshCw, AlertCircle, Volume2,
  VolumeX, Clock, Film
} from 'lucide-react';
import './Editor.css';

const API_BASE = '/api';

const Editor = () => {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const videoRef = useRef(null);

  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Active clip selection
  const [selectedClipId, setSelectedClipId] = useState(null);
  const [activeTab, setActiveTab] = useState('clips'); // 'clips', 'subtitles', 'crop', 'export'

  // Playback state
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [isMuted, setIsMuted] = useState(false);

  // Edit states for currently selected clip
  const [clipTitle, setClipTitle] = useState('');
  const [clipStart, setClipStart] = useState(0);
  const [clipEnd, setClipEnd] = useState(0);
  const [clipSegments, setClipSegments] = useState([]);
  const [isSavingClip, setIsSavingClip] = useState(false);

  // Formatting & Subtitle Style options
  const [aspectRatio, setAspectRatio] = useState('9:16'); // '9:16', '1:1', '16:9'
  const [cropPosition, setCropPosition] = useState('center'); // 'center', 'left', 'right'
  const [resolution, setResolution] = useState('720x1280'); // '720x1280', '1080x1920'
  const [burnSubtitles, setBurnSubtitles] = useState(true);
  const [subtitleStyle, setSubtitleStyle] = useState('clean_white'); // 'clean_white', 'highlighted', 'minimal', 'bold_creator'
  const [customFontSize, setCustomFontSize] = useState(19);
  const [customFontColor, setCustomFontColor] = useState('#FFFFFF');
  const [customAlignment, setCustomAlignment] = useState('bottom');

  // Export states
  const [isExporting, setIsExporting] = useState(false);
  const [exportStatus, setExportStatus] = useState(null);
  const [exportResult, setExportResult] = useState(null);

  useEffect(() => {
    fetchProject();
  }, [projectId]);

  const fetchProject = async () => {
    setLoading(true);
    try {
      const response = await axios.get(`${API_BASE}/projects/${projectId}`);
      const data = response.data;
      setProject(data);

      if (data.clips && data.clips.length > 0) {
        selectClip(data.clips[0]);
      }
    } catch (err) {
      console.error('Failed to load project:', err);
      setError('Could not load project. Make sure the backend server is running.');
    } finally {
      setLoading(false);
    }
  };

  const activeClip = project?.clips?.find(c => c.id === selectedClipId) || null;
  const isPreTrimmedVideo = !project?.videoUrl && Boolean(activeClip?.export?.fileUrl);

  const selectClip = (clip) => {
    setSelectedClipId(clip.id);
    setClipTitle(clip.title || 'Untitled Clip');
    setClipStart(clip.start);
    setClipEnd(clip.end);
    setClipSegments(clip.segments || []);
    setExportResult(clip.export || null);

    if (clip.subtitleStyle) setSubtitleStyle(clip.subtitleStyle);
    if (clip.customFontSize) setCustomFontSize(clip.customFontSize);
    if (clip.customFontColor) setCustomFontColor(clip.customFontColor);
    if (clip.customAlignment) setCustomAlignment(clip.customAlignment);
    if (clip.burnSubtitles !== undefined) setBurnSubtitles(clip.burnSubtitles);

    const isClipPreTrimmed = !project?.videoUrl && Boolean(clip.export?.fileUrl);
    if (videoRef.current) {
      videoRef.current.currentTime = isClipPreTrimmed ? 0 : clip.start;
      setCurrentTime(clip.start);
    }
  };

  // Video time update listener
  const handleTimeUpdate = () => {
    if (!videoRef.current) return;
    const mediaTime = videoRef.current.currentTime;

    if (isPreTrimmedVideo) {
      const absTime = clipStart + mediaTime;
      setCurrentTime(absTime);

      const clipDuration = Math.max(0.5, clipEnd - clipStart);
      if (mediaTime >= clipDuration) {
        videoRef.current.currentTime = 0;
        if (!isPlaying) {
          videoRef.current.pause();
        }
      }
    } else {
      setCurrentTime(mediaTime);

      // Loop within clip boundaries
      if (activeClip && mediaTime >= clipEnd) {
        videoRef.current.currentTime = clipStart;
        if (!isPlaying) {
          videoRef.current.pause();
        }
      }
    }
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
      setIsPlaying(false);
    } else {
      if (isPreTrimmedVideo) {
        const clipDuration = Math.max(0.5, clipEnd - clipStart);
        if (videoRef.current.currentTime >= clipDuration) {
          videoRef.current.currentTime = 0;
        }
      } else {
        if (currentTime < clipStart || currentTime >= clipEnd) {
          videoRef.current.currentTime = clipStart;
        }
      }
      videoRef.current.play();
      setIsPlaying(true);
    }
  };

  const handleSeek = (e) => {
    const newTime = parseFloat(e.target.value);
    setCurrentTime(newTime);
    if (videoRef.current) {
      if (isPreTrimmedVideo) {
        const clipDuration = Math.max(0.5, clipEnd - clipStart);
        const relTime = Math.max(0, Math.min(newTime - clipStart, clipDuration));
        videoRef.current.currentTime = relTime;
      } else {
        videoRef.current.currentTime = newTime;
      }
    }
  };

  const setStartToCurrent = () => {
    if (currentTime < clipEnd) {
      const val = Math.round(currentTime * 100) / 100;
      setClipStart(val);
      saveClipChanges(clipTitle, val, clipEnd, clipSegments);
    }
  };

  const setEndToCurrent = () => {
    if (currentTime > clipStart) {
      const val = Math.round(currentTime * 100) / 100;
      setClipEnd(val);
      saveClipChanges(clipTitle, clipStart, val, clipSegments);
    }
  };

  const SUBTITLE_PRESETS = {
    clean_white: {
      style: 'clean_white',
      color: '#FFFFFF',
      fontSize: 19,
      alignment: 'bottom'
    },
    highlighted: {
      style: 'highlighted',
      color: '#FF9F0A',
      fontSize: 20,
      alignment: 'bottom'
    },
    minimal: {
      style: 'minimal',
      color: '#F5F5F7',
      fontSize: 16,
      alignment: 'bottom'
    },
    bold_creator: {
      style: 'bold_creator',
      color: '#FFE600',
      fontSize: 24,
      alignment: 'bottom'
    }
  };

  const handleSelectPreset = (presetKey) => {
    const preset = SUBTITLE_PRESETS[presetKey];
    if (!preset) return;
    setSubtitleStyle(preset.style);
    setCustomFontColor(preset.color);
    setCustomFontSize(preset.fontSize);
    setCustomAlignment(preset.alignment);
  };

  const saveClipChanges = async (title, start, end, segments, extra = {}) => {
    if (!activeClip) return;
    setIsSavingClip(true);
    try {
      const payload = {
        title,
        start,
        end,
        segments,
        subtitleStyle: extra.subtitleStyle !== undefined ? extra.subtitleStyle : subtitleStyle,
        customFontSize: extra.customFontSize !== undefined ? extra.customFontSize : customFontSize,
        customFontColor: extra.customFontColor !== undefined ? extra.customFontColor : customFontColor,
        customAlignment: extra.customAlignment !== undefined ? extra.customAlignment : customAlignment,
        burnSubtitles: extra.burnSubtitles !== undefined ? extra.burnSubtitles : burnSubtitles
      };

      const response = await axios.put(`${API_BASE}/projects/${projectId}/clips/${activeClip.id}`, payload);

      setProject(prev => ({
        ...prev,
        clips: prev.clips.map(c => c.id === activeClip.id ? response.data : c)
      }));
    } catch (err) {
      console.error('Failed to save clip edits:', err);
    } finally {
      setIsSavingClip(false);
    }
  };

  const handleSubtitleTextChange = (index, newText) => {
    const updated = [...clipSegments];
    const seg = updated[index];
    const tokens = newText.trim().split(/\s+/).filter(Boolean);
    const start = parseFloat(seg.start) || 0;
    const end = Math.max(start + 0.1, parseFloat(seg.end) || (start + 1));
    const dur = Math.max(0.05, (end - start) / Math.max(1, tokens.length));
    const words = tokens.map((tok, i) => ({
      word: tok,
      start: Math.round((start + i * dur) * 1000) / 1000,
      end: Math.round((start + (i + 1) * dur) * 1000) / 1000
    }));
    updated[index] = { ...seg, text: newText, words };
    setClipSegments(updated);
  };

  const handleSaveSubtitles = () => {
    saveClipChanges(clipTitle, clipStart, clipEnd, clipSegments);
  };

  const handleExportClip = async () => {
    if (!activeClip) return;
    setIsExporting(true);
    setExportStatus('Rendering vertical video with FFmpeg...');

    try {
      const response = await axios.post(`${API_BASE}/projects/${projectId}/clips/${activeClip.id}/export`, {
        resolution,
        aspectRatio,
        burnSubtitles,
        subtitleStyle,
        cropPosition,
        customFontSize,
        customFontColor,
        customAlignment,
        segments: clipSegments
      });

      setExportResult(response.data.export);
      setExportStatus('Clip rendered successfully!');

      setProject(prev => ({
        ...prev,
        clips: prev.clips.map(c => c.id === activeClip.id ? {
          ...c,
          segments: clipSegments,
          subtitleStyle,
          customFontSize,
          customFontColor,
          customAlignment,
          burnSubtitles,
          export: response.data.export
        } : c)
      }));
    } catch (err) {
      console.error('Export failed:', err);
      setExportStatus('Export failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsExporting(false);
    }
  };

  const handleExportAll = async () => {
    if (!project || !project.clips || project.clips.length === 0) return;
    setIsExporting(true);
    setExportStatus(`Rendering all ${project.clips.length} clips with FFmpeg...`);

    try {
      await axios.post(`${API_BASE}/projects/${projectId}/export-all`, {
        resolution,
        aspectRatio,
        burnSubtitles,
        subtitleStyle,
        cropPosition,
        customFontSize,
        customFontColor,
        customAlignment
      });

      setExportStatus('All clips exported successfully!');
      fetchProject();
    } catch (err) {
      console.error('Batch export failed:', err);
      setExportStatus('Batch export failed: ' + (err.response?.data?.error || err.message));
    } finally {
      setIsExporting(false);
    }
  };

  // Derive ~2-word synchronized display with restrained word highlight matching spoken audio
  const currentChunk = useMemo(() => {
    if (!clipSegments || clipSegments.length === 0) return null;

    // Collect all words from segments
    const allWords = [];
    for (const seg of clipSegments) {
      const segText = (seg.text || '').trim();
      const segWords = Array.isArray(seg.words) ? seg.words : [];
      const joinedWords = segWords.map(w => w.word).join(' ').trim();

      if (segWords.length > 0 && (!segText || joinedWords === segText)) {
        allWords.push(...segWords);
      } else {
        const tokens = segText.split(/\s+/).filter(Boolean);
        const start = parseFloat(seg.start) || 0;
        const dur = Math.max(0.05, ((parseFloat(seg.end) || start + 1) - start) / Math.max(1, tokens.length));
        tokens.forEach((tok, idx) => {
          allWords.push({
            word: tok,
            start: Math.round((start + idx * dur) * 1000) / 1000,
            end: Math.round((start + (idx + 1) * dur) * 1000) / 1000
          });
        });
      }
    }

    if (allWords.length === 0) return null;

    // Group words into ~2 words per display group, respecting pauses & punctuation
    const chunks = [];
    for (let i = 0; i < allWords.length; ) {
      const w1 = allWords[i];
      const w2 = allWords[i + 1];
      if (!w2 || /[.!?]$/.test(w1.word) || (w2.start - w1.end > 0.35)) {
        chunks.push([w1]);
        i += 1;
      } else {
        chunks.push([w1, w2]);
        i += 2;
      }
    }

    // Locate active chunk based on currentTime
    for (const chunk of chunks) {
      const cStart = chunk[0].start;
      const cEnd = chunk[chunk.length - 1].end;
      if (currentTime >= cStart && currentTime <= cEnd) {
        const activeIdx = chunk.findIndex(w => currentTime >= w.start && currentTime <= w.end);
        return {
          words: chunk,
          activeWordIndex: activeIdx !== -1 ? activeIdx : 0
        };
      }
    }

    // Fallback when paused so subtitle editor preview remains visible
    if (!isPlaying && chunks.length > 0) {
      let nearest = chunks[0];
      let minDiff = Infinity;
      for (const chunk of chunks) {
        const mid = (chunk[0].start + chunk[chunk.length - 1].end) / 2;
        const diff = Math.abs(currentTime - mid);
        if (diff < minDiff) {
          minDiff = diff;
          nearest = chunk;
        }
      }
      return {
        words: nearest,
        activeWordIndex: 0
      };
    }

    return null;
  }, [clipSegments, currentTime, isPlaying]);

  const getSubtitleOverlayClass = () => {
    return `subtitle-overlay style-${subtitleStyle} align-${customAlignment}`;
  };

  if (loading) {
    return (
      <div className="editor-loading">
        <RefreshCw size={36} className="spinning" />
        <h2>Loading Project Studio...</h2>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="editor-error container card">
        <AlertCircle size={48} className="error-icon" />
        <h2>Project Error</h2>
        <p>{error || 'Project not found.'}</p>
        <Link to="/dashboard" className="btn-pill btn-primary">Back to Dashboard</Link>
      </div>
    );
  }

  const clips = project.clips || [];

  return (
    <div className="editor-page">
      {/* Top Studio Bar */}
      <div className="studio-topbar">
        <div className="container studio-topbar-content">
          <div className="studio-left">
            <Link to="/dashboard" className="btn-pill btn-subtle">
              <ArrowLeft size={16} />
              <span>Dashboard</span>
            </Link>
            <div className="studio-project-meta">
              <h2 className="studio-project-name">{project.name}</h2>
              <span className="studio-res-tag">{project.width}×{project.height} • {project.fps} fps</span>
            </div>
          </div>

          <div className="studio-actions">
            <button
              className="btn-pill btn-primary btn-sm"
              onClick={handleExportAll}
              disabled={isExporting || clips.length === 0}
            >
              <Download size={15} />
              <span>Export All ({clips.length})</span>
            </button>
          </div>
        </div>
      </div>

      <div className="container studio-main-grid">
        {/* Left Column: Player & Interactive Timeline */}
        <div className="player-column">
          <div className="viewport-container card">
            {/* Viewport Frame toggling 9:16 / 1:1 / 16:9 */}
            <div className={`viewport-frame ratio-${aspectRatio.replace(':', '-')}`}>
              {(project.videoUrl || activeClip?.export?.fileUrl) ? (
                <video
                  ref={videoRef}
                  src={project.videoUrl || activeClip?.export?.fileUrl}
                  className={`main-video crop-${cropPosition}`}
                  onTimeUpdate={handleTimeUpdate}
                  muted={isMuted}
                  playsInline
                  onClick={togglePlay}
                />
              ) : (
                <div className="clip-pending-render" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--muted-text)', gap: '12px', padding: '24px', textAlign: 'center' }}>
                  <Film size={36} />
                  <span style={{ fontSize: '13px', lineHeight: '1.4' }}>Video preview will be available once rendered. Switch to the Export tab to render this short.</span>
                </div>
              )}

              {/* Live Rendered 2-Word Synchronized Subtitle Overlay with Word Highlighting */}
              {burnSubtitles && currentChunk && (
                <div
                  className={getSubtitleOverlayClass()}
                  style={{
                    fontSize: `${customFontSize}px`
                  }}
                >
                  <span className="two-word-subtitle">
                    {currentChunk.words.map((w, idx) => (
                      <span
                        key={idx}
                        className={`sub-word ${idx === currentChunk.activeWordIndex ? 'active-word' : 'inactive-word'}`}
                        style={idx === currentChunk.activeWordIndex ? { color: customFontColor } : {}}
                      >
                        {w.word}{' '}
                      </span>
                    ))}
                  </span>
                </div>
              )}

              {/* Official V4 Watermark Badge (Fixed Top-Right) */}
              <div className="viewport-watermark-v4">V4</div>
            </div>

            {/* Video Player Controls */}
            <div className="player-controls">
              <button className="ctrl-btn" onClick={togglePlay} title={isPlaying ? 'Pause' : 'Play'}>
                {isPlaying ? <Pause size={20} /> : <Play size={20} fill="currentColor" />}
              </button>

              <button
                className="ctrl-btn"
                onClick={() => {
                  if (videoRef.current) {
                    videoRef.current.currentTime = isPreTrimmedVideo ? 0 : clipStart;
                    setCurrentTime(clipStart);
                  }
                }}
                title="Restart Clip"
              >
                <RotateCcw size={18} />
              </button>

              <div className="time-display">
                <span>{currentTime.toFixed(1)}s</span>
                <span className="time-divider">/</span>
                <span className="time-total">{clipEnd.toFixed(1)}s</span>
              </div>

              <input
                type="range"
                min={0}
                max={project.duration || 100}
                step={0.1}
                value={currentTime}
                onChange={handleSeek}
                className="timeline-slider"
              />

              <button
                className="ctrl-btn"
                onClick={() => setIsMuted(!isMuted)}
                title={isMuted ? 'Unmute' : 'Mute'}
              >
                {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
            </div>
          </div>

          {/* Timeline & Trimming Card */}
          <div className="trimming-card card">
            <div className="trim-header">
              <div className="trim-title-group">
                <Scissors size={18} className="trim-icon" />
                <h3>Precision Trimming</h3>
              </div>
              <div className="clip-duration-badge">
                <Clock size={13} />
                <span>Duration: {(clipEnd - clipStart).toFixed(1)}s</span>
              </div>
            </div>

            <div className="trim-sliders-row">
              <div className="trim-input-group">
                <label>Clip Start</label>
                <div className="trim-input-wrap">
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max={clipEnd - 1}
                    value={clipStart}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || 0;
                      setClipStart(val);
                      saveClipChanges(clipTitle, val, clipEnd, clipSegments);
                    }}
                  />
                  <button className="btn-trim-action" onClick={setStartToCurrent} title="Set start to current playback position">
                    Use Now
                  </button>
                </div>
              </div>

              <div className="trim-input-group">
                <label>Clip End</label>
                <div className="trim-input-wrap">
                  <input
                    type="number"
                    step="0.1"
                    min={clipStart + 1}
                    max={project.duration || 9999}
                    value={clipEnd}
                    onChange={(e) => {
                      const val = parseFloat(e.target.value) || clipStart + 1;
                      setClipEnd(val);
                      saveClipChanges(clipTitle, clipStart, val, clipSegments);
                    }}
                  />
                  <button className="btn-trim-action" onClick={setEndToCurrent} title="Set end to current playback position">
                    Use Now
                  </button>
                </div>
              </div>
            </div>

            {/* Quick Trim Timeline Track */}
            <div className="trim-track-visual">
              <div
                className="trim-highlight"
                style={{
                  left: `${(clipStart / (project.duration || 1)) * 100}%`,
                  width: `${((clipEnd - clipStart) / (project.duration || 1)) * 100}%`
                }}
              ></div>
              <div
                className="trim-playhead"
                style={{
                  left: `${(currentTime / (project.duration || 1)) * 100}%`
                }}
              ></div>
            </div>
          </div>
        </div>

        {/* Right Column: Multi-Tab Studio Workspace */}
        <div className="studio-controls-column">
          {/* Navigation Tabs */}
          <div className="studio-tabs">
            <button
              className={`tab-btn ${activeTab === 'clips' ? 'active' : ''}`}
              onClick={() => setActiveTab('clips')}
            >
              <Sparkles size={16} />
              <span>AI Clips</span>
            </button>

            <button
              className={`tab-btn ${activeTab === 'subtitles' ? 'active' : ''}`}
              onClick={() => setActiveTab('subtitles')}
            >
              <Subtitles size={16} />
              <span>Subtitles</span>
            </button>

            <button
              className={`tab-btn ${activeTab === 'crop' ? 'active' : ''}`}
              onClick={() => setActiveTab('crop')}
            >
              <Crop size={16} />
              <span>Crop & Format</span>
            </button>

            <button
              className={`tab-btn ${activeTab === 'export' ? 'active' : ''}`}
              onClick={() => setActiveTab('export')}
            >
              <Download size={16} />
              <span>Export</span>
            </button>
          </div>

          {/* TAB 1: AI CLIPS SELECTION */}
          {activeTab === 'clips' && (
            <div className="tab-pane card">
              <div className="pane-header">
                <h3>Selected Moments</h3>
                <span className="badge-pill">{clips.length} Clips</span>
              </div>

              <div className="clips-list">
                {clips.map((clip, idx) => {
                  const isSelected = clip.id === selectedClipId;
                  const isClipExported = Boolean(clip.export);

                  return (
                    <div
                      key={clip.id}
                      className={`clip-select-card ${isSelected ? 'active' : ''}`}
                      onClick={() => selectClip(clip)}
                    >
                      <div className="clip-select-top">
                        <span className="clip-number">Clip #{idx + 1}</span>
                        <div className="clip-score-badge">
                          Score {clip.overall_score || 85}
                        </div>
                      </div>

                      <h4 className="clip-select-title">{clip.title}</h4>

                      <div className="clip-select-meta">
                        <span>{clip.start.toFixed(1)}s - {clip.end.toFixed(1)}s</span>
                        <span>•</span>
                        <span>{clip.duration ? clip.duration.toFixed(1) : (clip.end - clip.start).toFixed(1)}s</span>
                        {isClipExported && (
                          <span className="exported-dot" title="Exported MP4 Ready">Ready</span>
                        )}
                      </div>

                      {clip.reason && (
                        <p className="clip-reason-text">"{clip.reason}"</p>
                      )}

                      {/* Score Breakdown Bars */}
                      {clip.scores && (
                        <div className="score-bars">
                          <div className="score-item">
                            <span>Hook</span>
                            <div className="mini-bar">
                              <div style={{ width: `${clip.scores.hook}%` }}></div>
                            </div>
                          </div>
                          <div className="score-item">
                            <span>Emotion</span>
                            <div className="mini-bar">
                              <div style={{ width: `${clip.scores.emotion}%` }}></div>
                            </div>
                          </div>
                          <div className="score-item">
                            <span>Story</span>
                            <div className="mini-bar">
                              <div style={{ width: `${clip.scores.storytelling}%` }}></div>
                            </div>
                          </div>
                          <div className="score-item">
                            <span>Viral</span>
                            <div className="mini-bar">
                              <div style={{ width: `${clip.scores.shareability}%` }}></div>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Clip Title Inline Editor */}
              {activeClip && (
                <div className="clip-title-editor">
                  <label>Clip Title</label>
                  <div className="title-input-row">
                    <input
                      type="text"
                      value={clipTitle}
                      onChange={(e) => setClipTitle(e.target.value)}
                      onBlur={() => saveClipChanges(clipTitle, clipStart, clipEnd, clipSegments)}
                      placeholder="Enter engaging title..."
                    />
                    <button
                      className="btn-pill btn-secondary btn-sm"
                      onClick={() => saveClipChanges(clipTitle, clipStart, clipEnd, clipSegments)}
                      disabled={isSavingClip}
                    >
                      {isSavingClip ? <RefreshCw size={14} className="spinning" /> : <Check size={14} />}
                      <span>Save</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: SUBTITLE ENGINE */}
          {activeTab === 'subtitles' && (
            <div className="tab-pane card">
              <div className="pane-header">
                <h3>Subtitle Engine</h3>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={burnSubtitles}
                    onChange={(e) => setBurnSubtitles(e.target.checked)}
                  />
                  <span className="slider"></span>
                  <span className="toggle-label">Burn Subtitles</span>
                </label>
              </div>

              {/* Subtitle Style Presets */}
              <div className="subtitle-styles-grid">
                <div
                  className={`style-card ${subtitleStyle === 'clean_white' ? 'active' : ''}`}
                  onClick={() => handleSelectPreset('clean_white')}
                >
                  <div className="style-preview clean_white">White Clean</div>
                  <span>Clean White</span>
                </div>

                <div
                  className={`style-card ${subtitleStyle === 'highlighted' ? 'active' : ''}`}
                  onClick={() => handleSelectPreset('highlighted')}
                >
                  <div className="style-preview highlighted">Amber Accent</div>
                  <span>Highlighted</span>
                </div>

                <div
                  className={`style-card ${subtitleStyle === 'minimal' ? 'active' : ''}`}
                  onClick={() => handleSelectPreset('minimal')}
                >
                  <div className="style-preview minimal">Professional</div>
                  <span>Minimal</span>
                </div>

                <div
                  className={`style-card ${subtitleStyle === 'bold_creator' ? 'active' : ''}`}
                  onClick={() => handleSelectPreset('bold_creator')}
                >
                  <div className="style-preview bold_creator">BOLD SHORTS</div>
                  <span>Bold Creator</span>
                </div>
              </div>

              {/* Subtitle Customization Sliders */}
              <div className="subtitle-custom-options">
                <div className="custom-row">
                  <label>Font Size ({customFontSize}px)</label>
                  <input
                    type="range"
                    min="14"
                    max="28"
                    value={customFontSize}
                    onChange={(e) => setCustomFontSize(parseInt(e.target.value, 10))}
                  />
                </div>

                <div className="custom-row">
                  <label>Font Color</label>
                  <div className="color-swatches-row">
                    {[
                      { label: 'White', color: '#FFFFFF' },
                      { label: 'Yellow', color: '#FFE600' },
                      { label: 'Amber', color: '#FF9F0A' },
                      { label: 'Cyan', color: '#00F0FF' },
                      { label: 'Lime', color: '#30D158' }
                    ].map(swatch => (
                      <button
                        key={swatch.color}
                        type="button"
                        className={`color-swatch-btn ${customFontColor.toUpperCase() === swatch.color.toUpperCase() ? 'active' : ''}`}
                        style={{ backgroundColor: swatch.color }}
                        onClick={() => setCustomFontColor(swatch.color)}
                        title={swatch.label}
                      />
                    ))}
                    <input
                      type="color"
                      className="color-picker-input"
                      value={customFontColor}
                      onChange={(e) => setCustomFontColor(e.target.value)}
                      title="Custom color"
                    />
                  </div>
                </div>

                <div className="custom-row">
                  <label>Alignment</label>
                  <div className="align-buttons">
                    {['bottom', 'middle', 'top'].map(pos => (
                      <button
                        key={pos}
                        className={`btn-align ${customAlignment === pos ? 'active' : ''}`}
                        onClick={() => setCustomAlignment(pos)}
                      >
                        {pos.charAt(0).toUpperCase() + pos.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {/* Subtitle Spoken Segment Editor */}
              <div className="transcript-editor-box">
                <div className="transcript-editor-header">
                  <h4>Spoken Transcript</h4>
                  <button className="btn-pill btn-secondary btn-sm" onClick={handleSaveSubtitles}>
                    <Check size={14} />
                    <span>Save Text Edits</span>
                  </button>
                </div>

                <div className="transcript-segments-list">
                  {clipSegments.map((seg, idx) => (
                    <div
                      key={idx}
                      className="transcript-segment-row"
                      onClick={() => {
                        if (videoRef.current) {
                          const targetTime = isPreTrimmedVideo ? Math.max(0, seg.start - clipStart) : seg.start;
                          videoRef.current.currentTime = targetTime;
                          setCurrentTime(seg.start);
                        }
                      }}
                    >
                      <span className="seg-time">{seg.start.toFixed(1)}s</span>
                      <input
                        type="text"
                        value={seg.text}
                        onClick={(e) => e.stopPropagation()}
                        onChange={(e) => handleSubtitleTextChange(idx, e.target.value)}
                        className="seg-input"
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: CROP & FORMAT */}
          {activeTab === 'crop' && (
            <div className="tab-pane card">
              <div className="pane-header">
                <h3>Crop & Dimensions</h3>
              </div>

              {/* Aspect Ratio Cards */}
              <label className="section-sublabel">Aspect Ratio Presets</label>
              <div className="aspect-ratio-grid">
                <div
                  className={`ratio-card ${aspectRatio === '9:16' ? 'active' : ''}`}
                  onClick={() => setAspectRatio('9:16')}
                >
                  <div className="ratio-box vertical">9:16</div>
                  <h4>Vertical 9:16</h4>
                  <p>Shorts, Reels & TikTok</p>
                </div>

                <div
                  className={`ratio-card ${aspectRatio === '1:1' ? 'active' : ''}`}
                  onClick={() => setAspectRatio('1:1')}
                >
                  <div className="ratio-box square">1:1</div>
                  <h4>Square 1:1</h4>
                  <p>Instagram & LinkedIn</p>
                </div>

                <div
                  className={`ratio-card ${aspectRatio === '16:9' ? 'active' : ''}`}
                  onClick={() => setAspectRatio('16:9')}
                >
                  <div className="ratio-box wide">16:9</div>
                  <h4>Original 16:9</h4>
                  <p>YouTube Landscape</p>
                </div>
              </div>

              {/* Crop Horizon (Speaker Tracking Position) */}
              {aspectRatio === '9:16' && (
                <div className="crop-position-section">
                  <label className="section-sublabel">Horizontal Framing (Speaker Position)</label>
                  <div className="crop-buttons-row">
                    <button
                      className={`crop-btn ${cropPosition === 'left' ? 'active' : ''}`}
                      onClick={() => setCropPosition('left')}
                    >
                      Left Crop
                    </button>
                    <button
                      className={`crop-btn ${cropPosition === 'center' ? 'active' : ''}`}
                      onClick={() => setCropPosition('center')}
                    >
                      Center Crop (Default)
                    </button>
                    <button
                      className={`crop-btn ${cropPosition === 'right' ? 'active' : ''}`}
                      onClick={() => setCropPosition('right')}
                    >
                      Right Crop
                    </button>
                  </div>
                </div>
              )}

              {/* Resolution Setting */}
              <div className="resolution-section">
                <label className="section-sublabel">Output Resolution</label>
                <div className="resolution-row">
                  <label className="radio-label">
                    <input
                      type="radio"
                      name="res"
                      value="720x1280"
                      checked={resolution === '720x1280'}
                      onChange={() => setResolution('720x1280')}
                    />
                    <span>720 × 1280 (Fast Export)</span>
                  </label>

                  <label className="radio-label">
                    <input
                      type="radio"
                      name="res"
                      value="1080x1920"
                      checked={resolution === '1080x1920'}
                      onChange={() => setResolution('1080x1920')}
                    />
                    <span>1080 × 1920 (Full HD Studio)</span>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: EXPORT & DOWNLOAD */}
          {activeTab === 'export' && (
            <div className="tab-pane card">
              <div className="pane-header">
                <h3>Export & Download</h3>
              </div>

              <div className="export-summary-box">
                <h4>Clip Summary</h4>
                <div className="summary-row">
                  <span>Selected Clip:</span>
                  <strong>{clipTitle}</strong>
                </div>
                <div className="summary-row">
                  <span>Duration:</span>
                  <strong>{(clipEnd - clipStart).toFixed(1)} seconds</strong>
                </div>
                <div className="summary-row">
                  <span>Aspect Ratio:</span>
                  <strong>{aspectRatio} ({resolution})</strong>
                </div>
                <div className="summary-row">
                  <span>Subtitles:</span>
                  <strong>{burnSubtitles ? `Burned-In (${subtitleStyle})` : 'None'}</strong>
                </div>
              </div>

              <div className="export-action-block">
                <button
                  className="btn-pill btn-primary btn-large btn-full"
                  onClick={handleExportClip}
                  disabled={isExporting}
                >
                  {isExporting ? (
                    <>
                      <RefreshCw size={18} className="spinning" />
                      <span>{exportStatus || 'Rendering Clip...'}</span>
                    </>
                  ) : (
                    <>
                      <Download size={18} />
                      <span>Export This Short</span>
                    </>
                  )}
                </button>
              </div>

              {exportStatus && !isExporting && (
                <div className="export-status-message">
                  <span>{exportStatus}</span>
                </div>
              )}

              {/* Ready Downloads */}
              {exportResult && (
                <div className="download-ready-card card">
                  <div className="ready-header">
                    <Check size={20} className="check-icon" />
                    <h4>Ready for Download</h4>
                  </div>
                  <p>Your vertical short has been rendered in high quality.</p>

                  <div className="download-buttons-group">
                    <a
                      href={exportResult.fileUrl}
                      download={exportResult.fileName}
                      className="btn-pill btn-primary"
                    >
                      <Download size={16} />
                      <span>Download MP4 Video</span>
                    </a>

                    <a
                      href={exportResult.srtUrl}
                      download={exportResult.fileName.replace(/\.mp4$/i, '.srt')}
                      className="btn-pill btn-secondary"
                    >
                      <Subtitles size={16} />
                      <span>Download SRT</span>
                    </a>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Editor;
