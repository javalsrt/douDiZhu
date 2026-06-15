// ===== 斗地主前端游戏逻辑 =====

(function () {
  'use strict';

  // DOM工具
  const $ = (s) => document.querySelector(s);

  // 核心DOM引用
  const loginScreen = $('#loginScreen');
  const gameScreen = $('#gameScreen');
  const nameInput = $('#nameInput');
  const joinBtn = $('#joinBtn');
  const roomInfo = $('#roomInfo');
  const multiplierDisplay = $('#multiplierDisplay');
  const handCards = $('#handCards');
  const btnPlay = $('#btnPlay');
  const btnPass = $('#btnPass');
  const btnHint = $('#btnHint');
  const actionBar = $('#actionBar');
  const callBar = $('#callBar');
  const btnCall = $('#btnCall');
  const btnNoCall = $('#btnNoCall');
  const overlay = $('#overlay');
  const toast = $('#toast');
  const topPlayedZone = $('#topPlayedZone');
  const bottomCardsZone = $('#bottomCardsZone');

  // 游戏状态
  let socket = null;
  let userId = '';
  let myName = '';
  let roomId = '';
  let myHand = [];
  let selectedCards = new Set();
  let isMyTurn = false;
  let isCalling = false;
  let gamePhase = 'waiting';
  let myIndex = -1;
  let players = [];
  let currentPlayerIndex = -1;
  let lastPlayedCards = null;
  let lastPlayedBy = null;

  const RED_SUITS = ['♥', '♦'];
  const BLACK_SUITS = ['♠', '♣'];
  function isRed(card) {
    return RED_SUITS.includes(card.suit) || card.rank === '大王' || card.rank === '小王';
  }

  // ===== 客户端牌型分析（用于提示） =====
  function analyzeHand(cards) {
    const len = cards.length;
    if (len === 0) return null;

    const countMap = {};
    cards.forEach(c => { countMap[c.value] = (countMap[c.value] || 0) + 1; });
    const groups = { 1: [], 2: [], 3: [], 4: [] };
    for (const [val, cnt] of Object.entries(countMap)) {
      groups[cnt].push(parseInt(val));
    }
    for (const k of Object.keys(groups)) {
      groups[k].sort((a, b) => b - a);
    }
    const uniqueVals = [...new Set(cards.map(c => c.value))].sort((a, b) => b - a);

    function isConsec(values) {
      if (values.length < 2) return false;
      for (let i = 1; i < values.length; i++) {
        if (values[i - 1] - values[i] !== 1) return false;
      }
      return Math.max(...values) <= 14;
    }

    // 火箭
    if (len === 2 && cards.some(c => c.value === 17) && cards.some(c => c.value === 16)) {
      return { type: 'rocket', mainValue: 17 };
    }
    // 炸弹
    if (len === 4 && uniqueVals.length === 1) return { type: 'bomb', mainValue: uniqueVals[0] };
    // 单张
    if (len === 1) return { type: 'single', mainValue: uniqueVals[0] };
    // 对子
    if (len === 2 && uniqueVals.length === 1) return { type: 'pair', mainValue: uniqueVals[0] };
    // 三条
    if (len === 3 && uniqueVals.length === 1) return { type: 'triple', mainValue: uniqueVals[0] };
    // 三带一
    if (len === 4 && groups[3].length === 1 && groups[1].length === 1) return { type: 'triple_one', mainValue: groups[3][0] };
    // 三带二
    if (len === 5 && groups[3].length === 1 && groups[2].length === 1) return { type: 'triple_two', mainValue: groups[3][0] };
    // 四带二
    if ((len === 6 && groups[4].length === 1) || (len === 8 && groups[4].length === 1 && groups[2].length === 2)) {
      return { type: 'four_two', mainValue: groups[4][0] };
    }
    // 顺子
    if (len >= 5 && groups[2].length === 0 && groups[3].length === 0 && groups[4].length === 0 && uniqueVals.length === len && isConsec(uniqueVals)) {
      return { type: 'straight', mainValue: uniqueVals[0], length: len };
    }
    // 连对
    if (len >= 6 && len % 2 === 0 && groups[1].length === 0 && groups[3].length === 0 && groups[4].length === 0 && groups[2].length === len / 2 && isConsec(groups[2])) {
      return { type: 'straight_pair', mainValue: groups[2][0], length: groups[2].length };
    }
    // 飞机不带
    if (len >= 6 && len % 3 === 0 && groups[3].length === len / 3 && groups[1].length === 0 && groups[2].length === 0 && groups[4].length === 0 && isConsec(groups[3])) {
      return { type: 'plane', mainValue: groups[3][0], length: groups[3].length };
    }
    // 飞机带翅膀
    if (groups[3].length >= 2 && groups[4].length === 0 && isConsec(groups[3])) {
      const tc = groups[3].length;
      const rem = len - tc * 3;
      if (rem === tc) return { type: 'plane_wing', mainValue: groups[3][0], length: tc, wingType: 'single' };
      if (rem === tc * 2 && groups[1].length === 0 && groups[2].length === tc) return { type: 'plane_wing', mainValue: groups[3][0], length: tc, wingType: 'pair' };
    }

    return null;
  }

  function canBeat(myAnalysis, lastPlayed) {
    if (!lastPlayed || !lastPlayed.cards || lastPlayed.cards.length === 0) return myAnalysis !== null;
    const cur = myAnalysis;
    const last = lastPlayed;
    if (cur.type === 'rocket') return true;
    if (last.type === 'rocket') return false;
    if (cur.type === 'bomb' && last.type !== 'bomb' && last.type !== 'rocket') return true;
    if (cur.type === 'bomb' && last.type === 'bomb') return cur.mainValue > last.mainValue;
    if (cur.type !== 'bomb' && last.type === 'bomb') return false;
    if (cur.type !== last.type) return false;
    if (cur.length !== undefined && cur.length !== last.length) return false;
    if (cur.type === 'plane_wing' && cur.wingType !== last.wingType) return false;
    return cur.mainValue > last.mainValue;
  }

  // ===== Socket连接 =====
  function connect() {
    socket = io();

    socket.on('connect', () => {
      console.log('[WS] 已连接');
    });

    socket.on('joined', (data) => {
      userId = data.userId;
      myName = data.name;
      roomId = data.roomId;
      $('#myName').textContent = myName;
      roomInfo.textContent = '房间: ' + roomId.slice(-6);
      showToast('等待其他玩家加入...');
      Sound.click();
    });

    socket.on('game_state', (state) => {
      updateGameState(state);
    });

    socket.on('game_started', (data) => {
      gamePhase = 'calling';
      hideCallBar();
      hideActionBar();
      Sound.gameStart();
      if (data.bottomCards) {
        showBottomCards(data.bottomCards, false);
      }
    });

    socket.on('your_cards', (data) => {
      myHand = data.cards;
      selectedCards.clear();
      renderHand();
    });

    socket.on('your_turn_call', () => {
      isCalling = true;
      isMyTurn = false;
      showCallBar();
      showToast('请叫地主');
      Sound.yourTurn();
    });

    socket.on('your_turn_play', () => {
      isMyTurn = true;
      isCalling = false;
      hideCallBar();
      showActionBar();
      updateButtons();
      renderHand();
      Sound.yourTurn();
    });

    socket.on('landlord_called', (data) => {
      gamePhase = 'playing';
      hideCallBar();
      showBottomCards(null, true);
      Sound.callLandlord();
    });

    socket.on('call_passed', () => { /* 更新在 game_state 里处理 */ });

    socket.on('redeal', () => {
      showToast('无人叫地主，重新发牌');
      topPlayedZone.innerHTML = '';
    });

    socket.on('cards_played', (data) => {
      renderPlayedCards(data);
      // 出牌音效
      if (data.cards && data.cards.length > 0) {
        const type = (data.type && data.type.type) || '';
        if (type === 'bomb') {
          Sound.bomb();
        } else if (type === 'rocket') {
          Sound.rocket();
        } else if (['straight', 'straight_pair', 'plane', 'plane_wing'].includes(type)) {
          Sound.bigPlay();
        } else {
          Sound.playCard();
        }
      } else {
        Sound.pass();
      }
      if (data.playerIndex === myIndex) {
        isMyTurn = false;
        hideActionBar();
        selectedCards.clear();
      }
    });

    socket.on('reveal_hand', (data) => {
      // 游戏结束揭示所有手牌
      if (data.playerId !== userId) {
        // 显示对手手牌（可扩展）
      }
    });

    socket.on('game_over', (data) => {
      gamePhase = 'over';
      isMyTurn = false;
      isCalling = false;
      hideActionBar();
      hideCallBar();
      // 判断自己是否赢了再决定音效
      const me = players.find(p => p.id === userId);
      const iAmLandlord = me && me.isLandlord;
      const landlordWon = data.winnerSide === 'landlord';
      const iWon = (iAmLandlord && landlordWon) || (!iAmLandlord && !landlordWon);
      if (iWon) { Sound.win(); } else { Sound.lose(); }
      showResult(data);
    });

    socket.on('player_left', (data) => {
      showToast(data.name + ' 离开了房间');
    });

    socket.on('error', (data) => {
      showToast(data.msg || '操作失败');
      Sound.error();
    });

    socket.on('disconnect', () => {
      showToast('连接断开，请刷新页面');
    });
  }

  // ===== 游戏状态更新 =====
  function updateGameState(state) {
    if (!state) return;
    gamePhase = state.phase;
    roomInfo.textContent = '房间: ' + (state.roomId ? state.roomId.slice(-6) : '---');
    multiplierDisplay.textContent = (state.multiplier || 1) + '倍';
    isMyTurn = state.isMyTurn;
    myIndex = state.myIndex;
    players = state.players || [];
    currentPlayerIndex = state.currentPlayerIndex;
    lastPlayedCards = state.lastPlayedCards;
    lastPlayedBy = state.lastPlayedBy;

    // 更新手牌
    if (state.players) {
      const me = state.players.find(p => p.id === userId);
      if (me && me.hand) {
        myHand = me.hand;
        selectedCards.clear();
        renderHand();
      }
    }

    // 更新玩家UI
    updateAllPlayerUI(state);

    // 出牌区
    if (state.lastPlayedCards && state.lastPlayedCards.cards) {
      renderPlayedCards({
        playerIndex: state.lastPlayedBy,
        cards: state.lastPlayedCards.cards,
        type: { type: state.lastPlayedCards.type }
      });
    } else if (gamePhase === 'playing') {
      topPlayedZone.innerHTML = '';
    }

    // 底牌
    if (state.bottomCards) {
      const faceUp = gamePhase === 'playing' || gamePhase === 'over';
      showBottomCards(state.bottomCards, faceUp);
    }

    // 操作区域
    if (gamePhase === 'calling' && state.isMyTurn) {
      isCalling = true;
      showCallBar();
    } else if (gamePhase === 'playing' && state.isMyTurn) {
      isMyTurn = true;
      showActionBar();
    } else if (!state.isMyTurn) {
      hideActionBar();
      hideCallBar();
    }

    updateButtons();
  }

  function updateAllPlayerUI(state) {
    if (!state.players || myIndex < 0) return;

    // 计算另外两个玩家的索引
    const rightIdx = (myIndex + 1) % 3; // 右边玩家（下家）
    const leftIdx = (myIndex + 2) % 3;  // 左边玩家（上家）

    const rightPlayer = state.players[rightIdx];
    const leftPlayer = state.players[leftIdx];

    // 上方显示上家（左玩家）
    if (leftPlayer) {
      $('#topName').textContent = leftPlayer.name;
      $('#topAvatar').textContent = leftPlayer.name.charAt(0);
      renderMiniCards($('#topCardsMini'), leftPlayer.cardCount);
      $('#topLandlord').style.display = state.landlordIndex === leftIdx ? 'inline-block' : 'none';

      if (state.currentPlayerIndex === leftIdx && gamePhase === 'playing') {
        $('#topAction').textContent = '思考中...';
      } else if (state.currentPlayerIndex === leftIdx && gamePhase === 'calling') {
        $('#topAction').textContent = '叫地主中...';
      } else {
        $('#topAction').textContent = '';
      }
    }

    // 右侧玩家信息（用另一个位置显示）
    if (rightPlayer) {
      const rightArea = $('#rightPlayerArea');
      if (rightArea) {
        rightArea.querySelector('.player-name').textContent = rightPlayer.name;
        rightArea.querySelector('.avatar-circle').textContent = rightPlayer.name.charAt(0);
        renderMiniCards(rightArea.querySelector('.player-cards-mini'), rightPlayer.cardCount);
        rightArea.querySelector('.landlord-badge').style.display = state.landlordIndex === rightIdx ? 'inline-block' : 'none';
      }
    }

    // 自己
    $('#myName').textContent = myName;
    $('#myLandlord').style.display = state.landlordIndex === myIndex ? 'inline-block' : 'none';
  }

  function renderMiniCards(container, count) {
    if (!container) return;
    container.innerHTML = '';
    const maxShow = Math.min(count, 20);
    for (let i = 0; i < maxShow; i++) {
      const div = document.createElement('div');
      div.className = 'mini-card';
      container.appendChild(div);
    }
  }

  // ===== 手牌渲染（选中牌在上方容器，未选中在下方重叠排列）=====
  function renderHand() {
    const selContainer = $('#selectedCards');
    const handContainer = $('#handCards');
    selContainer.innerHTML = '';
    handContainer.innerHTML = '';

    const totalCount = myHand.length;
    if (totalCount === 0) { updateButtons(); return; }

    const containerWidth = handContainer.clientWidth || (window.innerWidth - 20);
    const isLandscape = window.innerWidth > window.innerHeight;

    // 牌尺寸
    const cardW = isLandscape ? 34 : 40;
    const cardH = isLandscape ? 52 : 62;

    // 分离选中和未选中
    const selectedList = myHand.filter(c => selectedCards.has(c.id));
    const unselectedList = myHand.filter(c => !selectedCards.has(c.id));

    // ===== 上方：选中牌并排显示 =====
    selectedList.forEach(card => {
      const div = createCardElement(card, cardW, cardH, true);
      selContainer.appendChild(div);
    });

    // ===== 下方：未选中牌水平重叠排列 =====
    const count = unselectedList.length;
    if (count > 0) {
      // 每张牌露出的宽度
      const visiblePerCard = Math.min(28, Math.max(20, (containerWidth - 12) / count));
      const totalWidth = cardW + (count - 1) * visiblePerCard;
      const startLeft = Math.max(0, (containerWidth - totalWidth) / 2);

      handContainer.style.height = (cardH + 4) + 'px';
      handContainer.style.position = 'relative';

      unselectedList.forEach((card, i) => {
        const div = createCardElement(card, cardW, cardH, false);
        div.style.left = (startLeft + i * visiblePerCard) + 'px';
        div.style.bottom = '0px';
        div.style.zIndex = i + 1;
        handContainer.appendChild(div);
      });
    } else {
      handContainer.style.height = '0px';
    }

    updateButtons();
  }

  function createCardElement(card, cardW, cardH, isSelected) {
    const div = document.createElement('div');
    const isRedCard = isRed(card);
    const isJoker = card.rank === '大王' || card.rank === '小王';
    div.className = 'hand-card ' + (isRedCard ? 'red' : 'black') + (isJoker ? ' joker' : '');
    if (isSelected) div.classList.add('selected');
    div.style.width = cardW + 'px';
    div.style.height = cardH + 'px';
    div.innerHTML = `<span class="rank">${card.rank}</span><span class="suit">${card.suit}</span>`;
    div.addEventListener('click', () => {
      if (!isMyTurn) return;
      if (selectedCards.has(card.id)) {
        selectedCards.delete(card.id);
      } else {
        selectedCards.add(card.id);
        Sound.selectCard();
      }
      renderHand();
    });
    return div;
  }

  // ===== 出牌区渲染 =====
  function renderPlayedCards(data) {
    topPlayedZone.innerHTML = '';

    if (!data || !data.cards || data.cards.length === 0) {
      const label = document.createElement('span');
      label.className = 'type-label';
      label.textContent = '不出';
      topPlayedZone.appendChild(label);
      return;
    }

    data.cards.forEach(card => {
      const div = document.createElement('div');
      const cardClass = isRed(card) ? 'red' : 'black';
      const isJoker = card.rank === '大王' || card.rank === '小王';
      div.className = 'played-card ' + cardClass + (isJoker ? ' joker' : '');
      div.innerHTML = `
        <span class="rank">${card.rank}</span>
        <span class="suit">${card.suit}</span>
      `;
      topPlayedZone.appendChild(div);
    });

    if (data.type && data.type.type) {
      const label = document.createElement('span');
      label.className = 'type-label';
      label.textContent = getTypeName(data.type.type);
      topPlayedZone.appendChild(label);
    }
  }

  function getTypeName(type) {
    const names = {
      single: '单张', pair: '对子', triple: '三条',
      triple_one: '三带一', triple_two: '三带二',
      straight: '顺子', straight_pair: '连对',
      plane: '飞机', plane_wing: '飞机带翅膀',
      four_two: '四带二', bomb: '炸弹', rocket: '火箭'
    };
    return names[type] || type;
  }

  // ===== 底牌 =====
  function showBottomCards(cards, faceUp) {
    bottomCardsZone.innerHTML = '';

    if (!cards || cards.length === 0) {
      bottomCardsZone.innerHTML = '<span style="font-size:11px;color:#C7C7CC">底牌</span>';
      return;
    }

    cards.forEach(card => {
      const div = document.createElement('div');
      if (faceUp) {
        div.className = 'bottom-card face-up ' + (isRed(card) ? 'red' : 'black');
        div.textContent = card.rank + card.suit;
      } else {
        div.className = 'bottom-card';
        div.textContent = '?';
      }
      bottomCardsZone.appendChild(div);
    });
  }

  // ===== 按钮 =====
  function updateButtons() {
    if (!isMyTurn) {
      btnPlay.disabled = true;
      btnPass.disabled = true;
      btnHint.disabled = true;
      return;
    }

    const selectedArr = myHand.filter(c => selectedCards.has(c.id));
    const hasSelected = selectedArr.length > 0;
    const analysis = hasSelected ? analyzeHand(selectedArr) : null;

    // 如果是自由出牌（上轮是自己出的或者新一轮），有有效牌型就可以出
    const isFreePlay = !lastPlayedCards || !lastPlayedCards.cards || lastPlayedCards.cards.length === 0 || lastPlayedBy === myIndex;
    const canPlay = hasSelected && analysis !== null && (isFreePlay || canBeat(analysis, lastPlayedCards));

    btnPlay.disabled = !canPlay;
    btnPass.disabled = isFreePlay; // 新一轮必须出牌
    btnHint.disabled = false;
  }

  function showActionBar() {
    actionBar.style.display = 'flex';
    callBar.style.display = 'none';
  }

  function hideActionBar() {
    actionBar.style.display = 'none';
  }

  function showCallBar() {
    callBar.style.display = 'flex';
    actionBar.style.display = 'none';
  }

  function hideCallBar() {
    callBar.style.display = 'none';
  }

  // ===== 操作 =====
  function playCards() {
    if (!isMyTurn) return;

    const cards = myHand.filter(c => selectedCards.has(c.id));
    if (cards.length === 0) return;

    socket.emit('play_cards', { cards });
    selectedCards.clear();
    isMyTurn = false;
    hideActionBar();
    renderHand();
  }

  function passCards() {
    if (!isMyTurn) return;

    socket.emit('play_cards', { cards: [] });
    selectedCards.clear();
    isMyTurn = false;
    hideActionBar();
    renderHand();
  }

  function hintCards() {
    if (!isMyTurn || myHand.length === 0) return;
    Sound.click();
    selectedCards.clear();

    const isFreePlay = !lastPlayedCards || !lastPlayedCards.cards || lastPlayedCards.cards.length === 0 || lastPlayedBy === myIndex;

    if (isFreePlay) {
      // 自由出牌：选最小的单张
      if (myHand.length > 0) {
        selectedCards.add(myHand[myHand.length - 1].id); // 手牌已降序排列，最后是最小的
      }
    } else {
      // 需要管牌：找最小能管上的
      const lastAnalysis = lastPlayedCards;
      // 尝试找最小能管上的单张
      for (let i = myHand.length - 1; i >= 0; i--) {
        const testCards = [myHand[i]];
        const testAnalysis = analyzeHand(testCards);
        if (testAnalysis && canBeat(testAnalysis, lastAnalysis)) {
          selectedCards.add(myHand[i].id);
          break;
        }
      }
    }

    renderHand();
  }

  function callLandlord() {
    socket.emit('call_landlord', { call: 'call' });
    isCalling = false;
    hideCallBar();
  }

  function passCall() {
    socket.emit('call_landlord', { call: 'pass' });
    isCalling = false;
    hideCallBar();
    Sound.passCall();
  }

  // ===== 游戏结束 =====
  function showResult(data) {
    const me = players.find(p => p.id === userId);
    const iAmLandlord = me && me.isLandlord;
    const landlordWon = data.winnerSide === 'landlord';
    const iWon = (iAmLandlord && landlordWon) || (!iAmLandlord && !landlordWon);

    resultCard.innerHTML = `
      <div class="result-icon">${iWon ? '🎉' : '😢'}</div>
      <div class="result-title">${iWon ? '你赢了！' : '你输了'}</div>
      <div class="result-detail">
        ${data.winnerSide === 'landlord' ? '👑 地主' : '🌾 农民'}阵营获胜<br>
        获胜者: ${data.winnerName}<br>
        倍数: ${data.multiplier}倍
        ${data.spring ? '<br>🏃 春天!' : ''}
        ${data.antiSpring ? '<br>🔄 反春天!' : ''}
        ${data.bombCount > 0 ? '<br>💣 炸弹 ×' + data.bombCount : ''}
        ${data.rocketCount > 0 ? '<br>🚀 火箭!' : ''}
      </div>
      <button class="btn btn-primary" onclick="location.reload()">再来一局</button>
    `;

    overlay.style.display = 'flex';
  }

  // ===== Toast =====
  let toastTimer = null;
  function showToast(msg) {
    if (toastTimer) clearTimeout(toastTimer);
    toast.textContent = msg;
    toast.style.display = 'block';
    toast.style.animation = 'none';
    toast.offsetHeight;
    toast.style.animation = 'fadeInOut 2s ease';
    toastTimer = setTimeout(() => {
      toast.style.display = 'none';
    }, 2000);
  }

  // ===== 事件绑定 =====
  joinBtn.addEventListener('click', () => {
    const name = nameInput.value.trim();
    if (!name) {
      showToast('请输入昵称');
      return;
    }
    loginScreen.style.display = 'none';
    gameScreen.style.display = 'flex';
    connect();
    socket.emit('join', { name });
  });

  nameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') joinBtn.click();
  });

  btnPlay.addEventListener('click', playCards);
  btnPass.addEventListener('click', passCards);
  btnHint.addEventListener('click', hintCards);
  btnCall.addEventListener('click', callLandlord);
  btnNoCall.addEventListener('click', passCall);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      overlay.style.display = 'none';
      location.reload();
    }
  });

})();
