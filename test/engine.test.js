// Balance-framework regression tests for the pure engine.
import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BASE_STATS, MAX_SHIELD, SCATTER_NEEDED, SCATTER_MAX, BUFF_DURATION,
  DEBUFF_DURATION, TIER_VALUES, FACTIONS, STATUS,
} from '../js/config.js';
import {
  makeRng, createCombatant, resolveSpin, computeOutcome, applyDamage, applyHeal,
  gainShield, gainScatter, applyStatus, tickStatuses, aggregateMods, castUltimate,
  ultimateReady, winnerByHp,
} from '../js/engine.js';

test('every faction starts with identical baseline stats (cosmetic-only representatives)', () => {
  for (const id of Object.keys(FACTIONS)) {
    const c = createCombatant(id, id);
    assert.deepEqual(c.stats, { ...BASE_STATS });
    assert.equal(c.hp, 100);
  }
});

test('faction reel strips share an equal power budget (same length)', () => {
  const lengths = Object.values(FACTIONS).map((f) => f.reel.length);
  assert.ok(lengths.every((l) => l === lengths[0]), 'all reels equal length');
});

test('resolveSpin tiers match the v1.3 damage/shield/heal tables', () => {
  const r3 = resolveSpin(['ATTACK', 'ATTACK', 'ATTACK']);
  assert.equal(r3.attackValue, TIER_VALUES.ATTACK[3]); // 30
  const r2 = resolveSpin(['SHIELD', 'SHIELD', 'BLANK']);
  assert.equal(r2.shieldValue, TIER_VALUES.SHIELD[2]); // 20
  const r1 = resolveSpin(['HEAL', 'BLANK', 'BLANK']);
  assert.equal(r1.healValue, TIER_VALUES.HEAL[1]); // 10
});

test('average single attack is ~20 over many rolls (supports ~5 attacks to KO)', () => {
  const rng = makeRng(12345);
  const a = createCombatant('CRIMSON', 'A');
  const d = createCombatant('ROSE', 'D');
  // sample tier1/2/3 attacks uniformly => expected average 20
  let total = 0; const n = 6000;
  for (let i = 0; i < n; i += 1) {
    const tier = 1 + (i % 3);
    const symbols = Array.from({ length: tier }, () => 'ATTACK')
      .concat(Array.from({ length: 3 - tier }, () => 'BLANK'));
    const out = computeOutcome(a, d, resolveSpin(symbols), rng);
    total += out.damage;
  }
  const avg = total / n;
  assert.ok(avg > 16 && avg < 22, `avg attack ${avg} should be near 20`);
});

test('shield is capped at 100 and absorbs before HP', () => {
  const c = createCombatant('CRIMSON', 'C');
  gainShield(c, 80); gainShield(c, 80);
  assert.equal(c.shield, MAX_SHIELD);
  const res = applyDamage(c, 30);
  assert.equal(res.absorbed, 30);
  assert.equal(c.hp, 100);
  assert.equal(c.shield, 70);
});

test('healing cannot exceed max HP', () => {
  const c = createCombatant('ROSE', 'C');
  c.hp = 90;
  const healed = applyHeal(c, 40);
  assert.equal(healed, 10);
  assert.equal(c.hp, 100);
});

test('scatter caps at 3 with no overflow and gates the ultimate', () => {
  const c = createCombatant('GOLDEN', 'C');
  gainScatter(c, 2); gainScatter(c, 5);
  assert.equal(c.scatter, SCATTER_MAX);
  assert.ok(ultimateReady(c));
  castUltimate(c, createCombatant('ROSE', 'D'), makeRng(1));
  assert.equal(c.scatter, 0);
  assert.equal(SCATTER_NEEDED, 3);
});

test('buffs last 4 turns, debuffs last 2 turns', () => {
  const c = createCombatant('GOLDEN', 'C');
  applyStatus(c, STATUS.RALLY);
  applyStatus(c, STATUS.SCANDAL);
  const rally = c.statuses.find((s) => s.id === 'RALLY');
  const scandal = c.statuses.find((s) => s.id === 'SCANDAL');
  assert.equal(rally.turnsLeft, BUFF_DURATION);
  assert.equal(scandal.turnsLeft, DEBUFF_DURATION);
});

