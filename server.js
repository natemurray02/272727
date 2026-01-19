const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// Game state
const tables = new Map();

// Card utilities
const SUITS = ['h', 'd', 'c', 's'];
const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];
const createDeck = () => SUITS.flatMap(s => RANKS.map(r => ({ suit: s, rank: r })));
const shuffle = (arr) => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// Card formatting for action log
function formatCard(card) {
  if (!card || !card.rank || !card.suit) return '??';
  const suitSymbols = { h: '♥', d: '♦', c: '♣', s: '♠' };
  const rank = card.rank === 'T' ? '10' : card.rank;
  return `${rank}${suitSymbols[card.suit] || card.suit}`;
}

function formatCards(cards) {
  if (!cards || cards.length === 0) return '';
  return cards.map(formatCard).join(' ');
}

// Hand evaluation
const rankValue = r => RANKS.indexOf(r);

function evaluateHand(cards) {
  if (!cards || cards.length < 5) return { rank: 0, value: 0, name: 'No hand' };
  
  const allCombos = [];
  for (let i = 0; i < cards.length; i++) {
    for (let j = i + 1; j < cards.length; j++) {
      for (let k = j + 1; k < cards.length; k++) {
        for (let l = k + 1; l < cards.length; l++) {
          for (let m = l + 1; m < cards.length; m++) {
            allCombos.push([cards[i], cards[j], cards[k], cards[l], cards[m]]);
          }
        }
      }
    }
  }
  
  let best = { rank: 0, value: 0, name: 'High Card' };
  for (const combo of allCombos) {
    const result = evaluate5Cards(combo);
    if (result.rank > best.rank || (result.rank === best.rank && result.value > best.value)) {
      best = result;
    }
  }
  return best;
}

function evaluate5Cards(cards) {
  const ranks = cards.map(c => rankValue(c.rank)).sort((a, b) => b - a);
  const suits = cards.map(c => c.suit);
  const isFlush = suits.every(s => s === suits[0]);
  const rankCounts = {};
  ranks.forEach(r => rankCounts[r] = (rankCounts[r] || 0) + 1);
  const counts = Object.values(rankCounts).sort((a, b) => b - a);
  const uniqueRanks = Object.keys(rankCounts).map(Number).sort((a, b) => b - a);
  
  const isStraight = uniqueRanks.length === 5 && (uniqueRanks[0] - uniqueRanks[4] === 4 || 
    (uniqueRanks[0] === 12 && uniqueRanks[1] === 3 && uniqueRanks[2] === 2 && uniqueRanks[3] === 1 && uniqueRanks[4] === 0));
  const isWheel = uniqueRanks[0] === 12 && uniqueRanks[1] === 3;
  
  let rank = 1, name = 'High Card', value = ranks[0] * 10000 + ranks[1] * 1000 + ranks[2] * 100 + ranks[3] * 10 + ranks[4];
  
  if (isFlush && isStraight) {
    if (uniqueRanks[0] === 12 && uniqueRanks[1] === 11) { rank = 10; name = 'Royal Flush'; }
    else { rank = 9; name = 'Straight Flush'; }
    value = isWheel ? 3 : uniqueRanks[0];
  } else if (counts[0] === 4) {
    rank = 8; name = 'Four of a Kind';
    const quadRank = Number(Object.keys(rankCounts).find(r => rankCounts[r] === 4));
    value = quadRank * 100 + uniqueRanks.find(r => r !== quadRank);
  } else if (counts[0] === 3 && counts[1] === 2) {
    rank = 7; name = 'Full House';
    const tripRank = Number(Object.keys(rankCounts).find(r => rankCounts[r] === 3));
    const pairRank = Number(Object.keys(rankCounts).find(r => rankCounts[r] === 2));
    value = tripRank * 100 + pairRank;
  } else if (isFlush) {
    rank = 6; name = 'Flush';
  } else if (isStraight) {
    rank = 5; name = 'Straight';
    value = isWheel ? 3 : uniqueRanks[0];
  } else if (counts[0] === 3) {
    rank = 4; name = 'Three of a Kind';
    const tripRank = Number(Object.keys(rankCounts).find(r => rankCounts[r] === 3));
    value = tripRank * 10000 + ranks.filter(r => r !== tripRank).slice(0, 2).reduce((a, r, i) => a + r * (100 - i * 99), 0);
  } else if (counts[0] === 2 && counts[1] === 2) {
    rank = 3; name = 'Two Pair';
    const pairs = Object.keys(rankCounts).filter(r => rankCounts[r] === 2).map(Number).sort((a, b) => b - a);
    const kicker = uniqueRanks.find(r => rankCounts[r] === 1);
    value = pairs[0] * 10000 + pairs[1] * 100 + kicker;
  } else if (counts[0] === 2) {
    rank = 2; name = 'Pair';
    const pairRank = Number(Object.keys(rankCounts).find(r => rankCounts[r] === 2));
    value = pairRank * 1000000 + ranks.filter(r => r !== pairRank).slice(0, 3).reduce((a, r, i) => a + r * Math.pow(100, 2 - i), 0);
  }
  
  return { rank, value, name };
}

function generateTableCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

function createTable(hostId, hostName, maxSeats, blinds, buyIn, isPrivate = false) {
  const code = generateTableCode();
  const table = {
    code,
    hostId,
    hostName,
    maxSeats,
    sb: blinds[0],
    bb: blinds[1],
    defaultBuyIn: buyIn,
    isPrivate,
    players: [],
    seats: Array(maxSeats).fill(null),
    gameState: null,
    phase: 'waiting',
    handInProgress: false
  };
  tables.set(code, table);
  return table;
}

function getTableList() {
  const list = [];
  tables.forEach((table, code) => {
    const playerCount = table.seats.filter(s => s !== null).length;
    list.push({
      code,
      hostName: table.hostName,
      playerCount,
      maxSeats: table.maxSeats,
      blinds: `$${table.sb}/$${table.bb}`,
      buyIn: table.defaultBuyIn,
      inProgress: table.handInProgress,
      isPrivate: table.isPrivate
    });
  });
  return list;
}

function getActivePlayers(table) {
  return table.gameState.players.filter(p => p && !p.folded);
}

function getActingPlayers(table) {
  return table.gameState.players.filter(p => p && !p.folded && !p.allIn && p.chips > 0);
}

// Calculate side pots from player contributions
function calculateSidePots(table) {
  const gs = table.gameState;
  const pots = [];
  
  // Get all players who contributed
  const contributors = [];
  gs.players.forEach((p, i) => {
    if (p && gs.totalContributions[i] > 0) {
      contributors.push({
        player: p,
        seatIdx: i,
        contribution: gs.totalContributions[i],
        folded: p.folded
      });
    }
  });
  
  // Sort by contribution amount
  contributors.sort((a, b) => a.contribution - b.contribution);
  
  let processedAmount = 0;
  for (let i = 0; i < contributors.length; i++) {
    const currentLevel = contributors[i].contribution;
    if (currentLevel <= processedAmount) continue;
    
    const levelAmount = currentLevel - processedAmount;
    let potAmount = 0;
    const eligible = [];
    
    // Everyone who contributed at least this much adds to the pot
    for (const c of contributors) {
      if (c.contribution >= currentLevel) {
        potAmount += levelAmount;
        if (!c.folded) {
          eligible.push(c.seatIdx);
        }
      }
    }
    
    if (potAmount > 0 && eligible.length > 0) {
      pots.push({ amount: potAmount, eligible: eligible });
    }
    processedAmount = currentLevel;
  }
  
  return pots;
}

function startHand(table) {
  const gs = table.gameState;
  gs.handNum++;
  gs.deck = shuffle(createDeck());
  gs.community = [];
  gs.pot = 0;
  gs.currentBet = 0;
  gs.minRaise = table.bb;
  gs.bets = Array(table.maxSeats).fill(0);
  gs.totalContributions = Array(table.maxSeats).fill(0);
  gs.acted = new Set();
  gs.phase = 'preflop';
  gs.sidePots = [];
  table.handInProgress = true;
  
  // Reset players
  gs.players.forEach((p, i) => {
    if (p) {
      p.cards = [];
      p.folded = false;
      p.allIn = false;
      p.sittingOut = p.sittingOut || false;
      p.wentToShowdown = false;
      p.showCards = false;
      p.voluntaryShow = false;
      p.revealedCards = [false, false];
    }
  });
  
  // Find active players (not sitting out, has chips)
  const activeSeatIndices = gs.players
    .map((p, i) => (p && !p.sittingOut && p.chips > 0) ? i : -1)
    .filter(i => i >= 0);
  
  if (activeSeatIndices.length < 2) {
    table.handInProgress = false;
    return false;
  }
  
  // Move dealer
  let dealerIdx = gs.dealerIdx;
  let tries = 0;
  do {
    dealerIdx = (dealerIdx + 1) % table.maxSeats;
    tries++;
  } while ((!gs.players[dealerIdx] || gs.players[dealerIdx].sittingOut) && tries < table.maxSeats);
  gs.dealerIdx = dealerIdx;
  
  // Find SB and BB
  const isHeadsUp = activeSeatIndices.length === 2;
  let sbIdx, bbIdx;
  
  if (isHeadsUp) {
    sbIdx = dealerIdx;
    bbIdx = activeSeatIndices.find(i => i !== dealerIdx);
  } else {
    sbIdx = dealerIdx;
    do {
      sbIdx = (sbIdx + 1) % table.maxSeats;
    } while (!gs.players[sbIdx] || gs.players[sbIdx].sittingOut);
    
    bbIdx = sbIdx;
    do {
      bbIdx = (bbIdx + 1) % table.maxSeats;
    } while (!gs.players[bbIdx] || gs.players[bbIdx].sittingOut);
  }
  
  gs.sbIdx = sbIdx;
  gs.bbIdx = bbIdx;
  
  // Post blinds
  const sbAmt = Math.min(gs.players[sbIdx].chips, table.sb);
  gs.players[sbIdx].chips -= sbAmt;
  gs.bets[sbIdx] = sbAmt;
  gs.totalContributions[sbIdx] = sbAmt;
  if (gs.players[sbIdx].chips === 0) gs.players[sbIdx].allIn = true;
  
  const bbAmt = Math.min(gs.players[bbIdx].chips, table.bb);
  gs.players[bbIdx].chips -= bbAmt;
  gs.bets[bbIdx] = bbAmt;
  gs.totalContributions[bbIdx] = bbAmt;
  gs.currentBet = bbAmt;
  if (gs.players[bbIdx].chips === 0) gs.players[bbIdx].allIn = true;
  
  // Deal cards
  activeSeatIndices.forEach(i => {
    gs.players[i].cards = [gs.deck.pop(), gs.deck.pop()];
  });
  
  // Set first to act
  if (isHeadsUp) {
    gs.currentIdx = sbIdx;
  } else {
    gs.currentIdx = bbIdx;
    do {
      gs.currentIdx = (gs.currentIdx + 1) % table.maxSeats;
    } while (!gs.players[gs.currentIdx] || gs.players[gs.currentIdx].sittingOut);
  }
  
  return true;
}

