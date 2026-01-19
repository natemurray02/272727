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

// UPDATED: Added isPrivate parameter
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
    isPrivate,  // NEW: track if table is private
    players: [],
    seats: Array(maxSeats).fill(null),
    gameState: null,
    phase: 'waiting',
    handInProgress: false
  };
  tables.set(code, table);
  return table;
}

// UPDATED: Include isPrivate in table list
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
      isPrivate: table.isPrivate  // NEW: send private status to clients
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

function startHand(table) {
  const gs = table.gameState;
  gs.handNum++;
  gs.deck = shuffle(createDeck());
  gs.community = [];
  gs.pot = 0;
  gs.currentBet = 0;
  gs.minRaise = table.bb;
  gs.bets = Array(table.maxSeats).fill(0);
  gs.acted = new Set();
  gs.phase = 'preflop';
  table.handInProgress = true;
  
  // Reset players
  gs.players.forEach((p, i) => {
    if (p) {
      p.cards = [];
      p.folded = false;
      p.allIn = false;
      p.sittingOut = p.sittingOut || false;
    }
  });
  
  // Find active players (not sitting out, has chips)
  const activeSeatIndices = gs.players.map((p, i) => (p && !p.sittingOut && p.chips > 0) ? i : -1).filter(i => i >= 0);
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
    do { sbIdx = (sbIdx + 1) % table.maxSeats; } while (!gs.players[sbIdx] || gs.players[sbIdx].sittingOut);
    bbIdx = sbIdx;
    do { bbIdx = (bbIdx + 1) % table.maxSeats; } while (!gs.players[bbIdx] || gs.players[bbIdx].sittingOut);
  }
  
  gs.sbIdx = sbIdx;
  gs.bbIdx = bbIdx;
  
  // Post blinds
  const sbAmt = Math.min(gs.players[sbIdx].chips, table.sb);
  gs.players[sbIdx].chips -= sbAmt;
  gs.bets[sbIdx] = sbAmt;
  gs.pot += sbAmt;
  
  const bbAmt = Math.min(gs.players[bbIdx].chips, table.bb);
  gs.players[bbIdx].chips -= bbAmt;
  gs.bets[bbIdx] = bbAmt;
  gs.pot += bbAmt;
  gs.currentBet = bbAmt;
  
  // Deal cards
  activeSeatIndices.forEach(i => {
    gs.players[i].cards = [gs.deck.pop(), gs.deck.pop()];
  });
  
  // Set first to act
  if (isHeadsUp) {
    gs.currentIdx = sbIdx;
  } else {
    gs.currentIdx = bbIdx;
    do { gs.currentIdx = (gs.currentIdx + 1) % table.maxSeats; } while (!gs.players[gs.currentIdx] || gs.players[gs.currentIdx].sittingOut);
  }
  
  return true;
}

