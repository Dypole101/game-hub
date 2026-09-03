// games/uno.js
// Classic Uno for up to 5 players, no teams. Standard 108-card deck,
// Skip/Reverse/Draw Two/Wild/Wild Draw Four all implemented. If you can't
// play, you draw one card and may play it immediately if it's legal.

(function () {
  const COLORS = ['red', 'yellow', 'green', 'blue'];
  const COLOR_HEX = { red: '#E85D75', yellow: '#F2B84B', green: '#6BCB77', blue: '#5B8DEF' };

  let channel = null;
  let ctx = null;
  let pendingWildCardIndex = null;

  function buildDeck() {
    const deck = [];
    COLORS.forEach(color => {
      deck.push({ color, value: '0' });
      for (let n = 1; n <= 9; n++) { deck.push({ color, value: String(n) }); deck.push({ color, value: String(n) }); }
      ['skip', 'reverse', 'draw2'].forEach(v => { deck.push({ color, value: v }); deck.push({ color, value: v }); });
    });
    for (let i = 0; i < 4; i++) deck.push({ color: 'wild', value: 'wild' });
    for (let i = 0; i < 4; i++) deck.push({ color: 'wild', value: 'wild4' });
    return shuffle(deck);
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function getInitialState(players) {
    let deck = buildDeck();
    const hands = {};
    players.forEach(p => { hands[p.playerId] = deck.splice(0, 7); });

    let firstCard = deck.pop();
    while (firstCard.value === 'wild4') { deck.unshift(firstCard); deck = shuffle(deck); firstCard = deck.pop(); }
    const discard = [firstCard];

    return {
      order: players.map(p => p.playerId),
      hands,
      deck,
      discard,
      currentColor: firstCard.color === 'wild' ? COLORS[0] : firstCard.color,
      turn: players[0].playerId,
      direction: 1,
      pendingDraw: 0,          // stacked draw amount from an unanswered draw2/wild4 (applied on next player's forced draw)
      status: 'playing',
      winner: null,
      drawnCardPlayable: null, // { playerId, cardIndex } - lets a player immediately play a card they just drew
      lastAction: null,
    };
  }

  function topCard(state) { return state.discard[state.discard.length - 1]; }

  function canPlay(card, state) {
    const top = topCard(state);
    if (card.color === 'wild') return true;
    if (card.color === state.currentColor) return true;
    if (card.value === top.value) return true;
    return false;
  }

  function nextPlayerId(state, fromId, skip) {
    const order = state.order;
    let idx = order.indexOf(fromId);
    let steps = 1 + (skip ? 1 : 0);
    idx = (idx + steps * state.direction + order.length * 2) % order.length;
    return order[idx];
  }

  function nameOf(playerId) {
    return ctx.players.find(p => p.playerId === playerId)?.username || 'Player';
  }

  function cardLabel(card) {
    const labels = { skip: 'Skip', reverse: 'Reverse', draw2: '+2', wild: 'Wild', wild4: '+4' };
    return labels[card.value] || card.value;
  }

  function render(container, state) {
    const myHand = state.hands[ctx.playerId] || [];
    const myTurn = state.turn === ctx.playerId && state.status === 'playing';
    const iDrewPlayable = state.drawnCardPlayable && state.drawnCardPlayable.playerId === ctx.playerId;

    let statusText = '';
    if (state.status === 'finished') {
      statusText = state.winner === ctx.playerId ? 'You won! 🎉' : `${nameOf(state.winner)} won.`;
    } else {
      statusText = myTurn ? (iDrewPlayable ? 'Play the card you drew, or pass' : 'Your turn') : `Waiting on ${nameOf(state.turn)}`;
    }
    ctx.setStatus(statusText);

    const top = topCard(state);

    container.innerHTML = `
      <div class="uno-table">
        <div class="uno-opponents" id="unoOpponents"></div>
        <div class="uno-center">
          <div class="uno-deck-pile" id="unoDeckPile">🂠<span class="uno-deck-count">${state.deck.length}</span></div>
          <div class="uno-discard-pile" style="background:${COLOR_HEX[state.currentColor]}">${cardLabel(top)}</div>
        </div>
        <div class="uno-hand" id="unoHand"></div>
        ${state.status === 'finished' ? '<button class="btn btn-primary" id="unoRematch">Play again</button>' : ''}
        ${iDrewPlayable ? '<button class="btn btn-ghost" id="unoPassBtn">Pass turn</button>' : ''}
      </div>
      <div class="uno-color-picker hidden" id="unoColorPicker">
        <p>Pick a color</p>
        <div class="uno-color-options">
          ${COLORS.map(c => `<button class="uno-color-btn" data-color="${c}" style="background:${COLOR_HEX[c]}"></button>`).join('')}
        </div>
      </div>
    `;
    injectStyles();

    const opponentsEl = document.getElementById('unoOpponents');
    state.order.filter(id => id !== ctx.playerId).forEach(id => {
      const chip = document.createElement('div');
      chip.className = 'uno-opponent-chip' + (state.turn === id ? ' active-turn' : '');
      chip.innerHTML = `<span>${escapeHtml(nameOf(id))}</span><strong>${state.hands[id].length}</strong>`;
      opponentsEl.appendChild(chip);
    });

    const handEl = document.getElementById('unoHand');
    myHand.forEach((card, i) => {
      const cardEl = document.createElement('div');
      const playable = myTurn && !iDrewPlayable && canPlay(card, state);
      const isDrawnPlayable = iDrewPlayable && i === state.drawnCardPlayable.cardIndex;
      cardEl.className = 'uno-card' + ((playable || isDrawnPlayable) ? ' playable' : '');
      cardEl.style.background = card.color === 'wild' ? 'linear-gradient(135deg,#E85D75,#F2B84B,#6BCB77,#5B8DEF)' : COLOR_HEX[card.color];
      cardEl.textContent = cardLabel(card);
      if (playable || isDrawnPlayable) cardEl.addEventListener('click', () => playCard(i));
      handEl.appendChild(cardEl);
    });

    if (myTurn && !iDrewPlayable && !myHand.some(c => canPlay(c, state))) {
      const drawBtn = document.createElement('button');
      drawBtn.className = 'btn btn-secondary uno-draw-btn';
      drawBtn.textContent = 'Draw card';
      drawBtn.addEventListener('click', drawCard);
      handEl.appendChild(drawBtn);
    }

    document.getElementById('unoDeckPile').addEventListener('click', () => {
      if (myTurn && !iDrewPlayable && !myHand.some(c => canPlay(c, state))) drawCard();
    });

    const rematchBtn = document.getElementById('unoRematch');
    if (rematchBtn) rematchBtn.addEventListener('click', rematch);
    const passBtn = document.getElementById('unoPassBtn');
    if (passBtn) passBtn.addEventListener('click', passAfterDraw);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function injectStyles() {
    if (document.getElementById('unoStyles')) return;
    const style = document.createElement('style');
    style.id = 'unoStyles';
    style.textContent = `
      .uno-table { display: flex; flex-direction: column; align-items: center; gap: 16px; width: 100%; }
      .uno-opponents { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
      .uno-opponent-chip { display: flex; gap: 8px; align-items: center; font-size: 12px; padding: 6px 12px; border: 1px solid var(--border); border-radius: 999px; background: var(--surface); }
      .uno-opponent-chip.active-turn { border-color: var(--online); color: var(--online); }
      .uno-center { display: flex; align-items: center; gap: 20px; }
      .uno-deck-pile { width: 60px; height: 84px; border-radius: 8px; background: var(--surface-raised); border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; font-size: 24px; position: relative; cursor: pointer; }
      .uno-deck-count { position: absolute; bottom: 2px; right: 4px; font-size: 10px; color: var(--text-muted); }
      .uno-discard-pile { width: 60px; height: 84px; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 13px; color: #12141C; text-align: center; padding: 4px; }
      .uno-hand { display: flex; gap: 6px; flex-wrap: wrap; justify-content: center; max-width: 100%; }
      .uno-card { width: 52px; height: 74px; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 12px; color: #12141C; opacity: 0.5; text-align: center; padding: 2px; }
      .uno-card.playable { opacity: 1; cursor: pointer; box-shadow: 0 0 0 2px var(--accent); transform: translateY(0); }
      .uno-card.playable:hover { transform: translateY(-4px); }
      .uno-draw-btn { margin-left: 8px; }
      .uno-color-picker { position: fixed; inset: 0; background: rgba(8,9,13,0.85); display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 16px; z-index: 200; }
      .uno-color-options { display: flex; gap: 12px; }
      .uno-color-btn { width: 56px; height: 56px; border-radius: 50%; border: 2px solid #fff; }
    `;
    document.head.appendChild(style);
  }

  async function withState(fn) {
    const { data } = await ctx.supabase.from(ctx.TABLES.GAME_STATE).select('state').eq('room_id', ctx.roomId).single();
    const state = data.state;
    fn(state);
    await ctx.supabase.from(ctx.TABLES.GAME_STATE).update({ state }).eq('room_id', ctx.roomId);
  }

  function applyCardEffect(state, card, playerId) {
    if (card.value === 'reverse') {
      state.direction *= -1;
      if (state.order.length === 2) {
        // With exactly 2 players, Reverse behaves like Skip: same player goes again.
        state.turn = playerId;
        return;
      }
    }
    if (card.value === 'skip') {
      state.turn = nextPlayerId(state, playerId, true);
      return;
    }
    if (card.value === 'draw2') {
      const target = nextPlayerId(state, playerId, false);
      drawCardsFor(state, target, 2);
      state.turn = nextPlayerId(state, playerId, true);
      return;
    }
    if (card.value === 'wild4') {
      const target = nextPlayerId(state, playerId, false);
      drawCardsFor(state, target, 4);
      state.turn = nextPlayerId(state, playerId, true);
      return;
    }
    state.turn = nextPlayerId(state, playerId, false);
  }

  function drawCardsFor(state, playerId, count) {
    for (let i = 0; i < count; i++) {
      if (state.deck.length === 0) reshuffleDiscardIntoDeck(state);
      if (state.deck.length === 0) break;
      state.hands[playerId].push(state.deck.pop());
    }
  }

  function reshuffleDiscardIntoDeck(state) {
    const top = state.discard.pop();
    state.deck = shuffle(state.discard);
    state.discard = [top];
  }

  function playCard(index) {
    ctx.supabase.from(ctx.TABLES.GAME_STATE).select('state').eq('room_id', ctx.roomId).single().then(({ data }) => {
      const state = data.state;
      const card = state.hands[ctx.playerId][index];
      if (!card) return;
      if (state.turn !== ctx.playerId || state.status !== 'playing') return;
      const wasDrawnCard = state.drawnCardPlayable && state.drawnCardPlayable.playerId === ctx.playerId && state.drawnCardPlayable.cardIndex === index;
      if (!wasDrawnCard && !canPlay(card, state)) return;

      if (card.color === 'wild') {
        pendingWildCardIndex = index;
        document.getElementById('unoColorPicker').classList.remove('hidden');
        document.querySelectorAll('.uno-color-btn').forEach(btn => {
          btn.addEventListener('click', () => finalizeWildPlay(index, btn.dataset.color), { once: true });
        });
        return;
      }
      finalizePlay(index, card.color);
    });
  }

  async function finalizeWildPlay(index, chosenColor) {
    document.getElementById('unoColorPicker').classList.add('hidden');
    await finalizePlay(index, chosenColor);
  }

  async function finalizePlay(index, resolvedColor) {
    await withState((state) => {
      const card = state.hands[ctx.playerId].splice(index, 1)[0];
      state.discard.push(card);
      state.currentColor = resolvedColor;
      state.drawnCardPlayable = null;
      state.lastAction = { playerId: ctx.playerId, card };

      if (state.hands[ctx.playerId].length === 0) {
        state.status = 'finished';
        state.winner = ctx.playerId;
        return;
      }
      applyCardEffect(state, card, ctx.playerId);
    });
  }

  async function drawCard() {
    await withState((state) => {
      if (state.turn !== ctx.playerId || state.status !== 'playing') return;
      if (state.deck.length === 0) reshuffleDiscardIntoDeck(state);
      if (state.deck.length === 0) { state.turn = nextPlayerId(state, ctx.playerId, false); return; }
      const card = state.deck.pop();
      state.hands[ctx.playerId].push(card);
      if (canPlay(card, state)) {
        state.drawnCardPlayable = { playerId: ctx.playerId, cardIndex: state.hands[ctx.playerId].length - 1 };
      } else {
        state.turn = nextPlayerId(state, ctx.playerId, false);
      }
    });
  }

  async function passAfterDraw() {
    await withState((state) => {
      if (!state.drawnCardPlayable || state.drawnCardPlayable.playerId !== ctx.playerId) return;
      state.drawnCardPlayable = null;
      state.turn = nextPlayerId(state, ctx.playerId, false);
    });
  }

  async function rematch() {
    const state = getInitialState(ctx.players);
    await ctx.supabase.from(ctx.TABLES.GAME_STATE).update({ state }).eq('room_id', ctx.roomId);
  }

  function start(container, gameCtx) {
    ctx = gameCtx;
    channel = ctx.supabase.channel(`game_${ctx.roomId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: ctx.TABLES.GAME_STATE, filter: `room_id=eq.${ctx.roomId}` }, (payload) => {
        render(container, payload.new.state);
      })
      .subscribe();

    ctx.supabase.from(ctx.TABLES.GAME_STATE).select('state').eq('room_id', ctx.roomId).single()
      .then(({ data }) => { if (data) render(container, data.state); });
  }

  function cleanup() {
    if (channel) { ctx.supabase.removeChannel(channel); channel = null; }
  }

  window.GameModules = window.GameModules || {};
  window.GameModules.uno = {
    getInitialState,
    start,
    cleanup,
    tutorial: `
      <h4>Goal</h4>
      <p>Be the first to play every card in your hand.</p>
      <h4>How to play</h4>
      <ul>
        <li>Match the top discard by color, number, or symbol — or play any Wild card.</li>
        <li>Skip: next player loses their turn. Reverse: turn order flips.</li>
        <li>+2 / +4: next player draws that many cards and loses their turn. Wild and +4 let you pick the color.</li>
        <li>No playable card? Draw one — if it's playable you may play it immediately, or pass.</li>
        <li>First to empty their hand wins.</li>
      </ul>
    `,
  };
})();
