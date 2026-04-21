#!/usr/bin/env bash
set -e

ROOT="$(cd "$(dirname "$0")" && pwd)"
BACKEND="$ROOT/backend"
FRONTEND="$ROOT/frontend"
VENV="$BACKEND/venv"

# ── Colors ────────────────────────────────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
info()  { echo -e "${GREEN}[start]${NC} $*"; }
warn()  { echo -e "${YELLOW}[start]${NC} $*"; }
error() { echo -e "${RED}[start]${NC} $*"; }

# ── Cleanup on exit ───────────────────────────────────────────────────────────
PIDS=()
cleanup() {
  info "Shutting down..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null
}
trap cleanup EXIT INT TERM

# ── 0. Create default .env if missing ────────────────────────────────────────
if [ ! -f "$BACKEND/.env" ]; then
  warn ".env not found — creating default .env (edit to add API keys)..."
  cat > "$BACKEND/.env" <<'EOF'
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
GEMINI_API_KEY=
GOOGLE_API_KEY=
EOF
  info "Created $BACKEND/.env with defaults."
fi

# ── 1. Check / install Node deps ─────────────────────────────────────────────
info "Checking frontend dependencies..."
if [ ! -d "$FRONTEND/node_modules" ]; then
  warn "node_modules not found — running npm install..."
  npm install --prefix "$FRONTEND"
else
  info "node_modules already installed."
fi

# ── 2. Set up Python venv + pip deps ─────────────────────────────────────────
info "Checking Python virtual environment..."
if [ ! -d "$VENV" ]; then
  warn "venv not found — creating..."
  python3 -m venv "$VENV"
fi

PYTHON="$VENV/bin/python"
PIP="$VENV/bin/pip"

info "Checking Python dependencies..."
"$PIP" install --quiet -r "$BACKEND/requirements.txt"

# ── 3. Check / install Playwright browsers ───────────────────────────────────
info "Checking Playwright browsers..."
if ! "$PYTHON" -c "from playwright.sync_api import sync_playwright; sync_playwright().start().chromium" 2>/dev/null; then
  warn "Playwright browsers not found — installing chromium..."
  "$PYTHON" -m playwright install chromium
else
  info "Playwright chromium ready."
fi

# ── 4. Start Ollama (if not already running) ─────────────────────────────────
OLLAMA_MODEL=$(grep OLLAMA_MODEL "$BACKEND/.env" 2>/dev/null | cut -d= -f2 | tr -d ' \r')
OLLAMA_MODEL="${OLLAMA_MODEL:-llama3.2}"

if command -v ollama &>/dev/null; then
  if ! curl -sf http://localhost:11434 &>/dev/null; then
    info "Starting Ollama..."
    ollama serve &>/tmp/ollama.log &
    PIDS+=($!)
    # Wait for Ollama to be ready
    for i in $(seq 1 20); do
      curl -sf http://localhost:11434 &>/dev/null && break
      sleep 0.5
    done
  else
    info "Ollama already running."
  fi

  # Pull the model if not present
  if ! ollama list 2>/dev/null | grep -q "$OLLAMA_MODEL"; then
    warn "Model '$OLLAMA_MODEL' not found — pulling (this may take a while)..."
    ollama pull "$OLLAMA_MODEL"
  else
    info "Model '$OLLAMA_MODEL' ready."
  fi
else
  warn "Ollama not found in PATH — skipping. Install from https://ollama.com if you want local AI."
fi

# ── 5. Start backend ─────────────────────────────────────────────────────────
info "Starting backend..."
cd "$BACKEND"
"$VENV/bin/uvicorn" main:app --host 0.0.0.0 --port 8000 --reload &>/tmp/poker-backend.log &
PIDS+=($!)
cd "$ROOT"

# Wait for backend to be ready
info "Waiting for backend..."
for i in $(seq 1 20); do
  curl -sf http://localhost:8000 &>/dev/null && break
  sleep 0.5
done
info "Backend ready at http://localhost:8000"

# ── 6. Start frontend ─────────────────────────────────────────────────────────
info "Starting frontend..."
npm run dev --prefix "$FRONTEND" &>/tmp/poker-frontend.log &
PIDS+=($!)

# Wait for Vite to be ready
info "Waiting for frontend..."
for i in $(seq 1 30); do
  curl -sf http://localhost:5173 &>/dev/null && break
  sleep 0.5
done

# ── 7. Open browser ───────────────────────────────────────────────────────────
info "Opening http://localhost:5173 ..."
open "http://localhost:5173" 2>/dev/null || xdg-open "http://localhost:5173" 2>/dev/null || true

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Poker Simulator is running!${NC}"
echo -e "  Frontend  →  http://localhost:5173"
echo -e "  Backend   →  http://localhost:8000"
echo -e "  Logs      →  /tmp/poker-backend.log  /tmp/poker-frontend.log"
echo -e "${GREEN}  Press Ctrl+C to stop everything.${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Keep running until Ctrl+C
wait
