// games/chess.js
// Standard chess for 2 players with full legal-move filtering (a move is
// illegal if it leaves your own king in check). Castling and en passant
// are not implemented; pawns auto-promote to queen. Board index 0 = a8
// (top-left from white's view), index 63 = h1.

(function () {
  let channel = null;
  let ctx = null;
  let selectedSquare = null;

  const FILES = 'abcdefgh';

  function startBoard() {
    const back = ['r', 'n', 'b', 'q', 'k', 'b', 'n', 'r'];
    const board = Array(64).fill(null);
    back.forEach((t, i) => { board[i] = { type: t, color: 'b' }; });
    for (let i = 8; i < 16; i++) board[i] = { type: 'p', color: 'b' };
    for (let i = 48; i < 56; i++) board[i] = { type: 'p', color: 'w' };
    back.forEach((t, i) => { board[56 + i] = { type: t, color: 'w' }; });
    return board;
  }

  function getInitialState(players) {
    return {
      board: startBoard(),
      players: { w: players[0].playerId, b: players[1].playerId },
      turn: 'w',
      status: 'playing',   // 'playing' | 'checkmate' | 'stalemate'
      winner: null,
      lastMove: null,
    };
  }

  function rc(i) { return { r: Math.floor(i / 8), c: i % 8 }; }
  function ix(r, c) { return r * 8 + c; }
  function inBounds(r, c) { return r >= 0 && r < 8 && c >= 0 && c < 8; }

  function pseudoMoves(board, from) {
    const piece = board[from];
    if (!piece) return [];
    const { r, c } = rc(from);
    const moves = [];
    const dir = piece.color === 'w' ? -1 : 1;

    const slide = (dirs) => {
      for (const [dr, dc] of dirs) {
        let nr = r + dr, nc = c + dc;
        while (inBounds(nr, nc)) {
          const target = board[ix(nr, nc)];
          if (!target) { moves.push(ix(nr, nc)); }
          else { if (target.color !== piece.color) moves.push(ix(nr, nc)); break; }
          nr += dr; nc += dc;
        }
      }
    };

    if (piece.type === 'p') {
      const oneStep = ix(r + dir, c);
      if (inBounds(r + dir, c) && !board[oneStep]) {
        moves.push(oneStep);
        const startRow = piece.color === 'w' ? 6 : 1;
        const twoStep = ix(r + dir * 2, c);
        if (r === startRow && !board[twoStep]) moves.push(twoStep);
      }
      for (const dc of [-1, 1]) {
        const nr = r + dir, nc = c + dc;
        if (inBounds(nr, nc)) {
          const target = board[ix(nr, nc)];
          if (target && target.color !== piece.color) moves.push(ix(nr, nc));
        }
      }
    } else if (piece.type === 'n') {
      const deltas = [[-2,-1],[-2,1],[-1,-2],[-1,2],[1,-2],[1,2],[2,-1],[2,1]];
      for (const [dr, dc] of deltas) {
        const nr = r + dr, nc = c + dc;
        if (inBounds(nr, nc)) {
          const target = board[ix(nr, nc)];
          if (!target || target.color !== piece.color) moves.push(ix(nr, nc));
        }
      }
    } else if (piece.type === 'b') {
      slide([[-1,-1],[-1,1],[1,-1],[1,1]]);
    } else if (piece.type === 'r') {
      slide([[-1,0],[1,0],[0,-1],[0,1]]);
    } else if (piece.type === 'q') {
      slide([[-1,-1],[-1,1],[1,-1],[1,1],[-1,0],[1,0],[0,-1],[0,1]]);
    } else if (piece.type === 'k') {
      const deltas = [[-1,-1],[-1,0],[-1,1],[0,-1],[0,1],[1,-1],[1,0],[1,1]];
      for (const [dr, dc] of deltas) {
        const nr = r + dr, nc = c + dc;
        if (inBounds(nr, nc)) {
          const target = board[ix(nr, nc)];
          if (!target || target.color !== piece.color) moves.push(ix(nr, nc));
        }
      }
    }
    return moves;
  }

  function findKing(board, color) {
    return board.findIndex(p => p && p.type === 'k' && p.color === color);
  }

  function isSquareAttacked(board, square, byColor) {
    for (let i = 0; i < 64; i++) {
      const p = board[i];
      if (p && p.color === byColor) {
        if (pseudoMoves(board, i).includes(square)) return true;
      }
    }
    return false;
  }

  function isInCheck(board, color) {
    const kingSquare = findKing(board, color);
    if (kingSquare === -1) return false;
    return isSquareAttacked(board, kingSquare, color === 'w' ? 'b' : 'w');
  }

  function legalMoves(board, from) {
    const piece = board[from];
    if (!piece) return [];
    const candidates = pseudoMoves(board, from);
    return candidates.filter(to => {
      const testBoard = board.slice();
      testBoard[to] = testBoard[from];
      testBoard[from] = null;
      return !isInCheck(testBoard, piece.color);
    });
  }

  function allLegalMoves(board, color) {
    let all = [];
    for (let i = 0; i < 64; i++) {
      const p = board[i];
      if (p && p.color === color) {
        legalMoves(board, i).forEach(to => all.push([i, to]));
      }
    }
    return all;
  }

  const GLYPHS = {
    w: { p: '♙', n: '♘', b: '♗', r: '♖', q: '♕', k: '♔' },
    b: { p: '♟', n: '♞', b: '♝', r: '♜', q: '♛', k: '♚' },
  };

  function nameOf(playerId) {
    return ctx.players.find(p => p.playerId === playerId)?.username || 'Player';
  }

  function render(container, state) {
    const myColor = state.players.w === ctx.playerId ? 'w' : 'b';
    const myTurn = state.turn === myColor && state.status === 'playing';

    let statusText = '';
    if (state.status === 'checkmate') statusText = `Checkmate — ${nameOf(state.winner)} wins!`;
    else if (state.status === 'stalemate') statusText = 'Stalemate — draw.';
    else statusText = (myTurn ? 'Your move' : "Opponent's move") + (isInCheck(state.board, state.turn) ? ' — Check!' : '');
    ctx.setStatus(statusText);

    const legal = selectedSquare !== null && myTurn ? legalMoves(state.board, selectedSquare) : [];

    container.innerHTML = `<div class="chess-board"></div>`;
    injectStyles();
    const boardEl = container.querySelector('.chess-board');

    for (let i = 0; i < 64; i++) {
      const { r, c } = rc(i);
      const light = (r + c) % 2 === 0;
      const cell = document.createElement('div');
      cell.className = 'chess-cell ' + (light ? 'light' : 'dark') +
        (selectedSquare === i ? ' selected' : '') +
        (legal.includes(i) ? ' legal' : '');
      const piece = state.board[i];
      if (piece) {
        cell.textContent = GLYPHS[piece.color][piece.type];
        cell.classList.add('piece-' + piece.color);
      }
      cell.addEventListener('click', () => handleClick(i, state, myColor, myTurn));
      boardEl.appendChild(cell);
    }
  }

  function injectStyles() {
    if (document.getElementById('chessStyles')) return;
    const style = document.createElement('style');
    style.id = 'chessStyles';
    style.textContent = `
      .chess-board { display: grid; grid-template-columns: repeat(8, 1fr); width: 100%; max-width: 420px; aspect-ratio: 1; border: 2px solid var(--border); border-radius: 8px; overflow: hidden; }
      .chess-cell { display: flex; align-items: center; justify-content: center; font-size: clamp(20px, 4vw, 30px); cursor: pointer; position: relative; }
      .chess-cell.light { background: #2a3040; }
      .chess-cell.dark { background: #191c26; }
      .chess-cell.piece-w { color: #f4f4f4; }
      .chess-cell.piece-b { color: #1a1a1a; text-shadow: 0 0 2px rgba(255,255,255,0.6); }
      .chess-cell.selected { box-shadow: inset 0 0 0 3px var(--accent); }
      .chess-cell.legal::after { content: ''; position: absolute; width: 22%; height: 22%; border-radius: 50%; background: rgba(79, 209, 197, 0.6); }
      .chess-cell.legal.piece-w::after, .chess-cell.legal.piece-b::after { width: 90%; height: 90%; background: transparent; border: 3px solid rgba(255,107,107,0.7); border-radius: 50%; }
    `;
    document.head.appendChild(style);
  }

  function handleClick(i, state, myColor, myTurn) {
    if (!myTurn) return;
    const piece = state.board[i];

    if (selectedSquare === null) {
      if (piece && piece.color === myColor) selectedSquare = i;
      render(document.getElementById('gameContainer'), state);
      return;
    }

    if (selectedSquare === i) {
      selectedSquare = null;
      render(document.getElementById('gameContainer'), state);
      return;
    }

    const legal = legalMoves(state.board, selectedSquare);
    if (legal.includes(i)) {
      makeMove(selectedSquare, i);
      selectedSquare = null;
    } else if (piece && piece.color === myColor) {
      selectedSquare = i;
      render(document.getElementById('gameContainer'), state);
    } else {
      selectedSquare = null;
      render(document.getElementById('gameContainer'), state);
    }
  }

  async function makeMove(from, to) {
    const { data } = await ctx.supabase.from(ctx.TABLES.GAME_STATE).select('state').eq('room_id', ctx.roomId).single();
    const state = data.state;
    const piece = state.board[from];
    if (!piece) return;

    state.board[to] = piece;
    state.board[from] = null;

    // Auto-promote pawns reaching the far rank
    const { r } = rc(to);
    if (piece.type === 'p' && (r === 0 || r === 7)) piece.type = 'q';

    state.lastMove = { from, to };
    const nextColor = state.turn === 'w' ? 'b' : 'w';
    state.turn = nextColor;

    const nextMoves = allLegalMoves(state.board, nextColor);
    if (nextMoves.length === 0) {
      if (isInCheck(state.board, nextColor)) {
        state.status = 'checkmate';
        state.winner = state.players[piece.color];
      } else {
        state.status = 'stalemate';
      }
    }

    await ctx.supabase.from(ctx.TABLES.GAME_STATE).update({ state }).eq('room_id', ctx.roomId);
  }

  function start(container, gameCtx) {
    ctx = gameCtx;
    selectedSquare = null;
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
    selectedSquare = null;
  }

  window.GameModules = window.GameModules || {};
  window.GameModules.chess = {
    getInitialState,
    start,
    cleanup,
    tutorial: `
      <h4>Goal</h4>
      <p>Checkmate your opponent's king — put it in check with no legal way out.</p>
      <h4>How to play</h4>
      <ul>
        <li>Tap a piece to select it — legal destination squares light up.</li>
        <li>Tap a highlighted square to move there.</li>
        <li>Pawns reaching the far row automatically promote to a queen.</li>
        <li>You cannot make a move that leaves your own king in check.</li>
      </ul>
      <p>Note: castling and en passant aren't implemented in this version.</p>
    `,
  };
})();
