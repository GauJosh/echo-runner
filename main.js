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
// Standing height (GROUND_Y - PLAYER_RADIUS = 604). Ducking overrides the
// player's effective top to this much lower value — always safely under any
// overhead clearance, whereas standing (604) is always above it (unsafe).
// That's what makes ducking a real, necessary action instead of the default.
// Kept close to GROUND_Y (not far below it) specifically so the "lying
// flat" duck pose can be drawn at a matching height — the previous value
// (626, well below ground) had no visual pose that could honestly match it,
// which was the actual bug: the drawing didn't look low enough to justify
// how safe the hitbox claimed to be.
const DUCK_EFFECTIVE_TOP = GROUND_Y - 2;

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

// Stages — every 100m (2000 world units) is a "stage," announced with a
// toast. First few stages unlock a new obstacle type; later ones are just a
// celebration beat, since difficulty keeps ramping via speed regardless.
// This is the "procedural milestone" approach to a sense of progress
// without hand-authoring levels (see CLAUDE.md).
const STAGE_DISTANCE_STEP = 2000; // 100m

// Max jump clears ~101 units (v²/2g + radius margin) — ground obstacle
// heights stay well under that so every one is always physically clearable.
const OVERHEAD_INTRO_DISTANCE = STAGE_DISTANCE_STEP * 1; // 100m
const OVERHEAD_CHANCE = 0.35;
// Standing top is a fixed 604 (GROUND_Y - PLAYER_RADIUS). Clearance is kept
// in a range where GROUND_Y - clearance always lands a bit ABOVE 604, so
// standing always collides and only ducking (top -> DUCK_EFFECTIVE_TOP=626)
// clears it. The first version used 20-30, which put the clearance line
// below 604 — standing was already safe, so ducking had nothing to do.
const OVERHEAD_CLEARANCE_MIN = 6;
const OVERHEAD_CLEARANCE_MAX = 14;

const FLYING_INTRO_DISTANCE = STAGE_DISTANCE_STEP * 2; // 200m
const MIXED_STAGE = 4; // stage 4 (300m+) is the "everything together" flavor beat
const FLYING_CHANCE = 0.4; // of eligible (non-overhead) obstacles past the intro distance

// Flying obstacles get a compact hitbox matching their actual (small) visual
// size, not the full ground/overhead box they're tagged with — using the
// full box caused invisible collisions well above/below the visible bird.
// Shrunk further after still feeling too generous even after the first fix.
// They also gain extra closing speed once on screen, so they read as
// darting toward the player rather than drifting in with the scenery.
const BIRD_HITBOX_HALF_HEIGHT = 11;
const FLYING_EXTRA_SPEED = 90;

function birdCenterY(ob) {
  return ob.type === "overhead" ? GROUND_Y - ob.clearance - 10 : GROUND_Y - ob.height / 2;
}

function obstacleScreenX(ob) {
  const baseScreenX = PLAYER_X + (ob.spawnDistance - worldDistance);
  return ob.flying ? baseScreenX - ob.extraApproach : baseScreenX;
}

function stageForDistance(distance) {
  return Math.floor(distance / STAGE_DISTANCE_STEP) + 1;
}

function stageMessage(stageNum) {
  if (stageNum === 2) return "Stage 2 — duck! Obstacles overhead now";
  if (stageNum === 3) return "Stage 3 — incoming flyers!";
  if (stageNum === MIXED_STAGE) return "Stage 4 — everything, all at once";
  return `Stage ${stageNum}`;
}

