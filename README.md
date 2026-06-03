# Political Slot Battle RPG

A browser-based, turn-based slot-machine battler. Spin the reels to generate
**Attack / Shield / Heal / Scatter** symbols, hold-and-reroll to steer your luck,
build **Scatter** to charge a faction **Ultimate**, and out-maneuver a rival
faction. Built as a faithful implementation of the **v1.3 Balance Framework**.

> Design target: **60% strategy, 40% luck.** The slot machine creates
> opportunities; your decisions determine outcomes.

## Play

No build step. Serve the folder and open it in a browser:

```bash
npm start          # python3 -m http.server 8000
# then open http://localhost:8000
```

(Use a server rather than `file://` so the ES modules load.)

## How it plays

1. **Pick a faction.** Representatives are cosmetic — every fighter starts with
   the same stats (HP 100 / ATK 20 / DEF 10 / SPD 10 / LUCK 10). Power comes only
   from each faction's **reel modifications** (equal power budget).
2. **Spin** the three reels on your turn. Matching symbols scale up:
   1-of-a-kind / 2 / 3 → e.g. ATK 10 / 20 / 30.
3. **Hold & Re-roll** any reels once (Balimbing gets an extra re-roll) — this is
   the core strategy lever.
4. **Resolve** to apply Attack (damage after DEF + crit), Shield (caps at 100,
   absorbs before HP), Heal (can't exceed max HP), and Scatter.
5. **Charge the Ultimate.** Collect **3 Scatter** (no overflow) to unleash your
   faction ultimate instead of a normal turn.
6. **Win** by eliminating the rival, or by holding the higher HP when the
   **match timer** (5:00) expires.

## Factions

| Faction | Reel bias | Ultimate |
| --- | --- | --- |
| Crimson Alliance | + Attack symbols | **Smear Campaign** — heavy strike + Scandal (−25% ATK) |
| Rose Reform League | + Heal symbols | **Welfare Surge** — big heal + Endorsement (+25% shield gain) |
| Golden Legacy Movement | + Scatter symbols | **Dynasty Decree** — Rally (+25% ATK) + Momentum |
| Balimbing Alliance | controlled re-rolls | **Backroom Deal** — strike + Silence + Investigation |

## Balance rules (v1.3)

- **Status durations:** buffs last 4 turns, debuffs 2 turns.
- **Power budget:** buffs/debuffs capped at ±25% (ATK/DEF/LUCK).
- **Anti-frustration:** no permanent debuffs/stuns, no infinite shield loops,
  no one-turn kills (single-turn damage is capped), no unavoidable defeats.
- **Fair AI:** the AI uses the same reel probabilities, buffs, debuffs and
  cooldowns — no hidden bonuses.

## Project layout

```
index.html          # markup + screens
css/styles.css      # styling
js/config.js        # all balance constants, symbols, factions, statuses
js/engine.js        # pure game logic (no DOM) — shared by browser + tests
js/main.js          # DOM controller + turn flow
test/engine.test.js # balance regression suite (node --test)
```

## Tests

The engine is pure and runs in Node, so the balance framework is enforced by an
automated suite (stat baselines, tier tables, caps, status durations,
anti-frustration guarantees, and a Monte-Carlo balance check):

```bash
npm test           # node --test
```

CI runs the same suite on every push / PR.
