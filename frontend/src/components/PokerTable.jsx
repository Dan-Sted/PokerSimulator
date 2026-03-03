import { useState } from 'react';
import { healthCheck, playTurn } from '../api';

const SEAT_NAMES = ['You', 'Player 2', 'Player 3', 'Player 4', 'Player 5'];

// Simple card display: "A♠" or "K♥" etc.
function Card({ rank, suit, faceDown }) {
  const suits = { S: '♠', H: '♥', D: '♦', C: '♣' };
  const red = suit === 'H' || suit === 'D';
  if (faceDown) {
    return (
      <div className="w-10 h-14 rounded bg-slate-700 border border-slate-500 flex items-center justify-center text-slate-400 text-xs">
        ?
      </div>
    );
  }
  return (
    <div
      className={`w-10 h-14 rounded bg-white border border-slate-300 flex flex-col items-center justify-center text-sm shadow ${red ? 'text-red-600' : 'text-slate-800'}`}
    >
      <span className="font-bold">{rank}</span>
      <span>{suits[suit] || suit}</span>
    </div>
  );
}

function Seat({ name, stack, cards, isDealer, isActive, isEmpty, style, className = '' }) {
  return (
    <div
      className={`absolute flex flex-col items-center justify-center rounded-xl px-3 py-2 min-w-[90px] transition-all ${className} ${
        isActive ? 'ring-2 ring-amber-400 ring-offset-2 ring-offset-green-900' : ''
      } ${isEmpty ? 'bg-green-900/50 border border-green-700/50' : 'bg-slate-800/90 border border-slate-600'}`}
      style={style}
    >
      <span className="text-white font-medium text-sm truncate max-w-full">{isEmpty ? 'Empty seat' : name}</span>
      {!isEmpty && <span className="text-amber-300 text-xs">{stack} chips</span>}
      <div className="flex gap-0.5 mt-1">
        {cards?.map((c, i) => (
          <Card key={i} rank={c.rank} suit={c.suit} faceDown={c.faceDown} />
        ))}
      </div>
      {isDealer && (
        <span className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-white text-slate-800 text-xs flex items-center justify-center font-bold">
          D
        </span>
      )}
    </div>
  );
}

