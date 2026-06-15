// ===== 房间管理 & 游戏状态机 =====

const { deal, analyzeHand, canBeat, isBombOrRocket, removeCards, cardsInHand, HAND_TYPE } = require('./gameEngine');

// 游戏阶段
const PHASE = {
  WAITING: 'waiting',       // 等待玩家
  CALLING: 'calling',       // 叫地主
  PLAYING: 'playing',       // 出牌
  OVER: 'over'              // 结束
};

class Room {
  constructor(id) {
    this.id = id;
    this.players = [];          // { id, name, socketId, hand:[], isLandlord:bool }
    this.maxPlayers = 3;
    this.phase = PHASE.WAITING;
    this.bottomCards = [];
    this.currentPlayerIndex = 0;
    this.lastPlayedCards = null;  // 上一手出的牌 { cards, type, mainValue, ... }
    this.lastPlayedBy = null;     // 上一手出牌玩家索引
    this.passCount = 0;
    this.landlordIndex = -1;
    this.callingIndex = -1;
    this.callingRound = 0;
    this.multiplier = 1;
    this.bombCount = 0;
    this.rocketCount = 0;
    this.spring = false;         // 春天
    this.antiSpring = false;     // 反春天
  }

  addPlayer(player) {
    if (this.players.length >= this.maxPlayers) return false;
    if (this.players.find(p => p.id === player.id)) return false;
    this.players.push({
      id: player.id,
      name: player.name,
      socketId: player.socketId,
      hand: [],
      isLandlord: false,
      ready: false
    });
    return true;
  }

  removePlayer(playerId) {
    const idx = this.players.findIndex(p => p.id === playerId);
    if (idx >= 0) {
      this.players.splice(idx, 1);
      // 如果在游戏中有人离开，游戏结束
      if (this.phase !== PHASE.WAITING) {
        this.phase = PHASE.OVER;
      }
    }
  }

  getPlayerCount() {
    return this.players.length;
  }

  canStart() {
    return this.players.length === this.maxPlayers;
  }

  startGame() {
    // 发牌
    const { players: hands, bottomCards } = deal();
    this.players.forEach((p, i) => {
      p.hand = hands[i];
      p.isLandlord = false;
      p.ready = false;
    });
    this.bottomCards = bottomCards;
    this.phase = PHASE.CALLING;
    this.callingIndex = Math.floor(Math.random() * 3);
    this.callingRound = 0;
    this.lastPlayedCards = null;
    this.lastPlayedBy = null;
    this.passCount = 0;
    this.landlordIndex = -1;
    this.multiplier = 1;
    this.bombCount = 0;
    this.rocketCount = 0;
    this.spring = false;
    this.antiSpring = false;

    return this.callingIndex;
  }

  // 叫地主处理
  handleCall(playerIndex, call) {
    if (this.phase !== PHASE.CALLING) return { ok: false, msg: '不在叫地主阶段' };
    if (playerIndex !== this.callingIndex) return { ok: false, msg: '还没轮到你叫地主' };

    // call: 'call' 叫地主, 'pass' 不叫
    if (call === 'call') {
      // 叫地主成功
      this.landlordIndex = playerIndex;
      this.players[playerIndex].isLandlord = true;
      this.players[playerIndex].hand.push(...this.bottomCards);
      // 重新排序手牌
      this.players[playerIndex].hand.sort((a, b) => b.value - a.value);
      this.phase = PHASE.PLAYING;
      this.currentPlayerIndex = this.landlordIndex;
      this.passCount = 0;
      this.lastPlayedCards = null;
      this.lastPlayedBy = null;

      // 检查是否春天（农民一手没出）
      this.spring = true;
      this.antiSpring = true;

      return {
        ok: true,
        result: 'called',
        landlordIndex: this.landlordIndex,
        bottomCards: this.bottomCards
      };
    }

    // 不叫
    this.callingRound++;
    this.callingIndex = (this.callingIndex + 1) % 3;

    // 前两人都不叫，第三人必须叫（强制叫地主）
    if (this.callingRound >= 2) {
      // 第三人自动成为地主
      this.landlordIndex = this.callingIndex;
      this.players[this.callingIndex].isLandlord = true;
      this.players[this.callingIndex].hand.push(...this.bottomCards);
      this.players[this.callingIndex].hand.sort((a, b) => b.value - a.value);
      this.phase = PHASE.PLAYING;
      this.currentPlayerIndex = this.landlordIndex;
      this.passCount = 0;
      this.lastPlayedCards = null;
      this.lastPlayedBy = null;
      this.spring = true;
      this.antiSpring = true;

      return {
        ok: true,
        result: 'called',
        landlordIndex: this.landlordIndex,
        bottomCards: this.bottomCards,
        forced: true
      };
    }

    return { ok: true, result: 'pass', nextCaller: this.callingIndex };
  }

