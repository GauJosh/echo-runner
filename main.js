// Echo Runner — simplified back to the proven core: one-button dodge/jump,
// no ghosts (see CLAUDE.md — the ghost/echo mechanic wasn't landing as fun
// even once correctly implemented, so we're falling back to the genre that's
// reliably fun — Flappy Bird / Chrome Dino style — and focusing effort on
// feel (juice) instead of mechanic novelty). Ghosts may return later as an
// optional mode if this baseline is actually fun first.

const LOGICAL_WIDTH = 480;
const LOGICAL_HEIGHT = 800;

const canvas = document.getElementById("gameCanvas");
canvas.width = LOGICAL_WIDTH;
canvas.height = LOGICAL_HEIGHT;
const ctx = canvas.getContext("2d");

function fitCanvasToViewport() {
  const scale = Math.min(window.innerWidth / LOGICAL_WIDTH, window.innerHeight / LOGICAL_HEIGHT);
  canvas.style.width = `${LOGICAL_WIDTH * scale}px`;
  canvas.style.height = `${LOGICAL_HEIGHT * scale}px`;
}
window.addEventListener("resize", fitCanvasToViewport);
fitCanvasToViewport();

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const FIXED_DT = 1 / 60;
const GRAVITY = 1800;
const JUMP_VELOCITY = -650;
const JUMP_CUT_MULTIPLIER = 0.45; // release early for a shorter hop — real control, not just timing
const GROUND_Y = 620;
const PLAYER_X = 120;
const PLAYER_RADIUS = 16;
const GROUND_EPSILON = 0.5;

// Difficulty ramps with distance, not with an artificial mechanic — the
// proven approach (Chrome Dino, etc.). Obstacle gaps are fixed in world
// distance; ramping speed alone naturally reduces reaction time over time.
const BASE_SCROLL_SPEED = 260;
const MAX_SCROLL_SPEED = 480;
const SPEED_RAMP_DISTANCE = 5000; // world units to reach max speed

const MIN_GAP_DIST = 300;
const MAX_GAP_DIST = 560;
const OBSTACLE_COUNT = 400;

// ---------------------------------------------------------------------------
// Deterministic obstacle course (no gameplay reason it must be deterministic
// anymore without ghosts, but it's free, and it means every player sees a
// hand-tunable, reproducible course rather than pure randomness).
// ---------------------------------------------------------------------------
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function buildObstacleCourse() {
  const rand = mulberry32(20260903);
  const obstacles = [];
  let distance = 700;
  for (let i = 0; i < OBSTACLE_COUNT; i++) {
    distance += MIN_GAP_DIST + rand() * (MAX_GAP_DIST - MIN_GAP_DIST);
    const width = 26 + Math.floor(rand() * 20);
    const height = 40 + Math.floor(rand() * 40);
    obstacles.push({ spawnDistance: distance, width, height, cleared: false });
  }
  return obstacles;
}
let OBSTACLE_COURSE = buildObstacleCourse();

// ---------------------------------------------------------------------------
// Audio — tiny synthesized sound effects via Web Audio API. No asset files,
// no loading, works the moment the page does. Browsers require audio to
// start after a user gesture, so the context is created lazily on first input.
// ---------------------------------------------------------------------------
let audioCtx = null;
function ensureAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioCtx;
}

function playTone({ freq, duration, type = "sine", startFreq, endFreq, gain = 0.15 }) {
  const ctxA = ensureAudio();
  const osc = ctxA.createOscillator();
  const gainNode = ctxA.createGain();
  osc.type = type;
  const now = ctxA.currentTime;
  if (startFreq && endFreq) {
    osc.frequency.setValueAtTime(startFreq, now);
    osc.frequency.exponentialRampToValueAtTime(endFreq, now + duration);
  } else {
    osc.frequency.setValueAtTime(freq, now);
  }
  gainNode.gain.setValueAtTime(gain, now);
  gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);
  osc.connect(gainNode).connect(ctxA.destination);
  osc.start(now);
  osc.stop(now + duration);
}

function sfxJump() {
  playTone({ startFreq: 380, endFreq: 720, duration: 0.12, type: "square", gain: 0.1 });
}
function sfxClear() {
  playTone({ freq: 900, duration: 0.08, type: "sine", gain: 0.06 });
}
function sfxDeath() {
  playTone({ startFreq: 220, endFreq: 60, duration: 0.35, type: "sawtooth", gain: 0.18 });
}

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
const STATE_IDLE = "idle";
const STATE_PLAYING = "playing";
let state = STATE_IDLE;

