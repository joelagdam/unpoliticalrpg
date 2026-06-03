// Political Slot Battle RPG — browser controller (DOM + turn flow).
import {
  FACTION_LIST, FACTIONS, SYMBOL_META, MATCH, SCATTER_NEEDED, SCATTER_MAX,
} from './config.js';
import {
  makeRng, createCombatant, spinReels, resolveSpin, computeOutcome, applyDamage,
  applyHeal, gainShield, gainScatter, castUltimate, ultimateReady, tickStatuses,
  aggregateMods, decideFirst, isOver, winnerByHp, aiChooseHolds, aiWantsUltimate,
} from './engine.js';

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

const rng = makeRng((Date.now() & 0xffffffff) >>> 0);

const G = {
  player: null,
  ai: null,
  order: [], // combatant refs in turn order
  current: 0,
  turnCount: 1,
  prev: null,
  held: [false, false, false],
  rerollsLeft: 0,
  phase: 'idle', // idle | spun | over
  secondsLeft: MATCH.maxSeconds,
  timerId: null,
  selectedFaction: null,
  busy: false,
};

// ===================== Faction select =====================

function buildSelect() {
  const grid = $('#faction-grid');
  grid.innerHTML = '';
  for (const f of FACTION_LIST) {
    const card = document.createElement('div');
    card.className = 'faction-card';
    card.dataset.faction = f.id;
    card.style.borderTopColor = f.color;
    const reelIcons = f.reel.map((s) => SYMBOL_META[s].icon).join(' ');
    card.innerHTML = `
      <h3><span class="swatch" style="background:${f.color}"></span>${f.name}</h3>
      <div class="blurb">${f.blurb}</div>
      <div class="ult"><b>${f.ultimate.name}:</b> ${f.ultimate.desc}</div>
      <div class="reel-preview" title="Reel symbols">${f.reel.map((s) => `<span>${SYMBOL_META[s].icon}</span>`).join('')}</div>
    `;
    card.addEventListener('click', () => {
      G.selectedFaction = f.id;
      $$('.faction-card').forEach((c) => c.classList.toggle('selected', c === card));
      $('#start-btn').disabled = false;
      $('#select-hint').textContent = `${f.name} selected — ${f.blurb}`;
    });
    grid.appendChild(card);
  }
}

function showScreen(id) {
  $$('.screen').forEach((s) => s.classList.toggle('active', s.id === id));
}

// ===================== Battle setup =====================

function startBattle() {
  const playerFaction = G.selectedFaction;
  const aiPool = FACTION_LIST.filter((f) => f.id !== playerFaction);
  const aiFaction = aiPool[Math.floor(rng() * aiPool.length)].id;

  G.player = createCombatant(playerFaction, 'You', { isAI: false });
  G.ai = createCombatant(aiFaction, 'Rival', { isAI: true });
  G.turnCount = 1;
  G.secondsLeft = MATCH.maxSeconds;
  G.phase = 'idle';

  const firstIdx = decideFirst(G.player, G.ai, rng);
  G.order = firstIdx === 0 ? [G.player, G.ai] : [G.ai, G.player];
  G.current = 0;

  $('#log').innerHTML = '';
  log('sys', `Battle start! ${G.order[0].name} (${G.order[0].faction.name}) move first.`);
  showScreen('screen-battle');
  renderPanels();
  startTimer();
  beginTurn();
}

function startTimer() {
  stopTimer();
  G.timerId = setInterval(() => {
    G.secondsLeft -= 1;
    renderTimer();
    if (G.secondsLeft <= 0) {
      G.secondsLeft = 0;
      endByTimer();
    }
  }, 1000);
  renderTimer();
}
function stopTimer() { if (G.timerId) { clearInterval(G.timerId); G.timerId = null; } }

// ===================== Turn flow =====================

function active() { return G.order[G.current]; }
function defender() { return G.order[(G.current + 1) % 2]; }

