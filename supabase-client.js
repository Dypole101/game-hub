// supabase-client.js
// Shared Supabase connection used by every page/game in the hub.
// Loaded after the supabase-js CDN script and before lobby.js / any game file.

const SUPABASE_URL = 'https://mgtdchpoknbsuwjjyikx.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ndGRjaHBva25ic3V3amp5aWt4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgzNDQ3MDgsImV4cCI6MjEwMzkyMDcwOH0.nz5XBHPNRVLZQYM3NICIzlaDyCtJmjPaZzoO8lAg2bA';

// Single shared client instance, attached to window so every other script
// (lobby.js, and every file in /games) can reach it as window.supabaseClient.
window.supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ---- Shared table names (keep in sync with the DB schema) ----
const TABLES = {
  PLAYERS: 'players',
  ROOMS: 'rooms',
  ROOM_PLAYERS: 'room_players',
  GAME_STATE: 'game_state',
};

// ---- Shared game type keys (must match rooms.game_type values in the DB) ----
const GAME_TYPES = {
  SNAKE: 'snake',
  LUDO: 'ludo',
  RPS: 'rps',
  TICTACTOE: 'tictactoe',
  CONNECT4: 'connect4',
  UNO: 'uno',
  WORDGUESS: 'wordguess',
  CHESS: 'chess',
};

// Max players allowed per game type - used when creating a room
const MAX_PLAYERS = {
  [GAME_TYPES.SNAKE]: 5,
  [GAME_TYPES.LUDO]: 4,
  [GAME_TYPES.RPS]: 2,
  [GAME_TYPES.TICTACTOE]: 2,
  [GAME_TYPES.CONNECT4]: 2,
  [GAME_TYPES.UNO]: 5,
  [GAME_TYPES.WORDGUESS]: 6,
  [GAME_TYPES.CHESS]: 2,
};