function advancePhase(table) {
  const gs = table.gameState;
  gs.bets = Array(table.maxSeats).fill(0);
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
  
  const active = getActivePlayers(table);
  if (active.length === 1) {
    active[0].chips += gs.pot;
    return { winners: [active[0]], hand: 'Everyone folded', amount: gs.pot };
  }
  
  let bestHand = { rank: 0, value: 0 };
  active.forEach(p => {
    const allCards = [...p.cards, ...gs.community];
    p.handResult = evaluateHand(allCards);
    if (p.handResult.rank > bestHand.rank || 
        (p.handResult.rank === bestHand.rank && p.handResult.value > bestHand.value)) {
      bestHand = p.handResult;
    }
  });
  
  const winners = active.filter(p => 
    p.handResult.rank === bestHand.rank && p.handResult.value === bestHand.value
  );
  
  const share = Math.floor(gs.pot / winners.length);
  winners.forEach(w => w.chips += share);
  
  return { winners, hand: bestHand.name, amount: share };
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
    gs.pot += callAmt;
    if (player.chips === 0) player.allIn = true;
  } else if (action === 'raise') {
    const raiseAmt = amount;
    if (raiseAmt < gs.currentBet + gs.minRaise && raiseAmt < player.chips + gs.bets[seatIdx]) {
      return { error: 'Raise too small' };
    }
    const toAdd = raiseAmt - gs.bets[seatIdx];
    if (toAdd > player.chips) return { error: 'Not enough chips' };
    player.chips -= toAdd;
    gs.pot += toAdd;
    gs.minRaise = raiseAmt - gs.currentBet;
    gs.bets[seatIdx] = raiseAmt;
    gs.currentBet = raiseAmt;
    gs.acted = new Set();
    if (player.chips === 0) player.allIn = true;
  } else if (action === 'allin') {
    const allInAmt = player.chips + gs.bets[seatIdx];
    gs.pot += player.chips;
    if (allInAmt > gs.currentBet) {
      gs.minRaise = allInAmt - gs.currentBet;
      gs.currentBet = allInAmt;
      gs.acted = new Set();
    }
    gs.bets[seatIdx] = allInAmt;
    player.chips = 0;
    player.allIn = true;
  }
  
  gs.acted.add(seatIdx);
  
  // Check if hand is over
  const active = getActivePlayers(table);
  if (active.length === 1) {
    active[0].chips += gs.pot;
    gs.phase = 'showdown';
    table.handInProgress = false;
    return { winner: active[0], hand: 'Everyone folded', amount: gs.pot };
  }
  
  // Check if betting round is complete
  const actors = getActingPlayers(table);
  const allActed = actors.every(p => {
    const idx = gs.players.indexOf(p);
    return gs.acted.has(idx) && (gs.bets[idx] >= gs.currentBet || p.allIn);
  });
  
  if (allActed || actors.length === 0) {
    if (actors.length <= 1) {
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
    return {
      id: p.id,
      name: p.name,
      chips: p.chips,
      folded: p.folded,
      allIn: p.allIn,
      sittingOut: p.sittingOut,
      cards: (isMe || isShowdown) ? p.cards : (p.cards?.length ? [{}, {}] : []),
      seatIdx: i,
      isMe
    };
  });
  
  return {
    phase: gs.phase,
    pot: gs.pot,
    community: gs.community,
    currentBet: gs.currentBet,
    bets: gs.bets,
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
    isPrivate: table.isPrivate,  // NEW: include in game state
    code: table.code  // NEW: include code so players can share link
  };
}

// Broadcast table list to all clients in lobby
function broadcastTableList() {
  io.emit('tableList', getTableList());
}

// Socket.io handling
io.on('connection', (socket) => {
  console.log('Connected:', socket.id);
  
  // Send table list on connect
  socket.emit('tableList', getTableList());
  
  socket.on('getTables', () => {
    socket.emit('tableList', getTableList());
  });
  
  // UPDATED: Accept isPrivate parameter
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
    
    // NEW: Send isPrivate and code back to client for UI display
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
  
  // UPDATED: Add hasCode parameter for private table access
  socket.on('joinTable', ({ code, name, buyIn, hasCode }) => {
    const table = tables.get(code.toUpperCase());
    if (!table) {
      socket.emit('error', { message: 'Table not found' });
      return;
    }
    
    // NEW: Check if private table and user doesn't have code
    // hasCode = true means they came via direct link or entered code manually
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
      sittingOut: table.handInProgress, // Sit out if hand is in progress
      socketId: socket.id
    };
    
    table.seats[seatIdx] = player;
    table.players.push(player);
    table.gameState.players[seatIdx] = player;
    
    socket.join(code);
    socket.tableCode = code;
    socket.seatIdx = seatIdx;
    
    socket.emit('joinedTable', { 
      code, 
      seatIdx, 
      sittingOut: player.sittingOut,
      isPrivate: table.isPrivate
    });
    
    // Send personalized update to all players
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
  });
  
  socket.on('sitIn', () => {
    const table = tables.get(socket.tableCode);
    if (!table) return;
    
    const player = table.gameState.players[socket.seatIdx];
    if (player) {
      player.sittingOut = false;
      io.to(table.code).emit('playerSatIn', { name: player.name, seatIdx: socket.seatIdx });
      
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
    
    // Send sound
    io.to(table.code).emit('sound', { type: action });
    
    // Send updated game state
    table.seats.forEach((p, i) => {
      if (p) {
        io.to(p.socketId).emit('gameUpdate', getPublicGameState(table, p.id));
      }
    });
    
    // Handle phase changes
    if (result === 'continue') {
      const phase = table.gameState.phase;
      io.to(table.code).emit('phaseChange', { phase });
      io.to(table.code).emit('sound', { type: 'deal' });
    }
    
    // Handle showdown/winner
    if (result.winners || result.winner) {
      const winners = result.winners || [result.winner];
      io.to(table.code).emit('handComplete', {
        winners: winners.map(w => ({ name: w.name, seatIdx: table.gameState.players.indexOf(w) })),
        hand: result.hand,
        amount: result.amount
      });
      io.to(table.code).emit('sound', { type: 'win' });
      
      // Start new hand after delay
      setTimeout(() => {
        // Remove busted players
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
