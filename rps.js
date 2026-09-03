// games/rps.js
// Rock Paper Scissors, 2 players, best of 3 rounds.

(function () {
  let channel = null;
  let ctx = null;

  const BEATS = { rock: 'scissors', paper: 'rock', scissors: 'paper' };
  const EMOJI = { rock: '✊', paper: '✋', scissors: '✌️' };

  function getInitialState(players) {
    return {
      order: players.map(p => p.playerId),
      choices: {},              // { playerId: 'rock'|'paper'|'scissors' } - cleared each round
      scores: { [players[0].playerId]: 0, [players[1].playerId]: 0 },
      round: 1,
      lastResult: null,         // { winner: playerId|'draw', choices: {...} }
      matchWinner: null,
    };
  }

  function render(container, state) {
    const [p1, p2] = state.order;
    const me = ctx.playerId;
    const opponent = state.order.find(id => id !== me);
    const iChose = !!state.choices[me];
    const bothChose = state.choices[p1] && state.choices[p2];

    let statusText = '';
    if (state.matchWinner) {
      statusText = state.matchWinner === me ? 'You won the match! 🏆' : `${nameOf(state.matchWinner)} won the match.`;
    } else if (state.lastResult) {
      statusText = `Round ${state.round - 1} result shown below`;
    } else {
      statusText = iChose ? 'Waiting for opponent…' : 'Pick rock, paper, or scissors';
    }
    ctx.setStatus(statusText);

    const p1Name = nameOf(p1), p2Name = nameOf(p2);

    container.innerHTML = `
      <div class="rps-scoreboard">
        <div class="rps-score"><span>${escapeHtml(p1Name)}</span><strong>${state.scores[p1]}</strong></div>
        <div class="rps-round">Round ${Math.min(state.round, 3)} of 3</div>
        <div class="rps-score"><span>${escapeHtml(p2Name)}</span><strong>${state.scores[p2]}</strong></div>
      </div>
      ${state.lastResult ? renderResult(state) : ''}
      ${!state.matchWinner ? renderChoices(iChose) : `<button class="btn btn-primary" id="rpsRematch">Play again</button>`}
    `;

    if (!document.getElementById('rpsStyles')) {
      const style = document.createElement('style');
      style.id = 'rpsStyles';
      style.textContent = `
        .rps-scoreboard { display: flex; align-items: center; gap: 20px; margin-bottom: 16px; }
        .rps-score { display: flex; flex-direction: column; align-items: center; font-size: 13px; color: var(--text-muted); }
        .rps-score strong { font-size: 24px; color: var(--accent); font-family: var(--font-display); }
        .rps-round { font-size: 12px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
        .rps-choices { display: flex; gap: 14px; margin-top: 10px; }
        .rps-choice-btn { width: 80px; height: 80px; border-radius: 50%; background: var(--surface); border: 1px solid var(--border); font-size: 32px; display: flex; align-items: center; justify-content: center; }
        .rps-choice-btn:hover:not(:disabled) { border-color: var(--accent); transform: translateY(-2px); }
        .rps-choice-btn:disabled { opacity: 0.4; }
        .rps-result { display: flex; align-items: center; gap: 24px; margin: 16px 0; font-size: 40px; }
        .rps-result-line { font-size: 14px; color: var(--text-muted); text-align: center; margin-bottom: 10px; }
      `;
      document.head.appendChild(style);
    }

    container.querySelectorAll('.rps-choice-btn').forEach(btn => {
      btn.addEventListener('click', () => makeChoice(btn.dataset.choice));
    });
    const rematchBtn = document.getElementById('rpsRematch');
    if (rematchBtn) rematchBtn.addEventListener('click', rematch);
  }

  function nameOf(playerId) {
    return ctx.players.find(p => p.playerId === playerId)?.username || 'Player';
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function renderChoices(disabled) {
    return `
      <div class="rps-choices">
        <button class="rps-choice-btn" data-choice="rock" ${disabled ? 'disabled' : ''}>✊</button>
        <button class="rps-choice-btn" data-choice="paper" ${disabled ? 'disabled' : ''}>✋</button>
        <button class="rps-choice-btn" data-choice="scissors" ${disabled ? 'disabled' : ''}>✌️</button>
      </div>
    `;
  }

  function renderResult(state) {
    const [p1, p2] = state.order;
    const r = state.lastResult;
    let line;
    if (r.winner === 'draw') line = "Draw — nobody scores.";
    else line = `${nameOf(r.winner)} wins the round.`;
    return `
      <div class="rps-result-line">${line}</div>
      <div class="rps-result">
        <span>${EMOJI[r.choices[p1]]}</span>
        <span style="font-size:16px;color:var(--text-muted);">vs</span>
        <span>${EMOJI[r.choices[p2]]}</span>
      </div>
    `;
  }

  async function makeChoice(choice) {
    const { data } = await ctx.supabase.from(ctx.TABLES.GAME_STATE).select('state').eq('room_id', ctx.roomId).single();
    const state = data.state;
    if (state.matchWinner || state.choices[ctx.playerId]) return;

    state.choices[ctx.playerId] = choice;
    const [p1, p2] = state.order;

    if (state.choices[p1] && state.choices[p2]) {
      const c1 = state.choices[p1], c2 = state.choices[p2];
      let winner = 'draw';
      if (c1 !== c2) winner = BEATS[c1] === c2 ? p1 : p2;
      if (winner !== 'draw') state.scores[winner] += 1;
      state.lastResult = { winner, choices: { ...state.choices } };

      if (state.scores[p1] >= 2 || state.scores[p2] >= 2) {
        state.matchWinner = state.scores[p1] >= 2 ? p1 : p2;
      } else {
        state.round += 1;
        state.choices = {};
      }
    }

    await ctx.supabase.from(ctx.TABLES.GAME_STATE).update({ state }).eq('room_id', ctx.roomId);
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
  window.GameModules.rps = {
    getInitialState,
    start,
    cleanup,
    tutorial: `
      <h4>Goal</h4>
      <p>Win 2 out of 3 rounds to win the match.</p>
      <h4>Rules</h4>
      <ul>
        <li>Rock beats Scissors</li>
        <li>Scissors beats Paper</li>
        <li>Paper beats Rock</li>
        <li>Same choice = round draw, nobody scores</li>
      </ul>
      <h4>How to play</h4>
      <p>Both players pick privately each round. Once both have chosen, results reveal automatically and the next round begins.</p>
    `,
  };
})();
