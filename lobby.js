// lobby.js
// Handles: persistent username, room create/join/browse, the waiting room
// screen, and starting a game by handing off to the right module in
// window.GameModules. Loaded last, after supabase-client.js and every
// game file, so window.GameModules is fully populated by the time this runs.

const sb = window.supabaseClient;

// ---------------------------------------------------------------------
// Player identity (persisted in localStorage - no login required)
// ---------------------------------------------------------------------

let currentPlayer = { id: null, username: null };
let currentRoom = null;       // { id, code, game_type, is_public, host_id, max_players, status }
let currentSeat = null;
let roomPlayersCache = [];    // array of { player_id, username, seat, is_ready }
let roomPlayersChannel = null;
let roomStatusChannel = null;
let activeGameModule = null;
let pendingCreateGameType = null;

function getStoredPlayerId() {
  return localStorage.getItem('gamehub_player_id');
}

function getStoredUsername() {
  return localStorage.getItem('gamehub_username');
}

async function initPlayer() {
  const storedId = getStoredPlayerId();
  const storedName = getStoredUsername();

  if (storedId && storedName) {
    const { data } = await sb.from(TABLES.PLAYERS).select('*').eq('id', storedId).maybeSingle();
    if (data) {
      currentPlayer = { id: data.id, username: data.username };
      await sb.from(TABLES.PLAYERS).update({ last_seen: new Date().toISOString() }).eq('id', storedId);
      finishPlayerInit();
      return;
    }
  }
  showUsernameModal(false);
}

function finishPlayerInit() {
  document.getElementById('profileUsername').textContent = currentPlayer.username;
  document.getElementById('usernameModal').classList.add('hidden');
}

function showUsernameModal(isChange) {
  const modal = document.getElementById('usernameModal');
  const input = document.getElementById('usernameInput');
  const title = modal.querySelector('h2');
  title.textContent = isChange ? 'Change your username' : 'What should we call you?';
  input.value = isChange ? currentPlayer.username : '';
  document.getElementById('usernameError').textContent = '';
  modal.classList.remove('hidden');
  input.focus();
}

async function saveUsername() {
  const input = document.getElementById('usernameInput');
  const errorEl = document.getElementById('usernameError');
  const name = input.value.trim();

  if (name.length < 2) { errorEl.textContent = 'Username needs at least 2 characters.'; return; }
  if (name.length > 16) { errorEl.textContent = 'Keep it under 16 characters.'; return; }

  try {
    if (currentPlayer.id) {
      const { error } = await sb.from(TABLES.PLAYERS).update({ username: name }).eq('id', currentPlayer.id);
      if (error) { errorEl.textContent = 'Could not save — try again.'; console.error('saveUsername update error:', error); return; }
      currentPlayer.username = name;
      localStorage.setItem('gamehub_username', name);
    } else {
      const { data, error } = await sb.from(TABLES.PLAYERS).insert({ username: name }).select().single();
      if (error) { errorEl.textContent = 'Could not save — try again.'; console.error('saveUsername insert error:', error); return; }
      currentPlayer = { id: data.id, username: data.username };
      localStorage.setItem('gamehub_player_id', data.id);
      localStorage.setItem('gamehub_username', data.username);
    }
    finishPlayerInit();
  } catch (err) {
    // Surfaced as an alert (not just console) since mobile browsers make the console hard to reach.
    alert('Unexpected error saving username: ' + (err && err.message ? err.message : err));
    console.error('saveUsername unexpected error:', err);
  }
}

// ---------------------------------------------------------------------
// Room code generation
// ---------------------------------------------------------------------

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I to avoid confusion

function generateCode() {
  let code = '';
  for (let i = 0; i < 4; i++) code += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return code;
}

async function createUniqueRoomCode() {
  for (let attempt = 0; attempt < 8; attempt++) {
    const code = generateCode();
    const { data } = await sb.from(TABLES.ROOMS).select('id').eq('code', code).maybeSingle();
    if (!data) return code;
  }
  return generateCode() + Math.floor(Math.random() * 9);
}

// ---------------------------------------------------------------------
// Create room flow
// ---------------------------------------------------------------------

function openCreateRoomModal(gameType) {
  pendingCreateGameType = gameType;
  document.getElementById('createRoomTitle').textContent = `Host ${gameLabel(gameType)}`;
  setCreateVisibility(false);
  document.getElementById('createRoomModal').classList.remove('hidden');
}

function setCreateVisibility(isPublic) {
  document.getElementById('createPrivateBtn').classList.toggle('active', !isPublic);
  document.getElementById('createPublicBtn').classList.toggle('active', isPublic);
  document.getElementById('createRoomModal').dataset.isPublic = isPublic ? '1' : '0';
}

