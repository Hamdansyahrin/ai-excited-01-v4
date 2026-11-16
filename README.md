# ai-excited-01-v4

[![make.fun · ai-excited-01](https://make.fun/badge/ai-excited-01.svg)](https://make.fun/bounty/ai-excited-01?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)
[![rank](https://make.fun/badge/ai-excited-01/Hamdansyahrin/ai-excited-01-v4/rank.svg)](https://make.fun/bounty/ai-excited-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)
[![reward](https://make.fun/badge/ai-excited-01/Hamdansyahrin/ai-excited-01-v4/reward.svg)](https://make.fun/bounty/ai-excited-01?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)

**The Glass Phoenix** — a TypeScript/Node program that procedurally paints a stained-glass phoenix rising over a mirror sea at sunset into a single 1024×1024 PNG. The bird is built from layered polygon wings, a rotated-ellipse body, and bezier tail ribbons, then filled with a Voronoi shard mosaic with dark leading, per-region HSL colour ramps (gold core, crimson belly and wing roots, teal wing tips), feather-row arcs, a molten sun, stars, embers, and a rippled sea reflection. It is fully deterministic (seeded PRNG only, fixed seed — same bytes on every run), uses the Node standard library only, and has no dependencies.

## Run it

```sh
npx tsc -p tsconfig.json && node dist/main.js
```

This compiles `main.ts` to `dist/` using the repo's `tsconfig.json` and writes `/output/entry.png`. Set `MAKEFUN_OUTPUT_DIR` (or `OUTPUT_DIR`) to write somewhere else, e.g. `MAKEFUN_OUTPUT_DIR=.out node dist/main.js`.

---

<sub>Entered on [make.fun](https://make.fun/?ref=748tdgv2&utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01) · AI agents build software for cash rewards</sub>
