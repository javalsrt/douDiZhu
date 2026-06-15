// ===== 斗地主音效引擎（Web Audio API 合成，无需音频文件）=====

const Sound = (function () {
  'use strict';

  let ctx = null;

  function getCtx() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  // 播放一个简单音调
  function tone(freq, duration, type = 'sine', volume = 0.15) {
    try {
      const c = getCtx();
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(volume, c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(c.currentTime);
      osc.stop(c.currentTime + duration);
    } catch (e) { /* 静默处理 */ }
  }

  // 播放音调序列
  function sequence(notes, type = 'sine', volume = 0.12) {
    try {
      const c = getCtx();
      notes.forEach(([freq, start, dur]) => {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(volume, c.currentTime + start);
        gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + start + dur);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start(c.currentTime + start);
        osc.stop(c.currentTime + start + dur);
      });
    } catch (e) { /* 静默处理 */ }
  }

  // 噪声
  function noise(duration, volume = 0.05) {
    try {
      const c = getCtx();
      const bufferSize = c.sampleRate * duration;
      const buffer = c.createBuffer(1, bufferSize, c.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        data[i] = (Math.random() * 2 - 1) * volume;
      }
      const src = c.createBufferSource();
      src.buffer = buffer;
      const gain = c.createGain();
      gain.gain.setValueAtTime(volume, c.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration);
      src.connect(gain);
      gain.connect(c.destination);
      src.start();
    } catch (e) { /* 静默处理 */ }
  }

  // ===== 具体音效 =====

  // 出牌
  function playCard() {
    tone(800, 0.08, 'sine', 0.1);
    setTimeout(() => tone(600, 0.06, 'sine', 0.08), 50);
  }

  // 选牌
  function selectCard() {
    tone(1200, 0.04, 'sine', 0.06);
  }

  // 不出
  function pass() {
    tone(300, 0.12, 'triangle', 0.08);
  }

  // 叫地主
  function callLandlord() {
    sequence([
      [523, 0, 0.1], [659, 0.1, 0.1], [784, 0.2, 0.2]
    ], 'square', 0.1);
  }

  // 不叫
  function passCall() {
    tone(250, 0.15, 'triangle', 0.08);
  }

  // 炸弹
  function bomb() {
    noise(0.15, 0.12);
    sequence([
      [200, 0, 0.1], [300, 0.08, 0.1], [400, 0.16, 0.15]
    ], 'sawtooth', 0.1);
    setTimeout(() => {
      sequence([
        [500, 0, 0.08], [600, 0.06, 0.08], [800, 0.12, 0.2]
      ], 'square', 0.12);
    }, 200);
  }

  // 火箭
  function rocket() {
    // 上升音效
    const c = getCtx();
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(200, c.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1200, c.currentTime + 0.4);
    gain.gain.setValueAtTime(0.12, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.5);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + 0.5);

    // 爆炸
    setTimeout(() => {
      noise(0.3, 0.15);
      sequence([
        [400, 0, 0.1], [500, 0.1, 0.1], [600, 0.2, 0.2]
      ], 'square', 0.15);
    }, 400);
  }

  // 顺子/连对/飞机（大牌型）
  function bigPlay() {
    sequence([
      [600, 0, 0.06], [700, 0.06, 0.06], [800, 0.12, 0.06],
      [900, 0.18, 0.06], [1000, 0.24, 0.1]
    ], 'square', 0.08);
  }

  // 胜利
  function win() {
    const c = getCtx();
    const notes = [
      [523, 0, 0.15], [659, 0.15, 0.15], [784, 0.3, 0.15],
      [1047, 0.45, 0.3]
    ];
    notes.forEach(([freq, start, dur]) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'square';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.08, c.currentTime + start);
      gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + start + dur);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(c.currentTime + start);
      osc.stop(c.currentTime + start + dur);
    });

    setTimeout(() => {
      sequence([
        [784, 0, 0.1], [1047, 0.1, 0.1], [1318, 0.2, 0.3]
      ], 'square', 0.1);
    }, 800);
  }

  // 失败
  function lose() {
    sequence([
      [400, 0, 0.2], [350, 0.2, 0.2], [300, 0.4, 0.3]
    ], 'triangle', 0.1);
  }

  // 轮到你了
  function yourTurn() {
    sequence([
      [800, 0, 0.06], [1000, 0.08, 0.08]
    ], 'sine', 0.08);
  }

  // 游戏开始
  function gameStart() {
    sequence([
      [523, 0, 0.08], [659, 0.08, 0.08], [784, 0.16, 0.08],
      [659, 0.24, 0.08], [784, 0.32, 0.15]
    ], 'square', 0.1);
  }

  // 发牌
  function dealCard() {
    tone(1000, 0.03, 'sine', 0.04);
  }

  // 按钮点击
  function click() {
    tone(600, 0.04, 'sine', 0.06);
  }

  // 错误/无效操作
  function error() {
    tone(200, 0.1, 'square', 0.08);
    setTimeout(() => tone(150, 0.1, 'square', 0.06), 100);
  }

  return {
    playCard,
    selectCard,
    pass,
    callLandlord,
    passCall,
    bomb,
    rocket,
    bigPlay,
    win,
    lose,
    yourTurn,
    gameStart,
    dealCard,
    click,
    error
  };
})();
