# Echo Runner

A small original arcade game: single-button endless runner where you compete
against replays of your own past runs. Built after a rough day on a separate
3D cricket project ([[cricket-game]] at `G:\cricket-game`) — deliberately
small in scope, 2D only, no external 3D assets, to actually ship something.

## The mechanic

- Single lane, single input (tap/click/Space = jump). Auto-runs forward.
- Obstacles scroll toward the player on a **fixed, deterministic course** —
  same every run, not randomized per-attempt (this matters, see below).
- On death (hit an obstacle, or hit one of your own ghosts), that run's exact
  jump-input timing is saved as a new **ghost**, and the game restarts from
  the beginning of the same course — now with every previous ghost replaying
  alongside you in real time.
- Score = how many ghosts you've accumulated (i.e., how many rounds
  survived) and/or distance reached on the current attempt.

### Why a fixed course, not random obstacles

Since the course is identical every round, a ghost that once found a
successful path through it will keep succeeding forever if replayed exactly.
That means simply repeating your own previous winning input pattern would
land you exactly on top of every ghost (since they took the same input at
the same tick and got the same result) — a guaranteed collision. The actual
skill is being forced to find a **new** timing pattern each round that still
clears the (unchanging) obstacles while also avoiding the specific timing of
every past ghost. Difficulty escalates from the player's own accumulated
history, not from hand-authored levels — this is what keeps scope small
(no level design needed) while still having a real difficulty curve.

### Determinism requirements

This only works if simulation is exactly reproducible:
- Fixed timestep physics (accumulator pattern), not variable per-frame dt —
  ghosts are replayed by re-simulating recorded jump-tick events against the
  same physics, not by storing raw position data.
- Obstacle course generated once from a fixed seed (or hardcoded), identical
  every load/round within a session.
- All runners (player + every ghost) share the same fixed on-screen X
  ("the lane") — only Y (jump height) varies per tick. Obstacles are what
  scroll through X toward that fixed point. This means ghost-vs-player
  collision is just "same tick, Y positions too close," not full 2D physics.

### Ghost cap

No hard difficulty cap (e.g., not fixed at 3) — accumulating ghosts *is* the
progression system, so artificially capping it would flatten the difficulty
curve. A soft safety valve (~20-30 ghosts) exists only to protect rendering
performance on a phone, not as a designed difficulty ceiling; a real player
is very unlikely to ever reach it.

## Scope

Start single-lane (one jump input, one Y-axis). Multi-lane (Subway-Surfers-
style left/right movement) is a possible later addition, not needed for a
first playable/shippable version — explicitly deferred, not designed around
yet.

## Platform target

Built as a plain web app (HTML/CSS/JS, no build step — same low-friction
approach that worked well once we dropped Unity on the cricket project) so
it can be wrapped with **Capacitor** for both Android and iOS from one
codebase. Android is the nearer-term target (buildable entirely from
Windows); iOS needs a Mac or a cloud Mac build service, and an Apple
Developer account ($99/yr) vs Google Play's one-time $25 fee — deferred
until there's a working, fun game.

## Status

2026-09-03: Design finalized, implementation starting.
