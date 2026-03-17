import axios from 'axios';

const API_BASE = '/api';

export async function healthCheck() {
  const { data } = await axios.get(`${API_BASE}/`);
  return data;
}

export async function getBrowserStatus() {
  const { data } = await axios.get(`${API_BASE}/browser/status`);
  return data;
}

export async function initBrowser(players, signal) {
  // Opens Chrome and sends system prompts — can take 1–2 minutes
  const payload = players && players.length > 0 ? { players } : {};
  const { data } = await axios.post(`${API_BASE}/browser/init`, payload, { timeout: 600_000, signal });
  return data;
}

export async function shutdownBrowser() {
  const { data } = await axios.post(`${API_BASE}/browser/shutdown`);
  return data;
}

export async function getSessionStatus() {
  const { data } = await axios.get(`${API_BASE}/browser/session-status`);
  return data;
}

export async function clearSession() {
  const { data } = await axios.delete(`${API_BASE}/browser/session`);
  return data;
}

export async function startLogin() {
  const { data } = await axios.post(`${API_BASE}/browser/login`);
  return data;
}

export async function confirmLogin() {
  const { data } = await axios.post(`${API_BASE}/browser/login-confirm`, {}, { timeout: 30_000 });
  return data;
}

export async function playTurn(playerName, state, mode = 'browser') {
  const { data } = await axios.post(`${API_BASE}/play-turn`, {
    player_name: playerName,
    state,
    mode,
  });
  return data;
}
