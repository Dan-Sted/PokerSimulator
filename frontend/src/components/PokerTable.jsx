import { useState, useRef, useEffect } from 'react';
import { Home } from 'lucide-react';
import { healthCheck, playTurn, evaluateHands, initBrowser, shutdownBrowser, getSessionStatus, clearSession, startLogin, confirmLogin, getGeminiKeyStatus, setGeminiKey } from '../api';

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

// Approximate [dx, dy] pixel offsets from table center for chip-fly animation
const SEAT_CHIP_OFFSETS = {
  3: [[0, 230], [360, -120], [-360, -120]],
  4: [[0, 230], [440,   0], [0, -250], [-440,   0]],
  5: [[0, 230], [440,  80], [360, -150], [-360, -150], [-440,  80]],
  6: [[0, 230], [430,  90], [430, -140], [0, -250], [-430, -140], [-430,  90]],
};

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

function Card({ rank, suit, faceDown, large, flipping }) {
  const SYM = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const red  = suit === 'H' || suit === 'D';
  const flipStyle = flipping ? { animation: 'cardReveal 0.45s ease-out' } : {};
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
      <div style={flipStyle} className={`w-12 h-16 rounded-lg bg-white border border-slate-300 flex flex-col items-center justify-center text-sm shadow-lg ${red ? 'text-red-600' : 'text-slate-800'}`}>
        <span className="font-bold leading-none text-base">{rank}</span>
        <span className="leading-none">{SYM[suit] || suit}</span>
      </div>
    );
  }
  return (
    <div style={flipStyle} className={`w-8 h-11 rounded bg-white border border-slate-300 flex flex-col items-center justify-center text-[10px] shadow-md ${red ? 'text-red-600' : 'text-slate-800'}`}>
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

function Seat({ name, stack, cards, isDealer, isSmallBlind, isBigBlind, isActive, isThinking, isPaused, lastAction, isFolded, isAllIn, isEliminated, isChipLeader, isHuman, wins, inPot, style, dealKey, isShowdownReveal, seatIdx, numSeats }) {
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
                : isAllIn
                  ? 'bg-purple-950/80 ring-2 ring-purple-400/80 ring-offset-1 ring-offset-green-900 border-purple-500/60 animate-pulse'
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

      {isThinking && !isPaused && (
        <span className="text-slate-400 text-[10px] animate-pulse mt-0.5">thinking…</span>
      )}
      {isThinking && isPaused && (
        <span className="text-purple-400 text-[10px] mt-0.5">⏸ paused</span>
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
        <div key={dealKey} className="flex gap-0.5 mt-1">
          {cards?.map((c, i) => {
            const [dx = 0, dy = 0] = (SEAT_CHIP_OFFSETS[numSeats] ?? [])[seatIdx] ?? [];
            return (
              <div
                key={i}
                style={{
                  '--ox': `${-dx}px`,
                  '--oy': `${-dy}px`,
                  animation: 'dealCard 0.38s ease-out both',
                  animationDelay: `${(seatIdx + i * numSeats) * 0.22}s`,
                }}
              >
                <Card {...c} flipping={isShowdownReveal && !c.faceDown} />
              </div>
            );
          })}
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

// Realistic poker chip SVG — used in fly animation and chip pile
function PokerChipSVG({ color, size = 20 }) {
  const r = size / 2;
  const stripeAngles = [0, 45, 90, 135, 180, 225, 270, 315];
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ display: 'block' }}>
      {/* drop shadow */}
      <circle cx={r} cy={r + 1} r={r - 1} fill="rgba(0,0,0,0.35)" />
      {/* main body */}
      <circle cx={r} cy={r} r={r - 0.5} fill={color} />
      {/* outer dark ring */}
      <circle cx={r} cy={r} r={r - 0.5} fill="none" stroke="rgba(0,0,0,0.55)" strokeWidth="1.5" />
      {/* edge notch stripes */}
      {stripeAngles.map(a => {
        const rad = (a * Math.PI) / 180;
        const x1 = r + (r - 1.5) * Math.cos(rad);
        const y1 = r + (r - 1.5) * Math.sin(rad);
        const x2 = r + (r - 4.5) * Math.cos(rad);
        const y2 = r + (r - 4.5) * Math.sin(rad);
        return <line key={a} x1={x1} y1={y1} x2={x2} y2={y2} stroke="rgba(255,255,255,0.55)" strokeWidth="2.2" strokeLinecap="round" />;
      })}
      {/* inner ring */}
      <circle cx={r} cy={r} r={r - 5.5} fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth="1.2" />
      {/* center fill */}
      <circle cx={r} cy={r} r={r - 7} fill="rgba(0,0,0,0.18)" />
    </svg>
  );
}

function ChipFly({ seatIdx, numSeats }) {
  const offsets = SEAT_CHIP_OFFSETS[numSeats] ?? [];
  const [dx = 0, dy = 0] = offsets[seatIdx] ?? [];
  return (
    <div
      style={{
        position: 'absolute', left: '50%', top: '50%',
        width: 22, height: 22, marginLeft: -11, marginTop: -11,
        '--dx': `${dx}px`, '--dy': `${dy}px`,
        animation: 'chipFly 0.6s ease-in-out forwards',
        pointerEvents: 'none', zIndex: 30,
      }}
    >
      <PokerChipSVG color="#d97706" size={22} />
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
  playerStats, onClearStats,
  geminiKeyInput, setGeminiKeyInput,
  geminiKeySet, geminiKeySaving, geminiKeyError,
  onSaveGeminiKey, onClearGeminiKey,
}) {
  const [activeTab, setActiveTab] = useState('settings');
  const browserSufficient = browserReady && initializedCount >= playerCount;
  const needsMoreTabs     = browserReady && initializedCount < playerCount;
  const canStart = connected && (mode === 'api' || mode === 'ollama' || browserSufficient);
  const { SB: sb, BB: bb } = calcBlinds(startingStack);

  // All known players in fixed display order
  const allKnown = [HUMAN_NAME, ...PLAYER_NAMES];
  const statsRows = allKnown
    .filter(name => playerStats[name])
    .map(name => ({ name, ...playerStats[name] }))
    .sort((a, b) => (b.tournamentsWon ?? 0) - (a.tournamentsWon ?? 0) || (b.roundsWon ?? 0) - (a.roundsWon ?? 0));

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

        {/* Tab bar */}
        <div className="flex border-b border-slate-700">
          {['settings', 'stats'].map(tab => (
            <button
              key={tab}
              className="tab-btn"
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1, padding: '0.6rem 0', fontSize: '0.85rem',
                fontWeight: activeTab === tab ? 600 : 400,
                background: activeTab === tab ? '#1e293b' : 'transparent',
                color: activeTab === tab ? '#f8fafc' : '#94a3b8',
                border: 'none',
                borderBottom: activeTab === tab ? '2px solid #d97706' : '2px solid transparent',
                cursor: 'pointer', transition: 'all 0.15s', outline: 'none',
              }}
            >
              {tab === 'settings' ? '⚙️ Settings' : '📊 Stats'}
            </button>
          ))}
        </div>

        {/* Stats tab */}
        {activeTab === 'stats' && (
          <div className="px-8 py-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-slate-300 font-semibold">Career Stats</p>
              {statsRows.length > 0 && (
                <button onClick={onClearStats} className="text-xs text-red-400 hover:text-red-300 transition-colors">
                  Clear All Stats
                </button>
              )}
            </div>
            {statsRows.length === 0 ? (
              <p className="text-slate-500 text-sm text-center py-10">No stats yet — play a game to start tracking.</p>
            ) : (
              <>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid #334155' }}>
                      {['Player', 'Matches', 'Rounds Won', 'Tournaments', 'Rounds/Match'].map(h => (
                        <th key={h} style={{ padding: '0.4rem 0.75rem', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', color: '#64748b', textAlign: h === 'Player' ? 'left' : 'right' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {statsRows.map((s, i) => {
                      const rpm = s.matchesPlayed > 0 ? (s.roundsWon / s.matchesPlayed).toFixed(1) : '—';
                      return (
                        <tr key={s.name} style={{ borderBottom: '1px solid #1e293b', background: i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent' }}>
                          <td style={{ padding: '0.55rem 0.75rem', color: s.name === HUMAN_NAME ? '#93c5fd' : '#f1f5f9', fontWeight: 600, fontSize: '0.875rem' }}>{s.name}</td>
                          <td style={{ padding: '0.55rem 0.75rem', color: '#94a3b8', textAlign: 'right', fontSize: '0.875rem' }}>{s.matchesPlayed ?? 0}</td>
                          <td style={{ padding: '0.55rem 0.75rem', color: '#94a3b8', textAlign: 'right', fontSize: '0.875rem' }}>{s.roundsWon ?? 0}</td>
                          <td style={{ padding: '0.55rem 0.75rem', textAlign: 'right' }}>
                            <span style={{ color: '#fbbf24', fontWeight: 700, fontSize: '0.875rem' }}>{s.tournamentsWon ?? 0}</span>
                          </td>
                          <td style={{ padding: '0.55rem 0.75rem', color: '#64748b', textAlign: 'right', fontSize: '0.875rem' }}>{rpm}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                {/* Action Frequency Chart */}
                {statsRows.some(s => s.actions) && (
                  <div style={{ marginTop: '1.75rem' }}>
                    <p style={{ color: '#94a3b8', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.75rem' }}>Action Frequency</p>
                    <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.6rem' }}>
                      {[['fold','#ef4444'],['call','#eab308'],['check','#3b82f6'],['raise','#22c55e']].map(([label, color]) => (
                        <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                          <div style={{ width: 10, height: 10, borderRadius: 2, background: color, flexShrink: 0 }} />
                          <span style={{ color: '#64748b', fontSize: '0.7rem' }}>{label.charAt(0).toUpperCase() + label.slice(1)}</span>
                        </div>
                      ))}
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                      {statsRows.filter(s => s.actions).map(s => {
                        const acts = s.actions ?? {};
                        const total = (acts.fold ?? 0) + (acts.call ?? 0) + (acts.check ?? 0) + (acts.raise ?? 0);
                        if (total === 0) return null;
                        const pct = key => ((acts[key] ?? 0) / total * 100);
                        const segments = [
                          { key: 'fold',  color: '#ef4444' },
                          { key: 'call',  color: '#eab308' },
                          { key: 'check', color: '#3b82f6' },
                          { key: 'raise', color: '#22c55e' },
                        ].filter(seg => pct(seg.key) > 0);
                        return (
                          <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                            <span style={{ width: 76, flexShrink: 0, fontSize: '0.8rem', fontWeight: 600, color: s.name === HUMAN_NAME ? '#93c5fd' : '#cbd5e1', textAlign: 'right' }}>{s.name}</span>
                            <div style={{ flex: 1, height: 18, borderRadius: 4, overflow: 'hidden', display: 'flex', background: '#1e293b' }}>
                              {segments.map(seg => (
                                <div
                                  key={seg.key}
                                  title={`${seg.key}: ${pct(seg.key).toFixed(1)}% (${acts[seg.key] ?? 0})`}
                                  style={{ width: `${pct(seg.key)}%`, background: seg.color, transition: 'width 0.4s', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                                >
                                  {pct(seg.key) >= 9 && (
                                    <span style={{ fontSize: '0.6rem', color: 'rgba(0,0,0,0.75)', fontWeight: 700, userSelect: 'none' }}>{pct(seg.key).toFixed(0)}%</span>
                                  )}
                                </div>
                              ))}
                            </div>
                            <span style={{ width: 36, flexShrink: 0, fontSize: '0.7rem', color: '#475569', textAlign: 'right' }}>{total}x</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Two-column body + action bar (settings tab only) */}
        {activeTab === 'settings' && (<><div className="grid grid-cols-2 gap-0 divide-x divide-slate-700">

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
                    ? 'Uses Gemini API directly with your API key'
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

            {/* Gemini API Key — api mode only */}
            {mode === 'api' && (
              <div>
                <p className="text-slate-400 text-xs uppercase tracking-wider mb-2">Gemini API Key</p>
                {geminiKeySet ? (
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-emerald-400 text-xs font-medium">✓ API key configured</span>
                    <button
                      onClick={onClearGeminiKey}
                      className="text-red-500 hover:text-red-400 text-xs px-2 py-1 rounded border border-red-900 hover:border-red-700 transition-colors"
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <div className="flex gap-2">
                    <input
                      type="password"
                      placeholder="AIza…"
                      value={geminiKeyInput}
                      onChange={e => setGeminiKeyInput(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && geminiKeyInput.trim() && onSaveGeminiKey()}
                      className="flex-1 px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-600 text-slate-200 text-xs placeholder-slate-600 focus:outline-none focus:border-violet-500"
                    />
                    <button
                      onClick={onSaveGeminiKey}
                      disabled={!geminiKeyInput.trim() || geminiKeySaving}
                      className="px-3 py-1.5 rounded-lg bg-violet-700 hover:bg-violet-600 disabled:opacity-40 text-white text-xs font-medium transition-colors"
                    >
                      {geminiKeySaving ? '…' : 'Save'}
                    </button>
                  </div>
                )}
                {geminiKeyError && (
                  <p className="text-red-400 text-xs mt-1">{geminiKeyError}</p>
                )}
                {!geminiKeySet && (
                  <p className="text-slate-600 text-xs mt-1.5">
                    Get a key at <span className="text-slate-500">aistudio.google.com</span>. Saved to your .env file.
                  </p>
                )}
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
        </>)}{/* end settings tab */}
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
  const [autoContinue, setAutoContinue]     = useState(() => localStorage.getItem('pk_autoContinue') === 'true');
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
  const [playerStats, setPlayerStats]       = useState(() => { try { return JSON.parse(localStorage.getItem('pk_player_stats') || '{}'); } catch { return {}; } });
  const [tournamentOver, setTournamentOver] = useState(false);      // true when only 1 player remains
  const [dealKey, setDealKey]               = useState(0);          // increments each deal to re-trigger CSS animation
  const [chipFlies, setChipFlies]           = useState([]);         // active chip-fly animations
  const [showdownRevealCards, setShowdownRevealCards] = useState(new Set()); // players whose cards flip at showdown
  const [sessionStatus, setSessionStatus]   = useState(null);       // null=unchecked, true/false
  const [clearingSession, setClearingSession] = useState(false);
  const [geminiKeyInput, setGeminiKeyInput] = useState('');         // controlled input value
  const [geminiKeySet, setGeminiKeySet]     = useState(null);       // null=unknown, true/false
  const [geminiKeySaving, setGeminiKeySaving] = useState(false);
  const [geminiKeyError, setGeminiKeyError] = useState(null);
  const [gameSettingsOpen, setGameSettingsOpen] = useState(false);
  const [paused, setPaused]                   = useState(false);
  const stopRef            = useRef(false);
  const pauseRef           = useRef(false);
  const initAbortRef       = useRef(null);   // AbortController for in-flight browser init
  const gameLogRef         = useRef(null);   // scroll container for auto-scroll to bottom
  const gameSettingsRef    = useRef(null);   // for click-outside close

  // Persist settings to localStorage
  useEffect(() => { localStorage.setItem('pk_mode', mode); }, [mode]);
  useEffect(() => { localStorage.setItem('pk_manual', manualPlayer); }, [manualPlayer]);
  useEffect(() => { localStorage.setItem('pk_players', playerCount); }, [playerCount]);
  useEffect(() => { localStorage.setItem('pk_stack', startingStack); }, [startingStack]);
  useEffect(() => { localStorage.setItem('pk_showHands', showHands); }, [showHands]);
  useEffect(() => { localStorage.setItem('pk_autoContinue', autoContinue); }, [autoContinue]);
  useEffect(() => { localStorage.setItem('pk_speed', actionSpeed); }, [actionSpeed]);
  useEffect(() => { localStorage.setItem('pk_player_stats', JSON.stringify(playerStats)); }, [playerStats]);

  // Polls until unpaused (or stopped) — awaited before each AI turn
  const waitIfPaused = () => new Promise(resolve => {
    const check = () => {
      if (!pauseRef.current || stopRef.current) resolve();
      else setTimeout(check, 100);
    };
    check();
  });

  const handlePauseResume = () => {
    const next = !pauseRef.current;
    pauseRef.current = next;
    setPaused(next);
  };

  // Close game settings dropdown on outside click
  useEffect(() => {
    if (!gameSettingsOpen) return;
    const handler = (e) => {
      if (gameSettingsRef.current && !gameSettingsRef.current.contains(e.target)) {
        setGameSettingsOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [gameSettingsOpen]);

  // Auto-scroll game log to bottom whenever a new entry is added
  useEffect(() => {
    if (gameLogRef.current) {
      gameLogRef.current.scrollTop = gameLogRef.current.scrollHeight;
    }
  }, [gameLog]);

  // Auto-continue: start next round after 1.5s when enabled (never after tournament ends)
  useEffect(() => {
    if (!autoContinue || !roundComplete || gameRunning || tournamentOver) return;
    const t = setTimeout(() => { handleNextRound(); }, 1500);
    return () => clearTimeout(t);
  }, [autoContinue, roundComplete, gameRunning, tournamentOver]); // eslint-disable-line react-hooks/exhaustive-deps

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

  // Check if a Gemini API key is already set on the backend when mode switches to api
  useEffect(() => {
    if (connected && mode === 'api') {
      getGeminiKeyStatus()
        .then(d => setGeminiKeySet(d.has_key))
        .catch(() => setGeminiKeySet(false));
    }
  }, [connected, mode]);

  const handleSaveGeminiKey = async () => {
    setGeminiKeySaving(true);
    setGeminiKeyError(null);
    try {
      const result = await setGeminiKey(geminiKeyInput.trim());
      setGeminiKeySet(result.has_key);
      setGeminiKeyInput('');
    } catch (e) {
      setGeminiKeyError(e?.response?.data?.detail ?? 'Failed to save key');
    } finally {
      setGeminiKeySaving(false);
    }
  };

  const handleClearGeminiKey = async () => {
    await setGeminiKey('').catch(() => {});
    setGeminiKeySet(false);
    setGeminiKeyInput('');
    setGeminiKeyError(null);
  };

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
    setChipFlies([]); setShowdownRevealCards(new Set());
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
    setChipFlies([]); setShowdownRevealCards(new Set());
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
    setChipFlies([]);
    setShowdownRevealCards(new Set());
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
        setLastWinner([{ name: winner, amount: null }]);
        setTournamentOver(true);
        setGameLog([{ player: winner, street: 'result', action: 'wins', amount: 0, reasoning: 'Last player standing — tournament winner!' }]);
        setPlayerStats(prev => ({ ...prev, [winner]: { ...prev[winner], matchesPlayed: prev[winner]?.matchesPlayed ?? 0, roundsWon: prev[winner]?.roundsWon ?? 0, tournamentsWon: (prev[winner]?.tournamentsWon ?? 0) + 1 } }));
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
    setDealKey(k => k + 1);
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
        setPlayerStats(prev => ({ ...prev, [winner]: { ...prev[winner], matchesPlayed: prev[winner]?.matchesPlayed ?? 0, roundsWon: (prev[winner]?.roundsWon ?? 0) + 1, tournamentsWon: prev[winner]?.tournamentsWon ?? 0 } }));
        setGameLog(prev => [...prev, {
          player: winner, street: 'result', action: 'wins',
          amount: winAmount, reasoning: `${winner === HUMAN_NAME ? 'Win' : 'Wins'} the pot of $${winAmount}.`,
        }]);
      }
      setActivePlayer(null);
      setGameRunning(false);
      setRoundComplete(!aborted);
    };

    // Capture the visual seat order before runStreet shadows the name with its own parameter
    const seatPlayers = activePlayers;

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
            // Hold the result until resumed — AI already answered, just delay applying it
            await waitIfPaused();
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
        // Track action frequency (skip blinds — only real decisions count)
        if (displayAction !== 'blind') {
          setPlayerStats(prev => {
            const ps = prev[player] ?? { matchesPlayed: 0, roundsWon: 0, tournamentsWon: 0 };
            const acts = ps.actions ?? { fold: 0, call: 0, check: 0, raise: 0 };
            return { ...prev, [player]: { ...ps, actions: { ...acts, [displayAction]: (acts[displayAction] ?? 0) + 1 } } };
          });
        }
        setStacks({ ...s });
        setPot(p);
        setCurrentContrib(prev => ({ ...prev, [player]: (prev[player] || 0) + actualAmount }));

        // Chip fly animation — only when chips actually move
        if (actualAmount > 0 && !stopRef.current) {
          const seatIdx = seatPlayers.indexOf(player);
          const flyId = performance.now() + Math.random();
          setChipFlies(prev => [...prev, { id: flyId, seatIdx, numSeats: seatPlayers.length }]);
          setTimeout(() => setChipFlies(prev => prev.filter(f => f.id !== flyId)), 650);
        }

        if (actionSpeed > 0 && !stopRef.current) {
          await waitIfPaused();
          if (!stopRef.current) await new Promise(r => setTimeout(r, actionSpeed));
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

    // Wait for deal animation to finish before the first player acts.
    // Total deal time = (last card delay) + animation duration.
    // Last card: seatIdx = n-1, cardIdx = 1 → delay = (n-1 + 1*n) * 0.22 = (2n-1)*0.22
    if (!stopRef.current) {
      const dealMs = Math.ceil(((2 * n - 1) * 0.22 + 0.38) * 1000);
      await new Promise(r => setTimeout(r, dealMs));
    }

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
          await waitIfPaused();
          if (!stopRef.current) await new Promise(r => setTimeout(r, Math.max(actionSpeed / 2, 400)));
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

    // Flip surviving players' cards face-up before evaluation
    if (survivors.length > 1) {
      setShowdownRevealCards(new Set(survivors));
      await new Promise(r => setTimeout(r, 700));
    }

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
        // Record round win for the winner of the main (last/largest) pot
        const mainWinner = allWins[allWins.length - 1]?.name;
        if (mainWinner) {
          setPlayerStats(prev => ({ ...prev, [mainWinner]: { ...prev[mainWinner], matchesPlayed: prev[mainWinner]?.matchesPlayed ?? 0, roundsWon: (prev[mainWinner]?.roundsWon ?? 0) + 1, tournamentsWon: prev[mainWinner]?.tournamentsWon ?? 0 } }));
        }
        setStacks(finalStacks);
        setPot(0);
        // Merge multiple pots won by the same player into one banner entry
        const mergedWins = Object.values(
          allWins.reduce((acc, w) => {
            acc[w.name] = { name: w.name, amount: (acc[w.name]?.amount ?? 0) + w.amount };
            return acc;
          }, {})
        );
        setLastWinner(mergedWins);
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
    // Record a match played for everyone in this lineup
    setPlayerStats(prev => {
      const next = { ...prev };
      players.forEach(name => {
        next[name] = { ...next[name], matchesPlayed: (next[name]?.matchesPlayed ?? 0) + 1, roundsWon: next[name]?.roundsWon ?? 0, tournamentsWon: next[name]?.tournamentsWon ?? 0 };
      });
      return next;
    });
    setTournamentOver(false);
    pauseRef.current = false;
    setPaused(false);
    setDealerIdx(0);
    setRoundNumber(1);
    setBlindLevel(1);
    return runGameRound(init, 0, 1);
  };

  const handleNextRound = () => {
    pauseRef.current = false;
    setPaused(false);
    stopRef.current = false;
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
        playerStats={playerStats}
        onClearStats={() => { setPlayerStats({}); localStorage.removeItem('pk_player_stats'); }}
        geminiKeyInput={geminiKeyInput} setGeminiKeyInput={setGeminiKeyInput}
        geminiKeySet={geminiKeySet} geminiKeySaving={geminiKeySaving}
        geminiKeyError={geminiKeyError}
        onSaveGeminiKey={handleSaveGeminiKey} onClearGeminiKey={handleClearGeminiKey}
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
      cards:        holeCards[name]
                      ? (showHands || isHuman || showdownRevealCards.has(name))
                        ? holeCards[name]
                        : [{ faceDown: true }, { faceDown: true }]
                      : [],
      isDealer:     name === dealerName,
      isSmallBlind: name === sbName,
      isBigBlind:   name === bbName,
      isActive:     name === activePlayer,
      isThinking:   name === activePlayer && gameRunning && !isHuman,
      isPaused:     name === activePlayer && gameRunning && !isHuman && paused,
      lastAction:   playerActions[name] ?? null,
      isFolded:     foldedPlayers.has(name),
      isAllIn:      allInPlayers.has(name),
      isEliminated: roundNumber > 0 && stack === 0 && !allInPlayers.has(name),
      isChipLeader: name === chipLeader && roundNumber > 0 && !gameRunning,
      wins:         playerWins[name] ?? 0,
      inPot:            currentContrib[name] ?? 0,
      isShowdownReveal: showdownRevealCards.has(name),
      dealKey,
      seatIdx:          i,
      numSeats:         activePlayers.length,
      style:            seatPos[i],
    };
  });

  const STREET_LABEL = { preflop: 'Pre-Flop', flop: 'Flop', turn: 'Turn', river: 'River' };

  return (
    <div className="h-screen bg-slate-900 text-white flex flex-col overflow-hidden">
      <style>{`
        @keyframes dealCard {
          from { opacity: 0; transform: translate(var(--ox), var(--oy)) scale(0.55); }
          to   { opacity: 1; transform: translate(0, 0) scale(1); }
        }
        @keyframes dealCommunityCard {
          from { opacity: 0; transform: translateY(-18px) scale(0.75) rotate(-4deg); }
          to   { opacity: 1; transform: translateY(0) scale(1) rotate(0deg); }
        }
        @keyframes chipFly {
          0%   { opacity: 1; transform: translate(var(--dx), var(--dy)) scale(1.1); }
          80%  { opacity: 1; transform: translate(0, 0) scale(1.15); }
          100% { opacity: 0; transform: translate(0, 0) scale(0.3); }
        }
        @keyframes cardReveal {
          0%   { transform: scaleX(0.05); }
          50%  { transform: scaleX(0.05); }
          100% { transform: scaleX(1); }
        }
      `}</style>

      {/* Top bar */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-slate-700 bg-slate-800/80 flex-shrink-0">

        {/* Back button — top-left like a browser back button */}
        <button
          onClick={handleEndGame}
          disabled={shuttingDown}
          className="btn-dark flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 disabled:opacity-40 text-sm font-medium transition-colors mr-1"
          title="End game and return to start"
        >
          {shuttingDown ? '…' : <><Home size={16} /> Home</>}
        </button>

        {/* Info badges */}
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

          {/* Settings gear dropdown */}
          <div className="relative" ref={gameSettingsRef}>
            <button
              onClick={() => setGameSettingsOpen(o => !o)}
              className="btn-dark px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm font-medium transition-colors"
              title="Options"
            >
              ⚙ Options
            </button>
            {gameSettingsOpen && (
              <div
                className="absolute right-0 top-full mt-1 z-50 rounded-xl border border-slate-600 bg-slate-800 shadow-2xl"
                style={{ minWidth: 220 }}
              >
                {/* Speed */}
                <div className="px-4 pt-3 pb-2">
                  <p className="text-slate-400 text-xs uppercase tracking-wider mb-2">Speed</p>
                  <div className="flex gap-1">
                    {[{v:0,label:'⚡ Fast'},{v:1000,label:'▶ Normal'},{v:2500,label:'🐢 Slow'}].map(({v,label}) => (
                      <button
                        key={v}
                        onClick={() => setActionSpeed(v)}
                        className="flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors"
                        style={{
                          background: actionSpeed === v ? '#d97706' : '#1e293b',
                          color: actionSpeed === v ? '#fff' : '#94a3b8',
                          border: `1px solid ${actionSpeed === v ? '#b45309' : '#334155'}`,
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border-t border-slate-700 mx-3" />

                {/* Auto-Run */}
                <div className="px-4 py-2">
                  <p className="text-slate-400 text-xs uppercase tracking-wider mb-2">Auto-Run</p>
                  <button
                    onClick={() => setAutoContinue(v => !v)}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors"
                    style={{
                      background: autoContinue ? 'rgba(16,185,129,0.15)' : '#1e293b',
                      border: `1px solid ${autoContinue ? 'rgba(16,185,129,0.4)' : '#334155'}`,
                    }}
                  >
                    <span className="text-sm" style={{ color: autoContinue ? '#6ee7b7' : '#94a3b8' }}>
                      Start next round automatically
                    </span>
                    <span
                      className="ml-3 flex-shrink-0"
                      style={{
                        width: 32, height: 18, borderRadius: 9, position: 'relative', display: 'inline-block',
                        background: autoContinue ? '#10b981' : '#334155', transition: 'background 0.2s',
                      }}
                    >
                      <span style={{
                        position: 'absolute', top: 3, left: autoContinue ? 17 : 3,
                        width: 12, height: 12, borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
                      }} />
                    </span>
                  </button>
                </div>

                <div className="border-t border-slate-700 mx-3" />

                {/* Show / Hide Hands */}
                <div className="px-4 py-2 pb-3">
                  <p className="text-slate-400 text-xs uppercase tracking-wider mb-2">Hole Cards</p>
                  <button
                    onClick={() => setShowHands(h => !h)}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg transition-colors"
                    style={{
                      background: showHands ? 'rgba(99,102,241,0.15)' : '#1e293b',
                      border: `1px solid ${showHands ? 'rgba(99,102,241,0.4)' : '#334155'}`,
                    }}
                  >
                    <span className="text-sm" style={{ color: showHands ? '#a5b4fc' : '#94a3b8' }}>
                      {showHands ? '👁 Showing all hands' : '🙈 Hands hidden'}
                    </span>
                    <span
                      className="ml-3 flex-shrink-0"
                      style={{
                        width: 32, height: 18, borderRadius: 9, position: 'relative', display: 'inline-block',
                        background: showHands ? '#6366f1' : '#334155', transition: 'background 0.2s',
                      }}
                    >
                      <span style={{
                        position: 'absolute', top: 3, left: showHands ? 17 : 3,
                        width: 12, height: 12, borderRadius: '50%', background: '#fff', transition: 'left 0.2s',
                      }} />
                    </span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Pause / Resume — only visible while a round is in progress */}
          {gameRunning && (
            <button
              onClick={handlePauseResume}
              className="px-4 py-1.5 rounded-lg font-semibold text-sm transition-colors"
              style={{
                background: paused ? '#065f46' : '#1d4ed8',
                border: `1px solid ${paused ? '#10b981' : '#3b82f6'}`,
                color: '#fff',
              }}
            >
              {paused ? '▶ Resume' : '⏸ Pause'}
            </button>
          )}

          {/* Round action buttons — Run Game hides while running */}
          {!gameRunning && roundComplete && (
            tournamentOver ? (
              <button
                onClick={handleEndGame}
                className="px-4 py-1.5 rounded-lg bg-purple-700 hover:bg-purple-600 font-semibold text-sm"
              >
                🏆 New Game
              </button>
            ) : (
              <button
                onClick={handleNextRound}
                className="px-4 py-1.5 rounded-lg bg-green-700 hover:bg-green-600 font-semibold text-sm"
              >
                ▶ Next Round
              </button>
            )
          )}
          {!gameRunning && !roundComplete && (
            <button
              onClick={handleRunGame}
              className="btn-dark px-4 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 font-semibold text-sm"
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
              <div
                className="absolute top-3 left-1/2 -translate-x-1/2 z-20 px-6 py-2.5 rounded-xl text-center shadow-xl whitespace-nowrap"
                style={{
                  background: tournamentOver ? 'rgba(88,28,135,0.97)' : 'rgba(69,26,3,0.97)',
                  border: tournamentOver ? '1px solid rgba(168,85,247,0.7)' : '1px solid rgba(217,119,6,0.6)',
                }}
              >
                {tournamentOver ? (
                  <>
                    <p style={{ color: '#e9d5ff', fontWeight: 800, fontSize: '1rem' }}>
                      🏆 Tournament Winner: {lastWinner[0]?.name}!
                    </p>
                    <p style={{ color: '#a78bfa', fontSize: '0.75rem', marginTop: '0.15rem' }}>
                      Click <span style={{ color: '#86efac', fontWeight: 600 }}>Run Game</span> to start a new tournament
                    </p>
                  </>
                ) : (
                  <>
                    {lastWinner.map(({ name, amount }, i) => (
                      <p key={i} className="text-amber-300 font-bold text-base">
                        🏆 {name} {name === HUMAN_NAME ? 'win' : 'wins'} ${amount}!
                      </p>
                    ))}
                    <p className="text-amber-600/80 text-xs mt-0.5">
                      {autoContinue
                        ? 'Next round starting automatically…'
                        : <>Press <span className="text-green-400 font-semibold">Next Round</span> to keep playing</>}
                    </p>
                  </>
                )}
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
                {communityCards.map((c, i) => (
                  <div key={i} style={{ animation: 'dealCommunityCard 0.35s ease-out both', animationDelay: `${i < 3 ? i * 0.18 : 0}s` }}>
                    <Card {...c} large />
                  </div>
                ))}
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

            {/* Chip fly overlay */}
            {chipFlies.map(fly => (
              <ChipFly key={fly.id} seatIdx={fly.seatIdx} numSeats={fly.numSeats} />
            ))}
          </div>

          {/* Human action panel — always visible when manual player is enabled */}
          {manualPlayer && (
            <div
              style={{ opacity: waitingForHuman && !paused ? 1 : 0.35, pointerEvents: waitingForHuman && !paused ? 'auto' : 'none', transition: 'opacity 0.3s' }}
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