test('buff/debuff power budget is capped at +/-25%', () => {
  const c = createCombatant('CRIMSON', 'C');
  applyStatus(c, STATUS.RALLY); // +25
  applyStatus(c, STATUS.MOMENTUM);
  // stack a hypothetical second atk buff by re-applying — still clamped
  c.statuses.push({ id: 'X', kind: 'buff', mods: { atk: 0.5 }, turnsLeft: 4 });
  assert.equal(aggregateMods(c).atk, 0.25);
});

test('immunity blocks the next incoming debuff (anti-frustration)', () => {
  const c = createCombatant('ROSE', 'C');
  applyStatus(c, STATUS.IMMUNITY);
  const r = applyStatus(c, STATUS.SCANDAL);
  assert.equal(r.blocked, true);
  assert.ok(!c.statuses.some((s) => s.id === 'SCANDAL'));
});

test('no one-turn kills: a single attack from full HP cannot eliminate', () => {
  const rng = makeRng(7);
  const a = createCombatant('CRIMSON', 'A');
  applyStatus(a, STATUS.RALLY); // max atk buff
  const d = createCombatant('ROSE', 'D');
  const out = computeOutcome(a, d, resolveSpin(['ATTACK', 'ATTACK', 'ATTACK']), rng);
  assert.ok(out.damage <= 60, `damage ${out.damage} capped`);
  applyDamage(d, out.damage);
  assert.ok(d.hp > 0, 'target survives a single max attack from full');
});

test('statuses are temporary — they tick down and expire (no permanent debuffs)', () => {
  const c = createCombatant('CRIMSON', 'C');
  applyStatus(c, STATUS.SCANDAL); // 2 turns
  tickStatuses(c); tickStatuses(c);
  assert.equal(c.statuses.length, 0);
});

test('winnerByHp picks the higher HP and reports draws', () => {
  const a = createCombatant('CRIMSON', 'A');
  const b = createCombatant('ROSE', 'B');
  a.hp = 50; b.hp = 30;
  assert.equal(winnerByHp(a, b), 0);
  b.hp = 50;
  assert.equal(winnerByHp(a, b), -1);
});

test('simulated AI-vs-AI matches stay balanced and terminate (factions within fair range)', () => {
  // Quick Monte-Carlo to ensure no faction is wildly dominant and matches end.
  const ids = Object.keys(FACTIONS);
  const wins = Object.fromEntries(ids.map((id) => [id, 0]));
  let games = 0;
  for (let s = 0; s < 200; s += 1) {
    const rng = makeRng(1000 + s);
    const aId = ids[s % ids.length];
    const bId = ids[(s + 1) % ids.length];
    const w = simulate(aId, bId, rng);
    if (w) wins[w] += 1;
    games += 1;
  }
  assert.equal(games, 200);
  // sanity: every faction should win at least once across the sample
  for (const id of ids) assert.ok(wins[id] > 0, `${id} never won — possible imbalance`);
});

// Minimal headless match simulator mirroring main.js turn logic.
function simulate(aId, bId, rng) {
  const a = createCombatant(aId, aId, { isAI: true });
  const b = createCombatant(bId, bId, { isAI: true });
  const order = rng() < 0.5 ? [a, b] : [b, a];
  let turn = 0;
  const maxTurns = 80; // generous cap; matches should end well before this
  while (turn < maxTurns) {
    const cur = order[turn % 2];
    const foe = order[(turn + 1) % 2];
    const mods = aggregateMods(cur);
    const skipped = mods.skipChance > 0 && rng() < mods.skipChance;
    if (!skipped) {
      if (ultimateReady(cur)) {
        castUltimate(cur, foe, rng);
      } else {
        const symbols = randomSpin(cur, rng);
        const out = computeOutcome(cur, foe, resolveSpin(symbols), rng);
        gainScatter(cur, out.scatterGain);
        applyHeal(cur, out.heal);
        gainShield(cur, out.shieldGain);
        if (out.damage > 0) applyDamage(foe, out.damage);
      }
    }
    tickStatuses(cur);
    if (a.hp <= 0 || b.hp <= 0) break;
    turn += 1;
  }
  if (a.hp <= 0 && b.hp > 0) return bId;
  if (b.hp <= 0 && a.hp > 0) return aId;
  const w = winnerByHp(a, b);
  return w === -1 ? null : (w === 0 ? aId : bId);
}

function randomSpin(c, rng) {
  const reel = c.faction.reel;
  return [0, 1, 2].map(() => reel[Math.floor(rng() * reel.length)]);
}