function beginTurn() {
  if (G.phase === 'over') return;
  G.prev = null;
  G.held = [false, false, false];
  const c = active();
  G.rerollsLeft = c.rerolls;
  renderPanels();
  renderReels(['\u2753', '\u2753', '\u2753'], false);

  // Investigation: chance to skip the turn (anti-frustration: still ticks down).
  const mods = aggregateMods(c);
  if (mods.skipChance > 0 && rng() < mods.skipChance) {
    log(c.isAI ? 'foe' : 'you', `${c.name} is bogged down by an Investigation and loses the turn!`);
    tickStatuses(c);
    renderPanels();
    setTimeout(endTurn, 900);
    return;
  }

  if (c.isAI) {
    setControls({ spin: false, reroll: false, resolve: false, ultimate: false });
    $('#spin-readout').textContent = `${c.name} is taking their turn...`;
    setTimeout(aiTakeTurn, 800);
  } else {
    G.phase = 'idle';
    setControls({ spin: true, reroll: false, resolve: false, ultimate: ultimateReady(c) });
    $('#spin-readout').innerHTML = ultimateReady(c)
      ? 'Your turn — <span class="pop">Ultimate ready!</span> Spin, or unleash it.'
      : 'Your turn — press <strong>SPIN</strong>.';
  }
}

function playerSpin() {
  if (G.phase === 'over' || active().isAI) return;
  G.phase = 'spun';
  doSpin(active(), () => {
    setControls({ spin: false, reroll: G.rerollsLeft > 0, resolve: true, ultimate: false });
  });
}

function playerReroll() {
  if (G.phase !== 'spun' || G.rerollsLeft <= 0) return;
  G.rerollsLeft -= 1;
  doSpin(active(), () => {
    setControls({ spin: false, reroll: G.rerollsLeft > 0, resolve: true, ultimate: false });
  });
}

function doSpin(c, done) {
  renderReels(null, true); // spinning animation
  $('#reroll-count').textContent = G.rerollsLeft > 0 ? `(${G.rerollsLeft})` : '';
  setTimeout(() => {
    const symbols = spinReels(c, G.held, G.prev, rng);
    G.prev = symbols;
    renderReels(symbols, false);
    const r = resolveSpin(symbols);
    $('#spin-readout').innerHTML = describeSpin(r);
    if (done) done();
  }, 520);
}

function describeSpin(r) {
  const parts = [];
  if (r.attackValue) parts.push(`<span class="pop">${r.attackValue} ATK</span>`);
  if (r.shieldValue) parts.push(`<span class="pop">${r.shieldValue} Shield</span>`);
  if (r.healValue) parts.push(`<span class="pop">${r.healValue} Heal</span>`);
  if (r.scatterCount) parts.push(`<span class="pop">+${r.scatterCount} Scatter</span>`);
  return parts.length ? parts.join(' &nbsp;•&nbsp; ') : 'Blanks — nothing happens this spin.';
}

function resolveTurn() {
  if (G.phase !== 'spun') return;
  const c = active();
  const d = defender();
  const r = resolveSpin(G.prev);
  const out = computeOutcome(c, d, r, rng);
  applyResolution(c, d, out);
  finishTurnAction(c);
}

function applyResolution(c, d, out) {
  const who = c.isAI ? 'foe' : 'you';
  const bits = [];
  if (out.scatterGain > 0) { gainScatter(c, out.scatterGain); bits.push(`+${out.scatterGain} scatter`); }
  if (out.heal > 0) { const h = applyHeal(c, out.heal); if (h) bits.push(`healed ${h}`); }
  if (out.shieldGain > 0) { const s = gainShield(c, out.shieldGain); if (s) bits.push(`+${s} shield`); }
  if (out.damage > 0) {
    const res = applyDamage(d, out.damage);
    const critTxt = out.crit ? ' (CRIT!)' : '';
    bits.push(`hit ${d.name} for ${out.damage}${critTxt}` + (res.absorbed ? ` [${res.absorbed} absorbed]` : ''));
  }
  log(who, `${c.name}: ${bits.length ? bits.join(', ') : 'no effect'}.`);
}

