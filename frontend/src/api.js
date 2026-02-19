import axios from 'axios';

// Use relative URL so Vite proxy forwards to backend (avoids CORS/network errors)
const API_BASE = '/api';

export async function healthCheck() {
  const { data } = await axios.get(`${API_BASE}/`);
  return data;
}

export async function playTurn(playerName, state) {
  const { data } = await axios.post(`${API_BASE}/play-turn`, {
    player_name: playerName,
    state,
  });
  return data;
}