function buildObstacleCourse(seed) {
  const rand = mulberry32(seed);
  const obstacles = [];
  let distance = 700;
  for (let i = 0; i < OBSTACLE_COUNT; i++) {
    distance += MIN_GAP_DIST + rand() * (MAX_GAP_DIST - MIN_GAP_DIST);
    const width = 26 + Math.floor(rand() * 20);

    if (distance > OVERHEAD_INTRO_DISTANCE && rand() < OVERHEAD_CHANCE) {
      const clearance = OVERHEAD_CLEARANCE_MIN + rand() * (OVERHEAD_CLEARANCE_MAX - OVERHEAD_CLEARANCE_MIN);
      const flying = distance > FLYING_INTRO_DISTANCE && rand() < FLYING_CHANCE;
      obstacles.push({ spawnDistance: distance, width, type: "overhead", clearance, flying, extraApproach: 0, cleared: false });
    } else {
      // Randomized per obstacle, and the whole course is reseeded fresh each
      // run (see startRun) — never the same layout twice, always within a
      // height range that stays comfortably clearable.
      const height = 40 + Math.floor(rand() * 40);
      const flying = distance > FLYING_INTRO_DISTANCE && rand() < FLYING_CHANCE;
      obstacles.push({ spawnDistance: distance, width, type: "ground", height, flying, extraApproach: 0, cleared: false });
    }
  }
  return obstacles;
}
let OBSTACLE_COURSE = buildObstacleCourse(Date.now());

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
let isDucking = false;

// Effective collision top: DUCK_EFFECTIVE_TOP while ducking-and-grounded
// (ducking mid-air isn't meaningful), otherwise the normal head height.
// Only overhead-type hazards care about this — ground obstacles/birds you
// jump over still use the normal bottom (see playerBottomY).
function playerTopY() {
  return isDucking && isGrounded(player) ? DUCK_EFFECTIVE_TOP : player.y - PLAYER_RADIUS;
}
function playerBottomY() {
  return player.y + PLAYER_RADIUS;
}

let particles = [];
let shakeTimer = 0;
let shakeMagnitude = 0;

let lastAnnouncedStage = 1; // stage 1 is the start; nothing to announce for it
let milestoneToastText = "";
let milestoneToastTimer = 0;

let bestDistance = Number(localStorage.getItem("echoRunner.bestDistance") || 0);

const hudRound = document.getElementById("roundLine");
const hudDistance = document.getElementById("distanceLine");
const overlay = document.getElementById("messageOverlay");
const overlayTitle = document.getElementById("messageTitle");
const overlayBody = document.getElementById("messageBody");
const milestoneToastEl = document.getElementById("milestoneToast");

function updateMilestoneToast() {
  if (milestoneToastTimer > 0) {
    milestoneToastEl.textContent = milestoneToastText;
    milestoneToastEl.style.opacity = "1";
  } else {
    milestoneToastEl.style.opacity = "0";
  }
}

function metersLabel(distanceUnits) {
  return Math.floor(distanceUnits / 20);
}

function updateHud() {
  hudRound.textContent = `${metersLabel(worldDistance)}m  ·  Stage ${stageForDistance(worldDistance)}`;
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

const DUCK_KEYS = new Set(["ArrowDown", "ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight"]);

window.addEventListener("keydown", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    if (e.repeat) return;
    requestJumpPress();
  } else if (DUCK_KEYS.has(e.code)) {
    e.preventDefault();
    isDucking = true;
  }
});
window.addEventListener("keyup", (e) => {
  if (e.code === "Space") {
    e.preventDefault();
    requestJumpRelease();
  } else if (DUCK_KEYS.has(e.code)) {
    e.preventDefault();
    isDucking = false;
  }
});
// Touch/mouse split: upper ~55% of the screen = jump, lower = duck. Keyboard
// (Space / ArrowDown / Ctrl / Shift) works independently and simultaneously
// — this only covers the touch case, which had no duck input at all before.
let activeTouchZone = null; // 'jump' | 'duck' | null, tracks what this pointer press started as

function touchZoneForEvent(e) {
  const rect = canvas.getBoundingClientRect();
  const fracY = (e.clientY - rect.top) / rect.height;
  return fracY < 0.55 ? "jump" : "duck";
}