// Collect bets into pot (called when betting round ends)
function collectBets(table) {
  const gs = table.gameState;
  let collected = 0;
  for (let i = 0; i < gs.bets.length; i++) {
    collected += gs.bets[i];
    gs.bets[i] = 0;
  }
  gs.pot += collected;
  return collected;
}

function advancePhase(table) {
  const gs = table.gameState;
  
  // Collect all bets into the pot
  collectBets(table);
  
  gs.currentBet = 0;
  gs.minRaise = table.bb;
  gs.acted = new Set();
  
  if (gs.phase === 'preflop') {
    gs.phase = 'flop';
    gs.deck.pop();
    gs.community = [gs.deck.pop(), gs.deck.pop(), gs.deck.pop()];
  } else if (gs.phase === 'flop') {
    gs.phase = 'turn';
    gs.deck.pop();
    gs.community.push(gs.deck.pop());
  } else if (gs.phase === 'turn') {
    gs.phase = 'river';
    gs.deck.pop();
    gs.community.push(gs.deck.pop());
  } else if (gs.phase === 'river') {
    return showdown(table);
  }
  
  // First to act post-flop
  let idx = gs.dealerIdx;
  let tries = 0;
  do {
    idx = (idx + 1) % table.maxSeats;
    tries++;
  } while ((!gs.players[idx] || gs.players[idx].folded || gs.players[idx].allIn || gs.players[idx].sittingOut) && tries < table.maxSeats);
  
  gs.currentIdx = idx;
  return 'continue';
}

function showdown(table) {
  const gs = table.gameState;
  gs.phase = 'showdown';
  table.handInProgress = false;
  
  // Collect any remaining bets
  collectBets(table);
  
  const active = getActivePlayers(table);
  
  // If everyone folded to one player, they win without showing
  if (active.length === 1) {
    const winner = active[0];
    const winnerIdx = gs.players.indexOf(winner);
    winner.chips += gs.pot;
    // Winner does NOT have to show cards when everyone folded
    // They can optionally show via the showCards button
    return {
      winners: [{ player: winner, amount: gs.pot }],
      hand: 'Everyone folded',
      noShow: true,
      potResults: [{ amount: gs.pot, winners: [winnerIdx] }]
    };
  }
  
  // Multiple players went to showdown - evaluate hands
  active.forEach(p => {
    const allCards = [...p.cards, ...gs.community];
    p.handResult = evaluateHand(allCards);
    p.wentToShowdown = true;
  });
  
  // Calculate side pots
  const sidePots = calculateSidePots(table);
  const potResults = [];
  const winnerAmounts = {};
  
  // Award each pot
  for (const pot of sidePots) {
    // Find best hand among eligible players
    let bestHand = { rank: 0, value: 0 };
    const eligiblePlayers = pot.eligible
      .map(idx => gs.players[idx])
      .filter(p => p && !p.folded);
    
    for (const p of eligiblePlayers) {
      if (p.handResult.rank > bestHand.rank || 
          (p.handResult.rank === bestHand.rank && p.handResult.value > bestHand.value)) {
        bestHand = p.handResult;
      }
    }
    
    // Find winners of this pot
    const potWinners = eligiblePlayers.filter(p =>
      p.handResult.rank === bestHand.rank && p.handResult.value === bestHand.value
    );
    
    const share = Math.floor(pot.amount / potWinners.length);
    const remainder = pot.amount % potWinners.length;
    
    potWinners.forEach((w, i) => {
      const winnerIdx = gs.players.indexOf(w);
      const amount = share + (i === 0 ? remainder : 0);
      w.chips += amount;
      w.showCards = true;  // Winners at showdown must show
      winnerAmounts[winnerIdx] = (winnerAmounts[winnerIdx] || 0) + amount;
    });
    
    potResults.push({
      amount: pot.amount,
      winners: potWinners.map(w => gs.players.indexOf(w)),
      hand: bestHand.name
    });
  }
  
  // Build winners array for response
  const winners = Object.entries(winnerAmounts).map(([idx, amount]) => ({
    player: gs.players[parseInt(idx)],
    amount
  }));
  
  return { winners, hand: potResults[0]?.hand || 'Unknown', potResults };
}

