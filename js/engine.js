// Political Slot Battle RPG — pure game engine (no DOM).
// Importable in both the browser and Node (for the balance test-suite).

import {
  BASE_STATS, BUFF_DURATION, DEBUFF_DURATION, MAX_SHIELD, SCATTER_NEEDED,
  SCATTER_MAX, BASE_REROLLS, SYMBOL, TIER_VALUES, STATUS, FACTIONS,
} from './config.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Deterministic RNG (mulberry32) so tests + replays are reproducible.
export function makeRng(seed) {
  let a = seed >>> 0;
  return function rng() {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createCombatant(factionId, name, { isAI = false } = {}) {
  const faction = FACTIONS[factionId];
  if (!faction) throw new Error(`Unknown faction: ${factionId}`);
  return {
    name,
    isAI,
    factionId,
    faction,
    hp: BASE_STATS.hp,
    maxHp: BASE_STATS.hp,
    shield: 0,
    scatter: 0,
    stats: { ...BASE_STATS },
    statuses: [], // [{ id, kind, turnsLeft, mods, label, icon }]
    rerolls: BASE_REROLLS + faction.extraRerolls,
  };
}

export function ultimateReady(c) {
  return c.scatter >= SCATTER_NEEDED && !hasFlag(c, 'noUltimate');
}

// --- Status helpers -------------------------------------------------------

function hasFlag(c, flag) {
  return c.statuses.some((s) => s.mods && s.mods[flag]);
}

export function aggregateMods(c) {
  let atk = 0; let shieldGain = 0; let skipChance = 0;
  let noShield = false; let noUltimate = false; let momentum = false; let immune = false;
  for (const s of c.statuses) {
    const m = s.mods || {};
    if (typeof m.atk === 'number') atk += m.atk;
    if (typeof m.shieldGain === 'number') shieldGain += m.shieldGain;
    if (typeof m.skipChance === 'number') skipChance = Math.max(skipChance, m.skipChance);
    if (m.noShield) noShield = true;
    if (m.noUltimate) noUltimate = true;
    if (m.scatter) momentum = true;
    if (m.immune) immune = true;
  }
  // Power budget cap: total +/-25%.
  return {
    atk: clamp(atk, -0.25, 0.25),
    shieldGain: clamp(shieldGain, 0, 0.25),
    skipChance, noShield, noUltimate, momentum, immune,
  };
}

export function applyStatus(target, statusDef) {
  const duration = statusDef.kind === 'buff' ? BUFF_DURATION : DEBUFF_DURATION;
  // Immunity blocks the next incoming debuff (anti-frustration).
  if (statusDef.kind === 'debuff') {
    const imm = target.statuses.find((s) => s.id === STATUS.IMMUNITY.id);
    if (imm) {
      target.statuses = target.statuses.filter((s) => s !== imm);
      return { blocked: true };
    }
  }
  const existing = target.statuses.find((s) => s.id === statusDef.id);
  if (existing) {
    existing.turnsLeft = duration; // refresh
  } else {
    target.statuses.push({
      id: statusDef.id, kind: statusDef.kind, label: statusDef.label,
      icon: statusDef.icon, desc: statusDef.desc, mods: statusDef.mods,
      turnsLeft: duration,
    });
  }
  return { blocked: false };
}

export function tickStatuses(c) {
  for (const s of c.statuses) s.turnsLeft -= 1;
  c.statuses = c.statuses.filter((s) => s.turnsLeft > 0);
}

// --- Reels ----------------------------------------------------------------

export function spinReels(c, held, prev, rng) {
  // held: boolean[3] of which reels to keep from `prev`. prev: SYMBOL[3]|null.
  const reel = c.faction.reel;
  const out = [];
  for (let i = 0; i < 3; i += 1) {
    if (held && held[i] && prev && prev[i]) {
      out.push(prev[i]);
    } else {
      out.push(reel[Math.floor(rng() * reel.length)]);
    }
  }
  return out;
}

export function resolveSpin(symbols) {
  const counts = { ATTACK: 0, SHIELD: 0, HEAL: 0, SCATTER: 0, BLANK: 0 };
  for (const s of symbols) counts[s] += 1;
  const tier = (type) => (counts[type] > 0 ? TIER_VALUES[type][counts[type]] : 0);
  return {
    counts,
    attackValue: tier('ATTACK'),
    shieldValue: tier('SHIELD'),
    healValue: tier('HEAL'),
    scatterCount: counts.SCATTER,
  };
}

// --- Outcome resolution ---------------------------------------------------

export function computeOutcome(attacker, defender, resolved, rng) {
  const aMods = aggregateMods(attacker);
  const dMods = aggregateMods(defender);
  const log = [];

  // Attack
  let damage = 0; let crit = false;
  if (resolved.attackValue > 0) {
    const critChance = attacker.stats.luck / 100; // 10% baseline
    crit = rng() < critChance;
    const eff = resolved.attackValue * (1 + aMods.atk);
    const defReduction = defender.stats.def * 0.005; // 10 DEF => 5%
    damage = eff * (1 - defReduction) * (crit ? 1.25 : 1);
    damage = Math.round(clamp(damage, 0, 60)); // no one-turn kills
  }

  // Shield
  let shieldGain = 0;
  if (resolved.shieldValue > 0 && !aMods.noShield) {
    shieldGain = Math.round(resolved.shieldValue * (1 + aMods.shieldGain));
  }

  // Heal
  let heal = 0;
  if (resolved.healValue > 0) heal = resolved.healValue;

  // Scatter (Momentum grants +1 when any scatter lands).
  let scatterGain = resolved.scatterCount;
  if (scatterGain > 0 && aMods.momentum) scatterGain += 1;

  return { damage, crit, shieldGain, heal, scatterGain, log };
}

export function applyDamage(target, rawDamage) {
  let dmg = rawDamage;
  const absorbed = Math.min(target.shield, dmg);
  target.shield -= absorbed;
  dmg -= absorbed;
  target.hp = Math.max(0, target.hp - dmg);
  return { absorbed, toHp: dmg };
}

export function applyHeal(target, amount) {
  const before = target.hp;
  target.hp = Math.min(target.maxHp, target.hp + amount);
  return target.hp - before;
}

export function gainShield(target, amount) {
  const before = target.shield;
  target.shield = Math.min(MAX_SHIELD, target.shield + amount);
  return target.shield - before;
}

export function gainScatter(target, amount) {
  const before = target.scatter;
  target.scatter = Math.min(SCATTER_MAX, target.scatter + amount);
  return target.scatter - before;
}

// Faction ultimates — consume SCATTER_NEEDED scatter.
export function castUltimate(attacker, defender, rng) {
  attacker.scatter = Math.max(0, attacker.scatter - SCATTER_NEEDED);
  const events = [];
  const strike = (base) => {
    const aMods = aggregateMods(attacker);
    const eff = base * (1 + aMods.atk);
    const dmg = Math.round(clamp(eff * (1 - defender.stats.def * 0.005), 0, 60));
    const res = applyDamage(defender, dmg);
    events.push({ type: 'damage', amount: dmg, absorbed: res.absorbed, toHp: res.toHp });
    return dmg;
  };
  const tryDebuff = (def) => {
    const r = applyStatus(defender, def);
    events.push({ type: 'debuff', id: def.id, label: def.label, blocked: r.blocked });
  };
  const buff = (def) => {
    applyStatus(attacker, def);
    events.push({ type: 'buff', id: def.id, label: def.label });
  };

  switch (attacker.factionId) {
    case 'CRIMSON':
      strike(45);
      tryDebuff(STATUS.SCANDAL);
      break;
    case 'ROSE': {
      const healed = applyHeal(attacker, 40);
      events.push({ type: 'heal', amount: healed });
      buff(STATUS.ENDORSEMENT);
      break;
    }
    case 'GOLDEN':
      buff(STATUS.RALLY);
      buff(STATUS.MOMENTUM);
      break;
    case 'BALIMBING':
      strike(20);
      tryDebuff(STATUS.SILENCE);
      tryDebuff(STATUS.INVESTIGATION);
      break;
    default:
      break;
  }
  return { name: attacker.faction.ultimate.name, events };
}

// --- AI -------------------------------------------------------------------

// Returns hold[] decision given a spin result. Strategy: pursue lethal attack
// when the enemy is low, heal when hurting, otherwise build scatter/attack.
export function aiChooseHolds(self, enemy, symbols) {
  const lowSelf = self.hp <= 40;
  const enemyLow = (enemy.hp + enemy.shield) <= 30;
  const priority = lowSelf ? SYMBOL.HEAL : (enemyLow ? SYMBOL.ATTACK : null);
  return symbols.map((s) => {
    if (priority) return s === priority || s === SYMBOL.SCATTER;
    // default: keep attack & scatter, re-roll blanks/extra
    return s === SYMBOL.ATTACK || s === SYMBOL.SCATTER;
  });
}

export function aiWantsUltimate(self, enemy) {
  return ultimateReady(self);
}

// --- Match orchestration --------------------------------------------------

export function decideFirst(a, b, rng) {
  // Randomized at battle start; SPD breaks ties. Then fixed rotation.
  if (a.stats.spd !== b.stats.spd) return a.stats.spd > b.stats.spd ? 0 : 1;
  return rng() < 0.5 ? 0 : 1;
}

export function isOver(a, b) {
  return a.hp <= 0 || b.hp <= 0;
}

export function winnerByHp(a, b) {
  if (a.hp === b.hp) return -1; // draw
  return a.hp > b.hp ? 0 : 1;
}
