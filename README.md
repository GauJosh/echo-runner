# 🏃 Echo Runner

**One button. Two rules. No mercy.**

Jump over what's in front of you. Duck under what's above you. The course
never repeats the same way twice, and it only gets faster the longer you
survive.

### 🎮 [**Play it now →**](https://gaujosh.github.io/echo-runner/)

No download, no install, no App Store, no $99/year — just a link.

---

## How to play

| Action | Keyboard | Touch |
|---|---|---|
| Jump (hold for higher) | `SPACE` | **▲** button |
| Duck | `↓` / `Ctrl` / `Shift` | **▼** button |

That's it. That's the whole control scheme. Everything else is you versus
the course.

## What you're actually up against

- 🧱 **Ground obstacles** — jump 'em.
- 🚧 **Overhead obstacles** — duck 'em. Standing still isn't enough; you
  have to actually get low.
- 🐦 **Birds** — same two rules, dressed up as a small, fast, angry animal
  that's closing in on you.
- ⏩ **Speed** — climbs the whole run. There's no safe plateau.
- 🎲 **A fresh course every run** — heights, gaps, and layout are randomized
  each time (always within a range that's honestly clearable — the game
  won't ask you to jump higher than physics allows).
- 🏁 **Stages** — every 100m is announced. The first three introduce new
  rules; everything after that is just a victory lap you have to earn.

## Why it looks the way it looks

Every visual in this game — the runner, the birds, the parallax hills, the
gradient obstacles — is drawn with `<canvas>` code. Zero image files, zero
external assets. That was a deliberate choice: it keeps the whole game
fast to iterate on and easy to run anywhere, with no asset pipeline to
maintain.

## Running it locally

There's no build step. Pick one:

```bash
# Just open it
open index.html        # or double-click it

# Or serve it (needed if you extend the game to load external assets later)
node serve.js           # → http://localhost:8080
```

Requires nothing but a browser (and Node, only for the optional local
server). No `npm install`, no bundler, no framework.

## Tech notes

- Plain HTML/CSS/JS, single file (`main.js`) for the whole game
- Fixed-timestep simulation (`requestAnimationFrame` + an accumulator), so
  physics stay consistent regardless of your device's frame rate
- Deterministic seeded obstacle generation (`mulberry32`), reseeded fresh
  each run
- Sound effects are synthesized on the fly via the Web Audio API — no audio
  files either
- Deployed automatically to GitHub Pages on every push to `main` (see
  `.github/workflows/`)

## Project history

This game exists because an earlier, much more ambitious 3D cricket project
taught a good lesson the hard way: prove a small thing is actually fun
*before* building it out further. The full story — including a mechanic
(ghost replays of your own past runs) that got built, tested, and cut
because it wasn't fun even when it worked correctly — is in
[`CLAUDE.md`](./CLAUDE.md).

---

*How far can you get?*