function playerUltimate() {
  const c = active();
  if (c.isAI || !ultimateReady(c)) return;
  castAndLog(c, defender());
  finishTurnAction(c);
}

function castAndLog(c, d) {
  const who = c.isAI ? 'foe' : 'you';
  const result = castUltimate(c, d, rng);
  log(who, `${c.name} unleashes ${result.name}!`);
  for (const e of result.events) {
    if (e.type === 'damage') log(who, ` ↳ ${e.amount} damage to ${d.name}${e.absorbed ? ` (${e.absorbed} absorbed)` : ''}.`);
    if (e.type === 'heal') log(who, ` ↳ restored ${e.amount} HP.`);
    if (e.type === 'buff') log(who, ` ↳ gained ${e.label}.`);
    if (e.type === 'debuff') log(who, e.blocked ? ` ↳ ${e.label} blocked by Immunity!` : ` ↳ inflicted ${e.label} on ${d.name}.`);
  }
}

function finishTurnAction(c) {
  tickStatuses(c); // owner's statuses count down at end of their turn
  renderPanels();
  if (isOver(G.player, G.ai)) return endByKo();
  setTimeout(endTurn, 700);
}

function endTurn() {
  if (G.phase === 'over') return;
  G.current = (G.current + 1) % 2;
  if (G.current === 0) G.turnCount += 1;
  $('#turn-count').textContent = G.turnCount;
  beginTurn();
}

// ===================== AI =====================

function aiTakeTurn() {
  const c = active();
  const d = defender();
  if (aiWantsUltimate(c, d)) {
    castAndLog(c, d);
    finishTurnAction(c);
    return;
  }
  G.phase = 'spun';
  doSpin(c, () => {
    // decide holds, optionally reroll once
    if (G.rerollsLeft > 0) {
      G.held = aiChooseHolds(c, d, G.prev);
      renderReels(G.prev, false, G.held);
      setTimeout(() => {
        G.rerollsLeft -= 1;
        doSpin(c, () => setTimeout(() => resolveTurn(), 500));
      }, 600);
    } else {
      setTimeout(() => resolveTurn(), 600);
    }
  });
}

// ===================== End states =====================

function endByKo() {
  G.phase = 'over';
  stopTimer();
  const w = winnerByHp(G.player, G.ai);
  showOverlay(G.player.hp > 0 && G.ai.hp <= 0 ? 'win' : 'lose',
    G.ai.hp <= 0 ? 'Your rival has been eliminated!' : 'You were eliminated!');
}

function endByTimer() {
  G.phase = 'over';
  stopTimer();
  const w = winnerByHp(G.player, G.ai);
  if (w === -1) showOverlay('draw', `Time! It's a dead heat at ${G.player.hp} HP each.`);
  else if (w === 0) showOverlay('win', `Time! You held the lead — ${G.player.hp} HP vs ${G.ai.hp} HP.`);
  else showOverlay('lose', `Time! Your rival led — ${G.ai.hp} HP vs ${G.player.hp} HP.`);
}

function showOverlay(kind, text) {
  const title = $('#overlay-title');
  title.className = kind;
  title.textContent = kind === 'win' ? 'Victory!' : kind === 'lose' ? 'Defeat' : 'Draw';
  $('#overlay-text').textContent = text;
  $('#overlay').classList.remove('hidden');
}

// ===================== Rendering =====================

function renderTimer() {
  const m = Math.floor(G.secondsLeft / 60);
  const s = String(G.secondsLeft % 60).padStart(2, '0');
  const el = $('#timer');
  el.textContent = `${m}:${s}`;
  el.classList.toggle('warn', G.secondsLeft <= 30);
}

