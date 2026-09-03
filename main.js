// Echo Runner — single-button endless runner where you compete against
// replays of your own past runs. See CLAUDE.md for the full design
// rationale (fixed deterministic course, fixed-timestep replay, no ghost
// cap). Single flat file deliberately — small scope, prove it's fun first.

// ---------------------------------------------------------------------------
// Fixed logical resolution — physics/positions are always defined in this
// coordinate space regardless of actual device screen size, then the canvas
// element is scaled (via CSS) to fit the viewport. This keeps game feel and
// (critically) ghost-replay determinism identical across devices.
// ---------------------------------------------------------------------------
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
// Constants (logical units — pixels in the fixed 480x800 space)
// ---------------------------------------------------------------------------
const FIXED_DT = 1 / 60;
const GRAVITY = 1800;
const JUMP_VELOCITY = -650;
const SCROLL_SPEED = 260; // logical units/sec
const GROUND_Y = 620;
const PLAYER_X = 120;
const PLAYER_RADIUS = 16;
const GHOST_RADIUS = 14;
const GROUND_EPSILON = 0.5;
const GHOST_COLLIDE_Y_THRESHOLD = PLAYER_RADIUS + GHOST_RADIUS - 6; // slight forgiveness
// Jump peak is ~117 units above GROUND_Y. Everyone passes briefly through the
// near-ground band on every single jump (launch and landing) — without this
// gate, two completely unrelated jumps coincidentally clipping that band at
// the same tick registers as a "collision" far more often than intended,
// since it's just launch/landing noise, not two jump arcs actually crossing
// in the air. Requiring both to be at least this far off the ground before
// checking proximity filters that noise out.
const GHOST_COLLIDE_MIN_HEIGHT_ABOVE_GROUND = 30;
// Variable jump height (Mario-style "jump cut"): releasing early while still
// rising scales velocity down, producing a shorter hop. Holding through the
// natural peak has no extra effect (already at max height for this press).
// This gives the player a second axis of control beyond WHEN to jump — HOW
// HIGH — so avoiding a ghost doesn't depend entirely on split-second timing.
const JUMP_CUT_MULTIPLIER = 0.45;
const SAFETY_MAX_GHOSTS = 30; // performance safety valve, not a designed difficulty cap — see CLAUDE.md

const MIN_GAP_SECONDS = 1.15;
const MAX_GAP_SECONDS = 2.3;
const OBSTACLE_COUNT = 300; // far more than any real run will reach

// ---------------------------------------------------------------------------
// Deterministic obstacle course — same seed every load, so every run (and
// every ghost replay) sees the identical sequence. mulberry32: small, fast,
// well-known deterministic PRNG.
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
  const rand = mulberry32(20260903); // fixed seed
  const obstacles = [];
  let distance = 700; // first obstacle spawns a bit further out so the opening is fair
  for (let i = 0; i < OBSTACLE_COUNT; i++) {
    const gapSeconds = MIN_GAP_SECONDS + rand() * (MAX_GAP_SECONDS - MIN_GAP_SECONDS);
    distance += gapSeconds * SCROLL_SPEED;
    const width = 26 + Math.floor(rand() * 20);
    const height = 40 + Math.floor(rand() * 40);
    obstacles.push({ spawnDistance: distance, width, height });
  }
  return obstacles;
}
const OBSTACLE_COURSE = buildObstacleCourse();

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
const STATE_IDLE = "idle";
const STATE_PLAYING = "playing";
let state = STATE_IDLE;

let tick = 0;
let worldDistance = 0;

const player = { y: GROUND_Y, vy: 0 };
let currentRunJumpStarts = new Set();
let currentRunJumpReleases = new Set();
let jumpPressRequested = false;
let jumpReleaseRequested = false;

/** @type {{jumpStarts: Set<number>, jumpReleases: Set<number>, deathTick: number, y: number, vy: number, hue: number}[]} */
let ghosts = [];

let bestDistance = Number(localStorage.getItem("echoRunner.bestDistance") || 0);
let bestRound = Number(localStorage.getItem("echoRunner.bestRound") || 1);

const hudRound = document.getElementById("roundLine");
const hudDistance = document.getElementById("distanceLine");
const overlay = document.getElementById("messageOverlay");
const overlayTitle = document.getElementById("messageTitle");
const overlayBody = document.getElementById("messageBody");

function metersLabel(distanceUnits) {
  return Math.floor(distanceUnits / 20); // purely cosmetic scale-down to friendlier numbers
}

function updateHud() {
  hudRound.textContent = `Round ${ghosts.length + 1}`;
  hudDistance.textContent = `Distance: ${metersLabel(worldDistance)}m  ·  Best: ${metersLabel(bestDistance)}m`;
}

