// games/wordguess.js
// Hangman-style word guess: the room host picks a secret word (hidden from
// everyone else), remaining players take turns guessing letters as a team
// against a shared strike limit.

(function () {
  const MAX_STRIKES = 6;
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

  let channel = null;
  let ctx = null;

  function getInitialState(players) {
    return {
      hostId: players[0].playerId,
      order: players.map(p => p.playerId),
      phase: 'choosing',        // 'choosing' | 'guessing' | 'finished'
      word: null,               // secret word, only meaningfully used server-side comparisons
      guessed: [],               // letters guessed so far
      strikes: 0,
      turn: players[1] ? players[1].playerId : players[0].playerId, // first guesser
      result: null,              // 'won' | 'lost'
    };
  }

  function maskedWord(state) {
    if (!state.word) return '';
    return state.word.split('').map(ch => {
      if (ch === ' ') return ' ';
      return state.guessed.includes(ch.toUpperCase()) ? ch.toUpperCase() : '_';
    }).join(' ');
  }

  function render(container, state) {
    const isHost = ctx.playerId === state.hostId;
    const guessers = state.order.filter(id => id !== state.hostId);
    const myTurn = state.turn === ctx.playerId && state.phase === 'guessing';

    let statusText = '';
    if (state.phase === 'choosing') statusText = isHost ? 'Pick a secret word' : `Waiting for ${nameOf(state.hostId)} to pick a word…`;
    else if (state.phase === 'finished') statusText = state.result === 'won' ? 'The word was guessed! 🎉' : `Out of guesses — the word was "${state.word}"`;
    else statusText = myTurn ? 'Your turn — guess a letter' : isHost ? 'Watching your team guess' : `Waiting on ${nameOf(state.turn)}`;
    ctx.setStatus(statusText);

    if (state.phase === 'choosing') {
      container.innerHTML = isHost ? `
        <div class="wg-setup">
          <p class="wg-setup-hint">Type a word or short phrase (letters and spaces only). Other players won't see it.</p>
          <input type="text" id="wgWordInput" maxlength="24" placeholder="Secret word" autocomplete="off">
          <button class="btn btn-primary" id="wgSubmitWord">Start round</button>
        </div>
      ` : `<p class="wg-waiting">Sit tight while the host chooses a word.</p>`;
      injectStyles();
      const submitBtn = document.getElementById('wgSubmitWord');
      if (submitBtn) submitBtn.addEventListener('click', submitWord);
      return;
    }

    const strikesLeft = MAX_STRIKES - state.strikes;
    container.innerHTML = `
      <div class="wg-word">${maskedWord(state) || ''}</div>
      <div class="wg-strikes">Strikes: ${'✗'.repeat(state.strikes)}${'·'.repeat(Math.max(0, strikesLeft))} (${state.strikes}/${MAX_STRIKES})</div>
      ${state.phase === 'guessing' ? `<div class="wg-keyboard">${ALPHABET.map(letter => {
        const used = state.guessed.includes(letter);
        const hit = used && state.word && state.word.toUpperCase().includes(letter);
        return `<button class="wg-key ${used ? (hit ? 'hit' : 'miss') : ''}" data-letter="${letter}" ${used || !myTurn ? 'disabled' : ''}>${letter}</button>`;
      }).join('')}</div>` : ''}
      ${state.phase === 'finished' && isHost ? `<button class="btn btn-primary" id="wgNewRound">New round</button>` : ''}
    `;
    injectStyles();

    container.querySelectorAll('.wg-key').forEach(btn => {
      btn.addEventListener('click', () => guessLetter(btn.dataset.letter));
    });
    const newRoundBtn = document.getElementById('wgNewRound');
    if (newRoundBtn) newRoundBtn.addEventListener('click', startNewRound);
  }

  function injectStyles() {
    if (document.getElementById('wgStyles')) return;
    const style = document.createElement('style');
    style.id = 'wgStyles';
    style.textContent = `
      .wg-setup { display: flex; flex-direction: column; gap: 10px; align-items: center; width: 100%; max-width: 320px; }
      .wg-setup-hint { font-size: 13px; text-align: center; }
      .wg-setup input { width: 100%; background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); padding: 10px 14px; color: var(--text); font-size: 15px; }
      .wg-waiting { font-size: 14px; }
      .wg-word { font-family: var(--font-display); font-size: 32px; letter-spacing: 0.15em; margin-bottom: 12px; text-align: center; word-break: break-all; }
      .wg-strikes { font-size: 13px; color: var(--danger); margin-bottom: 20px; }
      .wg-keyboard { display: grid; grid-template-columns: repeat(7, 1fr); gap: 6px; max-width: 360px; }
      .wg-key { padding: 10px 0; border-radius: 6px; background: var(--surface); border: 1px solid var(--border); color: var(--text); font-weight: 600; }
      .wg-key:disabled { opacity: 0.4; }
      .wg-key.hit { background: rgba(79, 209, 197, 0.15); border-color: var(--online); color: var(--online); }
      .wg-key.miss { background: rgba(255, 107, 107, 0.1); border-color: var(--danger); color: var(--danger); }
    `;
    document.head.appendChild(style);
  }

  function nameOf(playerId) {
    return ctx.players.find(p => p.playerId === playerId)?.username || 'Player';
  }

  async function submitWord() {
    const input = document.getElementById('wgWordInput');
    const word = input.value.trim();
    if (!/^[a-zA-Z ]{2,24}$/.test(word)) {
      alert('Use letters and spaces only, 2-24 characters.');
      return;
    }
    const { data } = await ctx.supabase.from(ctx.TABLES.GAME_STATE).select('state').eq('room_id', ctx.roomId).single();
    const state = data.state;
    state.word = word;
    state.phase = 'guessing';
    await ctx.supabase.from(ctx.TABLES.GAME_STATE).update({ state }).eq('room_id', ctx.roomId);
  }

  async function guessLetter(letter) {
    const { data } = await ctx.supabase.from(ctx.TABLES.GAME_STATE).select('state').eq('room_id', ctx.roomId).single();
    const state = data.state;
    if (state.phase !== 'guessing' || state.turn !== ctx.playerId || state.guessed.includes(letter)) return;

    state.guessed.push(letter);
    const wordUpper = state.word.toUpperCase();
    const isHit = wordUpper.includes(letter);
    if (!isHit) state.strikes += 1;

    const fullyGuessed = wordUpper.split('').every(ch => ch === ' ' || state.guessed.includes(ch));
    if (fullyGuessed) {
      state.phase = 'finished';
      state.result = 'won';
    } else if (state.strikes >= MAX_STRIKES) {
      state.phase = 'finished';
      state.result = 'lost';
    } else {
      const guessers = state.order.filter(id => id !== state.hostId);
      const currentIdx = guessers.indexOf(ctx.playerId);
      state.turn = guessers[(currentIdx + 1) % guessers.length];
    }

    await ctx.supabase.from(ctx.TABLES.GAME_STATE).update({ state }).eq('room_id', ctx.roomId);
  }

  async function startNewRound() {
    const state = getInitialState(ctx.players.map(p => ({ playerId: p.playerId })));
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
  window.GameModules.wordguess = {
    getInitialState,
    start,
    cleanup,
    tutorial: `
      <h4>Goal</h4>
      <p>The room host picks a secret word. Everyone else works together to guess it letter by letter before running out of strikes.</p>
      <h4>How to play</h4>
      <ul>
        <li>The host types a hidden word or short phrase.</li>
        <li>Guessers take turns picking a letter from the on-screen keyboard.</li>
        <li>Correct letters reveal themselves in the word. Wrong letters cost a strike.</li>
        <li>${MAX_STRIKES} strikes and the round is lost — the word is revealed.</li>
        <li>Guess every letter in the word before that happens to win.</li>
      </ul>
    `,
  };
})();