function renderPanels() {
  renderPanel($('#panel-player'), G.player, active() === G.player);
  renderPanel($('#panel-ai'), G.ai, active() === G.ai);
}

function renderPanel(el, c, isActive) {
  if (!c) return;
  const hpPct = Math.round((c.hp / c.maxHp) * 100);
  const shieldPct = Math.round((c.shield / 100) * 100);
  const pips = Array.from({ length: SCATTER_MAX }, (_, i) =>
    `<span class="scatter-pip ${i < c.scatter ? 'lit' : ''}"></span>`).join('');
  const chips = c.statuses.map((s) =>
    `<span class="status-chip ${s.kind}" title="${s.desc}">${s.icon} ${s.label} ${s.turnsLeft}</span>`).join('');
  el.className = `combatant-panel ${c.isAI ? 'ai' : ''} ${isActive ? 'active-turn' : ''}`;
  el.style.borderTopColor = c.faction.color;
  el.innerHTML = `
    <div class="cp-head">
      <span class="cp-name">${c.name}</span>
      <span class="cp-faction">${c.faction.name}</span>
    </div>
    <div class="bar-row"><span class="tag">HP</span>
      <div class="bar"><div class="fill hp ${hpPct <= 30 ? 'low' : ''}" style="width:${hpPct}%"></div>
        <span class="bar-label">${c.hp} / ${c.maxHp}</span></div></div>
    <div class="bar-row"><span class="tag">SHIELD</span>
      <div class="bar"><div class="fill shield" style="width:${shieldPct}%"></div>
        <span class="bar-label">${c.shield} / 100</span></div></div>
    <div class="scatter-row">${pips}<span class="scatter-text">Scatter ${c.scatter}/${SCATTER_NEEDED} ${ultimateReady(c) ? '— ULT READY' : ''}</span></div>
    <div class="statuses">${chips}</div>
  `;
}

function renderReels(symbols, spinning, held = G.held) {
  $$('.reel').forEach((reel, i) => {
    const sym = reel.querySelector('.reel-symbol');
    reel.classList.toggle('spinning', !!spinning);
    reel.classList.toggle('held', !!held[i]);
    if (spinning) { sym.textContent = '\u{1F3B0}'; return; }
    if (symbols) {
      const meta = SYMBOL_META[symbols[i]];
      sym.textContent = meta ? meta.icon : '\u2753';
    }
  });
}

function toggleHold(i) {
  if (G.phase !== 'spun' || active().isAI) return;
  G.held[i] = !G.held[i];
  renderReels(G.prev, false);
}

function setControls({ spin, reroll, resolve, ultimate }) {
  $('#spin-btn').disabled = !spin;
  $('#reroll-btn').disabled = !reroll;
  $('#resolve-btn').disabled = !resolve;
  $('#ultimate-btn').disabled = !ultimate;
  $('#reroll-count').textContent = reroll && G.rerollsLeft > 0 ? `(${G.rerollsLeft})` : '';
}

function log(kind, msg) {
  const li = document.createElement('li');
  li.className = kind;
  li.textContent = msg;
  const list = $('#log');
  list.prepend(li);
}

// ===================== Wiring =====================

function init() {
  buildSelect();
  $('#start-btn').addEventListener('click', startBattle);
  $('#spin-btn').addEventListener('click', playerSpin);
  $('#reroll-btn').addEventListener('click', playerReroll);
  $('#resolve-btn').addEventListener('click', resolveTurn);
  $('#ultimate-btn').addEventListener('click', playerUltimate);
  $$('.reel').forEach((r) => r.addEventListener('click', () => toggleHold(Number(r.dataset.reel))));
  $('#again-btn').addEventListener('click', () => {
    $('#overlay').classList.add('hidden');
    showScreen('screen-select');
  });
  $('#quit-btn').addEventListener('click', () => {
    G.phase = 'over'; stopTimer();
    showScreen('screen-select');
  });
}

init();
