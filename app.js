'use strict';

// ── DOM references ──────────────────────────────────────────────
const setupScreen   = document.getElementById('setup-screen');
const timerScreen   = document.getElementById('timer-screen');
const durationInput = document.getElementById('duration');
const startBtn      = document.getElementById('start-btn');
const stopBtn       = document.getElementById('stop-btn');
const timeDisplay   = document.getElementById('time-display');
const progressBar   = document.getElementById('progress-bar');

// ── State ───────────────────────────────────────────────────────
let totalSeconds  = 0;   // configured talk duration in seconds
let remainingMs   = 0;   // milliseconds left (goes negative = overtime)
let rafId         = null;
let lastTimestamp = null;
let wakeLock      = null;

// ── Wake Lock ───────────────────────────────────────────────────
async function acquireWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    document.addEventListener('visibilitychange', onVisibilityChange);
  } catch (_) {
    // Wake lock not supported or denied — silent fallback
  }
}

async function onVisibilityChange() {
  if (wakeLock !== null && document.visibilityState === 'visible') {
    await acquireWakeLock();
  }
}

function releaseWakeLock() {
  if (wakeLock) {
    wakeLock.release().catch(() => {});
    wakeLock = null;
  }
  document.removeEventListener('visibilitychange', onVisibilityChange);
}

// ── Helpers ─────────────────────────────────────────────────────

/**
 * Format a total number of seconds (possibly negative) as [−]MM:SS.
 */
function formatTime(totalSec) {
  const negative = totalSec < 0;
  const abs = Math.abs(totalSec);
  const m   = Math.floor(abs / 60);
  const s   = abs % 60;
  return `${negative ? '−' : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/**
 * Update background colour based on overtime:
 *   overtime ≥  5 min (remainingSec ≤ −300)  → dark orange
 *   overtime ≥ 10 min (remainingSec ≤ −600)  → red
 */
function applyBackground(remainingSec) {
  timerScreen.classList.remove('warning', 'danger');
  if (remainingSec <= -600) {
    timerScreen.classList.add('danger');
  } else if (remainingSec <= -300) {
    timerScreen.classList.add('warning');
  }
}

/**
 * Update the grey progress bar width.
 * 100% = full time remaining, 0% = time expired (clamped, not negative).
 */
function updateProgressBar(remainingSec) {
  const pct = Math.max(0, (remainingSec / totalSeconds) * 100);
  progressBar.style.width = pct + '%';
  progressBar.setAttribute('aria-valuenow', Math.round(pct));
}

// ── Animation loop ───────────────────────────────────────────────
function tick(timestamp) {
  if (lastTimestamp === null) lastTimestamp = timestamp;

  remainingMs  -= timestamp - lastTimestamp;
  lastTimestamp  = timestamp;

  const remainingSec = Math.ceil(remainingMs / 1000);

  timeDisplay.textContent = formatTime(remainingSec);
  updateProgressBar(remainingSec);
  applyBackground(remainingSec);

  rafId = requestAnimationFrame(tick);
}

// ── Start / Stop ─────────────────────────────────────────────────
function startTimer() {
  const minutes = parseInt(durationInput.value, 10);
  if (!Number.isFinite(minutes) || minutes < 1) return;

  totalSeconds  = minutes * 60;
  remainingMs   = totalSeconds * 1000;
  lastTimestamp = null;

  timerScreen.classList.remove('warning', 'danger');
  setupScreen.classList.add('hidden');
  timerScreen.classList.remove('hidden');

  progressBar.style.width = '100%';
  progressBar.setAttribute('aria-valuenow', 100);
  timeDisplay.textContent = formatTime(totalSeconds);

  rafId = requestAnimationFrame(tick);
  acquireWakeLock();
}

function stopTimer() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  lastTimestamp = null;

  releaseWakeLock();

  timerScreen.classList.add('hidden');
  timerScreen.classList.remove('warning', 'danger');
  setupScreen.classList.remove('hidden');
}

// ── Event listeners ──────────────────────────────────────────────
startBtn.addEventListener('click', startTimer);
stopBtn.addEventListener('click', stopTimer);

durationInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') startTimer();
});