function requestJumpPress() {
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
    if (e.repeat) return; // ignore OS key-repeat while held
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
// Round lifecycle
// ---------------------------------------------------------------------------
function startRun() {
  state = STATE_PLAYING;
  tick = 0;
  worldDistance = 0;
  player.y = GROUND_Y;
  player.vy = 0;
  currentRunJumpStarts = new Set();
  currentRunJumpReleases = new Set();
  jumpPressRequested = false;
  jumpReleaseRequested = false;
  for (const g of ghosts) {
    g.y = GROUND_Y;
    g.vy = 0;
  }
  overlay.classList.add("hidden");
  updateHud();
}

let deathReason = "";

function endRun() {
  state = STATE_IDLE;

  const survivedDistance = worldDistance;
  const priorBest = bestDistance; // captured before updating — see isNewRecord below
  const isNewRecord = survivedDistance > priorBest;
  bestDistance = Math.max(bestDistance, survivedDistance);
  bestRound = Math.max(bestRound, ghosts.length + 1);
  localStorage.setItem("echoRunner.bestDistance", String(bestDistance));
  localStorage.setItem("echoRunner.bestRound", String(bestRound));

  // Only add a ghost on a new personal best, not on every death. Ghosts
  // necessarily cluster around wherever you keep dying (everyone who's ever
  // survived had to pass that point too), so adding one on every failed
  // repeat made the earliest obstacle get crowded fastest while later,
  // never-reached parts of the course stayed empty — the opposite of a fair
  // ramp. Gating on "new record" means difficulty only grows once you've
  // actually demonstrated you can handle the current ghost set.
  if (isNewRecord && ghosts.length < SAFETY_MAX_GHOSTS) {
    ghosts.push({
      jumpStarts: currentRunJumpStarts,
      jumpReleases: currentRunJumpReleases,
      deathTick: tick,
      y: GROUND_Y,
      vy: 0,
      hue: (ghosts.length * 47) % 360,
    });
  }

  overlayTitle.textContent = isNewRecord ? `New best! Round ${ghosts.length} complete` : `Try again`;
  const progressLine = isNewRecord
    ? `Now dodge ${ghosts.length} ghost${ghosts.length === 1 ? "" : "s"} of yourself.`
    : `Beat ${metersLabel(priorBest)}m to add a new ghost. Still dodging ${ghosts.length} ghost${ghosts.length === 1 ? "" : "s"}.`;
  overlayBody.innerHTML = `You reached ${metersLabel(survivedDistance)}m.<br />Best: ${metersLabel(bestDistance)}m over ${bestRound} rounds.<br />${progressLine}` +
    `<br /><span style="opacity:0.6;font-size:12px">${deathReason}</span>`;
  overlay.classList.remove("hidden");
  updateHud();
}

// ---------------------------------------------------------------------------
// Fixed-timestep simulation step
// ---------------------------------------------------------------------------
function integrate(entity) {
  entity.vy += GRAVITY * FIXED_DT;
  entity.y += entity.vy * FIXED_DT;
  if (entity.y > GROUND_Y) {
    entity.y = GROUND_Y;
    entity.vy = 0;
  }
}

function isGrounded(entity) {
  return entity.y >= GROUND_Y - GROUND_EPSILON;
}

function applyJumpCutIfRising(entity) {
  if (entity.vy < 0) {
    entity.vy *= JUMP_CUT_MULTIPLIER;
  }
}

function step() {
  tick += 1;
  worldDistance += SCROLL_SPEED * FIXED_DT;

  if (jumpPressRequested) {
    if (isGrounded(player)) {
      player.vy = JUMP_VELOCITY;
      currentRunJumpStarts.add(tick);
    }
    jumpPressRequested = false;
  }
  if (jumpReleaseRequested) {
    applyJumpCutIfRising(player);
    currentRunJumpReleases.add(tick);
    jumpReleaseRequested = false;
  }
  integrate(player);

  for (const g of ghosts) {
    if (tick >= g.deathTick) continue; // this ghost had already died by this point in its run
    if (g.jumpStarts.has(tick) && isGrounded(g)) {
      g.vy = JUMP_VELOCITY;
    }
    if (g.jumpReleases.has(tick)) {
      applyJumpCutIfRising(g);
    }
    integrate(g);
  }

  // Obstacle collision — only obstacles near the player's fixed X matter.
  // OBSTACLE_COURSE is sorted by increasing spawnDistance, so screenX is
  // monotonically increasing as we iterate — the break below is safe once
  // we're past the collision window, and correctly skips already-checked
  // (already-passed) obstacles is not needed since 300 obstacles/tick is
  // cheap regardless.
  for (const ob of OBSTACLE_COURSE) {
    const screenX = PLAYER_X + (ob.spawnDistance - worldDistance);
    const halfW = ob.width / 2;
    if (screenX + halfW > PLAYER_X - PLAYER_RADIUS && screenX - halfW < PLAYER_X + PLAYER_RADIUS) {
      const obstacleTopY = GROUND_Y - ob.height;
      if (player.y + PLAYER_RADIUS > obstacleTopY) {
        deathReason = `Hit obstacle: player.y=${player.y.toFixed(1)} (needed <= ${(obstacleTopY - PLAYER_RADIUS).toFixed(1)}), tick=${tick}, jumpedThisRun=${currentRunJumpStarts.size}`;
        endRun();
        return;
      }
    }
    if (screenX > PLAYER_X + 40) break; // obstacles are in spawn order — nothing further matters yet
  }

  // Ghost collision — same fixed X for everyone ("the lane"), so it's a
  // Y-proximity check, but ONLY while both are airborne. Everyone starts
  // (and spends most of their time) grounded at the same resting height —
  // that's the normal, safe default state, not a collision. Requiring both
  // to be mid-jump means a collision only happens when your jump arc
  // actually crosses a ghost's jump arc in the air, which is also the more
  // interesting rule: avoiding a ghost is about not jumping in the same
  // time-window as it did, not about avoiding the ground.
  for (const g of ghosts) {
    if (tick >= g.deathTick) continue;
    const playerHeight = GROUND_Y - player.y;
    const ghostHeight = GROUND_Y - g.y;
    if (playerHeight < GHOST_COLLIDE_MIN_HEIGHT_ABOVE_GROUND || ghostHeight < GHOST_COLLIDE_MIN_HEIGHT_ABOVE_GROUND) continue;
    if (Math.abs(player.y - g.y) < GHOST_COLLIDE_Y_THRESHOLD) {
      deathReason = `Hit ghost: player.y=${player.y.toFixed(1)}, ghost.y=${g.y.toFixed(1)}, diff=${Math.abs(player.y - g.y).toFixed(1)}, tick=${tick}`;
      endRun();
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function render() {
  // Sky
  const sky = ctx.createLinearGradient(0, 0, 0, LOGICAL_HEIGHT);
  sky.addColorStop(0, "#2b2d5e");
  sky.addColorStop(1, "#4a3f7a");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, LOGICAL_WIDTH, LOGICAL_HEIGHT);

  // Ground
  ctx.fillStyle = "#12121f";
  ctx.fillRect(0, GROUND_Y, LOGICAL_WIDTH, LOGICAL_HEIGHT - GROUND_Y);
  ctx.strokeStyle = "rgba(255,255,255,0.15)";
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y);
  ctx.lineTo(LOGICAL_WIDTH, GROUND_Y);
  ctx.stroke();

  // Obstacles
  ctx.fillStyle = "#ff5d5d";
  for (const ob of OBSTACLE_COURSE) {
    const screenX = PLAYER_X + (ob.spawnDistance - worldDistance);
    if (screenX < -60 || screenX > LOGICAL_WIDTH + 60) continue;
    ctx.fillRect(screenX - ob.width / 2, GROUND_Y - ob.height, ob.width, ob.height);
  }

  // Ghosts — deliberately NOT snapped to ground on death; keep showing each
  // entity's actual last simulated position so a death-frame screenshot is
  // trustworthy for diagnosis instead of misleadingly resetting the pose.
  for (const g of ghosts) {
    if (tick >= g.deathTick && state === STATE_PLAYING) continue;
    ctx.fillStyle = `hsla(${g.hue}, 70%, 65%, 0.45)`;
    ctx.beginPath();
    ctx.arc(PLAYER_X, g.y - GHOST_RADIUS, GHOST_RADIUS, 0, Math.PI * 2);
    ctx.fill();
  }

  // Player — see the ghost-rendering comment above; same reasoning.
  ctx.fillStyle = "#ffffff";
  ctx.beginPath();
  ctx.arc(PLAYER_X, player.y - PLAYER_RADIUS, PLAYER_RADIUS, 0, Math.PI * 2);
  ctx.fill();
}

// ---------------------------------------------------------------------------
// Main loop — fixed timestep accumulator, decoupled from actual frame rate.
// ---------------------------------------------------------------------------
let lastTime = performance.now();
let accumulator = 0;

function frame(now) {
  requestAnimationFrame(frame);
  let delta = (now - lastTime) / 1000;
  lastTime = now;
  if (delta > 0.25) delta = 0.25; // clamp huge gaps (tab switch, etc.)
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
