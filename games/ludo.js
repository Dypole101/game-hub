// games/ludo.js
// Classic Ludo rules for 2-4 players: 4 tokens each, roll to leave yard on a
// 6, move around a shared 52-square ring, capture opponents on non-safe
// squares, enter your own 6-square home stretch with an exact roll.
//
// NOTE on visuals: rather than the traditional cross-shaped board (which
// needs a large hand-placed coordinate grid), this renders the same classic
// ring as a wrapped, numbered track with each player's yard/home-stretch
// shown in their own panel. Rules and turn mechanics are fully classic.

(function () {
  const RING_LENGTH = 52;
  const HOME_STRETCH = 6;      // steps 51..56 relative to a token's own start; 56 = finished
  const FINISH_STEP = 56;
  const COLORS = ['#E85D75', '#F2B84B', '#6BCB77', '#5B8DEF'];
  const COLOR_NAMES = ['Red', 'Yellow', 'Green', 'Blue'];
  const START_OFFSETS = [0, 13, 26, 39];
  const SAFE_OFFSETS = [0, 8, 13, 21, 26, 34, 39, 47]; // starts + star squares

  let channel = null;
  let ctx = null;

  function getInitialState(players) {
    const tokens = {};
    players.forEach((p, i) => {
      tokens[p.playerId] = [-1, -1, -1, -1]; // -1 = in yard, 0-50 relative progress on ring, 51-56 home stretch, 56 finished
    });
    return {
      order: players.map(p => p.playerId),
      colorIndex: Object.fromEntries(players.map((p, i) => [p.playerId, i])),
      tokens,
      turn: players[0].playerId,
      dice: null,
      rolledThisTurn: false,
      status: 'playing',
      winner: null,
    };
  }

  function nameOf(playerId) {
    return ctx.players.find(p => p.playerId === playerId)?.username || 'Player';
  }

  function ringPosition(playerId, progress, state) {
    // progress 0-50 -> absolute ring square 0-51
    const startOffset = START_OFFSETS[state.colorIndex[playerId]];
    return (startOffset + progress) % RING_LENGTH;
  }

  function isSafeRingSquare(square) {
    return SAFE_OFFSETS.includes(square);
  }

  function movableTokens(state, playerId, dice) {
    const tokens = state.tokens[playerId];
    const result = [];
    tokens.forEach((progress, i) => {
      if (progress === -1) {
        if (dice === 6) result.push(i);
      } else if (progress + dice <= FINISH_STEP) {
        result.push(i);
      }
    });
    return result;
  }

  function render(container, state) {
    const myIdx = state.colorIndex[ctx.playerId];
    const myTurn = state.turn === ctx.playerId && state.status === 'playing';
    const canRoll = myTurn && !state.rolledThisTurn;
    const movable = myTurn && state.rolledThisTurn ? movableTokens(state, ctx.playerId, state.dice) : [];

    let statusText = '';
    if (state.status === 'finished') {
      statusText = state.winner === ctx.playerId ? 'You got all tokens home! 🏆' : `${nameOf(state.winner)} won.`;
    } else if (myTurn) {
      statusText = canRoll ? 'Your turn — roll the dice' : (movable.length ? 'Pick a token to move' : 'No legal moves — passing turn…');
    } else {
      statusText = `Waiting on ${nameOf(state.turn)}`;
    }
    ctx.setStatus(statusText);

    container.innerHTML = `
      <div class="ludo-wrap">
        <div class="ludo-ring" id="ludoRing"></div>
        <div class="ludo-dice-area">
          <div class="ludo-dice" id="ludoDice">${state.dice || '?'}</div>
          <button class="btn btn-primary" id="ludoRollBtn" ${canRoll ? '' : 'disabled'}>Roll dice</button>
        </div>
        <div class="ludo-players" id="ludoPlayers"></div>
      </div>
    `;
    injectStyles();

    // Ring
    const ringEl = document.getElementById('ludoRing');
    for (let sq = 0; sq < RING_LENGTH; sq++) {
      const cell = document.createElement('div');
      cell.className = 'ludo-ring-cell' + (isSafeRingSquare(sq) ? ' safe' : '');
      const startIdx = START_OFFSETS.indexOf(sq);
      if (startIdx !== -1) cell.style.boxShadow = `inset 0 0 0 2px ${COLORS[startIdx]}`;
      cell.textContent = sq;
      // place tokens on this square
      state.order.forEach(pid => {
        state.tokens[pid].forEach((progress, tIdx) => {
          if (progress >= 0 && progress <= 50 && ringPosition(pid, progress, state) === sq) {
            const dot = document.createElement('span');
            dot.className = 'ludo-token-dot';
            dot.style.background = COLORS[state.colorIndex[pid]];
            if (movable.includes(tIdx) && pid === ctx.playerId) {
              dot.classList.add('movable');
              dot.addEventListener('click', () => moveToken(tIdx));
            }
            cell.appendChild(dot);
          }
        });
      });
      ringEl.appendChild(cell);
    }

    // Player panels (yard + home stretch + finished count)
    const playersEl = document.getElementById('ludoPlayers');
    state.order.forEach(pid => {
      const idx = state.colorIndex[pid];
      const tokens = state.tokens[pid];
      const yardCount = tokens.filter(t => t === -1).length;
      const finishedCount = tokens.filter(t => t === FINISH_STEP).length;
      const homeStretchTokens = tokens.map((t, i) => ({ t, i })).filter(x => x.t >= 51 && x.t < FINISH_STEP);

      const panel = document.createElement('div');
      panel.className = 'ludo-player-panel' + (state.turn === pid ? ' active-turn' : '');
      panel.style.borderColor = COLORS[idx];
      panel.innerHTML = `
        <div class="ludo-player-name" style="color:${COLORS[idx]}">${escapeHtml(nameOf(pid))} ${pid === ctx.playerId ? '(you)' : ''}</div>
        <div class="ludo-player-stats">
          <span>Yard: ${yardCount}</span>
          <span>Home: ${finishedCount}/4</span>
        </div>
        <div class="ludo-home-stretch" id="ludo-stretch-${idx}"></div>
      `;
      const stretchEl = panel.querySelector('.ludo-home-stretch');
      homeStretchTokens.forEach(({ t, i }) => {
        const dot = document.createElement('span');
        dot.className = 'ludo-token-dot stretch';
        dot.style.background = COLORS[idx];
        dot.title = `Home stretch step ${t - 50}/6`;
        if (movable.includes(i) && pid === ctx.playerId) {
          dot.classList.add('movable');
          dot.addEventListener('click', () => moveToken(i));
        }
        stretchEl.appendChild(dot);
      });
      // yard tokens (clickable to enter board on a 6)
      if (pid === ctx.playerId) {
        tokens.forEach((t, i) => {
          if (t === -1 && movable.includes(i)) {
            const btn = document.createElement('button');
            btn.className = 'ludo-yard-enter-btn';
            btn.style.borderColor = COLORS[idx];
            btn.textContent = 'Enter token ' + (i + 1);
            btn.addEventListener('click', () => moveToken(i));
            panel.appendChild(btn);
          }
        });
      }
      playersEl.appendChild(panel);
    });

    const rollBtn = document.getElementById('ludoRollBtn');
    if (rollBtn) rollBtn.addEventListener('click', rollDice);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function injectStyles() {
    if (document.getElementById('ludoStyles')) return;
    const style = document.createElement('style');
    style.id = 'ludoStyles';
    style.textContent = `
      .ludo-wrap { display: flex; flex-direction: column; align-items: center; gap: 16px; width: 100%; }
      .ludo-ring { display: flex; flex-wrap: wrap; gap: 2px; max-width: 480px; justify-content: center; }
      .ludo-ring-cell { width: 22px; height: 22px; background: var(--surface); border: 1px solid var(--border); border-radius: 4px; font-size: 8px; color: var(--text-muted); display: flex; align-items: center; justify-content: center; position: relative; flex-wrap: wrap; }
      .ludo-ring-cell.safe { background: var(--surface-raised); }
      .ludo-token-dot { width: 10px; height: 10px; border-radius: 50%; display: inline-block; margin: 1px; border: 1px solid rgba(0,0,0,0.3); }
      .ludo-token-dot.movable { box-shadow: 0 0 0 2px #fff; cursor: pointer; }
      .ludo-dice-area { display: flex; align-items: center; gap: 12px; }
      .ludo-dice { width: 44px; height: 44px; border-radius: 8px; background: var(--surface); border: 1px solid var(--border); display: flex; align-items: center; justify-content: center; font-family: var(--font-display); font-size: 20px; font-weight: 700; }
      .ludo-players { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 10px; width: 100%; max-width: 600px; }
      .ludo-player-panel { border: 1px solid var(--border); border-left-width: 4px; border-radius: 8px; padding: 10px 12px; background: var(--surface); }
      .ludo-player-panel.active-turn { background: var(--surface-raised); }
      .ludo-player-name { font-weight: 700; font-size: 13px; margin-bottom: 4px; }
      .ludo-player-stats { display: flex; gap: 12px; font-size: 11px; color: var(--text-muted); margin-bottom: 6px; }
      .ludo-home-stretch { display: flex; gap: 3px; min-height: 14px; }
      .ludo-token-dot.stretch { width: 12px; height: 12px; }
      .ludo-yard-enter-btn { margin-top: 6px; font-size: 11px; padding: 4px 8px; background: transparent; border: 1px solid; border-radius: 6px; color: var(--text); display: block; }
    `;
    document.head.appendChild(style);
  }

  async function withState(fn) {
    const { data } = await ctx.supabase.from(ctx.TABLES.GAME_STATE).select('state').eq('room_id', ctx.roomId).single();
    const state = data.state;
    fn(state);
    await ctx.supabase.from(ctx.TABLES.GAME_STATE).update({ state }).eq('room_id', ctx.roomId);
  }

  async function rollDice() {
    await withState((state) => {
      if (state.turn !== ctx.playerId || state.rolledThisTurn || state.status !== 'playing') return;
      const dice = 1 + Math.floor(Math.random() * 6);
      state.dice = dice;
      state.rolledThisTurn = true;

      const movable = movableTokens(state, ctx.playerId, dice);
      if (movable.length === 0) {
        // no legal moves - pass turn (extra turn on 6 doesn't apply if nothing could move)
        advanceTurn(state, dice === 6);
      }
    });
  }

  function advanceTurn(state, grantExtra) {
    if (grantExtra) {
      state.rolledThisTurn = false;
      state.dice = null;
      return; // same player goes again
    }
    const order = state.order;
    const idx = order.indexOf(state.turn);
    state.turn = order[(idx + 1) % order.length];
    state.rolledThisTurn = false;
    state.dice = null;
  }

  async function moveToken(tokenIndex) {
    await withState((state) => {
      if (state.turn !== ctx.playerId || !state.rolledThisTurn || state.status !== 'playing') return;
      const dice = state.dice;
      const tokens = state.tokens[ctx.playerId];
      const current = tokens[tokenIndex];

      let captured = false;

      if (current === -1) {
        if (dice !== 6) return;
        tokens[tokenIndex] = 0;
      } else {
        const next = current + dice;
        if (next > FINISH_STEP) return;
        tokens[tokenIndex] = next;
      }

      // Capture check (only relevant when landing on the shared ring, not home stretch)
      const newProgress = tokens[tokenIndex];
      if (newProgress >= 0 && newProgress <= 50) {
        const landedSquare = ringPosition(ctx.playerId, newProgress, state);
        if (!isSafeRingSquare(landedSquare)) {
          state.order.forEach(otherId => {
            if (otherId === ctx.playerId) return;
            state.tokens[otherId] = state.tokens[otherId].map(p => {
              if (p >= 0 && p <= 50 && ringPosition(otherId, p, state) === landedSquare) {
                captured = true;
                return -1;
              }
              return p;
            });
          });
        }
      }

      const allHome = tokens.every(t => t === FINISH_STEP);
      if (allHome) {
        state.status = 'finished';
        state.winner = ctx.playerId;
        return;
      }

      advanceTurn(state, state.dice === 6 || captured);
    });
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
  window.GameModules.ludo = {
    getInitialState,
    start,
    cleanup,
    tutorial: `
      <h4>Goal</h4>
      <p>Get all 4 of your tokens all the way around the board and home before anyone else.</p>
      <h4>How to play</h4>
      <ul>
        <li>Roll a 6 to bring a token out of your yard onto the board.</li>
        <li>Move a token forward by the number you roll.</li>
        <li>Landing exactly on an opponent's token sends it back to their yard — unless it's on a highlighted safe square.</li>
        <li>Rolling a 6, or capturing a token, earns you another roll.</li>
        <li>You need the exact number to enter your final home stretch and finish a token.</li>
        <li>First to get all 4 tokens home wins.</li>
      </ul>
      <p>Board note: this uses a numbered ring layout instead of the traditional cross-shaped board, but the rules are the same classic Ludo.</p>
    `,
  };
})();
