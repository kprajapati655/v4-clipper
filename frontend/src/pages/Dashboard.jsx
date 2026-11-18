import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import axios from 'axios';
import {
  Upload, Sparkles, Film, Clock, Trash2, AlertCircle, CheckCircle2,
  RefreshCw, Play, Pause, Download, Scissors, Subtitles, Settings2,
  ChevronDown, ChevronUp, Check, ExternalLink, ArrowRight, ShieldCheck, Link as LinkIcon
} from 'lucide-react';
import { parseYouTubeUrl, getYoutubeTypeLabel } from '../utils/youtubeUrl';
import './Dashboard.css';

const API_BASE = '/api';

const PIPELINE_STAGES = [
  { key: 'validating_url', label: '1. URL Validation', desc: 'Validating YouTube URL format and access' },
  { key: 'extracting_metadata', label: '2. Metadata Extraction', desc: 'Extracting video title, duration, and thumbnail' },
  { key: 'connecting_source', label: '3. Source Connection', desc: 'Connecting to captions and audio stream' },
  { key: 'analyzing_video', label: '4. Full Video Analysis', desc: 'Analyzing dialogue rhythm and narrative pacing' },
  { key: 'identifying_moments', label: '5. Best Moments Identification', desc: 'Selecting 3–4 strongest 30–60s viral highlights' },
  { key: 'generating_clips', label: '6. Clip Generation', desc: 'Selectively retrieving 9:16 vertical video segments' },
  { key: 'rendering_subtitles', label: '7. Subtitle Processing', desc: 'Burning synchronized speech captions' },
  { key: 'applying_watermark', label: '8. V4 Watermark Application', desc: 'Applying official discrete V4 top-right watermark' },
  { key: 'ready', label: '9. Final Export', desc: 'Completed shorts ready for preview and download' }
];

const STAGE_ORDER = {
  'idle': -1,
  'validating_url': 0,
  'validating_live': 0,
  'extracting_metadata': 1,
  'connecting_source': 2,
  'connecting_stream': 2,
  'extracting_audio': 2,
  'transcribing': 2,
  'transcribing_live': 2,
  'analyzing_video': 3,
  'analyzing_moments': 4,
  'analyzing_highlight': 4,
  'identifying_moments': 4,
  'generating_clips': 5,
  'cutting_highlight': 5,
  'rendering_subtitles': 6,
  'applying_watermark': 7,
  'ready': 8
};

