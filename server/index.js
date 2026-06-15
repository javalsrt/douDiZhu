// ===== 斗地主游戏服务器入口 =====

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { RoomManager, PHASE } = require('./roomManager');
const { analyzeHand } = require('./gameEngine');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] }
});

const roomManager = new RoomManager();

// 静态文件服务
app.use(express.static(path.join(__dirname, '..', 'client')));

// 连接用户映射
const users = new Map(); // socketId -> { id, name }

io.on('connection', (socket) => {
  console.log(`[连接] ${socket.id}`);

  // 用户加入
  socket.on('join', (data) => {
    const name = (data && data.name) ? data.name.trim() : '';
    if (!name) {
      socket.emit('error', { msg: '请输入昵称' });
      return;
    }

    const userId = uuidv4();
    users.set(socket.id, { id: userId, name, socketId: socket.id });

    const { room, ok } = roomManager.joinRoom({ id: userId, name, socketId: socket.id });
    if (!ok) {
      socket.emit('error', { msg: '加入房间失败' });
      return;
    }

    socket.join(room.id);
    socket.emit('joined', {
      userId,
      name,
      roomId: room.id,
      playerCount: room.getPlayerCount()
    });

    // 广播房间状态
    broadcastRoomState(room.id);

    // 满3人自动开始叫地主
    if (room.canStart() && room.phase === PHASE.WAITING) {
      const firstCaller = room.startGame();
      broadcastToRoom(room.id, 'game_started', {
        roomId: room.id,
        firstCaller,
        bottomCards: room.bottomCards
      });
      // 发送各自的手牌
      room.players.forEach((p, i) => {
        const socketId = p.socketId;
        io.to(socketId).emit('your_cards', { cards: p.hand });
      });
      broadcastRoomState(room.id);

      // 提示叫地主
      const caller = room.players[firstCaller];
      io.to(caller.socketId).emit('your_turn_call');
    }
  });

  // 叫地主
  socket.on('call_landlord', (data) => {
    const user = users.get(socket.id);
    if (!user) return;
    const room = roomManager.getPlayerRoom(user.id);
    if (!room) return;

    const playerIndex = room.players.findIndex(p => p.id === user.id);
    const result = room.handleCall(playerIndex, data.call); // 'call' or 'pass'

    if (!result.ok) {
      socket.emit('error', { msg: result.msg });
      return;
    }

    if (result.result === 'called') {
      // 有人叫了地主
      broadcastToRoom(room.id, 'landlord_called', {
        landlordIndex: result.landlordIndex,
        bottomCards: result.bottomCards
      });
      // 发给地主更新手牌
      const landlord = room.players[result.landlordIndex];
      io.to(landlord.socketId).emit('your_cards', { cards: landlord.hand });
      // 通知地主出牌
      io.to(landlord.socketId).emit('your_turn_play');
      broadcastRoomState(room.id);

    } else if (result.result === 'redeal') {
      // 没人叫地主，重新发牌
      broadcastToRoom(room.id, 'redeal');
      const firstCaller = room.startGame();
      broadcastToRoom(room.id, 'game_started', {
        roomId: room.id,
        firstCaller,
        bottomCards: room.bottomCards
      });
      room.players.forEach(p => {
        io.to(p.socketId).emit('your_cards', { cards: p.hand });
      });
      broadcastRoomState(room.id);
      io.to(room.players[firstCaller].socketId).emit('your_turn_call');

    } else if (result.result === 'pass') {
      broadcastToRoom(room.id, 'call_passed', {
        playerIndex,
        nextCaller: result.nextCaller
      });
      io.to(room.players[result.nextCaller].socketId).emit('your_turn_call');
    }
  });

  // 出牌
  socket.on('play_cards', (data) => {
    const user = users.get(socket.id);
    if (!user) return;
    const room = roomManager.getPlayerRoom(user.id);
    if (!room) return;

    const playerIndex = room.players.findIndex(p => p.id === user.id);
    const result = room.handlePlay(playerIndex, data.cards || []);

    if (!result.ok) {
      socket.emit('error', { msg: result.msg });
      return;
    }

    // 广播出牌
    broadcastToRoom(room.id, 'cards_played', {
      playerIndex,
      cards: data.cards || [],
      type: data.cards && data.cards.length > 0 ? analyzeHand(data.cards) : { type: 'pass' },
      passCount: room.passCount
    });

    broadcastRoomState(room.id);

    if (result.result === 'gameover') {
      broadcastToRoom(room.id, 'game_over', {
        winnerIndex: result.winnerIndex,
        winnerSide: result.winnerSide,
        winnerName: result.winnerName,
        multiplier: result.multiplier,
        spring: result.spring,
        antiSpring: result.antiSpring,
        bombCount: result.bombCount,
        rocketCount: result.rocketCount
      });

      // 揭示所有手牌
      room.players.forEach(p => {
        broadcastToRoom(room.id, 'reveal_hand', {
          playerId: p.id,
          hand: p.hand
        });
      });

    } else {
      // 提示下一位出牌
      const nextPlayer = room.players[result.nextPlayer];
      io.to(nextPlayer.socketId).emit('your_turn_play');
    }
  });

  // 获取游戏状态
  socket.on('get_state', () => {
    const user = users.get(socket.id);
    if (!user) return;
    const room = roomManager.getPlayerRoom(user.id);
    if (!room) return;
    const state = room.getGameState(user.id);
    socket.emit('game_state', state);
  });

  // 断线
  socket.on('disconnect', () => {
    console.log(`[断开] ${socket.id}`);
    const user = users.get(socket.id);
    if (user) {
      const room = roomManager.leaveRoom(user.id);
      users.delete(socket.id);
      if (room) {
        broadcastRoomState(room.id);
        broadcastToRoom(room.id, 'player_left', { playerId: user.id, name: user.name });
      }
    }
  });
});

function broadcastToRoom(roomId, event, data) {
  io.to(roomId).emit(event, data);
}

function broadcastRoomState(roomId) {
  const room = roomManager.getRoom(roomId);
  if (!room) return;
  room.players.forEach(p => {
    const state = room.getGameState(p.id);
    io.to(p.socketId).emit('game_state', state);
  });
}

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`🃏 斗地主服务器已启动: http://localhost:${PORT}`);
});
