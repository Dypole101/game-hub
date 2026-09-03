// games/snake.js
// Multiplayer Snake: 2-5 players share one grid. The room host runs the
// authoritative game loop (moves everyone, checks collisions, writes state);
// every client (including the host) sends direction changes over a realtime
// broadcast channel for low-latency input.

(function () {
  const GRID = 22;
  const TICK_MS = 180;
  const COLORS = ['#6BCB77', '#F2B84B', '#5B8DEF', '#E85D75', '#C68FFF'];
  const START_POSITIONS = [
    { x: 3, y: 3, dir: { x: 1, y: 0 } },
    { x: GRID - 4, y: GRID - 4, dir: { x: -1, y: 0 } },
    { x: GRID - 4, y: 3, dir: { x: -1, y: 0 } },
    { x: 3, y: GRID - 4, dir: { x: 1, y: 0 } },
    { x: Math.floor(GRID / 2), y: 3, dir: { x: 0, y: 1 } },
  ];

  let channel = null;
  let ctx = null;
  let tickInterval = null;
  let localState = null;   // host's authoritative in-memory copy
  let myDir = { x: 1, y: 0 };
  let keyHandler = null;

  function getInitialState(players) {
    const snakes = {};
    players.forEach((p, i) => {
      const start = START_POSITIONS[i] || START_POSITIONS[0];
      snakes[p.playerId] = {
        body: [{ x: start.x, y: start.y }],
        dir: { ...start.dir },
        alive: true,
        score: 0,
        color: COLORS[i % COLORS.length],
      };
    });
    return {
      order: players.map(p => p.playerId),
      snakes,
      food: randomFood(snakes),
      status: 'playing',
      winner: null,
      tick: 0,
    };
  }

  function randomFood(snakes) {
    const occupied = new Set();
    Object.values(snakes).forEach(s => s.body.forEach(seg => occupied.add(seg.x + ',' + seg.y)));
    let pos;
    do {
      pos = { x: Math.floor(Math.random() * GRID), y: Math.floor(Math.random() * GRID) };
    } while (occupied.has(pos.x + ',' + pos.y));
    return pos;
  }

  function nameOf(playerId) {
    return ctx.players.find(p => p.playerId === playerId)?.username || 'Player';
  }

  // ---- Host-only simulation ----

  function stepSimulation(state) {
    const nextHeads = {};
    for (const id of state.order) {
      const snake = state.snakes[id];
      if (!snake.alive) continue;
      const head = snake.body[0];
      nextHeads[id] = { x: head.x + snake.dir.x, y: head.y + snake.dir.y };
    }

    // Wall collisions
    for (const id of state.order) {
      const snake = state.snakes[id];
      if (!snake.alive) continue;
      const h = nextHeads[id];
      if (h.x < 0 || h.x >= GRID || h.y < 0 || h.y >= GRID) snake.alive = false;
    }

    // Self + other-snake body collisions (check against current bodies, tail will move so exclude last segment unless growing)
    for (const id of state.order) {
      const snake = state.snakes[id];
      if (!snake.alive) continue;
      const h = nextHeads[id];
      for (const otherId of state.order) {
        const other = state.snakes[otherId];
        if (!other.alive) continue;
        const bodyToCheck = otherId === id ? other.body : other.body;
        for (let i = 0; i < bodyToCheck.length - 1; i++) { // exclude tail tip since it moves away
          if (bodyToCheck[i].x === h.x && bodyToCheck[i].y === h.y) snake.alive = false;
        }
      }
    }

    // Head-to-head collision
    const headPositions = {};
    for (const id of state.order) {
      const snake = state.snakes[id];
      if (!snake.alive || !nextHeads[id]) continue;
      const key = nextHeads[id].x + ',' + nextHeads[id].y;
      if (headPositions[key]) {
        state.snakes[headPositions[key]].alive = false;
        snake.alive = false;
      } else {
        headPositions[key] = id;
      }
    }

    // Apply moves for survivors
    let ateAny = false;
    for (const id of state.order) {
      const snake = state.snakes[id];
      if (!snake.alive || !nextHeads[id]) continue;
      snake.body.unshift(nextHeads[id]);
      if (nextHeads[id].x === state.food.x && nextHeads[id].y === state.food.y) {
        snake.score += 1;
        ateAny = true;
      } else {
        snake.body.pop();
      }
    }
    if (ateAny) state.food = randomFood(state.snakes);

    state.tick += 1;

    const aliveIds = state.order.filter(id => state.snakes[id].alive);
    if (aliveIds.length <= 1 && state.order.length > 1) {
      state.status = 'finished';
      state.winner = aliveIds[0] || null;
    } else if (aliveIds.length === 0) {
      state.status = 'finished';
      state.winner = null;
    }

    return state;
  }

  async function hostTick() {
    if (!localState || localState.status !== 'playing') return;
    stepSimulation(localState);
    await ctx.supabase.from(ctx.TABLES.GAME_STATE).update({ state: localState }).eq('room_id', ctx.roomId);
    if (localState.status === 'finished') {
      clearInterval(tickInterval);
      tickInterval = null;
    }
  }

  // ---- Rendering ----

  function render(container, state) {
    if (!container.querySelector('.snake-wrap')) {
      container.innerHTML = `
        <div class="snake-wrap">
          <canvas id="snakeCanvas" width="440" height="440"></canvas>
          <div class="snake-scores" id="snakeScores"></div>
          <div class="snake-controls" id="snakeControls">
            <button class="snake-btn" data-dir="up">▲</button>
            <div class="snake-mid-row">
              <button class="snake-btn" data-dir="left">◀</button>
              <button class="snake-btn" data-dir="down">▼</button>
              <button class="snake-btn" data-dir="right">▶</button>
            </div>
          </div>
        </div>
      `;
      injectStyles();
      container.querySelectorAll('.snake-btn').forEach(btn => {
        btn.addEventListener('click', () => setDirection(btn.dataset.dir));
      });
    }

    const myAlive = state.snakes[ctx.playerId]?.alive;
    let statusText = '';
    if (state.status === 'finished') {
      statusText = state.winner ? (state.winner === ctx.playerId ? 'You won! 🏆' : `${nameOf(state.winner)} won.`) : "It's a draw — everyone crashed.";
    } else {
      statusText = myAlive ? 'Use arrows / WASD or the on-screen pad' : 'You crashed — spectating';
    }
    ctx.setStatus(statusText);

    const canvas = document.getElementById('snakeCanvas');
    const cw = canvas.width, ch = canvas.height;
    const cell = cw / GRID;
    const g = canvas.getContext('2d');
    g.fillStyle = '#12141C';
    g.fillRect(0, 0, cw, ch);

    // subtle grid
    g.strokeStyle = 'rgba(255,255,255,0.03)';
    for (let i = 0; i <= GRID; i++) {
      g.beginPath(); g.moveTo(i * cell, 0); g.lineTo(i * cell, ch); g.stroke();
      g.beginPath(); g.moveTo(0, i * cell); g.lineTo(cw, i * cell); g.stroke();
    }

    // food
    g.fillStyle = '#F2B84B';
    g.beginPath();
    g.arc((state.food.x + 0.5) * cell, (state.food.y + 0.5) * cell, cell * 0.35, 0, Math.PI * 2);
    g.fill();

    // snakes
    state.order.forEach(id => {
      const snake = state.snakes[id];
      g.fillStyle = snake.alive ? snake.color : 'rgba(255,255,255,0.15)';
      snake.body.forEach((seg, i) => {
        const pad = i === 0 ? 1 : 2;
        g.fillRect(seg.x * cell + pad, seg.y * cell + pad, cell - pad * 2, cell - pad * 2);
      });
    });

    const scoresEl = document.getElementById('snakeScores');
    scoresEl.innerHTML = state.order.map(id => {
      const s = state.snakes[id];
      return `<div class="snake-score-chip" style="border-color:${s.color}">
        <span class="snake-score-dot" style="background:${s.alive ? s.color : '#555'}"></span>
        ${escapeHtml(nameOf(id))}: ${s.score}${!s.alive ? ' 💀' : ''}
      </div>`;
    }).join('');
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  function injectStyles() {
    if (document.getElementById('snakeStyles')) return;
    const style = document.createElement('style');
    style.id = 'snakeStyles';
    style.textContent = `
      .snake-wrap { display: flex; flex-direction: column; align-items: center; gap: 12px; }
      #snakeCanvas { width: 100%; max-width: 440px; aspect-ratio: 1; border-radius: 10px; border: 1px solid var(--border); }
      .snake-scores { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
      .snake-score-chip { font-size: 12px; padding: 4px 10px; border: 1px solid var(--border); border-radius: 999px; display: flex; align-items: center; gap: 6px; }
      .snake-score-dot { width: 8px; height: 8px; border-radius: 50%; }
      .snake-controls { display: flex; flex-direction: column; align-items: center; gap: 6px; margin-top: 4px; }
      .snake-mid-row { display: flex; gap: 6px; }
      .snake-btn { width: 48px; height: 48px; border-radius: 8px; background: var(--surface); border: 1px solid var(--border); color: var(--text); font-size: 18px; }
      .snake-btn:active { background: var(--surface-raised); }
    `;
    document.head.appendChild(style);
  }

  // ---- Input handling ----

  function setDirection(dirName) {
    const map = { up: { x: 0, y: -1 }, down: { x: 0, y: 1 }, left: { x: -1, y: 0 }, right: { x: 1, y: 0 } };
    const next = map[dirName];
    if (!next) return;
    // prevent instant 180 reversal
    if (next.x === -myDir.x && next.y === -myDir.y) return;
    myDir = next;
    channel.send({ type: 'broadcast', event: 'direction', payload: { playerId: ctx.playerId, dir: next } });
  }

  function bindKeys() {
    keyHandler = (e) => {
      const key = e.key.toLowerCase();
      if (['arrowup', 'w'].includes(key)) setDirection('up');
      else if (['arrowdown', 's'].includes(key)) setDirection('down');
      else if (['arrowleft', 'a'].includes(key)) setDirection('left');
      else if (['arrowright', 'd'].includes(key)) setDirection('right');
    };
    document.addEventListener('keydown', keyHandler);
  }

  // ---- Lifecycle ----

  function start(container, gameCtx) {
    ctx = gameCtx;
    channel = ctx.supabase.channel(`game_${ctx.roomId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: ctx.TABLES.GAME_STATE, filter: `room_id=eq.${ctx.roomId}` }, (payload) => {
        if (ctx.isHost) localState = payload.new.state; // keep host copy in sync in case of external changes
        render(container, payload.new.state);
      })
      .on('broadcast', { event: 'direction' }, (msg) => {
        if (!ctx.isHost || !localState) return;
        const snake = localState.snakes[msg.payload.playerId];
        if (!snake || !snake.alive) return;
        const d = msg.payload.dir;
        // ignore reversal into own body
        if (d.x === -snake.dir.x && d.y === -snake.dir.y) return;
        snake.dir = d;
      })
      .subscribe();

    bindKeys();

    ctx.supabase.from(ctx.TABLES.GAME_STATE).select('state').eq('room_id', ctx.roomId).single()
      .then(({ data }) => {
        if (!data) return;
        render(container, data.state);
        if (ctx.isHost) {
          localState = data.state;
          tickInterval = setInterval(hostTick, TICK_MS);
        }
      });
  }

  function cleanup() {
    if (channel) { ctx.supabase.removeChannel(channel); channel = null; }
    if (tickInterval) { clearInterval(tickInterval); tickInterval = null; }
    if (keyHandler) { document.removeEventListener('keydown', keyHandler); keyHandler = null; }
    localState = null;
  }

  window.GameModules = window.GameModules || {};
  window.GameModules.snake = {
    getInitialState,
    start,
    cleanup,
    tutorial: `
      <h4>Goal</h4>
      <p>Grow the longest by eating food. Last snake alive (or highest score if everyone survives) wins.</p>
      <h4>How to play</h4>
      <ul>
        <li>Move with arrow keys / WASD, or the on-screen pad on mobile.</li>
        <li>Eating the gold dot grows you by one segment and respawns the food.</li>
        <li>Crashing into a wall, your own body, or another snake's body takes you out.</li>
        <li>Head-on collisions eliminate both snakes involved.</li>
        <li>Round ends when one snake remains, or everyone has crashed.</li>
      </ul>
    `,
  };
})();