const Dashboard = () => {
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  // YouTube Automation State
  const [youtubeUrl, setYoutubeUrl] = useState(searchParams.get('url') || '');
  const [isStartingYt, setIsStartingYt] = useState(false);
  const [ytError, setYtError] = useState(null);

  // Settings & Preferences
  const [showSettings, setShowSettings] = useState(false);
  const [resolution, setResolution] = useState('720x1280');
  const [aspectRatio, setAspectRatio] = useState('9:16');
  const [cropPosition, setCropPosition] = useState('center');
  const [subtitleStyle, setSubtitleStyle] = useState('clean_white');

  // Direct Upload State
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  // Action states
  const [retryingClipId, setRetryingClipId] = useState(null);
  const [activeProjectId, setActiveProjectId] = useState(null);

  useEffect(() => {
    fetchProjects();
  }, []);

  // Populate YouTube input if URL passed via query param
  useEffect(() => {
    const paramUrl = searchParams.get('url');
    if (paramUrl && !isStartingYt) {
      setYoutubeUrl(paramUrl);
    }
  }, [searchParams]);

  // Real-time polling for any processing project
  useEffect(() => {
    const hasProcessing = projects.some(p => p.status === 'processing');
    if (!hasProcessing) return;

    const interval = setInterval(() => {
      fetchProjects(false);
    }, 2000);

    return () => clearInterval(interval);
  }, [projects]);

  const fetchProjects = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const response = await axios.get(`${API_BASE}/projects`);
      setProjects(response.data);

      // Auto-focus latest active or completed project if not set
      if (!activeProjectId && response.data.length > 0) {
        setActiveProjectId(response.data[0].id);
      }
    } catch (error) {
      console.error('Error fetching projects:', error);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const handleStartProcessing = async (e) => {
    if (e) e.preventDefault();
    const cleanUrl = youtubeUrl.trim();
    if (!cleanUrl) return;

    const parsed = parseYouTubeUrl(cleanUrl);
    if (!parsed.isValid) {
      setYtError(parsed.error || 'Unsupported URL format: Please provide a valid YouTube link.');
      return;
    }

    if (parsed.type === 'playlist') {
      setYtError('Playlist not supported for this operation: V4 Clipper generates vertical shorts from individual videos. Please open the playlist on YouTube and paste the link of the specific video you wish to clip.');
      return;
    }

    setYtError(null);
    setIsStartingYt(true);

    try {
      const response = await axios.post(`${API_BASE}/youtube`, {
        url: cleanUrl,
        options: {
          resolution,
          aspectRatio,
          cropPosition,
          subtitleStyle
        }
      });

      const newProject = response.data;
      setProjects(prev => [newProject, ...prev]);
      setActiveProjectId(newProject.id);
      setYoutubeUrl('');
    } catch (error) {
      console.error('YouTube automated clipping start failed:', error);
      setYtError(error.response?.data?.error || 'Failed to start video processing. Please check the YouTube URL.');
    } finally {
      setIsStartingYt(false);
    }
  };

  const validateFile = (file) => {
    const allowed = ['.mp4', '.mov', '.mkv', '.webm', '.m4v'];
    const ext = '.' + file.name.split('.').pop().toLowerCase();
    if (!allowed.includes(ext) && !file.type.startsWith('video/')) {
      return `Unsupported file format. Please upload an MP4, MOV, MKV, WEBM, or M4V video.`;
    }
    if (file.size > 1024 * 1024 * 1024) {
      return `File size exceeds 1GB limit.`;
    }
    return null;
  };

  const uploadFile = async (file) => {
    const errorMsg = validateFile(file);
    if (errorMsg) {
      setUploadError(errorMsg);
      return;
    }

    setUploadError(null);
    setIsUploading(true);
    setUploadProgress(0);

    const formData = new FormData();
    formData.append('video', file);
    formData.append('name', file.name.replace(/\.[^/.]+$/, ''));

    try {
      const response = await axios.post(`${API_BASE}/upload`, formData, {
        onUploadProgress: (progressEvent) => {
          if (progressEvent.total) {
            const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setUploadProgress(percent);
          }
        }
      });

      const newProject = response.data;
      setProjects(prev => [newProject, ...prev]);
      setActiveProjectId(newProject.id);

      // Start processing upload automatically
      await axios.post(`${API_BASE}/projects/${newProject.id}/process`, {
        resolution,
        aspectRatio,
        cropPosition,
        subtitleStyle
      });
      fetchProjects(false);
    } catch (error) {
      console.error('Upload failed:', error);
      setUploadError(error.response?.data?.error || 'Video upload failed. Please try again.');
    } finally {
      setIsUploading(false);
    }
  };

  const handleRetryClip = async (projectId, clipId) => {
    setRetryingClipId(clipId);
    try {
      await axios.post(`${API_BASE}/projects/${projectId}/clips/${clipId}/export`, {
        resolution,
        aspectRatio,
        cropPosition,
        subtitleStyle
      });
      await fetchProjects(false);
    } catch (err) {
      console.error('Clip retry failed:', err);
      alert('Could not re-render clip: ' + (err.response?.data?.error || err.message));
    } finally {
      setRetryingClipId(null);
    }
  };

  const handleDelete = async (e, projectId) => {
    e.stopPropagation();
    if (!window.confirm('Delete this project and all associated exported short clips?')) {
      return;
    }

    try {
      await axios.delete(`${API_BASE}/projects/${projectId}`);
      setProjects(prev => prev.filter(p => p.id !== projectId));
      if (activeProjectId === projectId) {
        setActiveProjectId(null);
      }
    } catch (error) {
      console.error('Delete failed:', error);
      alert('Failed to delete project.');
    }
  };

  const formatDuration = (seconds) => {
    if (!seconds) return '0:00';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${String(secs).padStart(2, '0')}`;
  };

  // Find currently active project to showcase (processing project takes top priority)
  const currentActiveProject = projects.find(p => p.status === 'processing') ||
                               projects.find(p => p.id === activeProjectId) ||
                               projects[0] ||
                               null;

  const activeStageIdx = currentActiveProject ? (STAGE_ORDER[currentActiveProject.stage] ?? -1) : -1;

  return (
    <div className="dashboard">
      <div className="container">
        {/* Page Header */}
        <header className="dashboard-header">
          <div>
            <div className="hero-pill-badge">
              <Sparkles size={14} className="badge-icon" />
              <span>Automated Free AI Video Clipper</span>
            </div>
            <h1 className="dashboard-title">Turn YouTube Videos Into 9:16 Shorts</h1>
            <p className="dashboard-subtitle">
              Paste any YouTube URL. Our AI automatically discovers the best moments, generates vertical clips, adds subtitles, and places the V4 watermark — with zero full video download.
            </p>
          </div>
        </header>

        {/* PRIMARY ONE-CLICK YOUTUBE CLIPPER CARD */}
        <div className="card clipper-hero-card">
          {(() => {
            const detectedUrlInfo = youtubeUrl.trim() ? parseYouTubeUrl(youtubeUrl.trim()) : null;
            return (
              <form className="clipper-form" onSubmit={handleStartProcessing}>
                <div className="clipper-input-wrap">
                  <LinkIcon size={20} className="clipper-input-icon" />
                  <input
                    type="text"
                    inputMode="url"
                    autoComplete="off"
                    spellCheck="false"
                    className="clipper-input"
                    placeholder="Paste any YouTube link: Video, Short, Live stream, Clip, Channel, or Replay..."
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    disabled={isStartingYt}
                    required
                  />
                  {detectedUrlInfo && detectedUrlInfo.isValid && (
                    <span style={{
                      fontSize: '11px',
                      fontWeight: 600,
                      padding: '4px 9px',
                      borderRadius: '12px',
                      background: detectedUrlInfo.type === 'live' || detectedUrlInfo.type === 'channel_live' ? '#FEE2E2' : '#EFF6FF',
                      color: detectedUrlInfo.type === 'live' || detectedUrlInfo.type === 'channel_live' ? '#DC2626' : '#2563EB',
                      whiteSpace: 'nowrap',
                      marginRight: '8px',
                      letterSpacing: '0.02em'
                    }}>
                      {getYoutubeTypeLabel(detectedUrlInfo.type)}
                    </span>
                  )}
                </div>
                <button
                  type="submit"
                  className="btn-pill btn-primary btn-clipper-submit"
                  disabled={isStartingYt || !youtubeUrl.trim()}
                >
                  {isStartingYt ? (
                    <>
                      <RefreshCw size={18} className="spinning" />
                      <span>Connecting...</span>
                    </>
                  ) : (
                    <>
                      <Sparkles size={18} />
                      <span>Start Processing</span>
                    </>
                  )}
                </button>
              </form>
            );
          })()}

          {/* Quick Settings Drawer Toggle */}
          <div className="clipper-settings-row">
            <button
              type="button"
              className="btn-link-settings"
              onClick={() => setShowSettings(!showSettings)}
            >
              <Settings2 size={15} />
              <span>Clip & Subtitle Options</span>
              {showSettings ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
            <div className="clipper-security-note">
              <ShieldCheck size={14} />
              <span>Selective Range Streaming • Zero Full Video Storage</span>
            </div>
          </div>

          {showSettings && (
            <div className="clipper-settings-panel">
              <div className="settings-grid">
                <div className="setting-item">
                  <label>Aspect Ratio</label>
                  <select value={aspectRatio} onChange={(e) => setAspectRatio(e.target.value)}>
                    <option value="9:16">9:16 Vertical Short (Reels/TikTok/Shorts)</option>
                    <option value="1:1">1:1 Square</option>
                    <option value="16:9">16:9 Landscape</option>
                  </select>
                </div>

                <div className="setting-item">
                  <label>Framing Mode</label>
                  <select value={cropPosition} onChange={(e) => setCropPosition(e.target.value)}>
                    <option value="center">Center Crop</option>
                    <option value="blur_background">Blurred Background (No Content Lost)</option>
                    <option value="left">Left Anchor</option>
                    <option value="right">Right Anchor</option>
                  </select>
                </div>

                <div className="setting-item">
                  <label>Subtitle Preset</label>
                  <select value={subtitleStyle} onChange={(e) => setSubtitleStyle(e.target.value)}>
                    <option value="clean_white">Clean White (Apple Classic)</option>
                    <option value="highlighted">Highlighted Amber</option>
                    <option value="bold_creator">Bold Creator Yellow</option>
                    <option value="minimal">Minimal Slate</option>
                  </select>
                </div>

                <div className="setting-item">
                  <label>Resolution</label>
                  <select value={resolution} onChange={(e) => setResolution(e.target.value)}>
                    <option value="720x1280">720 × 1280 (Fast ARM64 Render)</option>
                    <option value="1080x1920">1080 × 1920 (Full HD)</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {ytError && (
            <div className="upload-error-banner" style={{ marginTop: '16px' }}>
              <AlertCircle size={18} />
              <span>{ytError}</span>
            </div>
          )}
        </div>

        {/* ACTIVE PROCESSING DASHBOARD (REAL STAGES ONLY — NO FAKE PERCENTAGES) */}
        {currentActiveProject && currentActiveProject.status === 'processing' && (
          <div className="card processing-dashboard-card">
            <div className="processing-dashboard-header">
              <div className="processing-status-indicator">
                <RefreshCw size={22} className="spinning text-primary-blue" />
                <div>
                  <h3>Processing Video: {currentActiveProject.name}</h3>
                  <p className="processing-meta-text">
                    Duration: {formatDuration(currentActiveProject.duration)} •
                    Source: {currentActiveProject.sourceType === 'youtube' ? 'YouTube Stream' : 'Local Upload'}
                  </p>
                </div>
              </div>
              <div className="live-status-pill">
                Live Processing
              </div>
            </div>

            {/* The 9 Canonical Backend Pipeline Steps */}
            <div className="stages-stepper">
              {PIPELINE_STAGES.map((st, idx) => {
                const isPassed = activeStageIdx > idx || currentActiveProject.status === 'completed';
                const isCurrent = activeStageIdx === idx && currentActiveProject.status === 'processing';
                const isPending = activeStageIdx < idx && currentActiveProject.status === 'processing';

                return (
                  <div
                    key={st.key}
                    className={`stepper-step ${isPassed ? 'completed' : ''} ${isCurrent ? 'active' : ''} ${isPending ? 'pending' : ''}`}
                  >
                    <div className="step-circle">
                      {isPassed ? (
                        <Check size={14} />
                      ) : isCurrent ? (
                        <RefreshCw size={14} className="spinning" />
                      ) : (
                        <span>{idx + 1}</span>
                      )}
                    </div>
                    <div className="step-text-wrap">
                      <div className="step-title">{st.label}</div>
                      <div className="step-desc">{st.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* PIPELINE ERROR CARD WITH INSTANT RETRY */}
        {currentActiveProject && currentActiveProject.status === 'error' && (
          <div className="card" style={{
            background: '#FFF5F5',
            border: '1px solid #FFD2D2',
            padding: '24px',
            borderRadius: '24px',
            marginBottom: '28px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-start',
            gap: '12px'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <AlertCircle size={22} color="#D32F2F" />
              <h3 style={{ fontSize: '18px', fontWeight: 600, color: '#D32F2F', margin: 0 }}>
                Processing Halted: {currentActiveProject.name}
              </h3>
            </div>
            <p style={{ fontSize: '14px', color: '#424245', lineHeight: 1.4, margin: 0 }}>
              {currentActiveProject.error || 'The video processing pipeline encountered an issue.'}
            </p>
            <div style={{ display: 'flex', gap: '10px', marginTop: '4px' }}>
              <button
                className="btn-pill btn-primary btn-sm"
                onClick={() => {
                  axios.post(`${API_BASE}/projects/${currentActiveProject.id}/process`, {
                    resolution,
                    aspectRatio,
                    cropPosition,
                    subtitleStyle
                  }).then(() => fetchProjects(false)).catch(err => alert(err.message));
                }}
              >
                <RefreshCw size={14} />
                <span>Retry Pipeline</span>
              </button>
              <button
                className="btn-pill btn-secondary btn-sm"
                onClick={() => setActiveProjectId(null)}
              >
                <span>Dismiss</span>
              </button>
            </div>
          </div>
        )}

        {/* COMPLETED RESULTS SHOWCASE */}
        {currentActiveProject && currentActiveProject.status === 'completed' && currentActiveProject.clips && currentActiveProject.clips.length > 0 && (
          <section className="results-section">
            <div className="section-title-row">
              <div>
                <h2>Completed AI Shorts: {currentActiveProject.name}</h2>
                <p className="section-subheading">
                  AI extracted {currentActiveProject.clips.length} high-engagement vertical shorts. Preview and download below:
                </p>
              </div>
              <div className="results-actions">
                <button
                  className="btn-pill btn-secondary btn-sm"
                  onClick={() => navigate(`/editor/${currentActiveProject.id}`)}
                >
                  <Scissors size={14} />
                  <span>Open Full Editor</span>
                </button>
              </div>
            </div>

            <div className="clips-results-grid">
              {currentActiveProject.clips.map((clip, idx) => {
                const isRetrying = retryingClipId === clip.id;
                const hasExport = Boolean(clip.export && clip.export.fileUrl);

                return (
                  <div key={clip.id} className="card clip-result-card">
                    {/* Vertical 9:16 Video Player Preview */}
                    <div className="clip-video-frame">
                      {hasExport ? (
                        <video
                          className="clip-video-player"
                          controls
                          playsInline
                          preload="metadata"
                          poster={currentActiveProject.thumbnailUrl}
                          src={clip.export.fileUrl}
                        />
                      ) : (
                        <div className="clip-pending-render">
                          <RefreshCw size={28} className="spinning" />
                          <span>Generating Clip...</span>
                        </div>
                      )}
                      <div className="clip-watermark-badge">V4</div>
                    </div>

                    {/* Clip Metadata & Details */}
                    <div className="clip-card-details">
                      <div className="clip-badge-row">
                        <span className="badge-duration">
                          <Clock size={12} />
                          {clip.duration}s ({formatDuration(clip.start)} - {formatDuration(clip.end)})
                        </span>
                        {clip.overall_score && (
                          <span className="badge-score">Score: {clip.overall_score}/100</span>
                        )}
                      </div>

                      <h4 className="clip-title" title={clip.title}>
                        {clip.title}
                      </h4>

                      {clip.reason && (
                        <p className="clip-reason">
                          <strong>Highlight Reason:</strong> {clip.reason}
                        </p>
                      )}

                      {clip.transcript_evidence && (
                        <blockquote className="clip-quote">
                          "{clip.transcript_evidence}"
                        </blockquote>
                      )}

                      {/* Download & Action Buttons */}
                      <div className="clip-download-actions">
                        {hasExport ? (
                          <>
                            <a
                              href={`/api/download/exports/${clip.export.fileName}`}
                              download
                              className="btn-pill btn-primary btn-sm btn-download-primary"
                            >
                              <Download size={14} />
                              <span>Download MP4</span>
                            </a>
                            {clip.export.srtUrl && (
                              <a
                                href={clip.export.srtUrl}
                                download
                                className="btn-pill btn-secondary btn-sm"
                                title="Download synchronized SRT captions"
                              >
                                <Subtitles size={14} />
                                <span>SRT</span>
                              </a>
                            )}
                          </>
                        ) : (
                          <button
                            className="btn-pill btn-primary btn-sm"
                            disabled={isRetrying}
                            onClick={() => handleRetryClip(currentActiveProject.id, clip.id)}
                          >
                            <RefreshCw size={14} className={isRetrying ? 'spinning' : ''} />
                            <span>{isRetrying ? 'Rendering...' : 'Render Clip'}</span>
                          </button>
                        )}

                        <button
                          className="btn-pill btn-secondary btn-sm"
                          title="Re-render this clip"
                          disabled={isRetrying}
                          onClick={() => handleRetryClip(currentActiveProject.id, clip.id)}
                        >
                          <RefreshCw size={14} className={isRetrying ? 'spinning' : ''} />
                          <span>Retry</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {/* DIRECT FILE UPLOAD (FOR LOCAL FILES) */}
        <section className="upload-section" style={{ marginTop: '48px' }}>
          <div className="section-title-row">
            <div>
              <h3>Direct Local Media Upload</h3>
              <p className="dropzone-hint">Or drop local video or audio files to clip podcasts, lectures, or interview recordings directly.</p>
            </div>
          </div>

          <div
            className={`dropzone-card card ${isDragging ? 'dragging' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const file = e.dataTransfer.files?.[0];
              if (file) uploadFile(file);
            }}
          >
            <div className="dropzone-inner">
              <div className="dropzone-icon">
                <Upload size={32} />
              </div>
              <h4>Drop local video or audio file here</h4>
              <p className="dropzone-hint">Supports Universal Video & Audio (MP4, MOV, MKV, WebM, AVI, MP3, WAV, M4A, FLAC, etc.) up to 1GB</p>
              <label className="btn-pill btn-secondary">
                <span>Choose Local File</span>
                <input
                  type="file"
                  accept="video/*,audio/*,.mp4,.mov,.mkv,.webm,.avi,.flv,.wmv,.m4v,.3gp,.ts,.mts,.m2ts,.vob,.ogv,.mxf,.asf,.mp3,.wav,.aac,.m4a,.flac,.ogg,.opus,.wma,.aiff,.alac,.ac3,.eac3,.amr,.caf"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) uploadFile(file);
                  }}
                  hidden
                />
              </label>
            </div>

            {isUploading && (
              <div className="upload-progress-overlay">
                <div className="upload-progress-info">
                  <RefreshCw size={18} className="spinning" />
                  <span>Uploading ({uploadProgress}%)</span>
                </div>
                <div className="progress-bar">
                  <div className="progress-fill" style={{ width: `${uploadProgress}%` }}></div>
                </div>
              </div>
            )}

            {uploadError && (
              <div className="upload-error-banner">
                <AlertCircle size={18} />
                <span>{uploadError}</span>
              </div>
            )}
          </div>
        </section>

        {/* ALL PROJECTS HISTORY */}
        <section className="projects-section">
          <div className="section-title-row">
            <h2>Your Projects History</h2>
            <span className="projects-count">{projects.length} {projects.length === 1 ? 'Project' : 'Projects'}</span>
          </div>

          {loading ? (
            <div className="loading-state card">
              <RefreshCw size={28} className="spinning" />
              <p>Loading projects...</p>
            </div>
          ) : projects.length === 0 ? (
            <div className="empty-state card">
              <Film size={48} className="empty-icon" />
              <h3>No projects created yet</h3>
              <p>Paste a YouTube URL above to generate automated vertical shorts in seconds.</p>
            </div>
          ) : (
            <div className="projects-grid">
              {projects.map((proj) => {
                const isProcessing = proj.status === 'processing';
                const isCompleted = proj.status === 'completed';
                const isError = proj.status === 'error';
                const clipCount = proj.clips ? proj.clips.length : 0;
                const isSelected = proj.id === activeProjectId;

                return (
                  <div
                    key={proj.id}
                    className={`project-card card ${isSelected ? 'selected' : ''}`}
                    onClick={() => setActiveProjectId(proj.id)}
                  >
                    <div className="project-thumbnail-wrap">
                      {proj.thumbnailUrl ? (
                        <img
                          src={proj.thumbnailUrl}
                          alt={proj.name}
                          className="project-thumbnail-img"
                          onError={(e) => {
                            e.target.style.display = 'none';
                            if (e.target.nextSibling) e.target.nextSibling.style.display = 'flex';
                          }}
                        />
                      ) : null}
                      <div className="project-thumbnail-placeholder" style={{ display: proj.thumbnailUrl ? 'none' : 'flex' }}>
                        <Film size={36} />
                      </div>

                      <div className="thumbnail-badges">
                        <span className="badge-duration">
                          <Clock size={12} />
                          {formatDuration(proj.duration)}
                        </span>
                        {proj.sourceType === 'youtube' && (
                          <span className="badge-ratio">YouTube</span>
                        )}
                      </div>
                    </div>

                    <div className="project-content">
                      <div className="project-info-row">
                        <h3 className="project-name" title={proj.name}>{proj.name}</h3>
                        <button
                          className="btn-delete"
                          title="Delete Project"
                          onClick={(e) => handleDelete(e, proj.id)}
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>

                      <div className="project-status-row">
                        {isProcessing && (
                          <div className="status-badge processing">
                            <RefreshCw size={12} className="spinning" />
                            <span>Processing...</span>
                          </div>
                        )}

                        {isCompleted && (
                          <div className="status-badge ready">
                            <CheckCircle2 size={12} />
                            <span>{clipCount} {clipCount === 1 ? 'Clip Ready' : 'Clips Ready'}</span>
                          </div>
                        )}

                        {isError && (
                          <div className="status-badge error">
                            <AlertCircle size={12} />
                            <span>Error</span>
                          </div>
                        )}

                        <span className="project-date">
                          {new Date(proj.createdAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </span>
                      </div>

                      <div className="project-actions">
                        <button
                          className="btn-pill btn-primary btn-sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            navigate(`/editor/${proj.id}`);
                          }}
                        >
                          <span>Open Editor</span>
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default Dashboard;