async function confirmCreateRoom() {
  const gameType = pendingCreateGameType;
  const isPublic = document.getElementById('createRoomModal').dataset.isPublic === '1';
  const code = await createUniqueRoomCode();
  const maxPlayers = MAX_PLAYERS[gameType] || 4;

  const { data: room, error } = await sb.from(TABLES.ROOMS).insert({
    code, game_type: gameType, is_public: isPublic,
    host_id: currentPlayer.id, status: 'waiting', max_players: maxPlayers,
  }).select().single();

  if (error) { alert('Could not create room. Please try again.'); return; }

  await sb.from(TABLES.ROOM_PLAYERS).insert({
    room_id: room.id, player_id: currentPlayer.id, seat: 0, is_ready: false,
  });

  document.getElementById('createRoomModal').classList.add('hidden');
  enterRoom(room);
}

// ---------------------------------------------------------------------
// Join room flow
// ---------------------------------------------------------------------

async function joinRoomByCode(rawCode) {
  const code = rawCode.trim().toUpperCase();
  if (!code) return;

  const { data: room, error } = await sb.from(TABLES.ROOMS).select('*').eq('code', code).maybeSingle();
  if (error || !room) { alert('No room found with that code.'); return; }
  if (room.status !== 'waiting') { alert('That game has already started.'); return; }

  const { data: existingPlayers } = await sb.from(TABLES.ROOM_PLAYERS).select('*').eq('room_id', room.id);
  const already = existingPlayers.find(p => p.player_id === currentPlayer.id);

  if (!already) {
    if (existingPlayers.length >= room.max_players) { alert('That room is full.'); return; }
    const takenSeats = existingPlayers.map(p => p.seat);
    let seat = 0;
    while (takenSeats.includes(seat)) seat++;

    const { error: joinError } = await sb.from(TABLES.ROOM_PLAYERS).insert({
      room_id: room.id, player_id: currentPlayer.id, seat, is_ready: false,
    });
    if (joinError) { alert('Could not join room. Please try again.'); return; }
  }

  enterRoom(room);
}

// ---------------------------------------------------------------------
// Browse public rooms
// ---------------------------------------------------------------------

