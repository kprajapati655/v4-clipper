import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, Film, Sparkles, Scissors, Subtitles, ShieldCheck, Download, Smartphone, Play, Link as LinkIcon } from 'lucide-react';
import './LandingPage.css';

const LandingPage = () => {
  const [quickUrl, setQuickUrl] = useState('');
  const navigate = useNavigate();

  const handleHeroSubmit = (e) => {
    e.preventDefault();
    if (quickUrl.trim()) {
      navigate(`/dashboard?url=${encodeURIComponent(quickUrl.trim())}`);
    } else {
      navigate('/dashboard');
    }
  };

  return (
    <div className="landing-page">
      {/* Hero Section */}
      <section className="hero">
        <div className="container hero-content">
          <div className="hero-pill-badge">
            <Sparkles size={14} className="badge-icon" />
            <span>100% Free Open AI Video Clipper</span>
          </div>

          <h1 className="hero-title">
            Turn Long Videos<br />Into Shorts That Matter.
          </h1>

          <p className="hero-subtitle">
            Professional AI clipping engineered for creators, podcasters, and educators. Automatically analyze conversations, detect virality hooks, convert to 9:16 vertical video, and burn subtitles — completely free with zero subscription paywalls.
          </p>

          <form className="hero-clipper-box card" onSubmit={handleHeroSubmit} style={{
            maxWidth: '680px',
            margin: '0 auto 28px',
            display: 'flex',
            gap: '10px',
            padding: '10px 12px 10px 18px',
            borderRadius: '100px',
            background: '#FFFFFF',
            border: '1px solid var(--container-surface)',
            boxShadow: '0 4px 20px rgba(0,0,0,0.06)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
              <LinkIcon size={18} color="var(--muted-text)" />
              <input
                type="text"
                inputMode="url"
                autoComplete="off"
                spellCheck="false"
                placeholder="Paste any YouTube link: Video, Short, Live stream, Clip, Channel..."
                value={quickUrl}
                onChange={(e) => setQuickUrl(e.target.value)}
                style={{
                  border: 'none',
                  outline: 'none',
                  fontSize: '15px',
                  width: '100%',
                  color: 'var(--primary-text)',
                  background: 'transparent'
                }}
              />
            </div>
            <button type="submit" className="btn-pill btn-primary" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', padding: '12px 24px', fontSize: '15px' }}>
              <Sparkles size={16} />
              <span>Start Processing</span>
            </button>
          </form>

          <div className="hero-actions">
            <Link to="/dashboard" className="btn-pill btn-secondary">
              <span>Open Creator Dashboard</span>
              <ArrowRight size={16} />
            </Link>
            <a href="#how-it-works" className="btn-link">
              See How It Works &darr;
            </a>
          </div>

          {/* Interactive Preview Container */}
          <div className="hero-preview">
            <div className="preview-container card">
              <div className="preview-topbar">
                <div className="window-dots">
                  <span className="dot dot-red"></span>
                  <span className="dot dot-yellow"></span>
                  <span className="dot dot-green"></span>
                </div>
                <div className="preview-title">V4 AI Clipper Studio</div>
                <div className="preview-status-pill">AI Engine Active</div>
              </div>

              <div className="mock-workspace">
                <div className="mock-video-area">
                  <div className="mock-phone-frame">
                    <div className="mock-phone-speaker"></div>
                    <div className="mock-phone-screen">
                      <div className="mock-video-content">
                        <div className="mock-play-indicator">
                          <Film size={36} />
                        </div>
                        <div className="mock-subtitle-burn clean-white">
                          "The secret isn't more content, it's finding the exact moment that connects."
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="mock-aspect-indicator">9:16 Vertical • 1080 × 1920</div>
                </div>

                <div className="mock-sidebar">
                  <div className="mock-clips-header">
                    <h4>AI Detected Highlights</h4>
                    <span className="badge-pill">4 Ready</span>
                  </div>

                  <div className="mock-clip-item active">
                    <div className="mock-clip-meta">
                      <span className="mock-clip-title">The Secret to Retention</span>
                      <span className="mock-clip-score">Score 94</span>
                    </div>
                    <p className="mock-clip-reason">Strong opening hook with high emotional engagement.</p>
                    <div className="mock-clip-time">00:36 - 01:18 (42s)</div>
                  </div>

                  <div className="mock-clip-item">
                    <div className="mock-clip-meta">
                      <span className="mock-clip-title">Why Most Creators Fail Early</span>
                      <span className="mock-clip-score">Score 89</span>
                    </div>
                    <p className="mock-clip-reason">Contrarian statement with high conversational density.</p>
                    <div className="mock-clip-time">02:15 - 02:58 (43s)</div>
                  </div>

                  <div className="mock-clip-item">
                    <div className="mock-clip-meta">
                      <span className="mock-clip-title">The Framework for 2026</span>
                      <span className="mock-clip-score">Score 86</span>
                    </div>
                    <p className="mock-clip-reason">Educational breakdown with clear actionable takeaways.</p>
                    <div className="mock-clip-time">05:40 - 06:22 (42s)</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works Section */}
      <section id="how-it-works" className="how-it-works">
        <div className="container">
          <div className="section-header">
            <h2 className="section-heading">How It Works</h2>
            <p className="section-subheading">From full-length video to export-ready short clips in three steps.</p>
          </div>

          <div className="steps-grid">
            <div className="step-card card">
              <div className="step-badge">1</div>
              <div className="step-icon-wrap">
                <Film size={28} />
              </div>
              <h3 className="step-title">Upload Video</h3>
              <p className="step-desc">
                Drag and drop videos in MP4, MOV, MKV, WEBM, or M4V formats up to 1GB. Full metadata, resolution, and audio profiles are automatically detected.
              </p>
            </div>

            <div className="step-card card">
              <div className="step-badge">2</div>
              <div className="step-icon-wrap">
                <Sparkles size={28} />
              </div>
              <h3 className="step-title">AI Video Analysis</h3>
              <p className="step-desc">
                Our engine transcribes every sentence with speech recognition, analyzes narrative arcs, conversational rhythm, and hook strength to find the top 3–4 highlights.
              </p>
            </div>

            <div className="step-card card">
              <div className="step-badge">3</div>
              <div className="step-icon-wrap">
                <Scissors size={28} />
              </div>
              <h3 className="step-title">Edit, Style & Export</h3>
              <p className="step-desc">
                Fine-tune start/end trim points, pick between 4 subtitle presets, choose vertical 9:16 or square crop, and download finished MP4 and SRT files instantly.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Features Overview */}
      <section className="features-section">
        <div className="container">
          <div className="section-header">
            <h2 className="section-heading">Engineered for Performance</h2>
            <p className="section-subheading">Every tool you need to turn long recordings into viral vertical shorts.</p>
          </div>

          <div className="features-grid">
            <div className="feature-card card">
              <Smartphone size={32} className="feature-icon" />
              <h3>Vertical 9:16 Auto-Framing</h3>
              <p>Converts widescreen 16:9 recordings into vertical formats formatted for YouTube Shorts, Instagram Reels, and TikTok with smart center crop.</p>
            </div>

            <div className="feature-card card">
              <Subtitles size={32} className="feature-icon" />
              <h3>Synchronized Subtitles</h3>
              <p>Generates word-level synchronized subtitles with 4 customizable visual styles: Clean White, Highlighted Keywords, Minimal Professional, and Bold Creator.</p>
            </div>

            <div className="feature-card card">
              <Sparkles size={32} className="feature-icon" />
              <h3>Dialogue & Hook Scoring</h3>
              <p>Computes genuine engagement metrics based on opening hooks, emotional indicators, speech cadence, and storytelling clarity.</p>
            </div>

            <div className="feature-card card">
              <Download size={32} className="feature-icon" />
              <h3>High-Definition Free Export</h3>
              <p>Export in 1080×1920 or 720×1280 with H.264 video and AAC audio. Download both finished MP4 videos and standalone SRT subtitle files.</p>
            </div>

            <div className="feature-card card">
              <ShieldCheck size={32} className="feature-icon" />
              <h3>100% Free & Private</h3>
              <p>No paywalls, no monthly subscription fees, and no artificial daily export limits. Supports local AI models directly on your machine.</p>
            </div>

            <div className="feature-card card">
              <Scissors size={32} className="feature-icon" />
              <h3>Precision Timeline Trimming</h3>
              <p>Interactive timeline editor allows you to adjust boundaries by fractions of a second, edit spoken subtitle text, and re-export anytime.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Formats & Privacy Guarantee */}
      <section className="formats-section">
        <div className="container formats-card card">
          <div className="formats-content">
            <h3>Supported Formats & Specifications</h3>
            <p className="formats-desc">
              Compatible with all standard camera and streaming formats including <strong>MP4, MOV, MKV, WEBM, and M4V</strong>. Export presets configured for <strong>9:16 Vertical</strong>, <strong>1:1 Square</strong>, and <strong>16:9 Landscape</strong> at 30 or 60 fps.
            </p>
            <div className="format-tags">
              <span className="tag">MP4</span>
              <span className="tag">MOV</span>
              <span className="tag">MKV</span>
              <span className="tag">WEBM</span>
              <span className="tag">M4V</span>
              <span className="tag">H.264</span>
              <span className="tag">AAC</span>
              <span className="tag">SRT</span>
            </div>
          </div>
          <div className="formats-action">
            <Link to="/dashboard" className="btn-pill btn-primary btn-large">
              Open Dashboard
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
};

export default LandingPage;
