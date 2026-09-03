// games/connect4.js
// Classic Connect 4: 7 columns x 6 rows, drop pieces, connect 4 to win.

(function () {
  const COLS = 7, ROWS = 6;
  let channel = null;
  let ctx = null;

  function getInitialState(players) {
    return {
      board: Array(COLS * ROWS).fill(null),   // index = row * COLS + col, row 0 = top
      order: players.map(p => p.playerId),
      colors: { [players[0].playerId]: 'r', [players[1].playerId]: 'y' },
      turn: players[0].playerId,
      winner: null,
      winCells: null,
    };
  }

  function idx(row, col) { return row * COLS + col; }

  function lowestEmptyRow(board, col) {
    for (let row = ROWS - 1; row >= 0; row--) {
      if (!board[idx(row, col)]) return row;
    }
    return -1;
  }

  function checkWin(board, color) {
    const dirs = [[0,1],[1,0],[1,1],[1,-1]];
    for (let row = 0; row < ROWS; row++) {
      for (let col = 0; col < COLS; col++) {
        if (board[idx(row, col)] !== color) continue;
        for (const [dr, dc] of dirs) {
          const cells = [[row, col]];
          for (let step = 1; step < 4; step++) {
            const r = row + dr * step, c = col + dc * step;
            if (r < 0 || r >= ROWS || c < 0 || c >= COLS || board[idx(r, c)] !== color) break;
            cells.push([r, c]);
          }
          if (cells.length === 4) return cells.map(([r, c]) => idx(r, c));
        }
      }
    }
    return null;
  }

  function render(container, state) {
    const myColor = state.colors[ctx.playerId];
    const myTurn = state.turn === ctx.playerId && !state.winner;

    let statusText = '';
    if (state.winner === 'draw') statusText = "It's a draw!";
    else if (state.winner) {
      statusText = state.winner === ctx.playerId ? 'You connected 4! 🎉' : `${nameOf(state.winner)} connected 4.`;
    } else {
      statusText = myTurn ? 'Your turn — pick a column' : "Opponent's turn";
    }
    ctx.setStatus(statusText);

    container.innerHTML = `
      <div class="c4-board">
        ${Array.from({ length: COLS }).map((_, col) => `<div class="c4-col" data-col="${col}"></div>`).join('')}
      </div>
      ${state.winner ? '<button class="btn btn-primary" id="c4Rematch">Rematch</button>' : ''}
    `;

    if (!document.getElementById('c4Styles')) {
      const style = document.createElement('style');
      style.id = 'c4Styles';
      style.textContent = `
        .c4-board { display: flex; gap: 6px; background: #16407a; padding: 10px; border-radius: 12px; }
        .c4-col { display: flex; flex-direction: column; gap: 6px; cursor: pointer; }
        .c4-cell { width: 40px; height: 40px; border-radius: 50%; background: #0d1a2e; }
        .c4-cell.r { background: #E85D75; }
        .c4-cell.y { background: #F2B84B; }
        .c4-cell.win { box-shadow: 0 0 0 3px #fff inset; }
        .c4-col:hover .c4-cell.empty-hint { background: rgba(255,255,255,0.08); }
      `;
      document.head.appendChild(style);
    }

    container.querySelectorAll('.c4-col').forEach(colEl => {
      const col = parseInt(colEl.dataset.col, 10);
      for (let row = 0; row < ROWS; row++) {
        const val = state.board[idx(row, col)];
        const cell = document.createElement('div');
        cell.className = 'c4-cell' + (val ? ' ' + val : ' empty-hint') + (state.winCells && state.winCells.includes(idx(row, col)) ? ' win' : '');
        colEl.appendChild(cell);
      }
      if (myTurn) colEl.addEventListener('click', () => dropPiece(col));
    });

    const rematchBtn = document.getElementById('c4Rematch');
    if (rematchBtn) rematchBtn.addEventListener('click', rematch);
  }

  function nameOf(playerId) {
    return ctx.players.find(p => p.playerId === playerId)?.username || 'Player';
  }

  async function dropPiece(col) {
    const { data } = await ctx.supabase.from(ctx.TABLES.GAME_STATE).select('state').eq('room_id', ctx.roomId).single();
    const state = data.state;
    if (state.winner || state.turn !== ctx.playerId) return;

    const row = lowestEmptyRow(state.board, col);
    if (row === -1) return; // column full

    const myColor = state.colors[ctx.playerId];
    state.board[idx(row, col)] = myColor;

    const winCells = checkWin(state.board, myColor);
    if (winCells) {
      state.winner = ctx.playerId;
      state.winCells = winCells;
    } else if (state.board.every(c => c)) {
      state.winner = 'draw';
    } else {
      state.turn = state.order.find(id => id !== ctx.playerId);
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
  window.GameModules.connect4 = {
    getInitialState,
    start,
    cleanup,
    tutorial: `
      <h4>Goal</h4>
      <p>Be the first to connect 4 of your pieces in a row — horizontally, vertically, or diagonally.</p>
      <h4>How to play</h4>
      <ul>
        <li>Players take turns dropping a piece into any column.</li>
        <li>Pieces fall to the lowest empty spot in that column.</li>
        <li>First to line up 4 wins. Full board with no winner = draw.</li>
      </ul>
    `,
  };
})();