function processAction(table, seatIdx, action, amount = 0) {
  const gs = table.gameState;
  
  if (gs.currentIdx !== seatIdx) return { error: 'Not your turn' };
  
  const player = gs.players[seatIdx];
  if (!player || player.folded || player.allIn) return { error: 'Cannot act' };
  
  const toCall = gs.currentBet - gs.bets[seatIdx];
  
  if (action === 'fold') {
    player.folded = true;
  } else if (action === 'check') {
    if (toCall > 0) return { error: 'Cannot check' };
  } else if (action === 'call') {
    const callAmt = Math.min(toCall, player.chips);
    player.chips -= callAmt;
    gs.bets[seatIdx] += callAmt;
    gs.totalContributions[seatIdx] += callAmt;
    if (player.chips === 0) player.allIn = true;
  } else if (action === 'raise') {
    const raiseAmt = amount;
    if (raiseAmt < gs.currentBet + gs.minRaise && raiseAmt < player.chips + gs.bets[seatIdx]) {
      return { error: 'Raise too small' };
    }
    const toAdd = raiseAmt - gs.bets[seatIdx];
    if (toAdd > player.chips) return { error: 'Not enough chips' };
    
    player.chips -= toAdd;
    gs.bets[seatIdx] = raiseAmt;
    gs.totalContributions[seatIdx] += toAdd;
    gs.minRaise = raiseAmt - gs.currentBet;
    gs.currentBet = raiseAmt;
    gs.acted = new Set();
    if (player.chips === 0) player.allIn = true;
  } else if (action === 'allin') {
    const allInTotal = player.chips;
    const newBetTotal = gs.bets[seatIdx] + allInTotal;
    
    gs.bets[seatIdx] = newBetTotal;
    gs.totalContributions[seatIdx] += allInTotal;
    player.chips = 0;
    player.allIn = true;
    
    // Only update currentBet and reset acted if this is a raise
    if (newBetTotal > gs.currentBet) {
      const raiseAmount = newBetTotal - gs.currentBet;
      // Only reset acted if it's a full raise (>= minRaise)
      if (raiseAmount >= gs.minRaise) {
        gs.minRaise = raiseAmount;
        gs.acted = new Set();
      }
      gs.currentBet = newBetTotal;
    }
  }
  
  gs.acted.add(seatIdx);
  
  // Check if hand is over (everyone folded to one player)
  const active = getActivePlayers(table);
  if (active.length === 1) {
    // Collect remaining bets first
    collectBets(table);
    const winner = active[0];
    winner.chips += gs.pot;
    gs.phase = 'showdown';
    table.handInProgress = false;
    return {
      winner,
      hand: 'Everyone folded',
      amount: gs.pot,
      noShow: true,
      potResults: [{ amount: gs.pot, winners: [gs.players.indexOf(winner)] }]
    };
  }
  
  // Check if betting round is complete
  const actors = getActingPlayers(table);
  const allActed = actors.every(p => {
    const idx = gs.players.indexOf(p);
    return gs.acted.has(idx) && gs.bets[idx] >= gs.currentBet;
  });
  
  if (allActed || actors.length === 0) {
    if (actors.length <= 1) {
      // Run out the board
      while (gs.community.length < 5) {
        gs.deck.pop();
        gs.community.push(gs.deck.pop());
      }
      return showdown(table);
    }
    return advancePhase(table);
  }
  
  // Move to next player
  let nextIdx = seatIdx;
  let tries = 0;
  do {
    nextIdx = (nextIdx + 1) % table.maxSeats;
    tries++;
  } while ((!gs.players[nextIdx] || gs.players[nextIdx].folded || gs.players[nextIdx].allIn || gs.players[nextIdx].sittingOut) && tries < table.maxSeats);
  
  gs.currentIdx = nextIdx;
  return { success: true };
}

