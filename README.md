# V4 Clipper — Free AI Video Clipping Platform

A complete, production-grade free AI video clipping platform designed under the **Apple (IN)** visual design system. Turn long-form recordings into viral 9:16 vertical shorts with AI conversational highlight detection, synchronized word-level subtitles, precision trimming, and high-definition watermark-free export.

---

## 1. Key Capabilities

1. **Full-Length Video AI Analysis**:
   - Transcribes the entire video using Whisper speech recognition.
   - Evaluates narrative hooks, speech density, and conversational peaks to identify the top 3–4 highlights (30–60 seconds).
   - Computes genuine multi-dimensional virality scores: **Hook**, **Emotion**, **Storytelling**, and **Shareability**.
   - Zero-cost local NLP fallback ensures complete offline functionality without paid API subscriptions.

2. **Apple Design System UI**:
   - Strict adherence to Apple colors (`#F5F5F7`, `#1D1D1F`, `#0066CC`, `#FF791B`), SF Pro typography, fully rounded pill buttons, and 28–36px container radiuses.
   - No distracting neon gradients, glassmorphism, or artificial credits.

3. **Interactive Studio Video Editor**:
   - Responsive video player preview with real-time subtitle overlays.
   - Aspect ratio toggle: **9:16 Vertical** (Shorts/Reels/TikTok), **1:1 Square**, and **16:9 Landscape**.
   - Horizon crop positioning (Center, Left, Right).
   - Dual-slider precision trimming down to 0.1s.
   - Interactive subtitle transcript editor: edit spoken words in real time.

4. **FFmpeg Video & Subtitle Rendering**:
   - 4 Subtitle Presets: **Clean White**, **Highlighted Keywords** (Amber), **Minimal Professional**, and **Bold Creator**.
   - Custom font size, color, and vertical alignment controls.
   - Sample-accurate H.264 video encoding at 720×1280 or 1080×1920.
   - Direct downloads of finished MP4 videos and standalone SRT subtitle files.

---

## 2. Directory Structure

```
v4-clipper/
├── backend/
│   ├── index.js                     # Express server & REST API
│   ├── package.json                 # Backend dependencies
│   └── services/
│       ├── metadataService.js       # FFprobe video inspection & thumbnail extraction
│       ├── transcriptionService.js  # Whisper STT (Groq API & local whisper.cpp)
│       ├── analysisService.js       # AI highlight scoring & dialogue analysis
│       └── videoProcessingService.js # FFmpeg 9:16 crop & subtitle burning engine
├── frontend/
│   ├── index.html                   # HTML5 shell
│   ├── package.json                 # Frontend dependencies (React 19, Vite)
│   ├── vite.config.js               # Vite config
│   └── src/
│       ├── main.jsx                 # React root mount
│       ├── App.jsx                  # Navigation & Routing
│       ├── App.css                  # Navbar & global layout styling
│       ├── index.css                # Apple Design System CSS design tokens
│       └── pages/
│           ├── LandingPage.jsx      # Hero, preview & features
│           ├── LandingPage.css      # Landing page styles
│           ├── Dashboard.jsx        # Project manager & dropzone
│           ├── Dashboard.css        # Dashboard styles
│           ├── Editor.jsx           # Studio editor & export suite
│           └── Editor.css           # Editor styles
├── data/
│   ├── uploads/                     # Uploaded videos & thumbnails
│   ├── projects/                    # Project JSON states
│   ├── exports/                     # Rendered MP4 shorts & SRTs
│   └── temp/                        # Working audio & subtitle buffers
├── package.json                     # Root orchestrator scripts
└── README.md                        # Documentation
```

---

## 3. Installation & Startup Instructions

### Prerequisites
- **Node.js**: v18+ recommended (v20+ supported).
- **FFmpeg & FFprobe**: Installed and available in your system `$PATH`.
- *(Optional)* **Whisper.cpp**: For offline speech-to-text (`~/whisper.cpp/build/bin/whisper-cli`).
- *(Optional)* **Groq API Key**: For ultra-fast cloud transcription and LLM analysis (`export GROQ_API_KEY="..."`).

### Step 1: Install Dependencies
```bash
# In the project root:
cd ~/v4-clipper

# Install backend dependencies
cd backend && npm install

# Install frontend dependencies
cd ../frontend && npm install
```

### Step 2: Start the Backend Server
```bash
cd ~/v4-clipper/backend
node index.js
```
*The API server will listen on `http://localhost:5000`.*

### Step 3: Start the Frontend Application
```bash
cd ~/v4-clipper/frontend
npm run dev
```
*Open your browser and navigate to `http://localhost:5173`.*

---

## 4. API Endpoints Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Healthcheck and timestamp |
| `GET` | `/api/config` | System capabilities and active models |
| `GET` | `/api/projects` | List all user projects |
| `GET` | `/api/projects/:id` | Get project metadata, clips, and transcript |
| `POST` | `/api/upload` | Multipart video upload (`video` field) |
| `DELETE` | `/api/projects/:id` | Safely remove project and its files |
| `POST` | `/api/projects/:id/process` | Trigger full-video AI transcription and highlight analysis |
| `PUT` | `/api/projects/:id/clips/:clipId` | Update clip title, start/end bounds, or transcript |
| `POST` | `/api/projects/:id/clips/:clipId/export` | Render a single clip to vertical MP4 + SRT |
| `POST` | `/api/projects/:id/export-all` | Batch render all project clips |
| `GET` | `/api/download/:type/:filename` | Direct download endpoint with attachment headers |

---

## 5. Free AI & Processing Fallback Guarantee

This software is strictly architected so that **no user is ever blocked by a paywall or missing API key**:
- If a `GROQ_API_KEY` is present, it uses Groq's high-speed Whisper and LLM models.
- If no key is provided, the backend seamlessly falls back to:
  1. Local `whisper.cpp` (`ggml-tiny.bin`) for zero-cost audio transcription.
  2. Local heuristic NLP dialogue analyzer that evaluates question triggers, speech density, and emotional transition cues to compute authentic virality scores.
- Video processing runs entirely via native FFmpeg with zero cloud fees.