export default function PokerTable() {
  const [connected, setConnected] = useState(false);
  const [checking, setChecking] = useState(false);
  const [lastAction, setLastAction] = useState(null);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState(null);

  const handleConnect = async () => {
    setChecking(true);
    setError(null);
    try {
      await healthCheck();
      setConnected(true);
    } catch (e) {
      setError(e.message || 'Could not reach backend');
      setConnected(false);
    } finally {
      setChecking(false);
    }
  };

  const handleRequestTurn = async () => {
    if (!connected) return;
    setRequesting(true);
    setError(null);
    setLastAction(null);
    const mockState = {
      hole_cards: [{ rank: 'A', suit: 'S' }, { rank: 'K', suit: 'H' }],
      community_cards: [{ rank: 'Q', suit: 'D' }, { rank: 'J', suit: 'C' }, { rank: 'T', suit: 'S' }],
      pot: 150,
      to_call: 20,
      valid_actions: ['fold', 'call', 'raise'],
    };
    try {
      const result = await playTurn('pro_1', mockState);
      setLastAction(result);
    } catch (e) {
      setError(e.message || 'Play turn failed');
    } finally {
      setRequesting(false);
    }
  };

  // Mock seats for display (one with hole cards, others with face-down or empty)
  const seats = [
    { name: SEAT_NAMES[0], stack: 980, cards: [{ rank: 'A', suit: 'S' }, { rank: 'K', suit: 'H' }], isDealer: false, isActive: true },
    { name: SEAT_NAMES[1], stack: 1000, cards: [{ faceDown: true }, { faceDown: true }], isDealer: true, isActive: false },
    { name: SEAT_NAMES[2], stack: 950, cards: [{ faceDown: true }, { faceDown: true }], isDealer: false, isActive: false },
    { name: SEAT_NAMES[3], stack: 1020, cards: null, isDealer: false, isActive: false, isEmpty: true },
    { name: SEAT_NAMES[4], stack: 1000, cards: [{ faceDown: true }, { faceDown: true }], isDealer: false, isActive: false },
  ];

  const communityCards = [
    { rank: 'Q', suit: 'D' },
    { rank: 'J', suit: 'C' },
    { rank: 'T', suit: 'S' },
  ];
  const pot = 150;

  return (
    <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center p-4">
      <div className="flex items-center gap-4 mb-4">
        <button
          onClick={handleConnect}
          disabled={checking}
          className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 font-medium"
        >
          {checking ? 'Connecting…' : connected ? 'Connected ✓' : 'Connect to engine'}
        </button>
        <button
          onClick={handleRequestTurn}
          disabled={!connected || requesting}
          className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 disabled:opacity-50 font-medium"
        >
          {requesting ? 'Requesting…' : 'Request AI turn'}
        </button>
      </div>
      {error && (
        <p className="text-red-400 text-sm mb-2">Error: {error}</p>
      )}
      {lastAction && (
        <div className="mb-4 p-3 rounded-lg bg-slate-800 border border-slate-600 text-sm max-w-md">
          <strong>Engine response:</strong> {lastAction.action}
          {lastAction.amount > 0 && ` (${lastAction.amount})`}
          {lastAction.reasoning && <p className="text-slate-400 mt-1">{lastAction.reasoning}</p>}
        </div>
      )}

      {/* Oval poker table */}
      <div className="relative w-[min(90vw,640px)] h-[min(55vw,360px)]">
        <div
          className="absolute inset-0 rounded-[50%] border-8 border-amber-800 shadow-xl"
          style={{ background: 'radial-gradient(ellipse at center, #166534 0%, #14532d 60%, #0f4222 100%)' }}
        />

        {/* Community cards + pot (center) */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-2">
          <div className="flex gap-1">
            {communityCards.map((c, i) => (
              <Card key={i} rank={c.rank} suit={c.suit} />
            ))}
          </div>
          <div className="px-4 py-1.5 rounded-full bg-slate-900/80 border border-amber-600/50 text-amber-300 font-bold">
            Pot: {pot}
          </div>
        </div>

        {/* 5 seats around the table */}
        <Seat
          name={seats[0].name}
          stack={seats[0].stack}
          cards={seats[0].cards}
          isDealer={seats[0].isDealer}
          isActive={seats[0].isActive}
          isEmpty={seats[0].isEmpty}
          className="absolute bottom-0 left-1/2 -translate-x-1/2 -translate-y-4"
          style={{ left: '50%', bottom: 0, transform: 'translate(-50%, 1rem)' }}
        />
        <Seat
          name={seats[1].name}
          stack={seats[1].stack}
          cards={seats[1].cards}
          isDealer={seats[1].isDealer}
          isActive={seats[1].isActive}
          isEmpty={seats[1].isEmpty}
          style={{ right: '5%', bottom: '35%', transform: 'translateY(50%)' }}
        />
        <Seat
          name={seats[2].name}
          stack={seats[2].stack}
          cards={seats[2].cards}
          isDealer={seats[2].isDealer}
          isActive={seats[2].isActive}
          isEmpty={seats[2].isEmpty}
          style={{ right: '8%', top: '15%' }}
        />
        <Seat
          name={seats[3].name}
          stack={seats[3].stack}
          cards={seats[3].cards}
          isDealer={seats[3].isDealer}
          isActive={seats[3].isActive}
          isEmpty={seats[3].isEmpty}
          style={{ left: '8%', top: '15%' }}
        />
        <Seat
          name={seats[4].name}
          stack={seats[4].stack}
          cards={seats[4].cards}
          isDealer={seats[4].isDealer}
          isActive={seats[4].isActive}
          isEmpty={seats[4].isEmpty}
          style={{ left: '5%', bottom: '35%', transform: 'translateY(50%)' }}
        />
      </div>

      <p className="mt-6 text-slate-500 text-sm">
        Start the backend with: <code className="bg-slate-800 px-1 rounded">uvicorn main:app --reload</code> from the backend folder.
      </p>
    </div>
  );
}
