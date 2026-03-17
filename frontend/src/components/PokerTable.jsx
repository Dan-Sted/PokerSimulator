import { useState, useRef, useEffect } from 'react';
import { healthCheck, playTurn, initBrowser, shutdownBrowser, getSessionStatus, clearSession, startLogin, confirmLogin } from '../api';

const PLAYER_NAMES   = ['Calculator', 'Shark', 'Gambler', 'Maniac', 'Rock'];
const RANKS          = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const SUITS          = ['S','H','D','C'];
const SMALL_BLIND    = 10;
const BIG_BLIND      = 20;
const STARTING_STACK = 1000;

function shuffledDeck() {
  const deck = RANKS.flatMap(r => SUITS.map(s => ({ rank: r, suit: s })));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

const SEAT_POSITIONS = {
  3: [
    { bottom: 0,      left: '50%',   transform: 'translateX(-50%)' },
    { top: '5%',      right: '8%' },
    { top: '5%',      left: '8%' },
  ],
  4: [
    { bottom: 0,      left: '50%',   transform: 'translateX(-50%)' },
    { right: '3%',    top: '50%',    transform: 'translateY(-50%)' },
    { top: '5%',      left: '50%',   transform: 'translateX(-50%)' },
    { left: '3%',     top: '50%',    transform: 'translateY(-50%)' },
  ],
  5: [
    { bottom: 0,      left: '50%',   transform: 'translateX(-50%)' },
    { right: '3%',    bottom: '22%', transform: 'translateY(50%)' },
    { top: '5%',      right: '8%' },
    { top: '5%',      left: '8%' },
    { left: '3%',     bottom: '22%', transform: 'translateY(50%)' },
  ],
};

const ACTION_TEXT  = {
  fold:  'text-red-400',
  call:  'text-yellow-400',
  raise: 'text-green-400',
  blind: 'text-slate-400',
  wins:  'text-amber-300',
  result:'text-amber-300',
  error: 'text-orange-400',
};
const ACTION_BADGE = {
  fold:  'bg-red-900/60 border-red-500/40',
  call:  'bg-yellow-900/60 border-yellow-500/40',
  raise: 'bg-green-900/60 border-green-500/40',
};
const ACTION_ROW = {
  fold:   'bg-red-950/40 border-red-800/40',
  call:   'bg-yellow-950/40 border-yellow-800/40',
  raise:  'bg-green-950/40 border-green-800/40',
  blind:  'bg-slate-800/60 border-slate-700',
  wins:   'bg-amber-950/40 border-amber-700/40',
  result: 'bg-amber-950/40 border-amber-700/40',
  error:  'bg-orange-950/40 border-orange-800/40',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function Card({ rank, suit, faceDown }) {
  const SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const red  = suit === 'H' || suit === 'D';
  if (faceDown) {
    return (
      <div className="w-8 h-11 rounded bg-slate-700 border border-slate-500 flex items-center justify-center text-slate-400 text-[10px]">
        ?
      </div>
    );
  }
  return (
    <div className={`w-8 h-11 rounded bg-white border border-slate-300 flex flex-col items-center justify-center text-[10px] shadow-md ${red ? 'text-red-600' : 'text-slate-800'}`}>
      <span className="font-bold leading-none">{rank}</span>
      <span className="leading-none">{SYM[suit] || suit}</span>
    </div>
  );
}

function Seat({ name, stack, cards, isDealer, isActive, isThinking, lastAction, style }) {
  return (
    <div
      className={`absolute flex flex-col items-center rounded-xl px-2 py-1.5 min-w-[84px] transition-all
        bg-slate-800/90 border
        ${isActive
          ? 'ring-2 ring-amber-400 ring-offset-1 ring-offset-green-900 border-amber-400/70'
          : 'border-slate-600/70'}`}
      style={style}
    >
      <span className="text-white font-semibold text-xs leading-tight">{name}</span>
      <span className="text-amber-300 text-xs leading-tight">${stack}</span>

      {isThinking && (
        <span className="text-slate-400 text-[10px] animate-pulse mt-0.5">thinking…</span>
      )}
      {!isThinking && lastAction && lastAction.action !== 'blind' && (
        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border mt-0.5
          ${ACTION_BADGE[lastAction.action] || 'bg-slate-700 border-slate-600'}
          ${ACTION_TEXT[lastAction.action]  || 'text-white'}`}>
          {lastAction.action}{lastAction.amount > 0 ? ` ${lastAction.amount}` : ''}
        </span>
      )}

      <div className="flex gap-0.5 mt-1">
        {cards?.map((c, i) => <Card key={i} {...c} />)}
      </div>

      {isDealer && (
        <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white text-slate-800 text-[10px] flex items-center justify-center font-bold shadow">
          D
        </span>
      )}
    </div>
  );
}

// Simple toggle using inline styles to avoid Tailwind purge issues
function Toggle({ value, onChange }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!value)}
      style={{
        position: 'relative',
        display: 'inline-flex',
        width: '44px',
        height: '24px',
        borderRadius: '12px',
        border: 'none',
        outline: 'none',
        padding: 0,
        cursor: 'pointer',
        flexShrink: 0,
        backgroundColor: value ? '#f59e0b' : '#475569',
        transition: 'background-color 0.2s',
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: '2px',
          left: value ? '22px' : '2px',
          width: '20px',
          height: '20px',
          borderRadius: '50%',
          backgroundColor: '#fff',
          boxShadow: '0 1px 3px rgba(0,0,0,0.4)',
          transition: 'left 0.2s',
        }}
      />
    </button>
  );
}

// Segmented button group — use inline style for bg so Tailwind purging can't remove it
function SegmentGroup({ options, value, onChange, labelFn }) {
  return (
    <div style={{ display: 'flex', borderRadius: '0.5rem', border: '1px solid #475569', overflow: 'hidden' }}>
      {options.map(opt => {
        const selected = value === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            style={{
              flex: 1,
              padding: '0.625rem 0',
              fontSize: '0.875rem',
              fontWeight: selected ? 600 : 400,
              cursor: 'pointer',
              border: 'none',
              outline: 'none',
              color: selected ? '#ffffff' : '#94a3b8',
              backgroundColor: selected ? '#d97706' : '#1e293b',
              transition: 'background-color 0.15s, color 0.15s',
            }}
          >
            {labelFn ? labelFn(opt) : opt}
          </button>
        );
      })}
    </div>
  );
}

// ── Settings Screen ───────────────────────────────────────────────────────────

function SettingsScreen({
  mode, setMode,
  playerCount, setPlayerCount,
  startingStack, setStartingStack,
  connected, onReconnect,
  browserReady, initializedCount, initingBrowser, onInitBrowser, onStopBrowser, shuttingDown,
  sessionStatus, onCheckSession, onClearSession, clearingSession,
  signingIn, onStartLogin, confirmingLogin, onConfirmLogin,
  showHands, setShowHands,
  onRestart,
  onStart, error,
}) {
  const browserSufficient = browserReady && initializedCount >= playerCount;
  const needsMoreTabs     = browserReady && initializedCount < playerCount;
  const canStart = connected && (mode === 'api' || browserSufficient);
  const sb = Math.round(startingStack * 0.01);
  const bb = sb * 2;

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-4xl bg-slate-800 rounded-2xl border border-slate-700 shadow-2xl overflow-hidden">

        {/* Header */}
        <div className="bg-gradient-to-br from-green-900 to-green-950 px-10 py-5 flex items-center justify-between border-b border-slate-700">
          <div>
            <h1 className="text-2xl font-bold text-white">Poker Simulator</h1>
            <p className="text-green-400 text-sm mt-0.5">AI-Powered Texas Hold'em</p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="text-3xl tracking-widest opacity-70">♠ ♣ ♥ ♦</div>
            {connected ? (
              <span className="text-xs text-emerald-400 font-medium">● Engine connected</span>
            ) : (
              <button
                onClick={onReconnect}
                className="text-xs text-amber-400 hover:text-amber-300 underline"
              >
                ○ Engine offline — retry
              </button>
            )}
          </div>
        </div>

        {/* Two-column body */}
        <div className="grid grid-cols-2 gap-0 divide-x divide-slate-700">

          {/* Left column */}
          <div className="px-8 py-6 space-y-5">

            {/* AI Mode */}
            <div>
              <p className="text-slate-400 text-xs uppercase tracking-wider mb-2">AI Mode</p>
              <SegmentGroup
                options={['browser', 'api']}
                value={mode}
                onChange={setMode}
                labelFn={m => m === 'browser' ? '🌐 Browser' : '⚡ API'}
              />
              <p className="text-slate-500 text-xs mt-1.5">
                {mode === 'browser'
                  ? 'Uses Gemini via Chrome — bypasses API rate limits'
                  : 'Uses Gemini API directly — requires API key in .env'}
              </p>
            </div>

            {/* Player Count */}
            <div>
              <p className="text-slate-400 text-xs uppercase tracking-wider mb-2">Number of Players</p>
              <SegmentGroup
                options={[3, 4, 5]}
                value={playerCount}
                onChange={setPlayerCount}
              />
              <p className="text-slate-500 text-xs mt-1.5">
                {PLAYER_NAMES.slice(0, playerCount).join(', ')}
              </p>
            </div>

            {/* Starting Stack */}
            <div>
              <p className="text-slate-400 text-xs uppercase tracking-wider mb-2">Starting Stack</p>
              <SegmentGroup
                options={[500, 1000, 2000]}
                value={startingStack}
                onChange={setStartingStack}
                labelFn={n => `$${n}`}
              />
              <p className="text-slate-500 text-xs mt-1.5">
                Blinds: ${sb} / ${bb} &nbsp;·&nbsp; {Math.floor(startingStack / bb)} big blinds each
              </p>
            </div>


          </div>

          {/* Right column */}
          <div className="px-8 py-6 space-y-5">

            {/* Browser Setup */}
            {mode === 'browser' && (
              <div>
                <p className="text-slate-400 text-xs uppercase tracking-wider mb-2">Browser Setup</p>
                <div className="flex gap-2">
                  <button
                    onClick={onInitBrowser}
                    disabled={browserSufficient || initingBrowser || !connected}
                    className={`flex-1 py-2.5 rounded-lg font-medium text-sm transition-colors disabled:opacity-50
                      ${browserSufficient
                        ? 'bg-violet-900 text-violet-200 cursor-default'
                        : 'bg-violet-600 hover:bg-violet-500 text-white'}`}
                  >
                    {initingBrowser
                      ? '⏳ Initializing…'
                      : browserSufficient
                        ? `✓ Ready (${initializedCount} tabs)`
                        : needsMoreTabs
                          ? `Add ${playerCount - initializedCount} More Tab${playerCount - initializedCount > 1 ? 's' : ''}`
                          : 'Initialize Browser'}
                  </button>
                  {browserReady && (
                    <button
                      onClick={onStopBrowser}
                      disabled={shuttingDown}
                      className="px-3 py-2.5 rounded-lg bg-red-900 hover:bg-red-800 disabled:opacity-40 text-sm font-medium text-red-200 transition-colors"
                    >
                      {shuttingDown ? '…' : '⏹ Stop'}
                    </button>
                  )}
                </div>
                {!browserSufficient && !initingBrowser && (
                  <p className="text-slate-500 text-xs mt-1.5">
                    {needsMoreTabs
                      ? `${initializedCount} tabs open — need ${playerCount} for this game`
                      : `Opens ${playerCount} Chrome tab${playerCount > 1 ? 's' : ''} and sends personality prompts`}
                  </p>
                )}
              </div>
            )}


            {/* Gemini Account — browser mode only */}
            {mode === 'browser' && (
              <div>
                <p className="text-slate-400 text-xs uppercase tracking-wider mb-2">Gemini Account</p>

                {/* Signing-in flow */}
                {signingIn ? (
                  <div className="space-y-2">
                    <p className="text-amber-300 text-xs leading-relaxed">
                      Chrome is open — sign into your Google account on the Gemini page, then click below.
                    </p>
                    <button
                      onClick={onConfirmLogin}
                      disabled={confirmingLogin}
                      className="w-full py-2 rounded-lg bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 text-white text-sm font-medium transition-colors"
                    >
                      {confirmingLogin ? '⏳ Saving session…' : '✓ I\'m Done Signing In'}
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 flex-wrap">
                    {sessionStatus === null && connected && (
                      <p className="text-slate-500 text-xs flex-1">Checking session…</p>
                    )}
                    {sessionStatus === true && (
                      <p className="flex-1 text-emerald-400 text-xs font-medium">✓ Signed in — session saved</p>
                    )}
                    {(sessionStatus === false || (!connected && sessionStatus === null)) && (
                      <p className="flex-1 text-slate-400 text-xs">Not signed in</p>
                    )}
                    {connected && (
                      <>
                        {sessionStatus !== true && (
                          <button
                            onClick={onStartLogin}
                            className="text-violet-400 hover:text-violet-300 text-xs px-2 py-1 rounded border border-violet-800 hover:border-violet-600 transition-colors"
                          >
                            Sign In
                          </button>
                        )}
                        <button
                          onClick={onCheckSession}
                          className="text-slate-500 hover:text-slate-300 text-xs px-2 py-1 rounded border border-slate-700 hover:border-slate-500 transition-colors"
                        >
                          ↺
                        </button>
                        {sessionStatus === true && (
                          <button
                            onClick={onClearSession}
                            disabled={clearingSession}
                            className="text-red-500 hover:text-red-400 text-xs px-2 py-1 rounded border border-red-900 hover:border-red-700 transition-colors disabled:opacity-40"
                          >
                            {clearingSession ? '…' : 'Clear'}
                          </button>
                        )}
                      </>
                    )}
                  </div>
                )}
                <p className="text-slate-600 text-xs mt-1.5">
                  Sign in to use a saved Google session. Or skip and sign in manually inside each browser tab.
                </p>
              </div>
            )}

            {/* Show Hands */}
            <div className="flex items-center justify-between py-1">
              <div>
                <p className="text-slate-300 text-sm font-medium">Show all player hands</p>
                <p className="text-slate-500 text-xs">Reveal face-down cards during the game</p>
              </div>
              <Toggle value={showHands} onChange={setShowHands} />
            </div>

            {error && (
              <p className="text-red-400 text-xs text-center bg-red-950/50 border border-red-800/50 rounded-lg px-3 py-2">
                {error}
              </p>
            )}

          </div>
        </div>

        {/* Bottom action bar */}
        <div className="px-8 pb-6 pt-4 border-t border-slate-700 flex gap-3">
          <button
            onClick={onStart}
            disabled={!canStart}
            className="flex-1 py-3.5 rounded-xl bg-amber-600 hover:bg-amber-500 disabled:opacity-30 disabled:cursor-not-allowed font-bold text-lg transition-colors"
          >
            ▶ Start Game
          </button>
          {(browserReady || connected) && (
            <button
              onClick={onRestart}
              disabled={shuttingDown}
              className="px-5 py-3.5 rounded-xl bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-slate-300 text-sm font-medium transition-colors whitespace-nowrap"
            >
              {shuttingDown ? '⏳ Restarting…' : '🔄 Restart'}
            </button>
          )}
        </div>
        {!canStart && (
          <p className="text-slate-500 text-xs text-center pb-4">
            {!connected
              ? 'Connect to the engine first'
              : needsMoreTabs
                ? `Add ${playerCount - initializedCount} more browser tab${playerCount - initializedCount > 1 ? 's' : ''} first`
                : 'Initialize the browser first'}
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main Game Component ───────────────────────────────────────────────────────

export default function PokerTable() {
  const [phase, setPhase]                   = useState('settings');
  const [connected, setConnected]           = useState(false);
  const [signingIn, setSigningIn]           = useState(false);
  const [confirmingLogin, setConfirmingLogin] = useState(false);
  const [mode, setMode]                     = useState('browser');
  const [browserReady, setBrowserReady]       = useState(false);
  const [initingBrowser, setInitingBrowser]   = useState(false);
  const [initializedCount, setInitializedCount] = useState(0); // how many player tabs are open
  const [showHands, setShowHands]           = useState(false);
  const [playerCount, setPlayerCount]       = useState(5);
  const [startingStack, setStartingStack]   = useState(1000);
  const [gameRunning, setGameRunning]       = useState(false);
  const [roundComplete, setRoundComplete]   = useState(false);
  const [activePlayer, setActivePlayer]     = useState(null);
  const [playerActions, setPlayerActions]   = useState({});
  const [gameLog, setGameLog]               = useState([]);
  const [error, setError]                   = useState(null);
  const [shuttingDown, setShuttingDown]     = useState(false);
  const [stacks, setStacks]                 = useState({});         // persists across rounds
  const [pot, setPot]                       = useState(0);
  const [communityCards, setCommunityCards] = useState([]);
  const [holeCards, setHoleCards]           = useState({});
  const [street, setStreet]                 = useState('preflop');
  const [lastWinner, setLastWinner]         = useState(null);       // { name, amount }
  const [sessionStatus, setSessionStatus]   = useState(null);       // null=unchecked, true/false
  const [clearingSession, setClearingSession] = useState(false);
  const stopRef       = useRef(false);
  const initAbortRef  = useRef(null);   // AbortController for in-flight browser init

  // Auto-connect to backend on mount
  useEffect(() => {
    healthCheck()
      .then(() => setConnected(true))
      .catch(() => setConnected(false));
  }, []);

  // Auto-check Gemini session whenever backend is connected and browser mode is active
  useEffect(() => {
    if (connected && mode === 'browser') {
      getSessionStatus()
        .then(d => setSessionStatus(d.has_session))
        .catch(() => setSessionStatus(null));
    }
  }, [connected, mode]);

  // ── Handlers ───────────────────────────────────────────────────────────────

  const handleReconnect = () => {
    setConnected(false);
    healthCheck()
      .then(() => setConnected(true))
      .catch(() => setConnected(false));
  };

  const handleStartLogin = async () => {
    setSigningIn(true); setError(null);
    try { await startLogin(); }
    catch (e) { setError(e.response?.data?.detail || e.message || 'Could not open login browser'); setSigningIn(false); }
  };

  const handleConfirmLogin = async () => {
    setConfirmingLogin(true); setError(null);
    try {
      await confirmLogin();
      setSessionStatus(true);
      setSigningIn(false);
    }
    catch (e) { setError(e.response?.data?.detail || e.message || 'Login confirmation failed'); }
    finally { setConfirmingLogin(false); }
  };

  const handleInitBrowser = async () => {
    const controller = new AbortController();
    initAbortRef.current = controller;
    setInitingBrowser(true); setError(null);
    try {
      await initBrowser(PLAYER_NAMES.slice(0, playerCount), controller.signal);
      setBrowserReady(true);
      setInitializedCount(playerCount);
    }
    catch (e) {
      if (e.name === 'CanceledError' || e.code === 'ERR_CANCELED') return; // aborted by restart
      setError(e.response?.data?.detail || e.message || 'Browser init failed');
    }
    finally { setInitingBrowser(false); initAbortRef.current = null; }
  };

  const handleShutdownBrowser = async () => {
    setShuttingDown(true); setError(null);
    try   { await shutdownBrowser(); setBrowserReady(false); setInitializedCount(0); }
    catch (e) { setError(e.response?.data?.detail || e.message || 'Shutdown failed'); }
    finally   { setShuttingDown(false); }
  };

  // End Game: stop round → close browser → reset state → return to settings
  const handleEndGame = async () => {
    stopRef.current = true;
    if (initAbortRef.current) { initAbortRef.current.abort(); initAbortRef.current = null; }
    setInitingBrowser(false);
    setShuttingDown(true);
    try {
      await shutdownBrowser(); // always attempt — backend handles "not initialized" gracefully
    } catch { /* ignore */ }
    finally { setShuttingDown(false); }
    setBrowserReady(false); setInitializedCount(0);
    setGameLog([]); setPlayerActions({}); setPot(0); setRoundComplete(false);
    setCommunityCards([]); setHoleCards({}); setStacks({}); setLastWinner(null);
    setActivePlayer(null); setGameRunning(false);
    setPhase('settings');
  };

  // Restart: close browser + reset all game state (stays on settings)
  const handleRestart = async () => {
    if (initAbortRef.current) { initAbortRef.current.abort(); initAbortRef.current = null; }
    setInitingBrowser(false);
    setShuttingDown(true); setError(null);
    try {
      await shutdownBrowser(); // always attempt — backend handles "not initialized" gracefully
    } catch { /* ignore */ }
    finally { setShuttingDown(false); }
    setBrowserReady(false); setInitializedCount(0);
    setGameLog([]); setPlayerActions({}); setPot(0); setRoundComplete(false);
    setCommunityCards([]); setHoleCards({}); setStacks({}); setLastWinner(null);
    setActivePlayer(null); setGameRunning(false);
    setSessionStatus(null);
  };

  const handleClearSession = async () => {
    setClearingSession(true);
    try {
      await clearSession();
      setSessionStatus(false);
    } catch { /* ignore */ }
    finally { setClearingSession(false); }
  };

  const handleCheckSession = () => {
    setSessionStatus(null);
    getSessionStatus()
      .then(d => setSessionStatus(d.has_session))
      .catch(() => setSessionStatus(null));
  };

  // Core game loop — accepts the initial stack values so we can carry over between rounds
  const runGameRound = async (initialStacks) => {
    stopRef.current = false;
    setGameRunning(true);
    setRoundComplete(false);
    setGameLog([]);
    setPlayerActions({});
    setError(null);
    setActivePlayer(null);
    setLastWinner(null);

    // Only include players who still have chips
    const players = PLAYER_NAMES.slice(0, playerCount)
      .filter(p => (initialStacks[p] ?? startingStack) > 0);

    if (players.length <= 1) {
      // Tournament over (or can't start a real hand)
      const winner = players[0] ?? null;
      if (winner) {
        setLastWinner({ name: winner, amount: 0 });
        setGameLog([{ player: winner, street: 'result', action: 'wins', amount: 0, reasoning: 'Last player with chips — wins the tournament!' }]);
      }
      setActivePlayer(null);
      setGameRunning(false);
      setRoundComplete(true);
      return;
    }

    // Deal cards
    const deck = shuffledDeck();
    const newHoleCards = {};
    players.forEach((p, i) => {
      newHoleCards[p] = [deck[i * 2], deck[i * 2 + 1]];
    });
    const communityDeck = deck.slice(players.length * 2, players.length * 2 + 5);

    setHoleCards(newHoleCards);
    setCommunityCards([]);
    setStreet('preflop');

    // Post blinds (capped at each player's actual stack)
    const s0   = { ...initialStacks };
    const sbAmt = Math.min(SMALL_BLIND, s0[players[0]]);
    const bbAmt = Math.min(BIG_BLIND,   s0[players[1]]);
    s0[players[0]] -= sbAmt;
    s0[players[1]] -= bbAmt;
    let pot0 = sbAmt + bbAmt;
    setStacks({ ...s0 });
    setPot(pot0);
    setGameLog([
      { player: players[0], street: 'preflop', action: 'blind', amount: sbAmt, reasoning: 'Posts small blind' },
      { player: players[1], street: 'preflop', action: 'blind', amount: bbAmt, reasoning: 'Posts big blind'  },
    ]);

    // Finish helper — awards pot, sets winner banner, marks round done
    const finish = (winner, winAmount, aborted = false) => {
      if (winner && !aborted) {
        setStacks(prev => ({ ...prev, [winner]: (prev[winner] ?? 0) + winAmount }));
        setPot(0);
        setLastWinner({ name: winner, amount: winAmount });
        setGameLog(prev => [...prev, {
          player: winner, street: 'result', action: 'wins',
          amount: winAmount, reasoning: `Wins the pot at ${winAmount > 0 ? 'showdown' : 'fold'}.`,
        }]);
      }
      setActivePlayer(null);
      setGameRunning(false);
      setRoundComplete(!aborted);
    };

    // One betting street — returns { stacks, pot, stillActive }
    const runStreet = async (activePlayers, stacks_, pot_, community, streetName, initialToCall) => {
      const s = { ...stacks_ };
      let p = pot_;
      const folded      = new Set();
      const contributed = {};
      activePlayers.forEach(pl => { contributed[pl] = 0; });
      let toCall = initialToCall;

      for (const player of activePlayers) {
        if (stopRef.current) break;
        if (s[player] <= 0) continue;

        const needToCall = Math.max(0, toCall - contributed[player]);
        setActivePlayer(player);

        const state = {
          hole_cards:      newHoleCards[player],
          community_cards: community,
          pot:             p,
          to_call:         needToCall,
          stack:           s[player],
          street:          streetName,
          valid_actions:   ['fold', 'call', 'raise'],
        };

        let result;
        try {
          result = await playTurn(player, state, mode);
        } catch (e) {
          const msg = e.response?.data?.detail || e.message || 'Request failed';
          setError(msg);
          result = { action: 'call', amount: needToCall, reasoning: `Error: ${msg}` };
        }

        // Apply action to local stack/pot
        if (result.action === 'fold') {
          folded.add(player);
        } else if (result.action === 'raise') {
          const extra    = result.amount > 0 ? result.amount : BIG_BLIND;
          const callPart = Math.min(needToCall, s[player]);
          const raisePart = Math.min(extra, s[player] - callPart);
          const total    = callPart + raisePart;
          s[player]          -= total;
          p                  += total;
          contributed[player] += total;
          toCall              = contributed[player];
        } else {
          const callAmt = Math.min(needToCall, s[player]);
          s[player]          -= callAmt;
          p                  += callAmt;
          contributed[player] += callAmt;
        }

        setPlayerActions(prev => ({ ...prev, [player]: result }));
        setGameLog(prev => [...prev, { player, street: streetName, ...result }]);
        setStacks({ ...s });
        setPot(p);
      }

      return { stacks: s, pot: p, stillActive: activePlayers.filter(pl => !folded.has(pl)) };
    };

    // ── PREFLOP ─────────────────────────────────────────────────────────────
    setStreet('preflop');
    const utg = Math.min(2, players.length - 1);
    const preflopOrder = [...players.slice(utg), ...players.slice(0, utg)];
    let result = await runStreet(preflopOrder, s0, pot0, [], 'preflop', BIG_BLIND);

    if (stopRef.current) { finish(null, 0, true); return; }
    if (result.stillActive.length <= 1) {
      finish(result.stillActive[0] ?? null, result.pot);
      return;
    }

    // ── FLOP ────────────────────────────────────────────────────────────────
    const flop = communityDeck.slice(0, 3);
    setCommunityCards(flop);
    setStreet('flop');
    setPlayerActions({});
    result = await runStreet(result.stillActive, result.stacks, result.pot, flop, 'flop', 0);

    if (stopRef.current) { finish(null, 0, true); return; }
    if (result.stillActive.length <= 1) {
      finish(result.stillActive[0] ?? null, result.pot);
      return;
    }

    // ── TURN ────────────────────────────────────────────────────────────────
    const turn = communityDeck.slice(0, 4);
    setCommunityCards(turn);
    setStreet('turn');
    setPlayerActions({});
    result = await runStreet(result.stillActive, result.stacks, result.pot, turn, 'turn', 0);

    if (stopRef.current) { finish(null, 0, true); return; }
    if (result.stillActive.length <= 1) {
      finish(result.stillActive[0] ?? null, result.pot);
      return;
    }

    // ── RIVER ───────────────────────────────────────────────────────────────
    const river = communityDeck.slice(0, 5);
    setCommunityCards(river);
    setStreet('river');
    setPlayerActions({});
    result = await runStreet(result.stillActive, result.stacks, result.pot, river, 'river', 0);

    if (stopRef.current) { finish(null, 0, true); return; }

    // ── SHOWDOWN — random winner among survivors (demo) ─────────────────────
    const survivors = result.stillActive;
    const winner    = survivors[Math.floor(Math.random() * survivors.length)];
    finish(winner ?? null, result.pot);
  };

  const handleRunGame = () => {
    const players = PLAYER_NAMES.slice(0, playerCount);
    const init    = {};
    players.forEach(p => { init[p] = startingStack; });
    return runGameRound(init);
  };

  const handleNextRound = () => {
    const players = PLAYER_NAMES.slice(0, playerCount);
    const carry   = {};
    players.forEach(p => { carry[p] = stacks[p] ?? startingStack; });
    setCommunityCards([]);
    setHoleCards({});
    return runGameRound(carry);
  };

  // ── Settings phase ─────────────────────────────────────────────────────────

  if (phase === 'settings') {
    return (
      <SettingsScreen
        mode={mode} setMode={setMode}
        playerCount={playerCount} setPlayerCount={setPlayerCount}
        startingStack={startingStack} setStartingStack={setStartingStack}
        connected={connected} onReconnect={handleReconnect}
        browserReady={browserReady} initializedCount={initializedCount}
        initingBrowser={initingBrowser} onInitBrowser={handleInitBrowser}
        onStopBrowser={handleShutdownBrowser} shuttingDown={shuttingDown}
        sessionStatus={sessionStatus} onCheckSession={handleCheckSession}
        onClearSession={handleClearSession} clearingSession={clearingSession}
        signingIn={signingIn} onStartLogin={handleStartLogin}
        confirmingLogin={confirmingLogin} onConfirmLogin={handleConfirmLogin}
        showHands={showHands} setShowHands={setShowHands}
        onRestart={handleRestart}
        onStart={() => {
          setGameLog([]); setPlayerActions({}); setPot(0); setRoundComplete(false);
          setCommunityCards([]); setHoleCards({}); setStacks({}); setLastWinner(null);
          setPhase('game');
        }}
        error={error}
      />
    );
  }

  // ── Game phase ─────────────────────────────────────────────────────────────

  const activePlayers = PLAYER_NAMES.slice(0, playerCount);
  const seatPos       = SEAT_POSITIONS[playerCount];

  const seats = activePlayers.map((name, i) => ({
    name,
    stack:      stacks[name] ?? startingStack,
    cards:      showHands
                  ? (holeCards[name] ?? [{ faceDown: true }, { faceDown: true }])
                  : (i === 0
                      ? (holeCards[name] ?? [{ faceDown: true }, { faceDown: true }])
                      : [{ faceDown: true }, { faceDown: true }]),
    isDealer:   i === 1,
    isActive:   name === activePlayer,
    isThinking: name === activePlayer && gameRunning,
    lastAction: playerActions[name] ?? null,
    style:      seatPos[i],
  }));

  const STREET_LABEL = { preflop: 'Pre-Flop', flop: 'Flop', turn: 'Turn', river: 'River' };

  return (
    <div className="h-screen bg-slate-900 text-white flex flex-col overflow-hidden">

      {/* Top bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-700 bg-slate-800/80 flex-shrink-0">
        <button
          onClick={() => setPhase('settings')}
          disabled={gameRunning}
          className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-sm"
        >
          ← Settings
        </button>
        <span className="text-slate-400 text-xs px-2 py-1 rounded bg-slate-800 border border-slate-700">
          {mode === 'browser' ? '🌐 Browser' : '⚡ API'}
        </span>
        {gameRunning && (
          <span className="text-amber-400 text-xs px-2 py-1 rounded bg-amber-950/40 border border-amber-700/40">
            {STREET_LABEL[street] ?? street}
          </span>
        )}
        {error && <span className="text-red-400 text-xs ml-2">⚠ {error}</span>}

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowHands(h => !h)}
            className="px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm"
          >
            {showHands ? '🙈 Hide Hands' : '👁 Show Hands'}
          </button>

          <button
            onClick={handleEndGame}
            disabled={shuttingDown}
            className="px-3 py-1.5 rounded-lg bg-red-900 hover:bg-red-800 disabled:opacity-40 text-sm font-medium"
          >
            {shuttingDown ? 'Ending…' : '⏹ End Game'}
          </button>

          {gameRunning ? (
            <button
              onClick={() => { stopRef.current = true; }}
              className="px-4 py-1.5 rounded-lg bg-red-700 hover:bg-red-600 font-semibold text-sm"
            >
              ⏹ Stop
            </button>
          ) : roundComplete ? (
            <button
              onClick={handleNextRound}
              className="px-4 py-1.5 rounded-lg bg-green-700 hover:bg-green-600 font-semibold text-sm"
            >
              ▶ Next Round
            </button>
          ) : (
            <button
              onClick={handleRunGame}
              className="px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 font-semibold text-sm"
            >
              ▶ Run Game
            </button>
          )}
        </div>
      </div>

      {/* Main content: table left, sidebar right */}
      <div className="flex flex-1 overflow-hidden">

        {/* Left — poker table */}
        <div className="flex flex-col items-center justify-center flex-1 p-6 gap-4 min-w-0">

          {/* Winner banner */}
          {lastWinner && !gameRunning && (
            <div className="w-full max-w-xl px-5 py-3 rounded-xl bg-amber-950/60 border border-amber-600/50 text-center flex-shrink-0">
              <p className="text-amber-300 font-bold text-lg">
                🏆 {lastWinner.name} wins ${lastWinner.amount}!
              </p>
              <p className="text-amber-500/80 text-xs mt-0.5">
                Press <span className="text-green-400 font-semibold">Next Round</span> to keep playing with current chip counts.
              </p>
            </div>
          )}

          {/* Poker Table */}
          <div
            className="relative flex-shrink-0"
            style={{ width: 'min(70vw, 720px)', height: 'min(42vw, 430px)' }}
          >
            {/* Felt oval */}
            <div
              className="absolute rounded-[50%] border-[12px] border-amber-900 shadow-2xl"
              style={{
                inset: '60px 80px',
                background: 'radial-gradient(ellipse at center, #166534 0%, #14532d 65%, #0f3d1f 100%)',
              }}
            />

            {/* Community cards + pot */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-2">
              <div className="flex gap-1.5">
                {communityCards.length > 0
                  ? communityCards.map((c, i) => <Card key={i} {...c} />)
                  : [0,1,2,3,4].map(i => <Card key={i} faceDown />)}
              </div>
              <div className="px-3 py-1 rounded-full bg-black/60 border border-amber-600/60 text-amber-300 font-bold text-xs">
                Pot: ${pot}
              </div>
            </div>

            {seats.map(seat => (
              <Seat key={seat.name} {...seat} />
            ))}
          </div>
        </div>

        {/* Right — game log sidebar */}
        <div className="w-80 flex-shrink-0 border-l border-slate-700 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700 flex-shrink-0">
            <p className="text-slate-400 text-xs font-semibold uppercase tracking-widest">Round Actions</p>
          </div>
          <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5">
            {gameLog.length === 0 && (
              <p className="text-slate-600 text-xs text-center mt-8">No actions yet — press Run Game to start.</p>
            )}
            {gameLog.map((entry, i) => (
              <div
                key={i}
                className={`flex gap-2.5 px-3 py-2 rounded-lg border text-sm
                  ${ACTION_ROW[entry.action] || 'bg-slate-800/60 border-slate-700'}`}
              >
                <div className="flex-shrink-0 min-w-[68px]">
                  <p className="text-white font-semibold text-xs leading-tight">{entry.player}</p>
                  <p className={`font-bold uppercase text-xs leading-tight ${ACTION_TEXT[entry.action] || 'text-slate-400'}`}>
                    {entry.action}{entry.amount > 0 ? ` $${entry.amount}` : ''}
                  </p>
                  {entry.street && (
                    <p className="text-slate-600 text-[9px] uppercase tracking-wide">{entry.street}</p>
                  )}
                </div>
                <p className="text-slate-400 text-[11px] leading-relaxed">{entry.reasoning}</p>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