let tick = 0;
let worldDistance = 0;
let currentScrollSpeed = BASE_SCROLL_SPEED;

const player = { y: GROUND_Y, vy: 0, squashX: 1, squashY: 1 };
let jumpPressRequested = false;
let jumpReleaseRequested = false;

let particles = [];
let shakeTimer = 0;
let shakeMagnitude = 0;

let bestDistance = Number(localStorage.getItem("echoRunner.bestDistance") || 0);

const hudRound = document.getElementById("roundLine");
const hudDistance = document.getElementById("distanceLine");
const overlay = document.getElementById("messageOverlay");
const overlayTitle = document.getElementById("messageTitle");
const overlayBody = document.getElementById("messageBody");

function metersLabel(distanceUnits) {
  return Math.floor(distanceUnits / 20);
}

function updateHud() {
  hudRound.textContent = `${metersLabel(worldDistance)}m`;
  hudDistance.textContent = `Best: ${metersLabel(bestDistance)}m`;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
function requestJumpPress() {
  ensureAudio();
  if (state === STATE_IDLE) {
    startRun();
    return;
  }
  jumpPressRequested = true;
}
function requestJumpRelease() {
  jumpReleaseRequested = true;
}

window.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    if (e.repeat) return;
    requestJumpPress();
  }
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    requestJumpRelease();
  }
});
canvas.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  requestJumpPress();
});
canvas.addEventListener("pointerup", (e) => {
  e.preventDefault();
  requestJumpRelease();
});

// ---------------------------------------------------------------------------
// Juice helpers
// ---------------------------------------------------------------------------
function spawnParticles(x, y, count, color) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 60 + Math.random() * 140;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      life: 0.4 + Math.random() * 0.3,
      maxLife: 0.7,
      color,
    });
  }
}

function triggerShake(magnitude, duration) {
  shakeMagnitude = magnitude;
  shakeTimer = duration;
}

// ---------------------------------------------------------------------------
// Round lifecycle
// ---------------------------------------------------------------------------
function startRun() {
  state = STATE_PLAYING;
  tick = 0;
  worldDistance = 0;
  currentScrollSpeed = BASE_SCROLL_SPEED;
  player.y = GROUND_Y;
  player.vy = 0;
  player.squashX = 1;
  player.squashY = 1;
  jumpPressRequested = false;
  jumpReleaseRequested = false;
  particles = [];
  for (const ob of OBSTACLE_COURSE) ob.cleared = false;
  overlay.classList.add("hidden");
  updateHud();
}

