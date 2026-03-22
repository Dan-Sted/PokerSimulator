import { useState, useRef, useEffect } from 'react';
import { healthCheck, playTurn, evaluateHands, initBrowser, shutdownBrowser, getSessionStatus, clearSession, startLogin, confirmLogin } from '../api';

const PLAYER_NAMES = ['Calculator', 'Shark', 'Gambler', 'Maniac', 'Rock'];
const HUMAN_NAME   = 'You';
const RANKS        = ['2','3','4','5','6','7','8','9','T','J','Q','K','A'];
const SUITS        = ['S','H','D','C'];

// Blinds scale with starting stack and blind level (increases every 3 rounds)
const calcBlinds = (stack, level = 1) => {
  const mult = Math.pow(1.5, level - 1);
  const sb = Math.max(1, Math.round(stack * 0.01 * mult));
  return { SB: sb, BB: sb * 2 };
};

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
  6: [
    { bottom: 0,      left: '50%',  transform: 'translateX(-50%)' },          // 6 o'clock  – You
    { top: '62%',     right: '6%'  },                                          // 4–5 o'clock
    { top: '18%',     right: '6%'  },                                          // 1–2 o'clock
    { top: 0,         left: '50%',  transform: 'translateX(-50%)' },           // 12 o'clock
    { top: '18%',     left: '6%'   },                                          // 10–11 o'clock
    { top: '62%',     left: '6%'   },                                          // 7–8 o'clock
  ],
};

const ACTION_TEXT  = {
  fold:     'text-red-400',
  call:     'text-yellow-400',
  check:    'text-blue-400',
  raise:    'text-green-400',
  blind:    'text-slate-400',
  wins:     'text-emerald-300',
  result:   'text-violet-300',
  showdown: 'text-violet-400',
  error:    'text-orange-400',
};
const ACTION_BADGE = {
  fold:  'bg-red-900/60 border-red-500/40',
  call:  'bg-yellow-900/60 border-yellow-500/40',
  check: 'bg-blue-900/60 border-blue-500/40',
  raise: 'bg-green-900/60 border-green-500/40',
};
const ACTION_ROW = {
  fold:     'bg-red-950/40 border-red-800/40',
  call:     'bg-yellow-950/40 border-yellow-800/40',
  check:    'bg-blue-950/40 border-blue-800/40',
  raise:    'bg-green-950/40 border-green-800/40',
  blind:    'bg-slate-800/60 border-slate-700',
  wins:     'bg-emerald-950/40 border-emerald-700/40',
  result:   'bg-violet-950/40 border-violet-800/40',
  showdown: 'bg-violet-950/40 border-violet-900/40',
  error:    'bg-orange-950/40 border-orange-800/40',
};

// ── Sub-components ────────────────────────────────────────────────────────────

