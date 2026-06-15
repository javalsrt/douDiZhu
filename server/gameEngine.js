// ===== 斗地主完整规则引擎 =====

// 牌面定义
const SUITS = ['♠', '♥', '♦', '♣'];
const RANKS = ['3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A', '2'];
const RANK_VALUES = { '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13, 'A': 14, '2': 15 };
const JOKER_SMALL = { suit: '🃏', rank: '小王', value: 16, id: 'small_joker' };
const JOKER_BIG = { suit: '🃏', rank: '大王', value: 17, id: 'big_joker' };

// 牌型枚举
const HAND_TYPE = {
  SINGLE: 'single',           // 单张
  PAIR: 'pair',               // 对子
  TRIPLE: 'triple',           // 三条
  TRIPLE_ONE: 'triple_one',   // 三带一
  TRIPLE_TWO: 'triple_two',   // 三带二
  STRAIGHT: 'straight',       // 顺子 (至少5张)
  STRAIGHT_PAIR: 'straight_pair', // 连对 (至少3连对)
  PLANE: 'plane',             // 飞机 (至少2连三)
  PLANE_WING: 'plane_wing',   // 飞机带翅膀
  FOUR_TWO: 'four_two',       // 四带二
  BOMB: 'bomb',               // 炸弹
  ROCKET: 'rocket',           // 火箭(王炸)
  INVALID: 'invalid'          // 无效牌型
};

// 创建一副牌
function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({
        suit,
        rank,
        value: RANK_VALUES[rank],
        id: `${suit}${rank}`
      });
    }
  }
  deck.push({ ...JOKER_SMALL });
  deck.push({ ...JOKER_BIG });
  return deck;
}

// 洗牌
function shuffle(deck) {
  const arr = [...deck];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// 发牌 (3人，留3张底牌)
function deal() {
  const deck = shuffle(createDeck());
  const players = [deck.slice(0, 17), deck.slice(17, 34), deck.slice(34, 51)];
  const bottomCards = deck.slice(51, 54);
  // 每人手牌按value降序排序
  players.forEach(p => p.sort((a, b) => b.value - a.value));
  return { players, bottomCards };
}

// 统计牌中每种value的数量
function countByValue(cards) {
  const count = {};
  cards.forEach(c => { count[c.value] = (count[c.value] || 0) + 1; });
  return count;
}

// 按数量分组
function groupByCount(cards) {
  const countMap = countByValue(cards);
  const groups = { 1: [], 2: [], 3: [], 4: [] };
  for (const [val, cnt] of Object.entries(countMap)) {
    const v = parseInt(val);
    groups[cnt].push(v);
  }
  // 每组内部降序
  for (const k of Object.keys(groups)) {
    groups[k].sort((a, b) => b - a);
  }
  return groups;
}

// 获取牌中所有不同的value（降序）
function uniqueValues(cards) {
  return [...new Set(cards.map(c => c.value))].sort((a, b) => b - a);
}

// 判断是否是连续的值
function isConsecutive(values) {
  if (values.length < 2) return false;
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1] - values[i] !== 1) return false;
  }
  // 2和大王小王不能出现在顺子/连对/飞机中
  const maxVal = Math.max(...values);
  return maxVal <= 14; // A=14, 2=15不能参与
}

