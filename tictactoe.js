// games/tictactoe.js
// Classic 3x3 Tic-Tac-Toe, 2 players, synced through the shared game_state table.

(function () {
  const LINES = [
    [0,1,2],[3,4,5],[6,7,8],
    [0,3,6],[1,4,7],[2,5,8],
    [0,4,8],[2,4,6],
  ];

  let channel = null;
  let ctx = null;
  let mySymbol = null;

  function getInitialState(players) {
    return {
      board: Array(9).fill(null),
      order: players.map(p => p.playerId),         // [p1, p2]
      symbols: { [players[0].playerId]: 'X', [players[1].playerId]: 'O' },
      turn: players[0].playerId,
      winner: null,       // playerId, 'draw', or null
      winLine: null,
    };
  }

  function checkWinner(board) {
    for (const line of LINES) {
      const [a, b, c] = line;
      if (board[a] && board[a] === board[b] && board[b] === board[c]) {
        return { symbol: board[a], line };
      }
    }
    if (board.every(cell => cell)) return { symbol: 'draw', line: null };
    return null;
  }

  function render(container, state) {
    const symbolToId = {};
    Object.entries(state.symbols).forEach(([id, sym]) => { symbolToId[sym] = id; });
    const myTurn = state.turn === ctx.playerId && !state.winner;

    let statusText = '';
    if (state.winner === 'draw') statusText = "It's a draw!";
    else if (state.winner) {
      const winnerName = ctx.players.find(p => p.playerId === state.winner)?.username || 'Someone';
      statusText = state.winner === ctx.playerId ? 'You won! 🎉' : `${winnerName} won.`;
    } else {
      statusText = myTurn ? 'Your turn' : "Opponent's turn";
    }
    ctx.setStatus(statusText);

    container.innerHTML = `
      <div class="ttt-board"></div>
      ${state.winner ? '<button class="btn btn-primary" id="tttRematch">Rematch</button>' : ''}
    `;

    if (!document.getElementById('tttStyles')) {
      const style = document.createElement('style');
      style.id = 'tttStyles';
      style.textContent = `
        .ttt-board { display: grid; grid-template-columns: repeat(3, 90px); grid-template-rows: repeat(3, 90px); gap: 8px; margin-bottom: 20px; }
        .ttt-cell { background: var(--surface); border: 1px solid var(--border); border-radius: 10px; font-size: 40px; font-weight: 800; font-family: var(--font-display); display: flex; align-items: center; justify-content: center; cursor: pointer; color: var(--text); }
        .ttt-cell:hover:not(.filled) { border-color: var(--accent); }
        .ttt-cell.filled { cursor: default; }
        .ttt-cell.x { color: var(--accent); }
        .ttt-cell.o { color: var(--online); }
        .ttt-cell.win { background: var(--surface-raised); border-color: var(--accent); }
      `;
      document.head.appendChild(style);
    }

    const boardEl = container.querySelector('.ttt-board');
    state.board.forEach((val, i) => {
      const cell = document.createElement('div');
      cell.className = 'ttt-cell' + (val ? ' filled ' + val.toLowerCase() : '') + (state.winLine && state.winLine.includes(i) ? ' win' : '');
      cell.textContent = val || '';
      if (!val && myTurn) {
        cell.addEventListener('click', () => makeMove(i));
      }
      boardEl.appendChild(cell);
    });

    const rematchBtn = document.getElementById('tttRematch');
    if (rematchBtn) rematchBtn.addEventListener('click', requestRematch);
  }

  async function makeMove(index) {
    const { data } = await ctx.supabase.from(ctx.TABLES.GAME_STATE).select('state').eq('room_id', ctx.roomId).single();
    const state = data.state;
    if (state.board[index] || state.winner || state.turn !== ctx.playerId) return;

    state.board[index] = state.symbols[ctx.playerId];
    const result = checkWinner(state.board);
    if (result) {
      state.winner = result.symbol === 'draw' ? 'draw' : ctx.playerId;
      state.winLine = result.line;
    } else {
      state.turn = state.order.find(id => id !== ctx.playerId);
    }
    await ctx.supabase.from(ctx.TABLES.GAME_STATE).update({ state }).eq('room_id', ctx.roomId);
  }

  async function requestRematch() {
    const state = getInitialState(ctx.players.map(p => ({ playerId: p.playerId })));
    // Keep the same symbol assignment and starting player rotation feel fair: alternate who starts.
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
  window.GameModules.tictactoe = {
    getInitialState,
    start,
    cleanup,
    tutorial: `
      <h4>Goal</h4>
      <p>Get three of your symbols in a row — horizontally, vertically, or diagonally — before your opponent does.</p>
      <h4>How to play</h4>
      <ul>
        <li>You're assigned X or O when the game starts.</li>
        <li>Players take turns tapping an empty square.</li>
        <li>First to line up 3 wins. If the board fills up with no winner, it's a draw.</li>
      </ul>
      <h4>Rematch</h4>
      <p>After a game ends, either player can hit Rematch to reset the board.</p>
    `,
  };
})();