function Card({ rank, suit, faceDown, large }) {
  const SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const red  = suit === 'H' || suit === 'D';
  if (faceDown) {
    return large ? (
      <div className="w-12 h-16 rounded-lg bg-slate-700 border border-slate-500 flex items-center justify-center text-slate-400 text-sm">
        ?
      </div>
    ) : (
      <div className="w-8 h-11 rounded bg-slate-700 border border-slate-500 flex items-center justify-center text-slate-400 text-[10px]">
        ?
      </div>
    );
  }
  if (large) {
    return (
      <div className={`w-12 h-16 rounded-lg bg-white border border-slate-300 flex flex-col items-center justify-center text-sm shadow-lg ${red ? 'text-red-600' : 'text-slate-800'}`}>
        <span className="font-bold leading-none text-base">{rank}</span>
        <span className="leading-none">{SYM[suit] || suit}</span>
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

function HumanActionPanel({ toCall, stack, pot, street, onAction }) {
  const minRaise = Math.max(toCall * 2, toCall + 1, 1);
  const canCheck = toCall === 0;
  const canRaise = stack > toCall;
  const callAmt  = Math.min(toCall, stack);

  const [raising, setRaising] = useState(false);
  // Store as string so the user can freely delete and retype
  const [rawInput, setRawInput] = useState(String(Math.min(minRaise, stack)));

  const parsedAmt = parseInt(rawInput) || 0;
  const isValid   = parsedAmt >= minRaise && parsedAmt <= stack;

  const handleConfirmRaise = () => {
    const amt = Math.max(minRaise, Math.min(stack, parsedAmt));
    onAction('raise', amt);
    setRaising(false);
  };

  // Info bar — same in both modes
  const infoBar = (
    <div className="flex items-center justify-between mb-2.5">
      <div className="flex items-center gap-1.5">
        <span className="w-2 h-2 rounded-full bg-blue-400 animate-pulse flex-shrink-0" />
        <span className="text-blue-300 font-bold text-xs uppercase tracking-widest">Your Turn</span>
        <span className="text-slate-500 text-xs ml-1">— {street}</span>
      </div>
      <div className="flex gap-4 text-xs">
        <span className="text-slate-400">Pot <span className="text-amber-300 font-semibold">${pot}</span></span>
        <span className="text-slate-400">Stack <span className="text-white font-semibold">${stack}</span></span>
        {toCall > 0 && <span className="text-slate-400">To Call <span className="text-red-400 font-semibold">${callAmt}</span></span>}
      </div>
    </div>
  );

  return (
    <div
      style={{ background: 'linear-gradient(to top, #0f172a, #1e1b4b)', borderTop: '2px solid rgba(99,102,241,0.5)' }}
      className="w-full flex-shrink-0 px-6 py-3"
    >
      {infoBar}

      {raising ? (
        <div className="flex items-center gap-3">
          <span className="text-slate-400 text-sm whitespace-nowrap">Raise $</span>
          <input
            autoFocus
            type="text"
            inputMode="numeric"
            value={rawInput}
            onChange={e => setRawInput(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={e => { if (e.key === 'Enter' && isValid) handleConfirmRaise(); if (e.key === 'Escape') setRaising(false); }}
            className="w-28 px-3 py-2 rounded-xl bg-slate-800 border border-slate-600 text-white text-sm text-center focus:outline-none focus:border-indigo-400 transition-colors"
          />
          {!isValid && rawInput !== '' && (
            <span className="text-red-400 text-xs whitespace-nowrap">
              {parsedAmt < minRaise ? `min $${minRaise}` : `max $${stack}`}
            </span>
          )}
          <div className="flex gap-2 ml-auto">
            <button
              onClick={() => setRaising(false)}
              className="px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-slate-300 text-sm font-medium transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleConfirmRaise}
              disabled={!isValid}
              className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-bold text-sm transition-colors"
            >
              Raise ${isValid ? parsedAmt : '—'}
            </button>
          </div>
        </div>
      ) : (
        <div className="flex gap-3 justify-center">
          <button
            onClick={() => onAction('fold', 0)}
            style={{ minWidth: '110px', background: 'rgba(153,27,27,0.6)', border: '1px solid rgba(239,68,68,0.4)' }}
            className="py-3 rounded-2xl text-red-300 font-bold text-base hover:bg-red-800 transition-colors"
          >
            Fold
          </button>
          <button
            onClick={() => onAction('call', callAmt)}
            style={{ minWidth: '140px', background: 'rgba(133,77,14,0.6)', border: '1px solid rgba(234,179,8,0.4)' }}
            className="py-3 rounded-2xl text-yellow-300 font-bold text-base hover:bg-yellow-800 transition-colors"
          >
            {canCheck ? 'Check' : `Call $${callAmt}`}
          </button>
          {canRaise && (
            <button
              onClick={() => { setRawInput(String(Math.min(minRaise, stack))); setRaising(true); }}
              style={{ minWidth: '110px', background: 'rgba(30,64,175,0.6)', border: '1px solid rgba(99,102,241,0.5)' }}
              className="py-3 rounded-2xl text-indigo-300 font-bold text-base hover:bg-indigo-800 transition-colors"
            >
              Raise
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Seat({ name, stack, cards, isDealer, isSmallBlind, isBigBlind, isActive, isThinking, lastAction, isFolded, isAllIn, isEliminated, isChipLeader, isHuman, wins, inPot, style }) {
  return (
    <div
      className={`absolute flex flex-col items-center rounded-xl px-2 py-1.5 min-w-[88px] transition-all border
        ${isEliminated
          ? 'bg-slate-950/60 border-slate-800/30 opacity-30'
          : isFolded
            ? 'bg-slate-900/60 border-slate-700/40 opacity-40'
            : isActive && isHuman
              ? 'bg-blue-950/90 ring-2 ring-blue-400 ring-offset-1 ring-offset-green-900 border-blue-400/70'
              : isActive
                ? 'bg-slate-800/90 ring-2 ring-amber-400 ring-offset-1 ring-offset-green-900 border-amber-400/70'
                : isHuman
                  ? 'bg-blue-950/70 ring-1 ring-blue-600/50 border-blue-600/50'
                  : isChipLeader
                    ? 'bg-slate-800/90 ring-1 ring-yellow-500/60 border-yellow-600/50'
                    : 'bg-slate-800/90 border-slate-600/70'}`}
      style={style}
    >
      <div className="flex items-center gap-1">
        {isChipLeader && !isEliminated && <span className="text-[10px]">👑</span>}
        {isHuman && !isEliminated && <span className="text-[10px]">👤</span>}
        <span className={`font-semibold text-xs leading-tight ${isEliminated || isFolded ? 'text-slate-500' : isHuman ? 'text-blue-300' : 'text-white'}`}>{name}</span>
      </div>
      <span className={`text-xs leading-tight ${isEliminated ? 'text-slate-600' : 'text-amber-300'}`}>${stack}</span>
      {inPot > 0 && !isEliminated && (
        <span className="text-[9px] text-slate-400 leading-none">in: <span className="text-slate-300">${inPot}</span></span>
      )}
      {wins > 0 && !isEliminated && <span className="text-[9px] text-amber-500 font-bold leading-none">×{wins} wins</span>}

      {isThinking && (
        <span className="text-slate-400 text-[10px] animate-pulse mt-0.5">thinking…</span>
      )}
      {isEliminated && (
        <span className="text-[10px] font-bold uppercase text-slate-600 mt-0.5">OUT</span>
      )}
      {!isEliminated && isFolded && (
        <span className="text-[10px] font-bold uppercase text-slate-500 mt-0.5">Folded</span>
      )}
      {!isEliminated && !isFolded && isAllIn && (
        <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border mt-0.5 bg-purple-900/60 border-purple-500/40 text-purple-300">
          All In
        </span>
      )}
      {!isEliminated && !isFolded && !isThinking && !isAllIn && lastAction && lastAction.action !== 'blind' && (
        <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded border mt-0.5
          ${ACTION_BADGE[lastAction.action] || 'bg-slate-700 border-slate-600'}
          ${ACTION_TEXT[lastAction.action]  || 'text-white'}`}>
          {lastAction.action}{lastAction.amount > 0 ? ` $${lastAction.amount}` : ''}
        </span>
      )}

      {!isEliminated && (
        <div className="flex gap-0.5 mt-1">
          {cards?.map((c, i) => <Card key={i} {...c} />)}
        </div>
      )}

      {!isEliminated && isDealer && (
        <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-white text-slate-800 text-[10px] flex items-center justify-center font-bold shadow">
          D
        </span>
      )}
      {!isEliminated && !isDealer && isSmallBlind && (
        <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-blue-500 text-white text-[9px] flex items-center justify-center font-bold shadow">
          SB
        </span>
      )}
      {!isEliminated && !isDealer && !isSmallBlind && isBigBlind && (
        <span className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-orange-500 text-white text-[9px] flex items-center justify-center font-bold shadow">
          BB
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
  manualPlayer, setManualPlayer,
  startingStack, setStartingStack,
  actionSpeed, setActionSpeed,
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
  const canStart = connected && (mode === 'api' || mode === 'ollama' || browserSufficient);
  const { SB: sb, BB: bb } = calcBlinds(startingStack);

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
                options={['ollama', 'browser', 'api']}
                value={mode}
                onChange={setMode}
                labelFn={m => m === 'browser' ? '🌐 Browser' : m === 'api' ? '⚡ API' : '🦙 Ollama'}
              />
              <p className="text-slate-500 text-xs mt-1.5">
                {mode === 'browser'
                  ? 'Uses Gemini via Chrome — bypasses API rate limits'
                  : mode === 'api'
                    ? 'Uses Gemini API directly — requires GEMINI_API_KEY in .env'
                    : 'Uses a local Ollama model — requires OLLAMA_URL + OLLAMA_MODEL in .env'}
              </p>
            </div>

            {/* AI Player Count */}
            <div>
              <p className="text-slate-400 text-xs uppercase tracking-wider mb-2">AI Players</p>
              <SegmentGroup
                options={[3, 4, 5]}
                value={playerCount}
                onChange={setPlayerCount}
              />
              <p className="text-slate-500 text-xs mt-1.5">
                {manualPlayer
                  ? `${HUMAN_NAME} + ${PLAYER_NAMES.slice(0, playerCount).join(', ')} (${playerCount + 1} total)`
                  : PLAYER_NAMES.slice(0, playerCount).join(', ')}
              </p>
            </div>

            {/* Manual Player */}
            <div className="flex items-center justify-between py-1">
              <div>
                <p className="text-slate-300 text-sm font-medium">Play yourself</p>
                <p className="text-slate-500 text-xs">Add a manual player seat at the table</p>
              </div>
              <Toggle value={manualPlayer} onChange={setManualPlayer} />
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

            {/* Action Speed */}
            <div>
              <p className="text-slate-400 text-xs uppercase tracking-wider mb-2">Action Speed</p>
              <SegmentGroup
                options={[0, 1000, 2500]}
                value={actionSpeed}
                onChange={setActionSpeed}
                labelFn={v => v === 0 ? '⚡ Fast' : v === 1000 ? '▶ Normal' : '🐢 Slow'}
              />
              <p className="text-slate-500 text-xs mt-1.5">Delay between each AI action</p>
            </div>

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
          {mode === 'browser' && (
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

// ── Side pot helper ───────────────────────────────────────────────────────────
// Returns an array of { amount, eligible } pots, or null when no side pots exist.
// totalContrib  – { playerName: totalChipsPutIn } for ALL players (including folded)
// eligible      – players still alive at showdown
// allRoundPlayers – every player who started this round
// allInSet      – Set of player names who went all-in
function computeSidePots(totalContrib, eligible, allRoundPlayers, allInSet) {
  const eligibleAllIn = eligible.filter(p => allInSet.has(p));
  if (eligibleAllIn.length === 0) return null; // no all-in among survivors → no side pot

  const allInCaps = eligibleAllIn.map(p => totalContrib[p] || 0).sort((a, b) => a - b);
  const nonAllInMax = eligible
    .filter(p => !allInSet.has(p))
    .reduce((mx, p) => Math.max(mx, totalContrib[p] || 0), 0);

  const caps = [...new Set([...allInCaps, nonAllInMax])].filter(c => c > 0).sort((a, b) => a - b);
  if (caps.length === 0) return null;

  const pots = [];
  let prevCap = 0;
  for (const cap of caps) {
    let potAmount = 0;
    for (const p of allRoundPlayers) {
      const contrib = totalContrib[p] || 0;
      potAmount += Math.min(contrib, cap) - Math.min(contrib, prevCap);
    }
    const potEligible = eligible.filter(p => (totalContrib[p] || 0) >= cap);
    if (potAmount > 0) {
      pots.push({ amount: potAmount, eligible: potEligible.length ? potEligible : eligible });
    }
    prevCap = cap;
  }
  return pots.length > 1 ? pots : null; // single pot → no split needed
}

// ── Main Game Component ───────────────────────────────────────────────────────

export default function PokerTable() {
  const [phase, setPhase]                   = useState('settings');
  const [connected, setConnected]           = useState(false);
  const [signingIn, setSigningIn]           = useState(false);
  const [confirmingLogin, setConfirmingLogin] = useState(false);
  const [mode, setMode]                     = useState(() => localStorage.getItem('pk_mode') || 'ollama');
  const [manualPlayer, setManualPlayer]     = useState(() => localStorage.getItem('pk_manual') === 'true');
  const [waitingForHuman, setWaitingForHuman] = useState(false);
  const [humanActionState, setHumanActionState] = useState(null);
  const humanResolverRef = useRef(null);
  const [browserReady, setBrowserReady]       = useState(false);
  const [initingBrowser, setInitingBrowser]   = useState(false);
  const [initializedCount, setInitializedCount] = useState(0);
  const [showHands, setShowHands]           = useState(() => localStorage.getItem('pk_showHands') === 'true');
  const [actionSpeed, setActionSpeed]       = useState(() => parseInt(localStorage.getItem('pk_speed') ?? '1000'));
  const [playerCount, setPlayerCount]       = useState(() => parseInt(localStorage.getItem('pk_players') || '3'));
  const [startingStack, setStartingStack]   = useState(() => parseInt(localStorage.getItem('pk_stack') || '1000'));
  const [dealerIdx, setDealerIdx]           = useState(0);   // rotates each round
  const [dealerName, setDealerName]         = useState(null); // persists for seat badge
  const [sbName, setSbName]                 = useState(null);
  const [bbName, setBbName]                 = useState(null);
  const [foldedPlayers, setFoldedPlayers]   = useState(new Set());
  const [allInPlayers, setAllInPlayers]     = useState(new Set());
  const [roundNumber, setRoundNumber]       = useState(0);
  const [blindLevel, setBlindLevel]         = useState(1);   // increases every 3 rounds
  const [playerWins, setPlayerWins]         = useState({});  // win count per player
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
  const [lastWinner, setLastWinner]         = useState(null);       // [{ name, amount }] or null
  const [currentContrib, setCurrentContrib] = useState({});         // chips each player has put in this round
  const [sessionStatus, setSessionStatus]   = useState(null);       // null=unchecked, true/false
  const [clearingSession, setClearingSession] = useState(false);
  const stopRef       = useRef(false);
  const initAbortRef  = useRef(null);   // AbortController for in-flight browser init
  const gameLogRef    = useRef(null);   // scroll container for auto-scroll to bottom

  // Persist settings to localStorage
  useEffect(() => { localStorage.setItem('pk_mode', mode); }, [mode]);
  useEffect(() => { localStorage.setItem('pk_manual', manualPlayer); }, [manualPlayer]);
  useEffect(() => { localStorage.setItem('pk_players', playerCount); }, [playerCount]);
  useEffect(() => { localStorage.setItem('pk_stack', startingStack); }, [startingStack]);
  useEffect(() => { localStorage.setItem('pk_showHands', showHands); }, [showHands]);
  useEffect(() => { localStorage.setItem('pk_speed', actionSpeed); }, [actionSpeed]);

  // Auto-scroll game log to bottom whenever a new entry is added
  useEffect(() => {
    if (gameLogRef.current) {
      gameLogRef.current.scrollTop = gameLogRef.current.scrollHeight;
    }
  }, [gameLog]);

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

  // Unblock human if waiting for input
  const resolveHumanWithFold = () => {
    if (humanResolverRef.current) {
      humanResolverRef.current({ action: 'fold', amount: 0, reasoning: 'Game stopped' });
      humanResolverRef.current = null;
    }
    setWaitingForHuman(false);
    setHumanActionState(null);
  };

  // End Game: stop round → close browser → reset state → return to settings
  const handleEndGame = async () => {
    stopRef.current = true;
    resolveHumanWithFold();
    if (initAbortRef.current) { initAbortRef.current.abort(); initAbortRef.current = null; }
    setInitingBrowser(false);
    setShuttingDown(true);
    try {
      await shutdownBrowser(); // always attempt — backend handles "not initialized" gracefully
    } catch { /* ignore */ }
    finally { setShuttingDown(false); }
    setBrowserReady(false); setInitializedCount(0);
    setGameLog([]); setPlayerActions({}); setPot(0); setRoundComplete(false);
    setCommunityCards([]); setHoleCards({}); setStacks({}); setLastWinner(null); setCurrentContrib({});
    setActivePlayer(null); setGameRunning(false);
    setDealerIdx(0); setDealerName(null); setSbName(null); setBbName(null);
    setFoldedPlayers(new Set()); setAllInPlayers(new Set()); setRoundNumber(0);
    setBlindLevel(1); setPlayerWins({});
    setPhase('settings');
  };

  // Restart: close browser + reset all game state (stays on settings)
  const handleRestart = async () => {
    stopRef.current = true;
    resolveHumanWithFold();
    if (initAbortRef.current) { initAbortRef.current.abort(); initAbortRef.current = null; }
    setInitingBrowser(false);
    setShuttingDown(true); setError(null);
    try {
      await shutdownBrowser(); // always attempt — backend handles "not initialized" gracefully
    } catch { /* ignore */ }
    finally { setShuttingDown(false); }
    setBrowserReady(false); setInitializedCount(0);
    setGameLog([]); setPlayerActions({}); setPot(0); setRoundComplete(false);
    setCommunityCards([]); setHoleCards({}); setStacks({}); setLastWinner(null); setCurrentContrib({});
    setActivePlayer(null); setGameRunning(false);
    setDealerIdx(0); setDealerName(null); setSbName(null); setBbName(null);
    setFoldedPlayers(new Set()); setAllInPlayers(new Set()); setRoundNumber(0);
    setBlindLevel(1); setPlayerWins({});
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

  // Core game loop
  const runGameRound = async (initialStacks, dIdx, bLevel = 1) => {
    const { SB, BB } = calcBlinds(startingStack, bLevel);

    stopRef.current = false;
    setGameRunning(true);
    setRoundComplete(false);
    setGameLog([]);
    setPlayerActions({});
    setFoldedPlayers(new Set());
    setAllInPlayers(new Set());
    setCurrentContrib({});
    setError(null);
    setActivePlayer(null);
    setLastWinner(null);

    // Only include players who still have chips
    const allPlayers = manualPlayer
      ? [HUMAN_NAME, ...PLAYER_NAMES.slice(0, playerCount)]
      : PLAYER_NAMES.slice(0, playerCount);
    const players = allPlayers.filter(p => (initialStacks[p] ?? startingStack) > 0);

    if (players.length <= 1) {
      const winner = players[0] ?? null;
      if (winner) {
        setLastWinner([{ name: winner, amount: 0 }]);
        setGameLog([{ player: winner, street: 'result', action: 'wins', amount: 0, reasoning: 'Last player standing — tournament winner!' }]);
      }
      setActivePlayer(null);
      setGameRunning(false);
      setRoundComplete(true);
      return;
    }

    // ── Dealer / blind positions ─────────────────────────────────────────────
    const n   = players.length;
    const d   = dIdx % n;
    const sbI = (d + 1) % n;
    const bbI = (d + 2) % n;
    const utgI = (d + 3) % n;

    setDealerName(players[d]);
    setSbName(players[sbI]);
    setBbName(players[bbI]);

    // Deal cards
    const deck = shuffledDeck();
    const newHoleCards = {};
    players.forEach((p, i) => { newHoleCards[p] = [deck[i * 2], deck[i * 2 + 1]]; });
    const communityDeck = deck.slice(n * 2, n * 2 + 5);

    setHoleCards(newHoleCards);
    setCommunityCards([]);
    setStreet('preflop');

    // Post blinds
    const s0    = { ...initialStacks };
    const sbAmt = Math.min(SB, s0[players[sbI]]);
    const bbAmt = Math.min(BB, s0[players[bbI]]);
    s0[players[sbI]] -= sbAmt;
    s0[players[bbI]] -= bbAmt;
    let pot0 = sbAmt + bbAmt;

    // Track total chips committed per player across all streets (for side pot math).
    // Blinds are NOT pre-loaded here — they're tracked via preflopInitContrib and
    // accumulated by the first runStreet call, so there's no double-counting.
    const totalContrib = {};
    players.forEach(p => { totalContrib[p] = 0; });
    const localAllIn = new Set();
    if (s0[players[sbI]] === 0) { localAllIn.add(players[sbI]); setAllInPlayers(prev => new Set([...prev, players[sbI]])); }
    if (s0[players[bbI]] === 0) { localAllIn.add(players[bbI]); setAllInPlayers(prev => new Set([...prev, players[bbI]])); }

    // Running per-player totals for the whole round (for log display)
    const runningTotal = {};
    players.forEach(p => { runningTotal[p] = 0; });
    runningTotal[players[sbI]] = sbAmt;
    runningTotal[players[bbI]] = bbAmt;

    setStacks({ ...s0 });
    setPot(pot0);
    setCurrentContrib({ [players[sbI]]: sbAmt, [players[bbI]]: bbAmt });
    setGameLog([
      { player: players[sbI], street: 'preflop', action: 'blind', amount: sbAmt, reasoning: 'Posts small blind' },
      { player: players[bbI], street: 'preflop', action: 'blind', amount: bbAmt, reasoning: 'Posts big blind'  },
    ]);

    // Finish helper
    const finish = (winner, winAmount, aborted = false) => {
      if (winner && !aborted) {
        setStacks(prev => ({ ...prev, [winner]: (prev[winner] ?? 0) + winAmount }));
        setPot(0);
        setLastWinner([{ name: winner, amount: winAmount }]);
        setPlayerWins(prev => ({ ...prev, [winner]: (prev[winner] ?? 0) + 1 }));
        setGameLog(prev => [...prev, {
          player: winner, street: 'result', action: 'wins',
          amount: winAmount, reasoning: `${winner === HUMAN_NAME ? 'Win' : 'Wins'} the pot of $${winAmount}.`,
        }]);
      }
      setActivePlayer(null);
      setGameRunning(false);
      setRoundComplete(!aborted);
    };

    // One betting street — uses a proper multi-round loop so players can respond to raises.
    // initialContributed: credit blinds so SB/BB aren't double-charged in preflop.
    const runStreet = async (activePlayers, stacks_, pot_, community, streetName, initialToCall, initialContributed = null) => {
      const s = { ...stacks_ };
      let p = pot_;
      const folded          = new Set();
      const contributed     = {};
      const allInThisStreet = new Set();
      activePlayers.forEach(pl => { contributed[pl] = initialContributed?.[pl] ?? 0; });
      let toCall = initialToCall;

      // Track who has acted since the last raise; everyone starts needing to act.
      const actedSinceRaise = new Set();
      let idx = 0;
      const n = activePlayers.length;

      while (true) {
        if (stopRef.current) break;

        // Players still able to bet (not folded, still have chips)
        const active = activePlayers.filter(pl => !folded.has(pl) && s[pl] > 0);
        if (active.length <= 1) break;
        // All active players have responded to the latest action → street over
        if (active.every(pl => actedSinceRaise.has(pl))) break;

        const player = activePlayers[idx % n];
        idx++;

        if (folded.has(player)) continue;
        if (s[player] <= 0) continue;
        if (actedSinceRaise.has(player)) continue;

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
        if (player === HUMAN_NAME) {
          result = await new Promise(resolve => {
            setWaitingForHuman(true);
            setHumanActionState(state);
            humanResolverRef.current = resolve;
          });
          setWaitingForHuman(false);
          setHumanActionState(null);
        } else {
          try {
            result = await playTurn(player, state, mode);
          } catch (e) {
            const msg = e.response?.data?.detail || e.message || 'Request failed';
            setError(msg);
            result = { action: 'call', amount: needToCall, reasoning: `Error: ${msg}` };
          }
        }

        let actualAmount = 0;
        if (result.action === 'fold') {
          folded.add(player);
          setFoldedPlayers(prev => new Set([...prev, player]));
        } else if (result.action === 'raise') {
          const extra     = result.amount > 0 ? result.amount : BB;
          const callPart  = Math.min(needToCall, s[player]);
          const raisePart = Math.min(extra, s[player] - callPart);
          const total     = callPart + raisePart;
          s[player]           -= total;
          p                   += total;
          contributed[player] += total;
          toCall               = contributed[player];
          actualAmount         = total;
          // Raise: everyone else must respond
          actedSinceRaise.clear();
        } else {
          const callAmt = Math.min(needToCall, s[player]);
          s[player]           -= callAmt;
          p                   += callAmt;
          contributed[player] += callAmt;
          actualAmount         = callAmt;
        }

        actedSinceRaise.add(player);

        if (s[player] === 0 && result.action !== 'fold') {
          allInThisStreet.add(player);
          setAllInPlayers(prev => new Set([...prev, player]));
        }

        // Show 'check' when a call costs $0
        const displayAction = (result.action === 'call' && actualAmount === 0) ? 'check' : result.action;
        runningTotal[player] = (runningTotal[player] || 0) + actualAmount;
        const logEntry = { ...result, action: displayAction, amount: actualAmount, totalIn: runningTotal[player] };
        setPlayerActions(prev => ({ ...prev, [player]: logEntry }));
        setGameLog(prev => [...prev, { player, street: streetName, ...logEntry }]);
        setStacks({ ...s });
        setPot(p);
        setCurrentContrib(prev => ({ ...prev, [player]: (prev[player] || 0) + actualAmount }));

        if (actionSpeed > 0 && !stopRef.current) {
          await new Promise(r => setTimeout(r, actionSpeed));
        }
      }

      return { stacks: s, pot: p, stillActive: activePlayers.filter(pl => !folded.has(pl)), contributed, allInThisStreet };
    };

    // Accumulate each street's contributions into totalContrib and localAllIn
    const accumulate = (streetResult) => {
      for (const [p, amt] of Object.entries(streetResult.contributed)) {
        totalContrib[p] = (totalContrib[p] || 0) + amt;
      }
      for (const p of streetResult.allInThisStreet) localAllIn.add(p);
    };

    // ── PREFLOP ──────────────────────────────────────────────────────────────
    // Credit blinds as already-contributed so SB/BB aren't charged again
    const preflopInitContrib = {};
    players.forEach(p => { preflopInitContrib[p] = 0; });
    preflopInitContrib[players[sbI]] = sbAmt;
    preflopInitContrib[players[bbI]] = bbAmt;

    setStreet('preflop');
    const preflopOrder = [...players.slice(utgI), ...players.slice(0, utgI)];
    let result = await runStreet(preflopOrder, s0, pot0, [], 'preflop', BB, preflopInitContrib);
    accumulate(result);

    if (stopRef.current) { finish(null, 0, true); return; }
    if (result.stillActive.length <= 1) { finish(result.stillActive[0] ?? null, result.pot); return; }

    // Helper: reveal community cards and run a betting street, but SKIP betting
    // if ≤1 player still has chips (everyone else is all-in — no meaningful action).
    const runOrSkip = async (streetName, community) => {
      setCommunityCards(community);
      setStreet(streetName);
      setPlayerActions({});
      const canBet = result.stillActive.filter(p => result.stacks[p] > 0);
      if (canBet.length <= 1) {
        // All opponents are all-in — no betting possible, just reveal cards
        if (actionSpeed > 0 && !stopRef.current) {
          await new Promise(r => setTimeout(r, Math.max(actionSpeed / 2, 400)));
        }
        return result; // unchanged stacks / pot
      }
      const newResult = await runStreet(result.stillActive, result.stacks, result.pot, community, streetName, 0);
      accumulate(newResult);
      return newResult;
    };

    // ── FLOP ─────────────────────────────────────────────────────────────────
    result = await runOrSkip('flop', communityDeck.slice(0, 3));

    if (stopRef.current) { finish(null, 0, true); return; }
    if (result.stillActive.length <= 1) { finish(result.stillActive[0] ?? null, result.pot); return; }

    // ── TURN ─────────────────────────────────────────────────────────────────
    result = await runOrSkip('turn', communityDeck.slice(0, 4));

    if (stopRef.current) { finish(null, 0, true); return; }
    if (result.stillActive.length <= 1) { finish(result.stillActive[0] ?? null, result.pot); return; }

    // ── RIVER ────────────────────────────────────────────────────────────────
    result = await runOrSkip('river', communityDeck.slice(0, 5));
    const river = communityDeck.slice(0, 5);

    if (stopRef.current) { finish(null, 0, true); return; }

    // ── SHOWDOWN — evaluate hands, compute side pots, award chips ────────────
    const survivors = result.stillActive;
    try {
      const payload = survivors.map(name => ({ name, hole_cards: newHoleCards[name] }));
      const { winners, hand_descriptions } = await evaluateHands(payload, river);

      // Log each player's hand description
      survivors.forEach(name => {
        if (hand_descriptions?.[name]) {
          setGameLog(prev => [...prev, {
            player: name, street: 'showdown', action: 'result',
            amount: 0, reasoning: hand_descriptions[name],
          }]);
        }
      });

      // Check if side pots are needed (only when ≥1 survivor is all-in)
      const sidePots = computeSidePots(totalContrib, survivors, players, localAllIn);

      if (sidePots) {
        // Award each pot to the best hand among eligible players
        const finalStacks = { ...result.stacks };
        const allWins = [];
        for (const { amount, eligible } of sidePots) {
          let potWinner;
          if (eligible.length === 1) {
            potWinner = eligible[0];
          } else {
            const eligPayload = eligible.map(name => ({ name, hole_cards: newHoleCards[name] }));
            const { winners: potWinners } = await evaluateHands(eligPayload, river);
            potWinner = potWinners[0] ?? eligible[0];
          }
          finalStacks[potWinner] = (finalStacks[potWinner] ?? 0) + amount;
          allWins.push({ name: potWinner, amount });
          setPlayerWins(prev => ({ ...prev, [potWinner]: (prev[potWinner] ?? 0) + 1 }));
          setGameLog(prev => [...prev, {
            player: potWinner, street: 'result', action: 'wins',
            amount, reasoning: `${potWinner === HUMAN_NAME ? 'Win' : 'Wins'} pot of $${amount}.`,
          }]);
        }
        setStacks(finalStacks);
        setPot(0);
        setLastWinner(allWins);
        setActivePlayer(null);
        setGameRunning(false);
        setRoundComplete(true);
      } else {
        // Single pot — award to best hand overall
        const winner = winners[0] ?? survivors[0] ?? null;
        finish(winner, result.pot);
      }
    } catch {
      // Fallback: first survivor takes the pot
      finish(survivors[0] ?? null, result.pot);
    }
  };

  const handleRunGame = () => {
    const players = manualPlayer
      ? [HUMAN_NAME, ...PLAYER_NAMES.slice(0, playerCount)]
      : PLAYER_NAMES.slice(0, playerCount);
    const init    = {};
    players.forEach(p => { init[p] = startingStack; });
    setDealerIdx(0);
    setRoundNumber(1);
    setBlindLevel(1);
    return runGameRound(init, 0, 1);
  };

  const handleNextRound = () => {
    const players    = manualPlayer
      ? [HUMAN_NAME, ...PLAYER_NAMES.slice(0, playerCount)]
      : PLAYER_NAMES.slice(0, playerCount);
    const carry      = {};
    players.forEach(p => { carry[p] = stacks[p] ?? startingStack; });
    const nextDealer = dealerIdx + 1;
    const nextRound  = roundNumber + 1;
    // Increase blind level every 3 rounds
    const nextLevel  = Math.floor((nextRound - 1) / 3) + 1;
    setCommunityCards([]);
    setHoleCards({});
    setFoldedPlayers(new Set());
    setAllInPlayers(new Set());
    setDealerIdx(nextDealer);
    setRoundNumber(nextRound);
    setBlindLevel(nextLevel);
    return runGameRound(carry, nextDealer, nextLevel);
  };

  // ── Settings phase ─────────────────────────────────────────────────────────

  if (phase === 'settings') {
    return (
      <SettingsScreen
        mode={mode} setMode={setMode}
        playerCount={playerCount} setPlayerCount={setPlayerCount}
        manualPlayer={manualPlayer} setManualPlayer={setManualPlayer}
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
        actionSpeed={actionSpeed} setActionSpeed={setActionSpeed}
        onRestart={handleRestart}
        onStart={() => {
          setGameLog([]); setPlayerActions({}); setPot(0); setRoundComplete(false);
          setCommunityCards([]); setHoleCards({}); setStacks({}); setLastWinner(null);
          setFoldedPlayers(new Set()); setAllInPlayers(new Set());
          setDealerName(null); setSbName(null); setBbName(null);
          setActivePlayer(null); setError(null);
          setPhase('game');
        }}
        error={error}
      />
    );
  }

  // ── Game phase ─────────────────────────────────────────────────────────────

  const activePlayers = manualPlayer
    ? [HUMAN_NAME, ...PLAYER_NAMES.slice(0, playerCount)]
    : PLAYER_NAMES.slice(0, playerCount);
  const seatPos       = SEAT_POSITIONS[activePlayers.length];

  // Chip leader = active (non-eliminated) player with max stack, only when stacks have diverged
  const aliveStacks = activePlayers.filter(n => (stacks[n] ?? startingStack) > 0);
  const stackVals   = aliveStacks.map(n => stacks[n] ?? startingStack);
  const stacksDiverged = stackVals.length > 1 && Math.max(...stackVals) !== Math.min(...stackVals);
  const chipLeader  = stacksDiverged
    ? aliveStacks.reduce((a, b) => ((stacks[a] ?? startingStack) >= (stacks[b] ?? startingStack) ? a : b), aliveStacks[0])
    : null;

  const seats = activePlayers.map((name, i) => {
    const stack = stacks[name] ?? startingStack;
    const isHuman = name === HUMAN_NAME;
    return {
      name,
      stack,
      isHuman,
      cards:        (showHands || isHuman)
                      ? (holeCards[name] ?? [{ faceDown: true }, { faceDown: true }])
                      : [{ faceDown: true }, { faceDown: true }],
      isDealer:     name === dealerName,
      isSmallBlind: name === sbName,
      isBigBlind:   name === bbName,
      isActive:     name === activePlayer,
      isThinking:   name === activePlayer && gameRunning && !isHuman,
      lastAction:   playerActions[name] ?? null,
      isFolded:     foldedPlayers.has(name),
      isAllIn:      allInPlayers.has(name),
      isEliminated: roundNumber > 0 && stack === 0 && !allInPlayers.has(name),
      isChipLeader: name === chipLeader && roundNumber > 0 && !gameRunning,
      wins:         playerWins[name] ?? 0,
      inPot:        currentContrib[name] ?? 0,
      style:        seatPos[i],
    };
  });

  const STREET_LABEL = { preflop: 'Pre-Flop', flop: 'Flop', turn: 'Turn', river: 'River' };

  return (
    <div className="h-screen bg-slate-900 text-white flex flex-col overflow-hidden">

      {/* Top bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-700 bg-slate-800/80 flex-shrink-0">
        <span className="text-slate-400 text-xs px-2 py-1 rounded bg-slate-800 border border-slate-700">
          {mode === 'browser' ? '🌐 Browser' : mode === 'api' ? '⚡ API' : '🦙 Ollama'}
        </span>
        {roundNumber > 0 && (
          <span className="text-slate-400 text-xs px-2 py-1 rounded bg-slate-800 border border-slate-700">
            Round {roundNumber}
          </span>
        )}
        {roundNumber > 0 && (() => { const { SB, BB } = calcBlinds(startingStack, blindLevel); return (
          <span className={`text-xs px-2 py-1 rounded border ${blindLevel > 1 ? 'text-orange-300 bg-orange-950/40 border-orange-700/40' : 'text-slate-400 bg-slate-800 border-slate-700'}`}>
            Blinds ${SB}/${BB}{blindLevel > 1 ? ` · Lv.${blindLevel}` : ''}
          </span>
        ); })()}
        {gameRunning && (
          <span className="text-amber-400 text-xs px-2 py-1 rounded bg-amber-950/40 border border-amber-700/40">
            {STREET_LABEL[street] ?? street}
          </span>
        )}
        {error && <span className="text-red-400 text-xs ml-2">⚠ {error}</span>}

        <div className="ml-auto flex items-center gap-2">
          {/* Speed control — usable mid-game */}
          <div className="flex items-center gap-1 border border-slate-700 rounded-lg overflow-hidden">
            {[{v:0,label:'⚡'},{v:1000,label:'▶'},{v:2500,label:'🐢'}].map(({v,label}) => (
              <button
                key={v}
                onClick={() => setActionSpeed(v)}
                style={{ backgroundColor: actionSpeed === v ? '#d97706' : '#1e293b' }}
                className="px-2 py-1 text-xs border-none outline-none text-white cursor-pointer"
              >
                {label}
              </button>
            ))}
          </div>

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
              onClick={() => { stopRef.current = true; resolveHumanWithFold(); }}
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

          {/* Poker Table */}
          <div
            className="relative flex-shrink-0"
            style={{ width: 'min(calc(100vw - 380px), 1000px)', height: 'min(calc(100vh - 180px), 600px)' }}
          >
            {/* Winner banner — absolute overlay so it never shifts layout */}
            {lastWinner && !gameRunning && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 px-6 py-2.5 rounded-xl bg-amber-950/95 border border-amber-600/60 text-center shadow-xl whitespace-nowrap">
                {lastWinner.map(({ name, amount }, i) => (
                  <p key={i} className="text-amber-300 font-bold text-base">
                    🏆 {name} {name === HUMAN_NAME ? 'win' : 'wins'} ${amount}!
                  </p>
                ))}
                <p className="text-amber-600/80 text-xs mt-0.5">
                  Press <span className="text-green-400 font-semibold">Next Round</span> to keep playing
                </p>
              </div>
            )}
            {/* Felt oval */}
            <div
              className="absolute rounded-[50%] border-[12px] border-amber-900 shadow-2xl"
              style={{
                inset: '60px 80px',
                background: 'radial-gradient(ellipse at center, #166534 0%, #14532d 65%, #0f3d1f 100%)',
              }}
            />

            {/* Community cards + pot */}
            <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-3">
              <div className="flex gap-2">
                {communityCards.length > 0
                  ? communityCards.map((c, i) => <Card key={i} {...c} large />)
                  : [0,1,2,3,4].map(i => <Card key={i} faceDown large />)}
              </div>
              <div className="flex flex-col items-center gap-1">
                <div className="px-4 py-1.5 rounded-full bg-black/70 border border-amber-600/60 text-amber-300 font-bold text-sm tracking-wide">
                  Pot: ${pot}
                </div>
                {gameRunning && activePlayer && (() => {
                  const { BB } = calcBlinds(startingStack, blindLevel);
                  if (pot > 0 && BB > 0) return (
                    <div className="text-slate-400 text-[10px]">{(pot / BB).toFixed(1)} BB in pot</div>
                  );
                  return null;
                })()}
              </div>
            </div>

            {seats.map(seat => (
              <Seat key={seat.name} {...seat} />
            ))}
          </div>

          {/* Human action panel — always visible when manual player is enabled */}
          {manualPlayer && (
            <div
              style={{ opacity: waitingForHuman ? 1 : 0.35, pointerEvents: waitingForHuman ? 'auto' : 'none', transition: 'opacity 0.3s' }}
            >
              <HumanActionPanel
                toCall={humanActionState?.to_call ?? 0}
                stack={humanActionState?.stack ?? (stacks[HUMAN_NAME] ?? startingStack)}
                pot={humanActionState?.pot ?? pot}
                street={humanActionState?.street ?? street}
                onAction={(action, amount) => {
                  if (humanResolverRef.current) {
                    const displayAction = action === 'call' && amount === 0 ? 'check' : action;
                    humanResolverRef.current({
                      action,
                      amount,
                      reasoning: `You chose to ${displayAction}${amount > 0 ? ` $${amount}` : ''}`,
                    });
                    humanResolverRef.current = null;
                  }
                }}
              />
            </div>
          )}
        </div>

        {/* Right — game log sidebar */}
        <div className="w-96 flex-shrink-0 border-l border-slate-700 flex flex-col overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700 flex-shrink-0">
            <p className="text-slate-400 text-xs font-semibold uppercase tracking-widest">Round Actions</p>
          </div>
          {/* Player stats strip */}
          {Object.keys(playerWins).length > 0 && (
            <div className="px-3 py-2 border-b border-slate-700/60 flex gap-2 flex-wrap flex-shrink-0">
              {activePlayers.map(name => {
                const w = playerWins[name] ?? 0;
                const s = stacks[name] ?? startingStack;
                const eliminated = roundNumber > 0 && s === 0;
                return (
                  <div key={name} className={`flex flex-col items-center text-[10px] ${eliminated ? 'opacity-30' : ''}`}>
                    <span className="text-slate-300 font-medium">{name.slice(0,4)}</span>
                    <span className="text-amber-400 font-bold">{w}W</span>
                  </div>
                );
              })}
            </div>
          )}
          <div ref={gameLogRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-1.5">
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
                <p className="text-slate-400 text-[11px] leading-relaxed flex-1">{entry.reasoning}</p>
                {entry.totalIn > 0 && (
                  <span className="flex-shrink-0 self-start mt-0.5 text-[9px] text-slate-500 bg-slate-800/80 border border-slate-700/60 rounded px-1.5 py-0.5 whitespace-nowrap">
                    in <span className="text-slate-300 font-semibold">${entry.totalIn}</span>
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}