function endRun() {
  state = STATE_IDLE;
  sfxDeath();
  triggerShake(10, 0.3);
  spawnParticles(PLAYER_X, player.y - PLAYER_RADIUS, 18, "255,120,90");

  const survivedDistance = worldDistance;
  const isNewRecord = survivedDistance > bestDistance;
  bestDistance = Math.max(bestDistance, survivedDistance);
  localStorage.setItem("echoRunner.bestDistance", String(bestDistance));

  overlayTitle.textContent = isNewRecord ? "New best!" : "Run over";
  overlayBody.innerHTML = `You reached ${metersLabel(survivedDistance)}m.<br />Best: ${metersLabel(bestDistance)}m.`;
  overlay.classList.remove("hidden");
  updateHud();
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------
function integrate(entity) {
  entity.vy += GRAVITY * FIXED_DT;
  entity.y += entity.vy * FIXED_DT;
  if (entity.y > GROUND_Y) {
    if (entity.vy > 200) {
      // landed with real speed — a satisfying squash
      player.squashX = 1.35;
      player.squashY = 0.7;
    }
    entity.y = GROUND_Y;
    entity.vy = 0;
  }
}

function isGrounded(entity) {
  return entity.y >= GROUND_Y - GROUND_EPSILON;
}

function step() {
  tick += 1;
  currentScrollSpeed = BASE_SCROLL_SPEED + (MAX_SCROLL_SPEED - BASE_SCROLL_SPEED) * Math.min(1, worldDistance / SPEED_RAMP_DISTANCE);
  worldDistance += currentScrollSpeed * FIXED_DT;

  if (jumpPressRequested) {
    if (isGrounded(player)) {
      player.vy = JUMP_VELOCITY;
      player.squashX = 0.7;
      player.squashY = 1.35;
      sfxJump();
      spawnParticles(PLAYER_X, GROUND_Y, 6, "255,255,255");
    }
    jumpPressRequested = false;
  }
  if (jumpReleaseRequested) {
    if (player.vy < 0) player.vy *= JUMP_CUT_MULTIPLIER;
    jumpReleaseRequested = false;
  }
  integrate(player);

  // Squash/stretch relaxes back toward normal each tick.
  player.squashX += (1 - player.squashX) * 0.2;
  player.squashY += (1 - player.squashY) * 0.2;

  // Particles
  for (const p of particles) {
    p.x += p.vx * FIXED_DT;
    p.y += p.vy * FIXED_DT;
    p.vy += GRAVITY * 0.3 * FIXED_DT;
    p.life -= FIXED_DT;
  }
  particles = particles.filter((p) => p.life > 0);

  if (shakeTimer > 0) shakeTimer = Math.max(0, shakeTimer - FIXED_DT);

  // Obstacles: collision + "cleared" pop for satisfaction.
  for (const ob of OBSTACLE_COURSE) {
    const screenX = PLAYER_X + (ob.spawnDistance - worldDistance);
    const halfW = ob.width / 2;

    if (!ob.cleared && screenX < PLAYER_X - halfW - PLAYER_RADIUS) {
      ob.cleared = true;
      sfxClear();
    }

    if (screenX + halfW > PLAYER_X - PLAYER_RADIUS && screenX - halfW < PLAYER_X + PLAYER_RADIUS) {
      const obstacleTopY = GROUND_Y - ob.height;
      if (player.y + PLAYER_RADIUS > obstacleTopY) {
        endRun();
        return;
      }
    }
    if (screenX > PLAYER_X + 40) break;
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function render() {
  ctx.save();
  if (shakeTimer > 0) {
    const s = shakeMagnitude * (shakeTimer / 0.3);
    ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
  }

  const sky = ctx.createLinearGradient(0, 0, 0, LOGICAL_HEIGHT);
  sky.addColorStop(0, "#2b2d5e");
  sky.addColorStop(1, "#4a3f7a");
  ctx.fillStyle = sky;
  ctx.fillRect(-20, -20, LOGICAL_WIDTH + 40, LOGICAL_HEIGHT + 40);

  // Ground with scrolling dashes for a sense of speed.
  ctx.fillStyle = "#12121f";
  ctx.fillRect(-20, GROUND_Y, LOGICAL_WIDTH + 40, LOGICAL_HEIGHT - GROUND_Y + 20);
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 3;
  const dashSpacing = 40;
  const offset = worldDistance % dashSpacing;
  ctx.beginPath();
  for (let x = -offset; x < LOGICAL_WIDTH; x += dashSpacing) {
    ctx.moveTo(x, GROUND_Y + 6);
    ctx.lineTo(x + 18, GROUND_Y + 6);
  }
  ctx.stroke();

  // Obstacles
  ctx.fillStyle = "#ff5d5d";
  for (const ob of OBSTACLE_COURSE) {
    const screenX = PLAYER_X + (ob.spawnDistance - worldDistance);
    if (screenX < -60 || screenX > LOGICAL_WIDTH + 60) continue;
    ctx.fillRect(screenX - ob.width / 2, GROUND_Y - ob.height, ob.width, ob.height);
  }

  // Particles
  for (const p of particles) {
    const alpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = `rgba(${p.color},${alpha})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Player, with squash/stretch
  ctx.save();
  ctx.translate(PLAYER_X, player.y);
  ctx.scale(player.squashX, player.squashY);
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(0, -PLAYER_RADIUS, PLAYER_RADIUS, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Main loop
// ---------------------------------------------------------------------------
let lastTime = performance.now();
let accumulator = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let delta = (now - lastTime) / 1000;
  lastTime = now;
  if (delta > 0.25) delta = 0.25;
  accumulator += delta;

  while (accumulator >= FIXED_DT) {
    if (state === STATE_PLAYING) step();
    accumulator -= FIXED_DT;
  }

  render();
  if (state === STATE_PLAYING) updateHud();
}

updateHud();
requestAnimationFrame(frame);