function getPublicGameState(table, forPlayerId = null) {
  if (!table.gameState) return null;
  
  const gs = table.gameState;
  const players = gs.players.map((p, i) => {
    if (!p) return null;
    const isMe = p.id === forPlayerId;
    const isShowdown = gs.phase === 'showdown';
    // Show cards if: it's me, OR at showdown AND (winner who must show OR voluntarily showed)
    const shouldShowCards = isMe || (isShowdown && p.wentToShowdown && (p.showCards || p.voluntaryShow));
    
    // Build cards array - show revealed cards even if not showdown
    let cards = [];
    if (shouldShowCards) {
      cards = p.cards;
    } else if (p.cards?.length) {
      // Check for individually revealed cards
      cards = p.cards.map((card, idx) => {
        if (p.revealedCards && p.revealedCards[idx]) {
          return card; // Show this card
        }
        return {}; // Hidden card
      });
    }
    
    return {
      id: p.id,
      name: p.name,
      chips: p.chips,
      folded: p.folded,
      allIn: p.allIn,
      sittingOut: p.sittingOut,
      cards: cards,
      seatIdx: i,
      isMe,
      wentToShowdown: p.wentToShowdown || false,
      revealedCards: p.revealedCards || [false, false],
      // Can show if: it's me, at showdown, haven't already shown, and (won by fold OR went to showdown but lost)
      canShow: isMe && isShowdown && !p.showCards && !p.voluntaryShow && p.cards && p.cards.length > 0
    };
  });
  
  return {
    phase: gs.phase,
    pot: gs.pot,
    bets: gs.bets,
    community: gs.community,
    currentBet: gs.currentBet,
    currentIdx: gs.currentIdx,
    dealerIdx: gs.dealerIdx,
    sbIdx: gs.sbIdx,
    bbIdx: gs.bbIdx,
    handNum: gs.handNum,
    players,
    sb: table.sb,
    bb: table.bb,
    maxSeats: table.maxSeats,
    handInProgress: table.handInProgress,
    isPrivate: table.isPrivate,
    code: table.code
  };
}

// Broadcast table list to all clients in lobby
function broadcastTableList() {
  io.emit('tableList', getTableList());
}

// Helper function to try starting the game automatically
function tryAutoStartGame(table) {
  // Only auto-start if game is in waiting phase
  if (table.phase !== 'waiting') return false;
  
  // Count active players (not sitting out, has chips)
  const activePlayers = table.seats.filter(s => s !== null && !s.sittingOut && s.chips > 0).length;
  
  if (activePlayers >= 2) {
    table.phase = 'playing';
    
    if (startHand(table)) {
      table.seats.forEach((p, i) => {
        if (p) {
          io.to(p.socketId).emit('gameUpdate', getPublicGameState(table, p.id));
        }
      });
      io.to(table.code).emit('handStarted', { handNum: table.gameState.handNum });
      io.to(table.code).emit('sound', { type: 'deal' });
      broadcastTableList();
      return true;
    }
  }
  return false;
}