canvas.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  if (state === STATE_IDLE) {
    requestJumpPress(); // tap anywhere starts the run
    return;
  }
  activeTouchZone = touchZoneForEvent(e);
  if (activeTouchZone === "duck") {
    isDucking = true;
  } else {
    requestJumpPress();
  }
});
canvas.addEventListener("pointerup", (e) => {
  e.preventDefault();
  if (activeTouchZone === "duck") {
    isDucking = false;
  } else {
    requestJumpRelease();
  }
  activeTouchZone = null;
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
  lastAnnouncedStage = 1;
  milestoneToastText = "";
  milestoneToastTimer = 0;
  OBSTACLE_COURSE = buildObstacleCourse(Date.now()); // fresh layout every run
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

  const stageNow = stageForDistance(worldDistance);
  if (stageNow > lastAnnouncedStage) {
    lastAnnouncedStage = stageNow;
    milestoneToastText = stageMessage(stageNow);
    milestoneToastTimer = 2.5;
  }
  if (milestoneToastTimer > 0) milestoneToastTimer = Math.max(0, milestoneToastTimer - FIXED_DT);

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

  // Squash/stretch relaxes back toward normal each tick — except while
  // actually ducking (grounded), where it eases toward a crouched pose
  // instead, so the visual clearly communicates the lowered hitbox.
  const duckingNow = isDucking && isGrounded(player);
  const targetSquashX = duckingNow ? 1.4 : 1;
  const targetSquashY = duckingNow ? 0.45 : 1;
  player.squashX += (targetSquashX - player.squashX) * 0.3;
  player.squashY += (targetSquashY - player.squashY) * 0.3;

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
    if (ob.flying && ob.spawnDistance - worldDistance < LOGICAL_WIDTH + 60) {
      ob.extraApproach += FLYING_EXTRA_SPEED * FIXED_DT;
    }
    const screenX = obstacleScreenX(ob);
    const halfW = ob.width / 2;

    if (!ob.cleared && screenX < PLAYER_X - halfW - PLAYER_RADIUS) {
      ob.cleared = true;
      sfxClear();
    }

    if (screenX + halfW > PLAYER_X - PLAYER_RADIUS && screenX - halfW < PLAYER_X + PLAYER_RADIUS) {
      if (ob.flying) {
        // Compact band matching the actual bird graphic, using the same
        // duck-aware top as everything else — ducking can save you from a
        // low bird, jumping (or already being airborne) can clear a high one.
        const centerY = birdCenterY(ob);
        if (playerBottomY() > centerY - BIRD_HITBOX_HALF_HEIGHT && playerTopY() < centerY + BIRD_HITBOX_HALF_HEIGHT) {
          endRun();
          return;
        }
      } else if (ob.type === "overhead") {
        // Hangs from the top down to a low clearance — colliding means the
        // player's effective top (head, or DUCK_EFFECTIVE_TOP if ducking)
        // rose too high. Standing alone is never enough clearance now —
        // ducking is a real, required action.
        const obstacleBottomY = GROUND_Y - ob.clearance;
        if (playerTopY() < obstacleBottomY) {
          endRun();
          return;
        }
      } else {
        const obstacleTopY = GROUND_Y - ob.height;
        if (playerBottomY() > obstacleTopY) {
          endRun();
          return;
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function drawBird(x, centerY, span) {
  const bob = Math.sin(tick * 0.25 + x * 0.05) * 4;
  const y = centerY + bob;
  const wingSpread = Math.sin(tick * 0.4 + x * 0.05) * (span * 0.3) + span * 0.35;
  ctx.fillStyle = "#ffcc4d";
  ctx.beginPath();
  ctx.ellipse(x, y, span * 0.28, span * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x - wingSpread, y - 4);
  ctx.lineTo(x, y - 10);
  ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x + wingSpread, y - 4);
  ctx.lineTo(x, y - 10);
  ctx.lineTo(x, y);
  ctx.closePath();
  ctx.fill();
}

// Sky/hill palette shifts per stage — a cheap, purely cosmetic way to make
// stage progress *feel* like it's going somewhere, not just a number ticking.
const STAGE_THEMES = [
  { sky: ["#2b2d5e", "#4a3f7a"], farHill: "#241f47", nearHill: "#332a5c" },
  { sky: ["#1f3a5f", "#3f6b9e"], farHill: "#1a2d4a", nearHill: "#26426b" },
  { sky: ["#2f1f4f", "#6b3f8a"], farHill: "#241a3d", nearHill: "#3a2860" },
  { sky: ["#1a1a3a", "#4a2f6f"], farHill: "#14142c", nearHill: "#241f47" },
];
function themeForStage(stage) {
  return STAGE_THEMES[Math.min(stage - 1, STAGE_THEMES.length - 1)];
}

function drawHillLayer(baseY, amplitude, wavelength, parallaxFactor, color) {
  const scrollOffset = worldDistance * parallaxFactor;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-20, LOGICAL_HEIGHT + 20);
  for (let x = -20; x <= LOGICAL_WIDTH + 20; x += 24) {
    const phase = (x + scrollOffset) * ((Math.PI * 2) / wavelength);
    const y = baseY - Math.sin(phase) * amplitude - Math.sin(phase * 0.37) * amplitude * 0.4;
    ctx.lineTo(x, y);
  }
  ctx.lineTo(LOGICAL_WIDTH + 20, LOGICAL_HEIGHT + 20);
  ctx.closePath();
  ctx.fill();
}

function drawGroundObstacle(x, w, h) {
  const top = GROUND_Y - h;
  const grad = ctx.createLinearGradient(0, top, 0, GROUND_Y);
  grad.addColorStop(0, "#ff8a7a");
  grad.addColorStop(1, "#d43f3f");
  ctx.fillStyle = grad;
  ctx.fillRect(x - w / 2, top, w, h);
  ctx.strokeStyle = "rgba(0,0,0,0.25)";
  ctx.lineWidth = 2;
  ctx.strokeRect(x - w / 2, top, w, h);
  // Hazard stripes
  ctx.save();
  ctx.beginPath();
  ctx.rect(x - w / 2, top, w, h);
  ctx.clip();
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 4;
  for (let sx = x - w / 2 - h; sx < x + w / 2 + h; sx += 14) {
    ctx.beginPath();
    ctx.moveTo(sx, top);
    ctx.lineTo(sx + h, GROUND_Y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawOverheadObstacle(x, w, bottomY) {
  const grad = ctx.createLinearGradient(0, -20, 0, bottomY);
  grad.addColorStop(0, "#2f9fc9");
  grad.addColorStop(1, "#7de6ff");
  ctx.fillStyle = grad;
  ctx.fillRect(x - w / 2, -20, w, bottomY + 20);
  // Jagged "icicle" bottom edge instead of a flat line, reads as hanging.
  ctx.beginPath();
  ctx.moveTo(x - w / 2, bottomY);
  const teeth = Math.max(2, Math.floor(w / 12));
  for (let i = 0; i <= teeth; i++) {
    const tx = x - w / 2 + (w / teeth) * i;
    const ty = i % 2 === 0 ? bottomY + 8 : bottomY;
    ctx.lineTo(tx, ty);
  }
  ctx.lineTo(x + w / 2, -20);
  ctx.lineTo(x - w / 2, -20);
  ctx.closePath();
  ctx.fill();
}

function drawPlayer() {
  const grounded = isGrounded(player);
  const ducking = isDucking && grounded;

  ctx.save();
  ctx.translate(PLAYER_X, player.y);

  if (ducking) {
    // Genuinely lying flat, drawn at fixed low coordinates rather than the
    // generic squash scale — its highest point (~world GROUND_Y-10) is
    // deliberately close to DUCK_EFFECTIVE_TOP, so what's drawn actually
    // matches what the collision check treats as safe. The previous version
    // just scaled the standing pose down a bit, which never got low enough
    // to visually justify clearing a low-hanging obstacle.
    ctx.fillStyle = "#ffffff";
    ctx.beginPath();
    ctx.ellipse(-2, -5, 22, 5, 0, 0, Math.PI * 2); // prone body, low and flat
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-21, -7, 5, 0, Math.PI * 2); // head, forward and low
    ctx.fill();
    ctx.strokeStyle = "#c9c9d9";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(16, -3);
    ctx.lineTo(25, 1); // trailing legs, flat
    ctx.stroke();
    ctx.restore();
    return;
  }

  ctx.scale(player.squashX, player.squashY);

  // Legs — running swing on the ground, tucked while airborne.
  ctx.strokeStyle = "#c9c9d9";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  if (!grounded) {
    ctx.moveTo(-4, -6);
    ctx.lineTo(-10, 6);
    ctx.moveTo(4, -6);
    ctx.lineTo(10, 6);
  } else {
    const swing = Math.sin(tick * 0.55) * 10;
    ctx.moveTo(-3, -8);
    ctx.lineTo(-3 + swing, 4);
    ctx.moveTo(3, -8);
    ctx.lineTo(3 - swing, 4);
  }
  ctx.stroke();

  // Torso + head
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.ellipse(0, -PLAYER_RADIUS - 2, PLAYER_RADIUS * 0.7, PLAYER_RADIUS * 0.85, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, -PLAYER_RADIUS * 2, PLAYER_RADIUS * 0.55, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

function render() {
  ctx.save();
  if (shakeTimer > 0) {
    const s = shakeMagnitude * (shakeTimer / 0.3);
    ctx.translate((Math.random() - 0.5) * s, (Math.random() - 0.5) * s);
  }

  const theme = themeForStage(stageForDistance(worldDistance));

  const sky = ctx.createLinearGradient(0, 0, 0, LOGICAL_HEIGHT);
  sky.addColorStop(0, theme.sky[0]);
  sky.addColorStop(1, theme.sky[1]);
  ctx.fillStyle = sky;
  ctx.fillRect(-20, -20, LOGICAL_WIDTH + 40, LOGICAL_HEIGHT + 40);

  // Parallax hills — far layer scrolls slowly, near layer faster, both well
  // behind the play area so they never compete with obstacle readability.
  drawHillLayer(GROUND_Y - 90, 26, 260, 0.015, theme.farHill);
  drawHillLayer(GROUND_Y - 40, 18, 160, 0.05, theme.nearHill);

  // Ground with scrolling dashes for a sense of speed.
  const groundGrad = ctx.createLinearGradient(0, GROUND_Y, 0, LOGICAL_HEIGHT);
  groundGrad.addColorStop(0, "#17162a");
  groundGrad.addColorStop(1, "#0a0a14");
  ctx.fillStyle = groundGrad;
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

  // Obstacles — ground (red, jump over) vs overhead (cyan, stay under),
  // deliberately different colors so the two opposite rules are instantly
  // readable, not just inferable from position. "Flying" variants use the
  // exact same hitbox/rule as their type, just drawn as a bobbing bird
  // (amber) instead of a static block — new presentation, same mechanic.
  for (const ob of OBSTACLE_COURSE) {
    const screenX = obstacleScreenX(ob); // must match the hitbox calculation exactly
    if (screenX < -60 || screenX > LOGICAL_WIDTH + 60) continue;

    if (ob.flying) {
      drawBird(screenX, birdCenterY(ob), ob.width);
    } else if (ob.type === "overhead") {
      drawOverheadObstacle(screenX, ob.width, GROUND_Y - ob.clearance);
    } else {
      drawGroundObstacle(screenX, ob.width, ob.height);
    }
  }

  // Particles
  for (const p of particles) {
    const alpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = `rgba(${p.color},${alpha})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  drawPlayer();

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
  if (state === STATE_PLAYING) {
    updateHud();
    updateMilestoneToast();
  }
}

updateHud();
requestAnimationFrame(frame);
