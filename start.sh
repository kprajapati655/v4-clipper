#!/data/data/com.termux/files/usr/bin/bash
set -e

# Ensure Termux environment binaries are in PATH
export PATH="/data/data/com.termux/files/usr/bin:$PATH"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "============================================="
echo "   V4 CLIPPER — FREE AI VIDEO CLIPPING"
echo "============================================="

# Ensure working directories and yt-dlp config exist
mkdir -p data/uploads/thumbnails data/projects data/exports data/temp "$HOME/.config/yt-dlp"

if [ ! -f "$HOME/.config/yt-dlp/config" ]; then
    cat << 'EOF' > "$HOME/.config/yt-dlp/config"
--js-runtimes node:/data/data/com.termux/files/usr/bin/node
--js-runtimes node
--extractor-args "youtube:player_client=default,-tv,web_safari,web_embedded"
--sleep-requests 1.5
--sleep-subtitles 1
--no-playlist
EOF
fi

# Check prerequisite binaries
if ! command -v node >/dev/null 2>&1; then
    echo "ERROR: 'node' executable not found in PATH. Install with: pkg install nodejs"
    exit 1
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
    echo "WARNING: 'ffmpeg' not found. Video rendering requires FFmpeg: pkg install ffmpeg"
fi

if ! command -v yt-dlp >/dev/null 2>&1; then
    echo "WARNING: 'yt-dlp' not found. YouTube clipping requires yt-dlp: pkg install yt-dlp"
fi

# Check for optional YouTube cookies
if [ -f "data/cookies.txt" ]; then
    echo "✓ YouTube authentication cookies detected in data/cookies.txt"
fi

if [ ! -d "backend/node_modules" ]; then
    echo "ERROR: backend/node_modules not found. Run: cd backend && npm install"
    exit 1
fi

if [ ! -d "frontend/node_modules" ]; then
    echo "ERROR: frontend/node_modules not found. Run: cd frontend && npm install"
    exit 1
fi

# 1. Pre-flight port availability check
PORT_5000_BUSY=$(node -e "
const net = require('net');
const s = net.createServer();
s.once('error', e => { if (e.code === 'EADDRINUSE') process.stdout.write('yes'); process.exit(0); });
s.once('listening', () => { s.close(); process.stdout.write('no'); process.exit(0); });
s.listen(5000, '0.0.0.0');
" 2>/dev/null || echo "no")

if [ "$PORT_5000_BUSY" = "yes" ]; then
    echo "ERROR: Port 5000 is already in use by an existing process."
    echo "Please stop the existing backend process before starting V4 Clipper."
    exit 1
fi

PORT_5173_BUSY=$(node -e "
const net = require('net');
const s = net.createServer();
s.once('error', e => { if (e.code === 'EADDRINUSE') process.stdout.write('yes'); process.exit(0); });
s.once('listening', () => { s.close(); process.stdout.write('no'); process.exit(0); });
s.listen(5173, '0.0.0.0');
" 2>/dev/null || echo "no")

if [ "$PORT_5173_BUSY" = "yes" ]; then
    echo "ERROR: Port 5173 is already in use by an existing process."
    echo "Please stop the existing frontend process before starting V4 Clipper."
    exit 1
fi

CLEANUP_DONE=0
BACKEND_PID=""
FRONTEND_PID=""

cleanup() {
    if [ "$CLEANUP_DONE" -eq 1 ]; then
        return
    fi
    CLEANUP_DONE=1

    echo ""
    echo "Shutting down V4 Clipper services..."

    # Gracefully terminate backend
    if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
        kill -TERM "$BACKEND_PID" 2>/dev/null || true
    fi

    # Gracefully terminate frontend
    if [ -n "$FRONTEND_PID" ] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
        kill -TERM "$FRONTEND_PID" 2>/dev/null || true
    fi

    # Wait up to 0.5s, then force kill if any process is still alive
    sleep 0.5
    if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
        kill -KILL "$BACKEND_PID" 2>/dev/null || true
    fi
    if [ -n "$FRONTEND_PID" ] && kill -0 "$FRONTEND_PID" 2>/dev/null; then
        kill -KILL "$FRONTEND_PID" 2>/dev/null || true
    fi

    echo "Shutdown complete."
}

trap cleanup INT TERM EXIT

# 2. Start Backend API Server
echo "Starting Backend API Server (port 5000)..."
node backend/index.js &
BACKEND_PID=$!

# Verify backend did not crash on startup
sleep 1
if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
    echo "ERROR: Backend server crashed on startup (PID $BACKEND_PID exited)."
    echo "Check the Node.js runtime traceback above for the exact error."
    exit 1
fi
echo "Backend running (PID: $BACKEND_PID)."

# 3. Start Frontend Dev Server
echo "Starting Frontend Dev Server (port 5173)..."
cd frontend
# Run vite binary directly to avoid orphaned child processes spawned by npx
./node_modules/.bin/vite --host 0.0.0.0 &
FRONTEND_PID=$!
cd "$DIR"

# Verify frontend did not crash on startup
sleep 1.5
if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
    echo "ERROR: Frontend server crashed on startup (PID $FRONTEND_PID exited)."
    echo "Check the Vite runtime traceback above for the exact error."
    exit 1
fi
echo "Frontend running (PID: $FRONTEND_PID)."

echo "============================================="
echo "   V4 Clipper is live! Press Ctrl+C to stop."
echo "============================================="

# Monitor both processes so if either crashes, the other does not remain orphaned
while true; do
    if ! kill -0 "$BACKEND_PID" 2>/dev/null; then
        echo "WARNING: Backend server process ($BACKEND_PID) exited."
        break
    fi
    if ! kill -0 "$FRONTEND_PID" 2>/dev/null; then
        echo "WARNING: Frontend server process ($FRONTEND_PID) exited."
        break
    fi
    sleep 2
done

exit 0