  // 出牌处理
  handlePlay(playerIndex, cards) {
    if (this.phase !== PHASE.PLAYING) return { ok: false, msg: '不在出牌阶段' };
    if (playerIndex !== this.currentPlayerIndex) return { ok: false, msg: '还没轮到你出牌' };

    const player = this.players[playerIndex];

    // 检查牌是否在手牌中
    if (!cardsInHand(player.hand, cards)) return { ok: false, msg: '手牌中没有这些牌' };

    // 如果要出牌
    if (cards.length > 0) {
      const analysis = analyzeHand(cards);
      if (analysis.type === HAND_TYPE.INVALID) {
        return { ok: false, msg: '无效牌型' };
      }

      // 检查是否能管上家的牌
      if (this.lastPlayedCards && this.lastPlayedBy !== playerIndex) {
        if (!canBeat({ ...analysis, cards }, this.lastPlayedCards)) {
          return { ok: false, msg: '管不上，请选择更大的牌型' };
        }
      }

      // 炸弹和火箭计数
      if (isBombOrRocket(analysis.type)) {
        if (analysis.type === HAND_TYPE.ROCKET) {
          this.rocketCount++;
          this.multiplier *= 2;
        } else {
          this.bombCount++;
          this.multiplier *= 2;
        }
      }

      // 春天检测
      if (this.lastPlayedCards === null && playerIndex !== this.landlordIndex) {
        this.spring = false;
      }
      if (this.lastPlayedCards === null && playerIndex === this.landlordIndex) {
        this.antiSpring = false;
      }

      // 从手牌中移除
      player.hand = removeCards(player.hand, cards);

      // 记录这手牌
      this.lastPlayedCards = { ...analysis, cards };
      this.lastPlayedBy = playerIndex;
      this.passCount = 0;

      // 检查是否出完牌
      if (player.hand.length === 0) {
        return this.endGame(playerIndex);
      }
    } else {
      // 不出（过）
      if (this.lastPlayedCards === null || this.lastPlayedBy === playerIndex) {
        return { ok: false, msg: '你必须出牌' };
      }
      this.passCount++;

      // 2人都过了，新一轮开始
      if (this.passCount >= 2) {
        this.lastPlayedCards = null;
        this.lastPlayedBy = null;
        this.passCount = 0;
      }
    }

    // 轮到下一个玩家
    this.currentPlayerIndex = this.getNextPlayer();
    return { ok: true, result: 'next', nextPlayer: this.currentPlayerIndex };
  }

  getNextPlayer() {
    return (this.currentPlayerIndex + 1) % 3;
  }

  endGame(winnerIndex) {
    this.phase = PHASE.OVER;
    const winner = this.players[winnerIndex];
    const isLandlordWin = winner.isLandlord;

    // 倍数计算
    let finalMultiplier = this.multiplier;
    if (this.spring && isLandlordWin) finalMultiplier *= 2;   // 春天
    if (this.antiSpring && !isLandlordWin) finalMultiplier *= 2; // 反春天

    // 判定赢家阵营
    let winnerSide;
    if (isLandlordWin) {
      winnerSide = 'landlord';
    } else {
      winnerSide = 'farmer';
    }

    return {
      ok: true,
      result: 'gameover',
      winnerIndex,
      winnerSide,
      winnerName: winner.name,
      multiplier: finalMultiplier,
      spring: this.spring,
      antiSpring: this.antiSpring,
      bombCount: this.bombCount,
      rocketCount: this.rocketCount
    };
  }

  getGameState(playerId) {
    const player = this.players.find(p => p.id === playerId);
    const isCurrentPlayer = player && this.players.indexOf(player) === this.currentPlayerIndex;

    return {
      roomId: this.id,
      phase: this.phase,
      players: this.players.map(p => ({
        id: p.id,
        name: p.name,
        cardCount: p.hand.length,
        isLandlord: p.isLandlord,
        // 只返回当前玩家的手牌
        hand: (player && p.id === playerId) ? p.hand : null,
      })),
      currentPlayerIndex: this.currentPlayerIndex,
      lastPlayedCards: this.lastPlayedCards ? {
        cards: this.lastPlayedCards.cards,
        type: this.lastPlayedCards.type,
        mainValue: this.lastPlayedCards.mainValue
      } : null,
      lastPlayedBy: this.lastPlayedBy,
      bottomCards: this.phase !== PHASE.WAITING ? this.bottomCards : null,
      landlordIndex: this.landlordIndex,
      myIndex: player ? this.players.indexOf(player) : -1,
      isMyTurn: isCurrentPlayer,
      multiplier: this.multiplier
    };
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.playerRoomMap = new Map(); // playerId -> roomId
  }

  createRoom() {
    const id = 'room_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const room = new Room(id);
    this.rooms.set(id, room);
    return room;
  }

  findOrCreateRoom() {
    // 找一个等待中的房间
    for (const room of this.rooms.values()) {
      if (room.phase === 'waiting' && room.getPlayerCount() < room.maxPlayers) {
        return room;
      }
    }
    return this.createRoom();
  }

  getRoom(roomId) {
    return this.rooms.get(roomId);
  }

  getPlayerRoom(playerId) {
    const roomId = this.playerRoomMap.get(playerId);
    return roomId ? this.rooms.get(roomId) : null;
  }

  joinRoom(player) {
    const room = this.findOrCreateRoom();
    const ok = room.addPlayer(player);
    if (ok) {
      this.playerRoomMap.set(player.id, room.id);
    }
    return { room, ok };
  }

  leaveRoom(playerId) {
    const room = this.getPlayerRoom(playerId);
    if (room) {
      room.removePlayer(playerId);
      this.playerRoomMap.delete(playerId);
      if (room.getPlayerCount() === 0) {
        this.rooms.delete(room.id);
      }
    }
    return room;
  }

  getRoomPlayers(roomId) {
    const room = this.rooms.get(roomId);
    return room ? room.players.map(p => p.id) : [];
  }
}

module.exports = { RoomManager, PHASE };