// Socket.io handling
io.on('connection', (socket) => {
  console.log('Connected:', socket.id);
  
  // Send table list on connect
  socket.emit('tableList', getTableList());
  
  socket.on('getTables', () => {
    socket.emit('tableList', getTableList());
  });
  
  socket.on('createTable', ({ name, maxSeats, blinds, buyIn, isPrivate }) => {
    const table = createTable(socket.id, name, maxSeats, blinds, buyIn, isPrivate || false);
    
    const player = {
      id: socket.id,
      name,
      chips: buyIn,
      cards: [],
      folded: false,
      allIn: false,
      sittingOut: false,
      socketId: socket.id
    };
    table.seats[0] = player;
    table.players.push(player);
    
    table.gameState = {
      players: Array(maxSeats).fill(null),
      deck: [],
      community: [],
      pot: 0,
      currentBet: 0,
      minRaise: blinds[1],
      bets: Array(maxSeats).fill(0),
      totalContributions: Array(maxSeats).fill(0),
      acted: new Set(),
      phase: 'waiting',
      dealerIdx: 0,
      sbIdx: 0,
      bbIdx: 1,
      currentIdx: 0,
      handNum: 0
    };
    table.gameState.players[0] = player;
    
    socket.join(table.code);
    socket.tableCode = table.code;
    socket.seatIdx = 0;
    socket.playerName = name;
    
    socket.emit('tableCreated', { 
      code: table.code, 
      seatIdx: 0, 
      isPrivate: table.isPrivate 
    });
    
    io.to(table.code).emit('tableUpdate', {
      seats: table.seats.map(p => p ? { name: p.name, chips: p.chips, id: p.id } : null),
      gameState: getPublicGameState(table, socket.id),
      phase: table.phase,
      isPrivate: table.isPrivate,
      code: table.code
    });
    
    broadcastTableList();
  });
  
  socket.on('joinTable', ({ code, name, buyIn, hasCode }) => {
    const table = tables.get(code.toUpperCase());
    if (!table) {
      socket.emit('error', { message: 'Table not found' });
      return;
    }
    
    // Check if private table and user doesn't have code
    if (table.isPrivate && !hasCode) {
      socket.emit('error', { message: 'This is a private table. You need the table code or link to join.' });
      return;
    }
    
    const seatIdx = table.seats.findIndex(s => s === null);
    if (seatIdx === -1) {
      socket.emit('error', { message: 'Table is full' });
      return;
    }
    
    const player = {
      id: socket.id,
      name,
      chips: buyIn || table.defaultBuyIn,
      cards: [],
      folded: false,
      allIn: false,
      sittingOut: table.handInProgress, // Only sit out if hand already in progress
      socketId: socket.id
    };
    
    table.seats[seatIdx] = player;
    table.players.push(player);
    table.gameState.players[seatIdx] = player;
    
    socket.join(code);
    socket.tableCode = code;
    socket.seatIdx = seatIdx;
    socket.playerName = name;
    
    socket.emit('joinedTable', { 
      code, 
      seatIdx, 
      sittingOut: player.sittingOut,
      isPrivate: table.isPrivate 
    });
    
    table.seats.forEach((p, i) => {
      if (p) {
        io.to(p.socketId).emit('tableUpdate', {
          seats: table.seats.map(pl => pl ? { name: pl.name, chips: pl.chips, id: pl.id, sittingOut: pl.sittingOut } : null),
          gameState: getPublicGameState(table, p.id),
          phase: table.phase,
          isPrivate: table.isPrivate,
          code: table.code
        });
      }
    });
    
    io.to(code).emit('playerJoined', { name, seatIdx });
    broadcastTableList();
    
    // AUTO-START: Try to start the game when a new player joins
    tryAutoStartGame(table);
  });
  
  socket.on('sitIn', () => {
    const table = tables.get(socket.tableCode);
    if (!table) return;
    
    const player = table.gameState.players[socket.seatIdx];
    if (player) {
      player.sittingOut = false;
      io.to(table.code).emit('playerSatIn', { name: player.name, seatIdx: socket.seatIdx });
      
      table.seats.forEach((p, i) => {
        if (p) {
          io.to(p.socketId).emit('tableUpdate', {
            seats: table.seats.map(pl => pl ? { name: pl.name, chips: pl.chips, id: pl.id, sittingOut: pl.sittingOut } : null),
            gameState: getPublicGameState(table, p.id),
            phase: table.phase,
            isPrivate: table.isPrivate,
            code: table.code
          });
        }
      });
      
      // AUTO-START: Try to start the game when a player sits in
      tryAutoStartGame(table);
    }
  });
  
  socket.on('revealCard', ({ cardIdx, revealed }) => {
    const table = tables.get(socket.tableCode);
    if (!table) return;
    
    const player = table.gameState.players[socket.seatIdx];
    if (!player || !player.cards || cardIdx < 0 || cardIdx > 1) return;
    
    // Initialize revealedCards array if not exists
    if (!player.revealedCards) player.revealedCards = [false, false];
    player.revealedCards[cardIdx] = revealed;
    
    // Notify all players about the reveal
    const card = player.cards[cardIdx];
    if (revealed && card) {
      io.to(table.code).emit('cardRevealed', { 
        name: player.name, 
        seatIdx: socket.seatIdx,
        cardIdx,
        card: formatCard(card)
      });
    }
    
    // Send updated game state to all players
    table.seats.forEach((p, i) => {
      if (p) {
        io.to(p.socketId).emit('gameUpdate', getPublicGameState(table, p.id));
      }
    });
  });
  
  socket.on('showCards', () => {
    const table = tables.get(socket.tableCode);
    if (!table) return;
    
    const player = table.gameState.players[socket.seatIdx];
    if (player && table.gameState.phase === 'showdown') {
      player.voluntaryShow = true;
      
      table.seats.forEach((p, i) => {
        if (p) {
          io.to(p.socketId).emit('gameUpdate', getPublicGameState(table, p.id));
        }
      });
      
      // Include the cards in the action log when player shows
      io.to(table.code).emit('playerShowedCards', { 
        name: player.name, 
        seatIdx: socket.seatIdx,
        cards: formatCards(player.cards)
      });
    }
  });
  
  socket.on('leaveSeat', () => {
    const table = tables.get(socket.tableCode);
    if (!table) return;
    
    const seatIdx = socket.seatIdx;
    if (seatIdx === undefined || !table.seats[seatIdx]) return;
    
    const player = table.seats[seatIdx];
    
    // If hand in progress, fold them first
    if (table.handInProgress && table.gameState.players[seatIdx] && !table.gameState.players[seatIdx].folded) {
      table.gameState.players[seatIdx].folded = true;
    }
    
    // Remove from seat but keep in room as spectator
    table.seats[seatIdx] = null;
    table.gameState.players[seatIdx] = null;
    socket.seatIdx = undefined;
    
    socket.emit('leftSeat');
    io.to(table.code).emit('playerLeft', { name: player.name, seatIdx });
    
    // Send updates to all players
    table.seats.forEach((p, i) => {
      if (p) {
        io.to(p.socketId).emit('tableUpdate', {
          seats: table.seats.map(pl => pl ? { name: pl.name, chips: pl.chips, id: pl.id, sittingOut: pl.sittingOut } : null),
          gameState: getPublicGameState(table, p.id),
          phase: table.phase,
          isPrivate: table.isPrivate,
          code: table.code
        });
      }
    });
    // Also send to spectator
    socket.emit('tableUpdate', {
      seats: table.seats.map(pl => pl ? { name: pl.name, chips: pl.chips, id: pl.id, sittingOut: pl.sittingOut } : null),
      gameState: getPublicGameState(table, null),
      phase: table.phase,
      isPrivate: table.isPrivate,
      code: table.code
    });
    
    broadcastTableList();
  });
  
  socket.on('takeSeat', ({ seatIdx, buyIn, name }) => {
    const table = tables.get(socket.tableCode);
    if (!table) return;
    
    // Check if seat is available
    if (table.seats[seatIdx] !== null) {
      socket.emit('error', { message: 'Seat is taken' });
      return;
    }
    
    // If player is already seated, move them
    if (socket.seatIdx !== undefined && table.seats[socket.seatIdx]) {
      const oldSeat = socket.seatIdx;
      const player = table.seats[oldSeat];
      
      // Can't move during active hand if you're in it
      if (table.handInProgress && table.gameState.players[oldSeat] && !table.gameState.players[oldSeat].folded) {
        socket.emit('error', { message: 'Cannot move seats during active hand' });
        return;
      }
      
      // Move player to new seat
      table.seats[oldSeat] = null;
      table.gameState.players[oldSeat] = null;
      table.seats[seatIdx] = player;
      table.gameState.players[seatIdx] = player;
      socket.seatIdx = seatIdx;
      
      socket.emit('seatTaken', { seatIdx });
      io.to(table.code).emit('playerMoved', { name: player.name, from: oldSeat, to: seatIdx });
    } else {
      // New player taking seat (spectator sitting down)
      const playerName = name || socket.playerName || 'Player';
      const player = {
        id: socket.id,
        name: playerName,
        chips: buyIn || table.defaultBuyIn,
        cards: [],
        folded: false,
        allIn: false,
        sittingOut: table.handInProgress,
        socketId: socket.id
      };
      
      table.seats[seatIdx] = player;
      table.gameState.players[seatIdx] = player;
      socket.seatIdx = seatIdx;
      socket.playerName = playerName;
      
      socket.emit('seatTaken', { seatIdx });
      io.to(table.code).emit('playerJoined', { name: player.name, seatIdx });
    }
    
    // Send updates
    table.seats.forEach((p, i) => {
      if (p) {
        io.to(p.socketId).emit('tableUpdate', {
          seats: table.seats.map(pl => pl ? { name: pl.name, chips: pl.chips, id: pl.id, sittingOut: pl.sittingOut } : null),
          gameState: getPublicGameState(table, p.id),
          phase: table.phase,
          isPrivate: table.isPrivate,
          code: table.code
        });
      }
    });
    
    broadcastTableList();
    tryAutoStartGame(table);
  });
  
  socket.on('startGame', () => {
    const table = tables.get(socket.tableCode);
    if (!table || table.hostId !== socket.id) return;
    
    const playerCount = table.seats.filter(s => s !== null && !s.sittingOut).length;
    if (playerCount < 2) {
      socket.emit('error', { message: 'Need at least 2 players' });
      return;
    }
    
    table.phase = 'playing';
    
    if (startHand(table)) {
      table.seats.forEach((p, i) => {
        if (p) {
          io.to(p.socketId).emit('gameUpdate', getPublicGameState(table, p.id));
        }
      });
      io.to(table.code).emit('handStarted', { handNum: table.gameState.handNum });
      io.to(table.code).emit('sound', { type: 'deal' });
    }
    
    broadcastTableList();
  });
  
  socket.on('action', ({ action, amount }) => {
    const table = tables.get(socket.tableCode);
    if (!table || table.phase !== 'playing') return;
    
    const result = processAction(table, socket.seatIdx, action, amount);
    
    if (result.error) {
      socket.emit('error', { message: result.error });
      return;
    }
    
    const player = table.gameState.players[socket.seatIdx];
    io.to(table.code).emit('actionMade', { 
      seatIdx: socket.seatIdx, 
      name: player.name, 
      action, 
      amount 
    });
    io.to(table.code).emit('sound', { type: action });
    
    table.seats.forEach((p, i) => {
      if (p) {
        io.to(p.socketId).emit('gameUpdate', getPublicGameState(table, p.id));
      }
    });
    
    if (result === 'continue') {
      const phase = table.gameState.phase;
      io.to(table.code).emit('phaseChange', { phase, community: table.gameState.community });
      io.to(table.code).emit('sound', { type: 'deal' });
      io.to(table.code).emit('collectBets');
    }
    
    if (result.winners || result.winner) {
      const gs = table.gameState;
      const winners = result.winners || [{ player: result.winner, amount: result.amount }];
      
      io.to(table.code).emit('collectBets');
      
      // Build winner info with cards for action log
      // Only include cards if it was NOT a "everyone folded" situation
      const winnersWithCards = winners.map(w => {
        const winnerIdx = gs.players.indexOf(w.player);
        const winnerPlayer = gs.players[winnerIdx];
        // Show cards only if it went to actual showdown (not everyone folded)
        const showCards = !result.noShow && winnerPlayer && winnerPlayer.wentToShowdown;
        return {
          name: w.player.name,
          seatIdx: winnerIdx,
          amount: w.amount,
          cards: showCards ? formatCards(winnerPlayer.cards) : null
        };
      });
      
      // Also include all showdown players' cards in a separate array for the log
      const showdownPlayers = [];
      if (!result.noShow) {
        gs.players.forEach((p, i) => {
          if (p && p.wentToShowdown && p.cards && p.cards.length > 0) {
            showdownPlayers.push({
              name: p.name,
              seatIdx: i,
              cards: formatCards(p.cards)
            });
          }
        });
      }
      
      io.to(table.code).emit('handComplete', {
        winners: winnersWithCards,
        hand: result.hand,
        potResults: result.potResults,
        showdownPlayers: showdownPlayers  // All players who went to showdown
      });
      io.to(table.code).emit('sound', { type: 'win' });
      
      setTimeout(() => {
        table.gameState.players.forEach((p, i) => {
          if (p && p.chips <= 0) {
            p.sittingOut = true;
          }
        });
        
        const activePlayers = table.seats.filter(s => s !== null && !s.sittingOut && s.chips > 0).length;
        
        if (activePlayers >= 2) {
          if (startHand(table)) {
            table.seats.forEach((p, i) => {
              if (p) {
                io.to(p.socketId).emit('gameUpdate', getPublicGameState(table, p.id));
              }
            });
            io.to(table.code).emit('handStarted', { handNum: table.gameState.handNum });
            io.to(table.code).emit('sound', { type: 'deal' });
          }
        } else {
          io.to(table.code).emit('gameOver', { winner: table.seats.find(s => s !== null && s.chips > 0)?.name });
          table.phase = 'waiting';
          table.handInProgress = false;
        }
        
        broadcastTableList();
      }, 4000);
    }
  });
  
  socket.on('chat', ({ message }) => {
    const table = tables.get(socket.tableCode);
    if (!table) return;
    const player = table.seats[socket.seatIdx];
    if (!player) return;
    io.to(table.code).emit('chatMessage', { name: player.name, message });
  });
  
  socket.on('leaveTable', () => {
    handleDisconnect(socket);
  });
  
  socket.on('disconnect', () => {
    console.log('Disconnected:', socket.id);
    handleDisconnect(socket);
  });
  
  function handleDisconnect(socket) {
    const table = tables.get(socket.tableCode);
    if (!table) return;
    
    const seatIdx = socket.seatIdx;
    if (seatIdx !== undefined && table.seats[seatIdx]) {
      const player = table.seats[seatIdx];
      
      // If hand in progress, fold them
      if (table.handInProgress && table.gameState.players[seatIdx]) {
        table.gameState.players[seatIdx].folded = true;
        table.gameState.players[seatIdx].sittingOut = true;
      }
      
      table.seats[seatIdx] = null;
      table.gameState.players[seatIdx] = null;
      
      io.to(table.code).emit('playerLeft', { name: player.name, seatIdx });
      
      // Send updates
      table.seats.forEach((p, i) => {
        if (p) {
          io.to(p.socketId).emit('tableUpdate', {
            seats: table.seats.map(pl => pl ? { name: pl.name, chips: pl.chips, id: pl.id, sittingOut: pl.sittingOut } : null),
            gameState: getPublicGameState(table, p.id),
            phase: table.phase,
            isPrivate: table.isPrivate,
            code: table.code
          });
        }
      });
    }
    
    // Clean up empty tables
    if (table.seats.every(s => s === null)) {
      tables.delete(table.code);
    }
    
    broadcastTableList();
  }
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`AllIn27 server running on port ${PORT}`));