// 分析牌型
function analyzeHand(cards) {
  const len = cards.length;
  if (len === 0) return { type: HAND_TYPE.INVALID, mainValue: 0 };

  const groups = groupByCount(cards);
  const uniqueVals = uniqueValues(cards);

  // 火箭: 大王+小王
  if (len === 2) {
    const hasBig = cards.some(c => c.value === 17);
    const hasSmall = cards.some(c => c.value === 16);
    if (hasBig && hasSmall) {
      return { type: HAND_TYPE.ROCKET, mainValue: 17 };
    }
  }

  // 炸弹: 4张相同
  if (len === 4 && uniqueVals.length === 1) {
    return { type: HAND_TYPE.BOMB, mainValue: uniqueVals[0] };
  }

  // 单张
  if (len === 1) {
    return { type: HAND_TYPE.SINGLE, mainValue: uniqueVals[0] };
  }

  // 对子
  if (len === 2 && uniqueVals.length === 1) {
    return { type: HAND_TYPE.PAIR, mainValue: uniqueVals[0] };
  }

  // 三条
  if (len === 3 && uniqueVals.length === 1) {
    return { type: HAND_TYPE.TRIPLE, mainValue: uniqueVals[0] };
  }

  // 三带一
  if (len === 4 && groups[3].length === 1 && groups[1].length === 1) {
    return { type: HAND_TYPE.TRIPLE_ONE, mainValue: groups[3][0] };
  }

  // 三带二
  if (len === 5 && groups[3].length === 1 && groups[2].length === 1) {
    return { type: HAND_TYPE.TRIPLE_TWO, mainValue: groups[3][0] };
  }

  // 四带二
  if (len === 6 && groups[4].length === 1) {
    return { type: HAND_TYPE.FOUR_TWO, mainValue: groups[4][0] };
  }
  if (len === 8 && groups[4].length === 1 && groups[2].length === 2) {
    return { type: HAND_TYPE.FOUR_TWO, mainValue: groups[4][0] };
  }

  // 顺子 (>=5张连续单牌)
  if (len >= 5 && groups[2].length === 0 && groups[3].length === 0 && groups[4].length === 0 && uniqueVals.length === len) {
    if (isConsecutive(uniqueVals)) {
      return { type: HAND_TYPE.STRAIGHT, mainValue: uniqueVals[0], length: len };
    }
  }

  // 连对 (>=3连对)
  if (len >= 6 && len % 2 === 0 && groups[1].length === 0 && groups[3].length === 0 && groups[4].length === 0 && groups[2].length === len / 2) {
    const pairVals = groups[2].sort((a, b) => b - a);
    if (isConsecutive(pairVals)) {
      return { type: HAND_TYPE.STRAIGHT_PAIR, mainValue: pairVals[0], length: pairVals.length };
    }
  }

  // 飞机 (不带翅膀)
  if (len >= 6 && len % 3 === 0 && groups[3].length === len / 3 && groups[1].length === 0 && groups[2].length === 0 && groups[4].length === 0) {
    const tripleVals = groups[3].sort((a, b) => b - a);
    if (isConsecutive(tripleVals)) {
      return { type: HAND_TYPE.PLANE, mainValue: tripleVals[0], length: tripleVals.length };
    }
  }

  // 飞机带翅膀 (>=2连三)
  if (groups[3].length >= 2 && groups[4].length === 0) {
    const tripleVals = groups[3].sort((a, b) => b - a);
    if (isConsecutive(tripleVals)) {
      const tripleCount = tripleVals.length;
      const remaining = len - tripleCount * 3;
      // 飞机带单: 剩余牌数 == 三连数量
      if (remaining === tripleCount) {
        return { type: HAND_TYPE.PLANE_WING, mainValue: tripleVals[0], length: tripleCount, wingType: 'single' };
      }
      // 飞机带双: 剩余牌数 == 三连数量 * 2, 且全部是对子
      if (remaining === tripleCount * 2 && groups[1].length === 0 && groups[2].length === tripleCount) {
        return { type: HAND_TYPE.PLANE_WING, mainValue: tripleVals[0], length: tripleCount, wingType: 'pair' };
      }
    }
  }

  return { type: HAND_TYPE.INVALID, mainValue: 0 };
}

// 比较两手牌，返回出牌方是否更大
function canBeat(current, lastPlayed) {
  // 没牌可出（第一手）
  if (!lastPlayed || lastPlayed.cards.length === 0) {
    return current.type !== HAND_TYPE.INVALID;
  }

  const cur = current;
  const last = lastPlayed;

  // 火箭可以管任何牌
  if (cur.type === HAND_TYPE.ROCKET) return true;
  if (last.type === HAND_TYPE.ROCKET) return false;

  // 炸弹可以管非炸弹
  if (cur.type === HAND_TYPE.BOMB && last.type !== HAND_TYPE.BOMB && last.type !== HAND_TYPE.ROCKET) return true;
  if (cur.type === HAND_TYPE.BOMB && last.type === HAND_TYPE.BOMB) return cur.mainValue > last.mainValue;
  if (cur.type !== HAND_TYPE.BOMB && last.type === HAND_TYPE.BOMB) return false;

  // 同类型比较
  if (cur.type !== last.type) return false;

  // 长度类牌型（顺子、连对、飞机等）长度必须一致
  if (cur.length !== undefined && cur.length !== last.length) return false;

  // 飞机带翅膀类型也要一致
  if (cur.type === HAND_TYPE.PLANE_WING && cur.wingType !== last.wingType) return false;

  return cur.mainValue > last.mainValue;
}

// 判断是否是炸弹或火箭
function isBombOrRocket(handType) {
  return handType === HAND_TYPE.BOMB || handType === HAND_TYPE.ROCKET;
}

// 从手牌中移除指定的牌
function removeCards(hand, toRemove) {
  const removeIds = new Set(toRemove.map(c => c.id));
  return hand.filter(c => !removeIds.has(c.id));
}

// 检查选中的牌是否都在手牌中
function cardsInHand(hand, selected) {
  const handIds = new Set(hand.map(c => c.id));
  return selected.every(c => handIds.has(c.id));
}

module.exports = {
  HAND_TYPE,
  createDeck,
  shuffle,
  deal,
  analyzeHand,
  canBeat,
  isBombOrRocket,
  removeCards,
  cardsInHand,
  RANK_VALUES,
  JOKER_SMALL,
  JOKER_BIG
};