async function browsePublicRooms(gameType) {
  document.getElementById('publicRoomsTitle').textContent = `Open ${gameLabel(gameType)} rooms`;
  const listEl = document.getElementById('publicRoomsList');
  listEl.innerHTML = '<p class="empty-state">Loading…</p>';
  document.getElementById('publicRoomsPanel').classList.remove('hidden');
  document.getElementById('publicRoomsPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });

  const { data: rooms, error } = await sb.from(TABLES.ROOMS)
    .select('*, room_players(count)')
    .eq('game_type', gameType)
    .eq('is_public', true)
    .eq('status', 'waiting')
    .order('created_at', { ascending: false })
    .limit(20);

  if (error || !rooms || rooms.length === 0) {
    listEl.innerHTML = '<p class="empty-state">No open rooms right now — host one to get things started.</p>';
    return;
  }

  listEl.innerHTML = '';
  rooms.forEach(room => {
    const count = room.room_players[0]?.count ?? 0;
    const row = document.createElement('div');
    row.className = 'room-row';
    row.innerHTML = `
      <div class="room-row-info">
        <span class="room-row-code">${room.code}</span>
        <span class="room-row-meta">${count}/${room.max_players} players</span>
      </div>
      <button class="btn btn-small btn-primary">Join</button>
    `;
    row.querySelector('button').addEventListener('click', () => {
      document.getElementById('publicRoomsPanel').classList.add('hidden');
      joinRoomByCode(room.code);
    });
    listEl.appendChild(row);
  });
}

// ---------------------------------------------------------------------
// Room screen (waiting room)
// ---------------------------------------------------------------------

function gameLabel(gameType) {
  const labels = {
    snake: 'Snake', ludo: 'Ludo', rps: 'Rock Paper Scissors',
    tictactoe: 'Tic-Tac-Toe', connect4: 'Connect 4', uno: 'Uno',
    wordguess: 'Word Guess', chess: 'Chess',
  };
  return labels[gameType] || gameType;
}

function showScreen(name) {
  document.getElementById('hubHome').style.display = name === 'home' ? '' : 'none';
  document.getElementById('roomScreen').classList.toggle('hidden', name !== 'room');
  document.getElementById('gameScreen').classList.toggle('hidden', name !== 'game');
  document.getElementById('hubFooter').style.display = name === 'home' ? '' : 'none';
}

async function enterRoom(room) {
  currentRoom = room;
  document.getElementById('roomCodeText').textContent = room.code;
  document.getElementById('roomGameTitle').textContent = gameLabel(room.game_type);
  document.getElementById('roomVisibilityText').textContent = room.is_public
    ? 'Public room — visible in Browse'
    : 'Private room — invite with the code above';

  showScreen('room');
  subscribeToRoomPlayers(room.id);
  subscribeToRoomStatus(room.id);
  await refreshRoomPlayers(room.id);
}

async function refreshRoomPlayers(roomId) {
  const { data: players } = await sb.from(TABLES.ROOM_PLAYERS).select('*, players(username)').eq('room_id', roomId).order('seat');
  roomPlayersCache = (players || []).map(p => ({
    player_id: p.player_id,
    username: p.players?.username || 'Player',
    seat: p.seat,
    is_ready: p.is_ready,
  }));
  currentSeat = roomPlayersCache.find(p => p.player_id === currentPlayer.id)?.seat ?? null;
  renderRoomPlayers();
}

function renderRoomPlayers() {
  const listEl = document.getElementById('roomPlayerList');
  listEl.innerHTML = '';
  roomPlayersCache.forEach(p => {
    const row = document.createElement('div');
    row.className = 'room-player-row';
    const isHost = currentRoom && p.player_id === currentRoom.host_id;
    row.innerHTML = `
      <span class="room-player-name">${escapeHtml(p.username)} ${isHost ? '<span class="host-badge">Host</span>' : ''}</span>
      <span class="ready-badge ${p.is_ready ? 'is-ready' : 'not-ready'}">${p.is_ready ? '● Ready' : '○ Waiting'}</span>
    `;
    listEl.appendChild(row);
  });

  const me = roomPlayersCache.find(p => p.player_id === currentPlayer.id);
  const readyBtn = document.getElementById('readyToggleBtn');
  readyBtn.textContent = me && me.is_ready ? "Not ready" : "I'm ready";

  const isHost = currentRoom && currentPlayer.id === currentRoom.host_id;
  const allReady = roomPlayersCache.length >= 2 && roomPlayersCache.every(p => p.is_ready);
  const startBtn = document.getElementById('startGameBtn');
  startBtn.classList.toggle('hidden', !isHost);
  startBtn.disabled = !allReady;
  startBtn.style.opacity = allReady ? '1' : '0.5';

  const hintEl = document.getElementById('roomHintText');
  if (isHost) {
    hintEl.textContent = allReady ? 'Everyone is ready — start when you like.' : 'Waiting for all players to ready up…';
  } else {
    hintEl.textContent = 'Waiting for the host to start the game…';
  }
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

async function toggleReady() {
  const me = roomPlayersCache.find(p => p.player_id === currentPlayer.id);
  if (!me) return;
  await sb.from(TABLES.ROOM_PLAYERS).update({ is_ready: !me.is_ready }).eq('room_id', currentRoom.id).eq('player_id', currentPlayer.id);
}

async function startGame() {
  const mod = window.GameModules && window.GameModules[currentRoom.game_type];
  if (!mod) { alert('This game is not available yet.'); return; }
  const initialState = mod.getInitialState(roomPlayersCache.map(p => ({ playerId: p.player_id, username: p.username, seat: p.seat })));

  await sb.from(TABLES.GAME_STATE).upsert({ room_id: currentRoom.id, state: initialState });
  await sb.from(TABLES.ROOMS).update({ status: 'in_progress' }).eq('id', currentRoom.id);
}

// ---------------------------------------------------------------------
// Realtime subscriptions
// ---------------------------------------------------------------------

function subscribeToRoomPlayers(roomId) {
  if (roomPlayersChannel) sb.removeChannel(roomPlayersChannel);
  roomPlayersChannel = sb.channel(`room_players_${roomId}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: TABLES.ROOM_PLAYERS, filter: `room_id=eq.${roomId}` }, () => {
      refreshRoomPlayers(roomId);
    })
    .subscribe();
}

function subscribeToRoomStatus(roomId) {
  if (roomStatusChannel) sb.removeChannel(roomStatusChannel);
  roomStatusChannel = sb.channel(`room_status_${roomId}`)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: TABLES.ROOMS, filter: `id=eq.${roomId}` }, (payload) => {
      if (payload.new.status === 'in_progress' && currentRoom && currentRoom.status !== 'in_progress') {
        currentRoom.status = 'in_progress';
        launchGame();
      }
    })
    .subscribe();
}

// ---------------------------------------------------------------------
// Launching a game
// ---------------------------------------------------------------------

function launchGame() {
  showScreen('game');
  document.getElementById('gameScreenTitle').textContent = gameLabel(currentRoom.game_type);

  const mod = window.GameModules[currentRoom.game_type];
  activeGameModule = mod;
  const container = document.getElementById('gameContainer');
  container.innerHTML = '';

  const isHost = currentPlayer.id === currentRoom.host_id;
  const players = roomPlayersCache.map(p => ({ playerId: p.player_id, username: p.username, seat: p.seat }));

  mod.start(container, {
    supabase: sb,
    TABLES,
    roomId: currentRoom.id,
    playerId: currentPlayer.id,
    username: currentPlayer.username,
    players,
    isHost,
    setStatus: (text) => { document.getElementById('gameStatusBar').textContent = text || ''; },
  });
}

// ---------------------------------------------------------------------
// Leaving rooms / games
// ---------------------------------------------------------------------

async function leaveCurrentRoom() {
  if (activeGameModule && activeGameModule.cleanup) {
    try { activeGameModule.cleanup(); } catch (e) { /* ignore */ }
  }
  activeGameModule = null;

  if (roomPlayersChannel) { sb.removeChannel(roomPlayersChannel); roomPlayersChannel = null; }
  if (roomStatusChannel) { sb.removeChannel(roomStatusChannel); roomStatusChannel = null; }

  if (currentRoom) {
    await sb.from(TABLES.ROOM_PLAYERS).delete().eq('room_id', currentRoom.id).eq('player_id', currentPlayer.id);
    const { data: remaining } = await sb.from(TABLES.ROOM_PLAYERS).select('id').eq('room_id', currentRoom.id);
    if (!remaining || remaining.length === 0) {
      await sb.from(TABLES.ROOMS).delete().eq('id', currentRoom.id);
    } else if (currentRoom.host_id === currentPlayer.id) {
      const { data: nextHost } = await sb.from(TABLES.ROOM_PLAYERS).select('player_id').eq('room_id', currentRoom.id).order('seat').limit(1).maybeSingle();
      if (nextHost) await sb.from(TABLES.ROOMS).update({ host_id: nextHost.player_id }).eq('id', currentRoom.id);
    }
  }

  currentRoom = null;
  roomPlayersCache = [];
  showScreen('home');
}

// ---------------------------------------------------------------------
// Tutorial modal
// ---------------------------------------------------------------------

function openTutorial(gameType) {
  const mod = window.GameModules && window.GameModules[gameType];
  document.getElementById('infoModalTitle').textContent = `How to play ${gameLabel(gameType)}`;
  document.getElementById('infoModalBody').innerHTML = mod && mod.tutorial ? mod.tutorial : '<p>Tutorial coming soon.</p>';
  document.getElementById('infoModal').classList.remove('hidden');
}

// ---------------------------------------------------------------------
// Event wiring
// ---------------------------------------------------------------------

function wireEvents() {
  document.getElementById('usernameSaveBtn').addEventListener('click', saveUsername);
  document.getElementById('usernameInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveUsername(); });
  document.getElementById('profileBtn').addEventListener('click', () => showUsernameModal(true));

  document.getElementById('gameGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-action]');
    if (!btn) return;
    const gameType = btn.dataset.game;
    if (btn.dataset.action === 'create') openCreateRoomModal(gameType);
    if (btn.dataset.action === 'browse') browsePublicRooms(gameType);
  });

  document.getElementById('createPrivateBtn').addEventListener('click', () => setCreateVisibility(false));
  document.getElementById('createPublicBtn').addEventListener('click', () => setCreateVisibility(true));
  document.getElementById('createRoomCancelBtn').addEventListener('click', () => document.getElementById('createRoomModal').classList.add('hidden'));
  document.getElementById('createRoomConfirmBtn').addEventListener('click', confirmCreateRoom);

  document.getElementById('joinCodeBtn').addEventListener('click', () => joinRoomByCode(document.getElementById('joinCodeInput').value));
  document.getElementById('joinCodeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') joinRoomByCode(e.target.value); });

  document.getElementById('closePublicRooms').addEventListener('click', () => document.getElementById('publicRoomsPanel').classList.add('hidden'));

  document.getElementById('leaveRoomBtn').addEventListener('click', leaveCurrentRoom);
  document.getElementById('leaveGameBtn').addEventListener('click', leaveCurrentRoom);
  document.getElementById('readyToggleBtn').addEventListener('click', toggleReady);
  document.getElementById('startGameBtn').addEventListener('click', startGame);

  document.getElementById('roomInfoBtn').addEventListener('click', () => openTutorial(currentRoom.game_type));
  document.getElementById('gameInfoBtn').addEventListener('click', () => openTutorial(currentRoom.game_type));
  document.getElementById('infoModalClose').addEventListener('click', () => document.getElementById('infoModal').classList.add('hidden'));

  window.addEventListener('beforeunload', () => {
    if (currentRoom) {
      navigator.sendBeacon && sb.from(TABLES.ROOM_PLAYERS).delete().eq('room_id', currentRoom.id).eq('player_id', currentPlayer.id);
    }
  });
}

// ---------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------

try {
  wireEvents();
  initPlayer();
} catch (err) {
  alert('Game Hub failed to start: ' + (err && err.message ? err.message : err));
  console.error('Boot error:', err);
}
