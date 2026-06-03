// Political Slot Battle RPG — Balance configuration
// Implements the v1.3 Balance Framework. All tunable numbers live here so the
// design philosophy (60% strategy / 40% luck) stays easy to audit.

export const BASE_STATS = Object.freeze({
  hp: 100,
  atk: 20,
  def: 10,
  spd: 10,
  luck: 10,
});

// Status effect duration standardization (v1.3).
export const BUFF_DURATION = 4; // turns
export const DEBUFF_DURATION = 2; // turns

// Resource caps.
export const MAX_SHIELD = 100;
export const SCATTER_NEEDED = 3; // scatter required for an ultimate
export const SCATTER_MAX = 3; // no overflow

// Match length target (seconds). Highest HP wins when the timer expires.
export const MATCH = Object.freeze({
  minSeconds: 120,
  avgSeconds: 240,
  maxSeconds: 300,
});

// Re-roll budget (the core strategy lever). Balimbing gets controlled re-rolls.
export const BASE_REROLLS = 1;

// Symbol types produced by the reels.
export const SYMBOL = Object.freeze({
  ATTACK: 'ATTACK',
  SHIELD: 'SHIELD',
  HEAL: 'HEAL',
  SCATTER: 'SCATTER',
  BLANK: 'BLANK',
});

export const SYMBOL_META = Object.freeze({
  ATTACK: { icon: '\u{1F4A5}', label: 'Attack' }, // collision/impact (renders reliably)
  SHIELD: { icon: '\u{1F6E1}\uFE0F', label: 'Shield' },
  HEAL: { icon: '\u2764\uFE0F', label: 'Heal' },
  SCATTER: { icon: '\u2B50', label: 'Scatter' },
  BLANK: { icon: '\u25EF', label: 'Blank' },
});

// Tiered effect values keyed by how many matching symbols landed in a spin.
// 1 / 2 / 3 of a kind. These match the v1.3 Damage / Shield / Heal tables.
export const TIER_VALUES = Object.freeze({
  ATTACK: { 1: 10, 2: 20, 3: 30 }, // avg ~20 => ~5 attacks to eliminate
  SHIELD: { 1: 10, 2: 20, 3: 30 },
  HEAL: { 1: 10, 2: 15, 3: 20 },
});

// Buff / debuff power budget (capped at +/-25%).
export const BUFF_POWER = Object.freeze({ minor: 0.1, medium: 0.2, major: 0.25 });

// Status effect definitions. `mods` are multiplicative percentage modifiers.
export const STATUS = Object.freeze({
  // Buffs (4 turns)
  RALLY: { id: 'RALLY', kind: 'buff', label: 'Rally', icon: '\u{1F4E2}', desc: '+25% Attack', mods: { atk: BUFF_POWER.major } },
  MOMENTUM: { id: 'MOMENTUM', kind: 'buff', label: 'Momentum', icon: '\u{1F501}', desc: '+Scatter rate', mods: { scatter: true } },
  ENDORSEMENT: { id: 'ENDORSEMENT', kind: 'buff', label: 'Endorsement', icon: '\u{1F91D}', desc: '+25% Shield gain', mods: { shieldGain: BUFF_POWER.major } },
  IMMUNITY: { id: 'IMMUNITY', kind: 'buff', label: 'Immunity', icon: '\u{1F31F}', desc: 'Blocks next debuff', mods: { immune: true } },
  // Debuffs (2 turns)
  SCANDAL: { id: 'SCANDAL', kind: 'debuff', label: 'Scandal', icon: '\u{1F4F0}', desc: '-25% Attack', mods: { atk: -BUFF_POWER.major } },
  AUDIT: { id: 'AUDIT', kind: 'debuff', label: 'Audit', icon: '\u{1F50D}', desc: 'No shield gain', mods: { noShield: true } },
  SILENCE: { id: 'SILENCE', kind: 'debuff', label: 'Silence', icon: '\u{1F910}', desc: 'No ultimate', mods: { noUltimate: true } },
  INVESTIGATION: { id: 'INVESTIGATION', kind: 'debuff', label: 'Investigation', icon: '\u2696\uFE0F', desc: '25% turn-skip chance', mods: { skipChance: 0.25 } },
});

// Faction balance — power comes ONLY from reel modifications (equal budget).
// Each reel strip has the same length (10); factions trade BLANK weight for a
// themed symbol, except Balimbing which keeps a neutral reel but gains a re-roll.
const baseStrip = () => ([
  SYMBOL.ATTACK, SYMBOL.ATTACK, SYMBOL.ATTACK,
  SYMBOL.SHIELD, SYMBOL.SHIELD,
  SYMBOL.HEAL, SYMBOL.HEAL,
  SYMBOL.SCATTER,
  SYMBOL.BLANK, SYMBOL.BLANK,
]);

function biasedStrip(extraSymbol) {
  // Replace the two BLANKs with the faction's themed symbol (equal budget swap).
  const strip = baseStrip().filter((s) => s !== SYMBOL.BLANK);
  strip.push(extraSymbol, extraSymbol);
  return strip;
}

export const FACTIONS = Object.freeze({
  CRIMSON: {
    id: 'CRIMSON',
    name: 'Crimson Alliance',
    color: '#c0392b',
    blurb: 'Aggression. More attack symbols.',
    reel: biasedStrip(SYMBOL.ATTACK),
    extraRerolls: 0,
    ultimate: { name: 'Smear Campaign', desc: 'Heavy strike + Scandal (-25% ATK) on the enemy.' },
  },
  ROSE: {
    id: 'ROSE',
    name: 'Rose Reform League',
    color: '#d6336c',
    blurb: 'Resilience. More heal symbols.',
    reel: biasedStrip(SYMBOL.HEAL),
    extraRerolls: 0,
    ultimate: { name: 'Welfare Surge', desc: 'Big heal + Endorsement (+25% shield gain).' },
  },
  GOLDEN: {
    id: 'GOLDEN',
    name: 'Golden Legacy Movement',
    color: '#d4a017',
    blurb: 'Tempo. More scatter symbols.',
    reel: biasedStrip(SYMBOL.SCATTER),
    extraRerolls: 0,
    ultimate: { name: 'Dynasty Decree', desc: 'Rally (+25% ATK) + Momentum (+scatter).' },
  },
  BALIMBING: {
    id: 'BALIMBING',
    name: 'Balimbing Alliance',
    color: '#2e8b57',
    blurb: 'Manipulation. Controlled re-rolls.',
    reel: baseStrip(),
    extraRerolls: 1,
    ultimate: { name: 'Backroom Deal', desc: 'Strike + Silence + Investigation on the enemy.' },
  },
});

export const FACTION_LIST = Object.values(FACTIONS);
