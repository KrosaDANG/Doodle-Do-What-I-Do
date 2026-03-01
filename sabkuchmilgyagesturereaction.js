// ================================================================
//  G E S T U R E   R E A C T I O N   S Y S T E M  — v9
//  burst-reaction.js
//
//  v9 CHANGES vs v8:
//  ─────────────────────────────────────────────────────────────
//  1. HEART RIPPLE — full-screen coverage fix
//     Rings now fill entire canvas with no corner/top voids.
//     fillRect(0,0,W,H) replaces arc-clipped fills everywhere.
//
//  2. STATE LOCK SYSTEM — intro/game never overlap
//     window.systemMode = "intro" | "active" | "game"
//     Game auto-resets when user leaves (userDetected → false).
//     Intro suppressed while game is active.
//
//  3. TYPOGRAPHY — bubbly Google Font for WIN / GAME OVER
//     Lilita One loaded via FontFace API (chunky, bubbly, free).
//     Fallback: Impact.
//
//  4. COUNTDOWN — 3-2-1 → GO! → instruction fade
//     Already in v8; preserved exactly.
//
//  5. BACKGROUND MUSIC + DUCKING + GAMEPLAY BOOST — unchanged.
//
//  ALL gameplay, physics, gestures, win/lose logic: UNTOUCHED.
// ================================================================

// ── Global system state ──────────────────────────────────────────
window.gameMode   = false;
window.gameState  = 'idle';   // "idle" | "countdown" | "playing" | "win" | "lose"
window.systemMode = 'intro';  // "intro" | "active" | "game"

// ── systemMode transition helpers ───────────────────────────────
// Called by gesture.js hooks (toIdle, onAwakening, etc.) OR internal
window._onUserPresence = function(present) {
  if (!present) {
    // User left — force everything back to intro
    if (window.systemMode !== 'intro') {
      window.systemMode = 'intro';
      if (window.gameMode) {
        // Abort active game immediately
        window.gameMode  = false;
        window.gameState = 'idle';
      }
    }
  } else {
    // User arrived — switch intro→active (never jump to game)
    if (window.systemMode === 'intro') {
      window.systemMode = 'active';
    }
  }
};

// Called by _updateBurst in gesture.js when twirl fires
window._onTwirlDetected = function() {
  if (window.systemMode === 'active') {
    window.systemMode = 'game';
    window.gameMode   = true;
  }
};

// Called when game ends (win/lose) — returns to active, not intro
window._onGameEnd = function() {
  window.systemMode = 'active';
  window.gameMode   = false;
  window.gameState  = 'idle';
};

const gestureReactionSystem = (() => {

  // ─────────────────────────────────────────────────────────────
  //  AUDIO — Web Audio API
  // ─────────────────────────────────────────────────────────────
  let _audioCtx   = null;
  let _audioReady = false;

  const _bgMusic = {
    file:      'defaultmusic.mp3',
    buf:       null,
    src:       null,
    gain:      null,
    vol:       0,
    targetVol: 0,
    started:   false,
    loaded:    false,
  };

  const _BG_NORMAL   = 0.50;
  const _BG_DUCKED   = 0.20;
  const _BG_GAMEPLAY = 0.65;
  let   _bgDuckFrames = 0;
  const _BG_DUCK_HOLD = 90;
  let   _bgGameActive = false;

  const _loopTracks = {
    romantic: { file: 'romantic meme.mp3', src: null, gain: null, vol: 0, targetVol: 0 },
    owa:      { file: 'owa.mp3',           src: null, gain: null, vol: 0, targetVol: 0 },
  };

  const _oneShots = {
    wow:      { file: 'wow meme.mp3', buf: null },
    yay:      { file: 'YAY Kids (Celebration) Sound Effect [Free Download].mp3', buf: null },
    gameOver: { file: 'game-over.mp3', buf: null, useSynth: false },
    popUp:    { file: 'floraphonic-ui-pop-up-14-197900.mp3', buf: null },
  };

  let _popUpPlayed    = false;
  let _prevCharAssigned = false;

  function _playGameOverSynth() {
    if (!_audioCtx) return;
    try {
      const freqs = [440, 349, 294, 220];
      freqs.forEach((freq, i) => {
        const osc  = _audioCtx.createOscillator();
        const gain = _audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(freq, _audioCtx.currentTime);
        gain.gain.setValueAtTime(0, _audioCtx.currentTime);
        gain.gain.linearRampToValueAtTime(0.18, _audioCtx.currentTime + 0.02 + i * 0.18);
        gain.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + 0.5 + i * 0.18);
        osc.connect(gain); gain.connect(_audioCtx.destination);
        osc.start(_audioCtx.currentTime + i * 0.18);
        osc.stop(_audioCtx.currentTime + 0.55 + i * 0.18);
      });
    } catch(e) {}
  }

  function _initAudio() {
    if (_audioReady) return;
    // Init audio as soon as user is present — not gated on companionMode.
    // This ensures the bg music buffer is fetched early enough.
    // AudioContext requires a user gesture; gesture.js calls _loadAudioLazy on
    // setup which already primes the gesture, so this is safe.
    const userPresent = (window.systemMode && window.systemMode !== 'intro') ||
                        ((typeof companionMode !== 'undefined') && companionMode);
    if (!userPresent) return;
    try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch(e) { return; }
    _audioReady = true;

    function fetchBuf(file, cb, onFail) {
      fetch(file).then(r => { if (!r.ok) throw 0; return r.arrayBuffer(); })
        .then(ab => _audioCtx.decodeAudioData(ab)).then(buf => cb(buf))
        .catch(() => { if (onFail) onFail(); });
    }

    for (const key in _oneShots) {
      const s = _oneShots[key];
      fetchBuf(
        s.file,
        buf => { s.buf = buf; },
        () => { if (key === 'gameOver') s.useSynth = true; }
      );
    }

    for (const key in _loopTracks) {
      const t = _loopTracks[key];
      fetchBuf(t.file, buf => {
        const g = _audioCtx.createGain();
        g.gain.setValueAtTime(0, _audioCtx.currentTime);
        g.connect(_audioCtx.destination);
        const src = _audioCtx.createBufferSource();
        src.buffer = buf; src.loop = true; src.connect(g); src.start();
        t.src = src; t.gain = g;
      });
    }

    fetchBuf(_bgMusic.file, buf => {
      _bgMusic.buf    = buf;
      _bgMusic.loaded = true;
    });
  }

  function _startBgMusic() {
    if (!_audioReady || !_audioCtx || _bgMusic.started) return;
    if (!_bgMusic.loaded || !_bgMusic.buf) return;
    try {
      const g = _audioCtx.createGain();
      g.gain.setValueAtTime(0, _audioCtx.currentTime);
      g.connect(_audioCtx.destination);
      const src = _audioCtx.createBufferSource();
      src.buffer = _bgMusic.buf;
      src.loop   = true;
      src.connect(g);
      src.start();
      _bgMusic.src     = src;
      _bgMusic.gain    = g;
      _bgMusic.started = true;
      _bgMusic.targetVol = _BG_NORMAL;
    } catch(e) {}
  }

  function _tickAudio() {
    if (!_audioReady || !_audioCtx) return;
    const now = _audioCtx.currentTime;

    for (const key in _loopTracks) {
      const t = _loopTracks[key]; if (!t.gain) continue;
      t.vol += (t.targetVol - t.vol) * 0.08;
      t.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, t.vol)), now, 0.05);
    }

    // Start bg music as soon as it's loaded and the user has been detected.
    // We no longer gate on window.introComplete (it is never set externally).
    // We start as soon as systemMode moves past 'intro' OR companionMode is true.
    if (!_bgMusic.started && _bgMusic.loaded) {
      const userPresent = (window.systemMode !== 'intro') ||
                          ((typeof companionMode !== 'undefined') && companionMode);
      if (userPresent) _startBgMusic();
    }

    // Pop-up sound: fires ONCE when character selection screen appears.
    // Triggers on either window.characterAssigned OR popupMode becoming true.
    const charNow = ((typeof window.characterAssigned !== 'undefined') && window.characterAssigned) ||
                    ((typeof popupMode !== 'undefined') && popupMode);
    if (charNow && !_prevCharAssigned && !_popUpPlayed) {
      _playOnce('popUp');
      _popUpPlayed = true;
    }
    // Reset so pop-up can fire again next time user re-enters
    if (!charNow && _prevCharAssigned) {
      _popUpPlayed = false;
    }
    _prevCharAssigned = charNow;

    if (_bgDuckFrames > 0) {
      _bgDuckFrames--;
      if (_bgDuckFrames === 0) {
        _bgMusic.targetVol = _bgGameActive ? _BG_GAMEPLAY : _BG_NORMAL;
      }
    }

    if (_bgMusic.gain) {
      _bgMusic.vol += (_bgMusic.targetVol - _bgMusic.vol) * 0.06;
      _bgMusic.gain.gain.setTargetAtTime(
        Math.max(0, Math.min(1, _bgMusic.vol)), now, 0.08
      );
    }
  }

  function _duckBg() {
    if (!_bgMusic.gain) return;
    _bgDuckFrames      = _BG_DUCK_HOLD;
    _bgMusic.targetVol = _BG_DUCKED;
  }

  function _playOnce(key) {
    if (!_audioReady || !_audioCtx) return;
    const s = _oneShots[key]; if (!s) return;
    if (key === 'gameOver' && s.useSynth) { _duckBg(); _playGameOverSynth(); return; }
    if (!s.buf) return;
    try {
      const src = _audioCtx.createBufferSource(), g = _audioCtx.createGain();
      src.buffer = s.buf; src.loop = false;
      g.gain.setValueAtTime(0.88, _audioCtx.currentTime);
      src.connect(g); g.connect(_audioCtx.destination); src.start();
      _duckBg();
    } catch(e) {}
  }

  // ─────────────────────────────────────────────────────────────
  //  GESTURE INTENSITIES + COOLDOWNS
  // ─────────────────────────────────────────────────────────────
  const G = { heart: 0, rock: 0, surprise: 0, confetti: 0 };
  let _active = null;
  let _surpCool = 0, _confCool = 0;
  let _wasSurprise = false, _wasConfetti = false;
  let _palmHoldCount = 0;
  const _PALM_HOLD_NEEDED = 6;

  // ─────────────────────────────────────────────────────────────
  //  HELPERS
  // ─────────────────────────────────────────────────────────────
  function _dist2(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }
  function _W() { return (typeof width  !== 'undefined') ? width  : 800; }
  function _H() { return (typeof height !== 'undefined') ? height : 600; }
  function _lp(a, b, t) { return a + (b - a) * t; }

  function _getRawHands() {
    const hands = window.mpHands;
    if (!hands || !hands.length) return { left: null, right: null };
    let left = null, right = null;
    for (const h of hands) {
      if (!h.landmarks) continue;
      if (h.handedness === 'Left')  left  = h.landmarks;
      if (h.handedness === 'Right') right = h.landmarks;
    }
    return { left, right };
  }

  // ─────────────────────────────────────────────────────────────
  //  DETECTION
  // ─────────────────────────────────────────────────────────────
  function _detectHeart(raw) {
    if (!raw.left || !raw.right) return 0;
    const L = raw.left, R = raw.right;
    const indexDist = _dist2(L[8], R[8]);
    if (indexDist > 0.22) return 0;
    const tipMeet = Math.min(
      _dist2(L[4], R[4]),
      Math.min(_dist2(L[4], R[8]), _dist2(R[4], L[8]))
    );
    if (tipMeet > 0.28) return 0;
    if ((L[8].y + R[8].y) * 0.5 > (L[4].y + R[4].y) * 0.5 + 0.04) return 0;
    const pd = (typeof POSE_DATA !== 'undefined') ? POSE_DATA : null;
    if (pd && pd.present && pd.smNoseY !== null) {
      if ((L[0].y + R[0].y) * 0.5 > pd.smNoseY / _H() + 0.15) return 0;
    }
    return Math.max(0, 1 - indexDist / 0.22) * Math.max(0, 1 - tipMeet / 0.28);
  }

  function _isRockHand(lm) {
    if (!lm) return false;
    const w = lm[0], D = a => _dist2(lm[a], w);
    return D(8) > 0.20 && D(20) > 0.18 &&
           _dist2(lm[12], lm[9]) < 0.12 &&
           _dist2(lm[16], lm[13]) < 0.12;
  }
  function _detectRock(raw) {
    return (_isRockHand(raw.left) && _isRockHand(raw.right)) ? 1 : 0;
  }

  function _detectSurprise() {
    const ce = (typeof COMP_EXPR !== 'undefined') ? COMP_EXPR : null;
    if (!ce) return 0;
    if (ce.get() === 'surprise') return Math.min(1, ce.blendT * 1.8);
    const e = (typeof EXPR !== 'undefined') ? EXPR : null;
    if (e && e.eyeOpen > 0.55 && e.mouthOpen > 0.42 && e.browHeight > 0.38) return 0.50;
    return 0;
  }

  function _isOpenPalmFacing(lm) {
    if (!lm) return false;
    const w = lm[0];
    for (const [tip, mcp] of [[8,5],[12,9],[16,13],[20,17]])
      if (lm[tip].y > lm[mcp].y - 0.025) return false;
    const avgZ = (lm[8].z + lm[12].z + lm[16].z + lm[20].z) * 0.25;
    if (avgZ > w.z + 0.015) return false;
    const pcx = (lm[5].x + lm[9].x + lm[13].x + lm[17].x) * 0.25;
    const pcy = (lm[5].y + lm[9].y + lm[13].y + lm[17].y) * 0.25;
    if (Math.hypot(lm[4].x - pcx, lm[4].y - pcy) < 0.055) return false;
    return true;
  }

  function _detectConfetti(raw) {
    if (!raw.left || !raw.right) {
      _palmHoldCount = Math.max(0, _palmHoldCount - 2); return 0;
    }
    if (_isOpenPalmFacing(raw.left) && _isOpenPalmFacing(raw.right))
      _palmHoldCount = Math.min(_palmHoldCount + 1, _PALM_HOLD_NEEDED + 10);
    else
      _palmHoldCount = Math.max(0, _palmHoldCount - 3);
    return _palmHoldCount >= _PALM_HOLD_NEEDED ? 1 : 0;
  }

  // ─────────────────────────────────────────────────────────────
  //  HEART — phase + cinematic polish state
  // ─────────────────────────────────────────────────────────────
  let _heartPhase = 0;
  const _heartParticles = [];
  const _HEART_PART_MAX = 18;
  let   _heartPartTimer = 0;

  function _mkHeartParticle(W, H) {
    return {
      x: W * 0.20 + Math.random() * W * 0.60,
      y: H * 0.55 + Math.random() * H * 0.30,
      vy: -(0.4 + Math.random() * 0.7),
      vx: (Math.random() - 0.5) * 0.35,
      size: 7 + Math.random() * 13,
      life: 1.0,
      wave: Math.random() * Math.PI * 2,
    };
  }

  let _shakeX = 0, _shakeY = 0;
  let _flashAlpha = 0;
  let _prevSurpriseActive = false;

  function _drawHeartShape(dc, cx, cy, r) {
    const top   = cy - r * 0.50;
    const mid   = cy - r * 0.05;
    const bot   = cy + r * 0.50;
    const halfW = r * 0.50;
    dc.beginPath();
    dc.moveTo(cx, mid);
    dc.bezierCurveTo(cx - halfW*0.18, top, cx - halfW, top, cx - halfW, cy - r*0.05);
    dc.bezierCurveTo(cx - halfW, cy + r*0.22, cx - halfW*0.22, cy + r*0.35, cx, bot);
    dc.bezierCurveTo(cx + halfW*0.22, cy + r*0.35, cx + halfW, cy + r*0.22, cx + halfW, cy - r*0.05);
    dc.bezierCurveTo(cx + halfW, top, cx + halfW*0.18, top, cx, mid);
    dc.closePath();
  }

  // ─────────────────────────────────────────────────────────────
  //  FIRE — blob pool
  // ─────────────────────────────────────────────────────────────
  const _FIRE_N = 44;
  const _fire   = [];
  let   _fireOk = false;
  let   _heatT  = 0;

  function _newFireBlob(top) {
    return { x: Math.random()*_W(), y: top?0:_H(), bW: 80+Math.random()*240,
             cH: 0, spd: (top?3:9)+Math.random()*16, life: Math.random()*0.8,
             seed: Math.random()*100, top: !!top };
  }
  function _resetFireBlob(b) {
    b.x = Math.random()*_W(); b.y = b.top?0:_H(); b.cH = 0; b.life = 0;
    b.spd = (b.top?3:9)+Math.random()*16; b.seed = Math.random()*100;
  }
  function _initFire() {
    if (_fireOk) return;
    for (let i = 0; i < _FIRE_N; i++) _fire.push(_newFireBlob(i < _FIRE_N*0.22));
    _fireOk = true;
  }

  // ─────────────────────────────────────────────────────────────
  //  SURPRISE — state machine
  // ─────────────────────────────────────────────────────────────
  let _surpState = 'off', _surpScale = 0, _surpAlpha = 0;
  let _surpHoldFrames = 0;
  const _SURP_HOLD_MAX = 80;
  let _surpTargetScale = 0;
  const _surpMini = [];

  function _randomiseMini() {
    _surpMini.length = 0;
    for (let i = 0; i < 5; i++) {
      _surpMini.push({ ang: Math.random()*Math.PI*2, d: 0.28+Math.random()*0.22,
                       rot: Math.random()*Math.PI*2, spikes: 8+Math.floor(Math.random()*6) });
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  CONFETTI — particle system
  // ─────────────────────────────────────────────────────────────
  const _confetti  = [];
  const _CONF_MAX  = 260;
  const _CONF_COLS = [
    '#FF3B5C','#FF9F1C','#FFBF00','#2EC4B6','#3A86FF',
    '#8338EC','#FB5607','#FF006E','#06D6A0','#FFD166','#A8DADC',
  ];

  function _mkPiece(x, y, fromTop) {
    const ang  = fromTop ? Math.PI*0.5+(Math.random()-0.5)*Math.PI*0.7 : Math.random()*Math.PI*2;
    const spd  = fromTop ? 2.5+Math.random()*4.5 : 5+Math.random()*13;
    const type = Math.random()<0.14?'circle':Math.random()<0.22?'ribbon':'rect';
    const layer = Math.random()<0.30?'back':'front';
    return {
      x, y,
      vx: Math.cos(ang)*spd,
      vy: Math.sin(ang)*spd - (fromTop?0:2+Math.random()*7),
      vr: (Math.random()-0.5)*0.36,
      rot: Math.random()*Math.PI*2,
      w:  type==='ribbon'?4+Math.random()*5 :7+Math.random()*13,
      h:  type==='ribbon'?18+Math.random()*24:5+Math.random()*10,
      col: _CONF_COLS[Math.floor(Math.random()*_CONF_COLS.length)],
      life: 1.0, type, layer,
      wave: Math.random()*Math.PI*2,
    };
  }

  // ─────────────────────────────────────────────────────────────
  //  BUNTING
  // ─────────────────────────────────────────────────────────────
  const _BUNTING_COLS = ['#FF6B6B','#FFD93D','#6BCB77','#4D96FF','#FF9248',
                          '#C77DFF','#FFA0AC','#90E0EF','#FFBF47'];
  const _BUNTING_FLAGS = 20;
  let _buntingAlpha = 0;
  let _buntingSwayT = 0;

  // ─────────────────────────────────────────────────────────────
  //  HALFTONE helper
  // ─────────────────────────────────────────────────────────────
  function _drawHalftone(dc, cx, cy, radius, alpha) {
    if (alpha < 0.005) return;
    const spacing = 26, rows = Math.ceil(radius*2/spacing)+1;
    dc.globalAlpha = 1;
    for (let row = -rows; row <= rows; row++) {
      for (let col = -rows; col <= rows; col++) {
        const px = col*spacing + (row%2===0?spacing*0.5:0);
        const py = row*spacing*0.87;
        const d  = Math.sqrt(px*px+py*py);
        if (d > radius*1.05) continue;
        const fade = Math.max(0,(d-radius*0.5)/(radius*0.55));
        dc.fillStyle = `rgba(30,5,0,${(alpha*(0.3+fade*0.5)).toFixed(3)})`;
        dc.beginPath(); dc.arc(cx+px,cy+py,1.5+fade*5.5,0,Math.PI*2); dc.fill();
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  BURST SYSTEM
  // ─────────────────────────────────────────────────────────────
  const _BURST_CHAR_COLS = {
    blue:   ['#4A90D9','#2C5F8A','#7BB8E8','#1A3A5C','#A8D4F5'],
    cyan:   ['#2ECFCF','#1A8A8A','#6BE5E5','#0D5252','#A0F0F0'],
    green:  ['#4CAF50','#2E7D32','#81C784','#1B5E20','#C8E6C9'],
    pink:   ['#F06292','#AD1457','#F48FB1','#880E4F','#FCE4EC'],
    purple: ['#9C27B0','#6A1B9A','#CE93D8','#38006B','#F3E5F5'],
    red:    ['#F44336','#B71C1C','#EF9A9A','#7F0000','#FFCDD2'],
  };

  const _burst = [];
  let _burstActive = false;
  let _burstCX = 0, _burstCY = 0;
  let _burstR  = 120;
  let _burstCharId = 'blue';

  let _shockRadius = 0, _shockAlpha = 0, _shockActive = false;
  let _burstParticleIdCounter = 0;

  function _mkBurstParticle(cx, cy, charId, radius) {
    const ang  = Math.random()*Math.PI*2;
    const spd  = 6+Math.random()*16;
    const cols = _BURST_CHAR_COLS[charId] || _BURST_CHAR_COLS.blue;
    const col  = cols[Math.floor(Math.random()*cols.length)];
    const sz   = 8+Math.random()*(radius*0.22);
    const spawnD = Math.random()*radius*0.6;
    return {
      id:       _burstParticleIdCounter++,
      isPopped: false,
      x: cx+Math.cos(ang)*spawnD, y: cy+Math.sin(ang)*spawnD,
      vx: Math.cos(ang)*spd, vy: Math.sin(ang)*spd-3-Math.random()*4,
      vr: (Math.random()-0.5)*0.25, rot: Math.random()*Math.PI*2,
      col, sz, life: 1.0,
      phase: 'out',
      wave: Math.random()*Math.PI*2,
      delay: Math.random()*0.22,
    };
  }

  function triggerBurst(cx, cy, charId, radius) {
    // ── STATE LOCK: only fire if systemMode allows ────────────
    if (window.systemMode !== 'active' && window.systemMode !== 'game') return;

    _burstCX = cx; _burstCY = cy; _burstCharId = charId; _burstR = radius;
    _burstActive = true; _burst.length = 0;
    const N = 55 + Math.floor(radius*0.25);
    for (let i = 0; i < N; i++) _burst.push(_mkBurstParticle(cx, cy, charId, radius));
    _shockRadius = 0; _shockAlpha = 1.0; _shockActive = true;

    _gameOnBurst(cx, cy, charId, radius, N);
  }

  function triggerRemat() {
    if (window.gameMode) return;
    for (const p of _burst) p.phase = 'in';
  }

  function _tickBurst() {
    if (window.gameMode) { _tickGame(); return; }
    if (!_burstActive || _burst.length === 0) return;

    const heroX = window.burstX || _burstCX;
    const heroY = window.burstY || _burstCY;

    if (_shockActive) {
      _shockRadius += 22; _shockAlpha *= 0.84;
      if (_shockAlpha < 0.01) { _shockActive = false; _shockAlpha = 0; }
    }

    for (let i = _burst.length-1; i >= 0; i--) {
      const p = _burst[i];
      if (p.phase === 'out') {
        p.vx += (Math.random()-0.5)*0.4; p.vy += 0.28;
        p.vx *= 0.97; p.x += p.vx; p.y += p.vy;
        p.rot += p.vr; p.wave += 0.04;
        p.life -= 0.004; if (p.life < 0) p.life = 0;
      } else {
        if (p.delay > 0) { p.delay -= 0.018; continue; }
        const dx = heroX-p.x, dy = heroY-p.y;
        const dist = Math.sqrt(dx*dx+dy*dy);
        if (dist < 8) { _burst.splice(i,1); continue; }
        const pullStr = 0.18+(1-Math.min(dist/400,1))*0.35;
        p.vx = _lp(p.vx,(dx/dist)*dist*pullStr*0.12,0.25);
        p.vy = _lp(p.vy,(dy/dist)*dist*pullStr*0.12,0.25);
        p.x += p.vx; p.y += p.vy;
        p.rot += p.vr*0.5; p.wave += 0.06;
        p.life = Math.min(1.0, p.life+0.012);
      }
    }
    if (_burst.length === 0) _burstActive = false;
  }

  // ─────────────────────────────────────────────────────────────
  //  GAME LAYER
  // ─────────────────────────────────────────────────────────────
  const _GAME_TIMER_SECS  = 15;
  const _GAME_TOUCH_THRESH = 55;
  const _GAME_GROW_FACTOR  = 1.6;

  let _gameTimeStart    = 0;
  let _gameSecsLeft     = _GAME_TIMER_SECS;
  let _gameEndTimer     = 0;
  let _gameInitialCount = 0;

  let _gameTotalCount = 0;
  let _gamePopped     = 0;

  // Countdown
  const _CD_STEP_MS     = 900;
  const _CD_STEPS       = 3;
  let   _cdNumber       = 3;
  let   _cdStart        = 0;
  let   _cdInstrAlpha   = 0;
  let   _cdGoAlpha      = 0;

  // ── Bubbly display font ───────────────────────────────────────
  // Lilita One — chunky, bubbly, free Google Font
  let _bubbleFont = 'Impact, sans-serif';
  (function _loadBubbleFont() {
    try {
      const ff = new FontFace(
        'LilitaOne',
        'url(https://fonts.gstatic.com/s/lilitaone/v15/i7dPIFZ9Zz-WBtRtedDbYEF8RXi4EwQ.woff2)'
      );
      ff.load().then(face => {
        document.fonts.add(face);
        _bubbleFont = '"LilitaOne", Impact, sans-serif';
      }).catch(() => {
        // Try Boogaloo as backup
        try {
          const ff2 = new FontFace(
            'BubbleFallback',
            'url(https://fonts.gstatic.com/s/boogaloo/v34/kmK-Zq45GAvOdnaW6x1F_SrQo_1K.woff2)'
          );
          ff2.load().then(face2 => {
            document.fonts.add(face2);
            _bubbleFont = '"BubbleFallback", Impact, sans-serif';
          }).catch(() => {});
        } catch(e) {}
      });
    } catch(e) {}
  })();

  const _popFX = [];

  function _mkPopFX(x, y, col) {
    const sparks = [];
    for (let i = 0; i < 10; i++) {
      const ang = Math.random()*Math.PI*2;
      const spd = 3+Math.random()*5;
      sparks.push({ vx: Math.cos(ang)*spd, vy: Math.sin(ang)*spd, life: 1.0 });
    }
    _popFX.push({ x, y, col, sparks, life: 1.0 });
  }

  function _spawnWinConfetti() {
    const W = _W(), H = _H();
    for (let k = 0; k < 120; k++) {
      _confetti.push(_mkPiece(
        Math.random()*W,
        -20 - Math.random()*80,
        true
      ));
    }
  }

  function _gameOnBurst(cx, cy, charId, radius, particleCount) {
    const W = _W(), H = _H();

    window.gameMode   = true;
    window.gameState  = 'countdown';
    window.systemMode = 'game';
    window.burstState = 'burst';

    _gameEndTimer    = 0;
    _gameInitialCount = particleCount;
    _popFX.length    = 0;

    _cdNumber     = 3;
    _cdStart      = performance.now();
    _cdInstrAlpha = 0;
    _cdGoAlpha    = 0;

    _gameTimeStart = 0;
    _gameSecsLeft  = _GAME_TIMER_SECS;

    _shockActive = false;
    _shockAlpha  = 0;

    _gameTotalCount = _burst.length;
    _gamePopped     = 0;

    for (const p of _burst) {
      p.id       = p.id !== undefined ? p.id : _burstParticleIdCounter++;
      p.isPopped = false;
      p.x        = 50 + Math.random() * (W - 100);
      p.y        = 50 + Math.random() * (H - 100);
      p.gameSz   = p.sz * _GAME_GROW_FACTOR;
      p.vx       = (Math.random() - 0.5) * 4;
      p.vy       = (Math.random() - 0.5) * 4;
      p.phase    = 'game';
      p.wobble   = Math.random() * Math.PI * 2;
      p.wobbleSpd = 0.025 + Math.random() * 0.02;
      p.life     = 1.0;
    }

    _bgGameActive      = true;
    _bgMusic.targetVol = _BG_GAMEPLAY;
    _bgDuckFrames      = 0;
  }

  function _getHandTips() {
    const pd = (typeof POSE_DATA !== 'undefined') ? POSE_DATA : null;
    const tips = [];
    if (pd && pd.present) {
      if (pd.smLWriX !== null) tips.push({ x: pd.smLWriX, y: pd.smLWriY });
      if (pd.smRWriX !== null) tips.push({ x: pd.smRWriX, y: pd.smRWriY });
    }
    return tips;
  }

  function _tickGame() {
    const W = _W(), H = _H();
    const now = performance.now();

    // ── CRITICAL: If user left during game, abort ─────────────
    if (window.systemMode === 'intro' && window.gameMode) {
      _endGame();
      return;
    }

    window.burstState = 'burst';

    for (let i = _popFX.length - 1; i >= 0; i--) {
      const fx = _popFX[i];
      fx.life -= 0.04;
      for (const s of fx.sparks) {
        s.vx *= 0.92; s.vy += 0.18; s.vy *= 0.95;
        s.life -= 0.05;
      }
      if (fx.life <= 0) { _popFX.splice(i, 1); continue; }
    }

    if (window.gameState === 'win' || window.gameState === 'lose') {
      if (++_gameEndTimer > 120) {
        _endGame();
      }
      return;
    }

    if (window.gameState === 'countdown') {
      const elapsed = now - _cdStart;
      const step    = Math.floor(elapsed / _CD_STEP_MS);

      _cdNumber = Math.max(0, _CD_STEPS - step);
      _cdInstrAlpha = Math.min(1, elapsed / 400);

      if (step >= _CD_STEPS) {
        _cdGoAlpha = Math.max(0, 1 - (elapsed - _CD_STEPS * _CD_STEP_MS) / 400);
      }

      if (elapsed >= (_CD_STEPS + 0.45) * _CD_STEP_MS) {
        window.gameState   = 'playing';
        _gameTimeStart     = performance.now();
        _gameSecsLeft      = _GAME_TIMER_SECS;
      }

      for (const p of _burst) {
        if (p.phase !== 'game' || p.isPopped) continue;
        p.wobble += p.wobbleSpd;
        p.vx += Math.sin(p.wobble * 1.3) * 0.06;
        p.vy += Math.sin(p.wobble * 0.9 + 1.0) * 0.04;
        const spd = Math.sqrt(p.vx*p.vx + p.vy*p.vy);
        if (spd > 5) { p.vx *= 5/spd; p.vy *= 5/spd; }
        p.x += p.vx; p.y += p.vy; p.rot += p.vr * 0.3;
        const margin = 50;
        if (p.x < margin)     { p.x = margin;     p.vx =  Math.abs(p.vx)*0.85; }
        if (p.x > W - margin) { p.x = W - margin; p.vx = -Math.abs(p.vx)*0.85; }
        if (p.y < margin)     { p.y = margin;      p.vy =  Math.abs(p.vy)*0.85; }
        if (p.y > H - margin) { p.y = H - margin;  p.vy = -Math.abs(p.vy)*0.85; }
      }
      return;
    }

    if (window.gameState !== 'playing') return;

    if (_cdInstrAlpha > 0) {
      const playedMs = now - _gameTimeStart;
      _cdInstrAlpha = Math.max(0, 1 - (playedMs - 200) / 2000);
    }

    const elapsed = (now - _gameTimeStart) / 1000;
    _gameSecsLeft = Math.max(0, _GAME_TIMER_SECS - elapsed);

    for (const p of _burst) {
      if (p.phase !== 'game' || p.isPopped) continue;
      p.wobble += p.wobbleSpd;
      p.vx += Math.sin(p.wobble * 1.3) * 0.06;
      p.vy += Math.sin(p.wobble * 0.9 + 1.0) * 0.04;
      const spd = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
      if (spd > 5) { p.vx *= 5 / spd; p.vy *= 5 / spd; }
      p.x += p.vx; p.y += p.vy; p.rot += p.vr * 0.3;
      const margin = 50;
      if (p.x < margin)     { p.x = margin;     p.vx =  Math.abs(p.vx) * 0.85; }
      if (p.x > W - margin) { p.x = W - margin; p.vx = -Math.abs(p.vx) * 0.85; }
      if (p.y < margin)     { p.y = margin;      p.vy =  Math.abs(p.vy) * 0.85; }
      if (p.y > H - margin) { p.y = H - margin;  p.vy = -Math.abs(p.vy) * 0.85; }
    }

    const tips = _getHandTips();
    if (tips.length > 0) {
      for (const p of _burst) {
        if (p.phase !== 'game' || p.isPopped) continue;
        for (const tip of tips) {
          const dx = tip.x - p.x, dy = tip.y - p.y;
          const d  = Math.sqrt(dx * dx + dy * dy);
          if (d < _GAME_TOUCH_THRESH + (p.gameSz || p.sz) * 0.5) {
            p.isPopped = true;
            _mkPopFX(p.x, p.y, p.col);
            _gamePopped++;
            break;
          }
        }
      }
    }

    if (_gamePopped >= _gameTotalCount && _gameTotalCount > 0) {
      window.gameState = 'win';
      _gameEndTimer    = 0;
      _playOnce('yay');
      _spawnWinConfetti();
      return;
    }

    if (_gameSecsLeft <= 0 && _gamePopped < _gameTotalCount) {
      window.gameState = 'lose';
      _gameEndTimer    = 0;
      _playOnce('gameOver');
    }
  }

  function _endGame() {
    // Return to active (NOT intro) — game ended naturally
    window.gameMode  = false;
    window.gameState = 'idle';
    _popFX.length    = 0;
    _cdInstrAlpha    = 0;

    // Only switch to 'active' if user is still present
    // If user left, systemMode was already set to 'intro' by _onUserPresence
    if (window.systemMode === 'game') {
      window.systemMode = 'active';
    }

    _bgGameActive      = false;
    _bgMusic.targetVol = _BG_NORMAL;
    _bgDuckFrames      = 0;

    for (let i = _burst.length - 1; i >= 0; i--) {
      const p = _burst[i];
      if (p.phase !== 'game') continue;
      if (p.isPopped) {
        _burst.splice(i, 1);
      } else {
        p.phase    = 'in';
        p.isPopped = false;
        p.life     = 1.0;
        p.delay    = 0;
      }
    }

    window.burstState = 'remat';
    for (const p of _burst) {
      if (p.phase === 'out') { p.phase = 'in'; p.delay = 0; }
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  MAIN DETECT + STATE UPDATE
  // ─────────────────────────────────────────────────────────────
  function _detect() {
    // ── GAME MODE: suppress all gesture reactions ─────────────
    if (window.gameMode) {
      G.heart = 0; G.rock = 0; G.surprise = 0; G.confetti = 0;
      _active  = null;
      _surpState = 'off'; _surpScale = 0; _surpAlpha = 0; _surpTargetScale = 0;
      _shakeX = 0; _shakeY = 0; _flashAlpha = 0;
      _buntingAlpha = 0;
      if (_audioReady) {
        for (const k in _loopTracks) _loopTracks[k].targetVol = 0;
      }
      return;
    }

    // ── INTRO MODE: suppress gesture reactions (no user present) ─
    if (window.systemMode === 'intro') {
      G.heart = 0; G.rock = 0; G.surprise = 0; G.confetti = 0;
      _active = null;
      _surpState = 'off'; _surpScale = 0; _surpAlpha = 0; _surpTargetScale = 0;
      _palmHoldCount = 0; _wasSurprise = false; _wasConfetti = false;
      for (const k in _loopTracks) _loopTracks[k].targetVol = 0;
      _buntingAlpha = 0;
      return;
    }

    const inM = (typeof companionMode !== 'undefined') && companionMode;
    if (!inM) {
      G.heart = 0; G.rock = 0; G.surprise = 0; G.confetti = 0;
      _active = null;
      _surpState = 'off'; _surpScale = 0; _surpAlpha = 0; _surpTargetScale = 0;
      _palmHoldCount = 0; _wasSurprise = false; _wasConfetti = false;
      for (const k in _loopTracks) _loopTracks[k].targetVol = 0;
      _buntingAlpha = 0;
      return;
    }

    const raw = _getRawHands();
    G.heart    = _lp(G.heart,    _detectHeart(raw),    0.12);
    G.rock     = _lp(G.rock,     _detectRock(raw),     0.10);
    G.surprise = _lp(G.surprise, _detectSurprise(),    0.14);
    const confScore = _detectConfetti(raw);
    if (confScore > G.confetti) G.confetti = Math.min(confScore, G.confetti+0.12);
    else                        G.confetti = _lp(G.confetti, 0, 0.10);

    if      (G.heart    > 0.35) _active = 'heart';
    else if (G.rock     > 0.35) _active = 'rock';
    else if (G.surprise > 0.35) _active = 'surprise';
    else if (G.confetti > 0.70) _active = 'confetti';
    else                        _active = null;

    if (_audioReady) {
      _loopTracks.romantic.targetVol = (_active === 'heart') ? 0.75 : 0;
      _loopTracks.owa.targetVol      = (_active === 'rock')  ? 0.70 : 0;
    }

    const isSurpriseNow = (_active === 'surprise');
    if (isSurpriseNow && !_wasSurprise && _surpCool === 0) { _playOnce('wow'); _surpCool = 90; }
    _wasSurprise = isSurpriseNow;
    if (_surpCool > 0) _surpCool--;

    const isConfettiNow = (_active === 'confetti');
    if (isConfettiNow && !_wasConfetti && _confCool === 0) { _playOnce('yay'); _confCool = 120; }
    _wasConfetti = isConfettiNow;
    if (_confCool > 0) _confCool--;

    if (_active === 'surprise') {
      if (_surpState === 'off' || _surpState === 'out') { _surpState = 'in'; _surpHoldFrames = 0; _randomiseMini(); }
      if (_surpState === 'in') {
        _surpTargetScale = _lp(_surpTargetScale, 1.12, 0.22);
        _surpScale = _lp(_surpScale, _surpTargetScale, 0.28);
        _surpAlpha += (1.0 - _surpAlpha)*0.28;
        if (_surpScale > 0.98) { _surpState = 'hold'; _surpTargetScale = 1.0; }
      }
      if (_surpState === 'hold') {
        _surpScale = _lp(_surpScale, 1.0, 0.06);
        _surpAlpha = _lp(_surpAlpha, 1.0, 0.08);
        if (++_surpHoldFrames > _SURP_HOLD_MAX) _surpState = 'out';
      }
    } else {
      if (_surpState === 'in' || _surpState === 'hold') _surpState = 'out';
      if (_surpState === 'out') {
        _surpScale = _lp(_surpScale, 0, 0.07); _surpAlpha = _lp(_surpAlpha, 0, 0.055);
        if (_surpAlpha < 0.008) { _surpState = 'off'; _surpScale = 0; _surpAlpha = 0; _surpTargetScale = 0; }
      }
    }

    if (G.heart > 0.05) _heartPhase = (_heartPhase + 0.006) % 1.0;
    if (_active === 'heart') {
      if (--_heartPartTimer <= 0 && _heartParticles.length < _HEART_PART_MAX) {
        _heartParticles.push(_mkHeartParticle(_W(), _H()));
        _heartPartTimer = 18 + Math.floor(Math.random()*18);
      }
    }

    if (_active === 'rock' && G.rock > 0.4) {
      _shakeX = (Math.random()-0.5)*G.rock*2.2;
      _shakeY = (Math.random()-0.5)*G.rock*2.2;
    } else { _shakeX *= 0.75; _shakeY *= 0.75; }

    const isSurpriseActive = (_active === 'surprise');
    if (isSurpriseActive && !_prevSurpriseActive) _flashAlpha = 1.0;
    _prevSurpriseActive = isSurpriseActive;
    _flashAlpha *= 0.55;
    if (_flashAlpha < 0.005) _flashAlpha = 0;

    if (_active === 'rock') { _initFire(); _heatT += 0.04; }

    _buntingAlpha = _lp(_buntingAlpha, (_active === 'confetti') ? 1.0 : 0.0, 0.08);
    if (_active === 'confetti') _buntingSwayT += 0.022;

    if (_active === 'confetti' && _confetti.length < _CONF_MAX) {
      const W = _W(), H = _H();
      const cx = W/2, cy = H*0.40;
      const burstN = Math.min(8, _CONF_MAX-_confetti.length);
      for (let k = 0; k < burstN; k++)
        _confetti.push(_mkPiece(cx+(Math.random()-0.5)*340, cy+(Math.random()-0.5)*180, false));
      const rainN = Math.min(4, _CONF_MAX-_confetti.length);
      for (let k = 0; k < rainN; k++)
        _confetti.push(_mkPiece(Math.random()*_W(), -10-Math.random()*40, true));
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  RENDER BEHIND
  // ─────────────────────────────────────────────────────────────
  function renderBehind() {
    if (typeof push !== 'function') return;
    const W = _W(), H = _H();
    const t = performance.now()*0.001;
    push();
    const dc = drawingContext;
    dc.save();

    // ── HEART — FULL SCREEN RIPPLE FIX ───────────────────────
    // Key fix: rings must COVER the entire canvas including corners.
    // We use fillRect(0,0,W,H) for the glow layer and clip rings
    // to maxRadius that is guaranteed to reach ALL four corners.
    if (!window.gameMode && G.heart > 0.02) {
      const cx = W / 2, cy = H / 2;

      // Exact distance from centre to farthest corner = half diagonal
      // Multiply by 1.05 for a small overdraw margin — eliminates voids
      const maxRadius   = Math.sqrt(W * W + H * H) * 0.55;
      const ringCount   = 16;
      const ringSpacing = maxRadius / ringCount;
      const breathe     = 1.0 + 0.03 * Math.sin(t * 1.1);

      // ── Full-canvas radial glow — no arc clip, no voids ──────
      const glow = dc.createRadialGradient(cx, cy, 0, cx, cy, maxRadius * 1.1);
      glow.addColorStop(0,   `rgba(255,100,160,${(G.heart * 0.38).toFixed(3)})`);
      glow.addColorStop(0.35,`rgba(240,60,120,${(G.heart * 0.22).toFixed(3)})`);
      glow.addColorStop(0.7, `rgba(220,30,90,${(G.heart * 0.10).toFixed(3)})`);
      glow.addColorStop(1,   'rgba(200,20,70,0)');
      dc.fillStyle   = glow;
      dc.globalAlpha = 1;
      dc.fillRect(0, 0, W, H);   // ← full rect, no arc clip

      // ── Ripple rings ─────────────────────────────────────────
      // Each ring is a full heart shape that has been scaled to
      // exceed the canvas diagonal — no corner voids possible.
      dc.save();
      dc.translate(cx, cy);
      dc.scale(breathe, breathe);
      dc.translate(-cx, -cy);

      for (let i = ringCount; i >= 0; i--) {
        const phase = (_heartPhase + i / ringCount) % 1.0;
        const r     = phase * maxRadius + ringSpacing * 0.5;
        if (r < 2) continue;

        // Alternate ring colours
        dc.fillStyle   = (i % 2 === 0) ? '#E8437A' : '#FFB3CC';
        dc.globalAlpha = G.heart * (0.55 + 0.45 * (1 - phase)); // fade outer rings
        _drawHeartShape(dc, cx, cy, r);
        dc.fill();
      }

      dc.restore();
      dc.globalAlpha = 1;

      // ── Heart float particles ─────────────────────────────────
      for (let i = _heartParticles.length - 1; i >= 0; i--) {
        const p = _heartParticles[i];
        p.y += p.vy; p.x += p.vx + Math.sin(p.wave + t * 1.3) * 0.3;
        p.wave += 0.025; p.life -= 0.008;
        if (p.life <= 0 || p.y < -40) { _heartParticles.splice(i, 1); continue; }
        const pa = Math.min(1, p.life * 2.0) * G.heart * 0.55;
        if (pa < 0.01) continue;
        dc.globalAlpha = pa;
        _drawHeartShape(dc, p.x, p.y, p.size * (1.0 + 0.03 * Math.sin(t * 1.1)) * 0.6);
        dc.fillStyle = '#FF6BA0'; dc.fill();
      }
      dc.globalAlpha = 1;
    }

    // ── ROCK / FIRE (skip during game) ───────────────────────
    const fi = (!window.gameMode && _active==='rock') ? G.rock : _lp(0,G.rock,0.04);
    if (!window.gameMode && fi > 0.02) {
      _initFire();
      dc.save(); dc.translate(_shakeX,_shakeY);

      const bgGrad = dc.createRadialGradient(W*0.5,H*0.5,0,W*0.5,H*0.5,Math.max(W,H)*0.75);
      bgGrad.addColorStop(0,   `rgba(55,3,0,${(fi*0.85).toFixed(3)})`);
      bgGrad.addColorStop(0.5, `rgba(18,0,0,${(fi*0.92).toFixed(3)})`);
      bgGrad.addColorStop(1,   `rgba(0,0,0,${(fi*0.98).toFixed(3)})`);
      dc.fillStyle = bgGrad; dc.globalAlpha = 1; dc.fillRect(0,0,W,H);

      const crackPulse = 0.5+0.5*Math.sin(t*1.9);
      dc.lineWidth = 1; dc.globalAlpha = 1;
      for (let cx2 = 0; cx2 < W; cx2 += 56) {
        for (let cy2 = 0; cy2 < H; cy2 += 56) {
          const jx = Math.sin(cx2*0.065+t*0.85)*14, jy = Math.cos(cy2*0.065+t*0.70)*14;
          dc.strokeStyle = `rgba(255,75,0,${(fi*0.14*crackPulse).toFixed(3)})`;
          dc.beginPath(); dc.moveTo(cx2+jx,cy2);
          dc.lineTo(cx2+28-jx,cy2+28+jy); dc.lineTo(cx2+56+jx,cy2+56); dc.stroke();
        }
      }

      for (const b of _fire) {
        b.cH += b.spd*fi; b.life += 0.018;
        if (b.life >= 1.0) _resetFireBlob(b);
        const env = fi*Math.sin(b.life*Math.PI);
        if (env < 0.018) continue;
        const xO = Math.sin(b.cH*0.032+b.seed)*24;
        const bx = b.x+xO, by = b.top?0:H, dir = b.top?1:-1;
        const fw = b.bW*env, fh = Math.min(b.cH*env, b.top?H*0.20:H*0.65);
        const LAYERS = [
          {col:'rgba(90,0,0,1)',        sc:1.00,a:0.72},{col:'rgba(190,15,0,1)',      sc:0.80,a:0.82},
          {col:'rgba(255,70,0,1)',       sc:0.58,a:0.88},{col:'rgba(255,155,0,1)',    sc:0.36,a:0.92},
          {col:'rgba(255,228,75,1)',     sc:0.18,a:0.97},{col:'rgba(255,255,195,0.85)',sc:0.07,a:1.00},
        ];
        dc.globalCompositeOperation = 'source-over';
        for (const ly of LAYERS) {
          const cW=fw*ly.sc,cH=fh*ly.sc; if(cW<1||cH<1) continue;
          dc.fillStyle=ly.col; dc.globalAlpha=env*ly.a;
          dc.beginPath(); dc.moveTo(bx-cW*0.5,by);
          dc.bezierCurveTo(bx-cW*1.14,by+dir*cH*0.20,bx-cW*0.10,by+dir*cH*0.78,bx,by+dir*cH);
          dc.bezierCurveTo(bx+cW*0.10,by+dir*cH*0.78,bx+cW*1.14,by+dir*cH*0.20,bx+cW*0.5,by);
          dc.fill();
        }
        dc.globalCompositeOperation = 'lighter';
        const grd = dc.createRadialGradient(bx,by,0,bx,by,fw*0.95);
        grd.addColorStop(0,`rgba(255,110,0,${(env*0.38).toFixed(3)})`);
        grd.addColorStop(1,'rgba(180,30,0,0)');
        dc.fillStyle=grd; dc.globalAlpha=env*0.65;
        dc.beginPath(); dc.ellipse(bx,by,fw*0.72,fw*0.17,0,0,Math.PI*2); dc.fill();
        dc.globalCompositeOperation = 'source-over';
      }

      const shimAmt = fi*0.16*(0.65+0.35*Math.sin(t*3.3));
      const shimmer = dc.createLinearGradient(0,H*0.32,0,H*0.68);
      shimmer.addColorStop(0,'rgba(0,0,0,0)');
      shimmer.addColorStop(0.4,`rgba(8,0,0,${shimAmt.toFixed(3)})`);
      shimmer.addColorStop(0.6,`rgba(8,0,0,${shimAmt.toFixed(3)})`);
      shimmer.addColorStop(1,'rgba(0,0,0,0)');
      dc.fillStyle=shimmer; dc.globalAlpha=1; dc.fillRect(0,H*0.32,W,H*0.36);

      const vig = dc.createRadialGradient(W*0.5,H*0.5,H*0.22,W*0.5,H*0.5,Math.max(W,H)*0.75);
      vig.addColorStop(0,'rgba(0,0,0,0)');
      vig.addColorStop(1,`rgba(0,0,0,${(fi*0.78).toFixed(3)})`);
      dc.fillStyle=vig; dc.globalAlpha=1; dc.fillRect(0,0,W,H);

      dc.globalAlpha=1; dc.globalCompositeOperation='source-over'; dc.restore();
    }

    // ── SURPRISE (skip during game) ──────────────────────────
    if (!window.gameMode && _surpAlpha > 0.008 && _surpScale > 0.01) {
      const cx=W*0.5,cy=H*0.42,BASE=Math.min(W,H)*0.56;
      const alpha=_surpAlpha,sc=_surpScale;
      dc.save(); dc.translate(cx,cy); dc.scale(sc,sc);

      const bgBurst = dc.createRadialGradient(0,0,0,0,0,BASE*2.4);
      bgBurst.addColorStop(0,   `rgba(255,245,55,${(alpha*0.92).toFixed(3)})`);
      bgBurst.addColorStop(0.20,`rgba(255,175,0,${(alpha*0.82).toFixed(3)})`);
      bgBurst.addColorStop(0.55,`rgba(220,55,0,${(alpha*0.60).toFixed(3)})`);
      bgBurst.addColorStop(1,   `rgba(80,8,0,${(alpha*0.22).toFixed(3)})`);
      dc.fillStyle=bgBurst; dc.globalAlpha=1;
      dc.beginPath(); dc.arc(0,0,BASE*2.4,0,Math.PI*2); dc.fill();
      dc.restore(); dc.save();

      _drawHalftone(dc,cx,cy,BASE*1.9*sc,alpha*0.13);
      dc.translate(cx,cy); dc.scale(sc,sc);

      for (let i = 0; i < 32; i++) {
        const ang=i/32*Math.PI*2,inner=BASE*0.20;
        const outer=BASE*2.8+Math.sin(i*1.65)*BASE*0.14;
        dc.strokeStyle=`rgba(10,3,0,${(alpha*0.88).toFixed(3)})`;
        dc.lineWidth=4.5+Math.sin(i*0.95)*3; dc.lineCap='butt'; dc.globalAlpha=1;
        dc.beginPath();
        dc.moveTo(Math.cos(ang)*inner,Math.sin(ang)*inner);
        dc.lineTo(Math.cos(ang)*outer,Math.sin(ang)*outer); dc.stroke();
      }

      const outerR=BASE*1.12,innerR=BASE*0.62;
      dc.fillStyle=`rgba(255,228,0,${(alpha*0.97).toFixed(3)})`;
      dc.strokeStyle=`rgba(150,70,0,${(alpha*0.72).toFixed(3)})`;
      dc.lineWidth=5; dc.globalAlpha=1;
      dc.beginPath();
      for (let i = 0; i < 52; i++) {
        const r=i%2===0?outerR:innerR;
        const ang=(Math.PI/26)*i-Math.PI/2;
        i===0?dc.moveTo(Math.cos(ang)*r,Math.sin(ang)*r):dc.lineTo(Math.cos(ang)*r,Math.sin(ang)*r);
      }
      dc.closePath(); dc.fill(); dc.stroke();

      for (const m of _surpMini) {
        const mx=Math.cos(m.ang)*BASE*m.d,my=Math.sin(m.ang)*BASE*m.d;
        const mR=BASE*(0.11+m.d*0.09),miR=mR*0.50;
        dc.fillStyle=`rgba(255,205,0,${(alpha*0.90).toFixed(3)})`;
        dc.strokeStyle=`rgba(180,75,0,${(alpha*0.55).toFixed(3)})`;
        dc.lineWidth=2; dc.globalAlpha=1; dc.save();
        dc.translate(mx,my); dc.rotate(m.rot+performance.now()*0.0003);
        dc.beginPath();
        for (let i = 0; i < m.spikes*2; i++) {
          const r=i%2===0?mR:miR,ang=(Math.PI/m.spikes)*i;
          i===0?dc.moveTo(Math.cos(ang)*r,Math.sin(ang)*r):dc.lineTo(Math.cos(ang)*r,Math.sin(ang)*r);
        }
        dc.closePath(); dc.fill(); dc.stroke(); dc.restore();
      }

      const fl = dc.createRadialGradient(0,0,0,0,0,BASE*0.38);
      fl.addColorStop(0,  `rgba(255,255,255,${(alpha*0.97).toFixed(3)})`);
      fl.addColorStop(0.5,`rgba(255,252,140,${(alpha*0.65).toFixed(3)})`);
      fl.addColorStop(1,  'rgba(255,200,0,0)');
      dc.fillStyle=fl; dc.globalAlpha=1;
      dc.beginPath(); dc.arc(0,0,BASE*0.38,0,Math.PI*2); dc.fill();
      dc.restore(); dc.globalAlpha=1;
    }

    // ── CONFETTI BACK LAYER ───────────────────────────────────
    if (_confetti.length > 0) {
      for (let i = 0; i < _confetti.length; i++) {
        const c = _confetti[i];
        if (c.layer !== 'back') continue;
        const a = Math.min(1,c.life*2.2)*0.68; if(a<0.01) continue;
        dc.save(); dc.globalAlpha=a; dc.fillStyle=c.col;
        dc.translate(c.x,c.y); dc.rotate(c.rot);
        if (c.type==='circle') { dc.beginPath(); dc.arc(0,0,c.w*0.44,0,Math.PI*2); dc.fill(); }
        else if (c.type==='ribbon') {
          dc.strokeStyle=c.col; dc.lineWidth=c.w*0.8; dc.lineCap='round'; dc.globalAlpha=a;
          dc.beginPath(); dc.moveTo(0,-c.h*0.5);
          dc.bezierCurveTo(c.w*1.6,-c.h*0.2,-c.w*1.6,c.h*0.2,0,c.h*0.5); dc.stroke();
        } else { dc.fillRect(-c.w*0.44,-c.h*0.44,c.w*0.88,c.h*0.88); }
        dc.restore();
      }
      dc.globalAlpha = 1;
    }

    // ── BURST SHOCKWAVE RING ──────────────────────────────────
    if (_shockActive && _shockAlpha > 0.01) {
      const cols = _BURST_CHAR_COLS[_burstCharId]||_BURST_CHAR_COLS.blue;
      dc.save();
      dc.strokeStyle=cols[0]; dc.lineWidth=8+_shockRadius*0.04; dc.globalAlpha=_shockAlpha*0.9;
      dc.beginPath(); dc.arc(_burstCX,_burstCY,_shockRadius,0,Math.PI*2); dc.stroke();
      dc.strokeStyle=cols[2]||cols[0]; dc.lineWidth=3; dc.globalAlpha=_shockAlpha*0.5;
      dc.beginPath(); dc.arc(_burstCX,_burstCY,_shockRadius*0.88,0,Math.PI*2); dc.stroke();
      dc.restore();
    }

    // ── BURST / GAME PARTICLES (back — remat 'in' phase) ─────
    if (_burst.length > 0) {
      dc.save();
      for (const p of _burst) {
        if (p.phase !== 'in') continue;
        const a = Math.min(1,p.life*1.8)*0.75; if(a<0.01) continue;
        const sz = p.sz;
        dc.save(); dc.globalAlpha=a; dc.fillStyle=p.col;
        dc.translate(p.x,p.y); dc.rotate(p.rot);
        dc.beginPath(); dc.ellipse(0,0,sz*0.55,sz*0.4,0,0,Math.PI*2); dc.fill();
        dc.fillStyle='rgba(255,255,255,0.28)'; dc.beginPath();
        dc.ellipse(-sz*0.10,-sz*0.08,sz*0.18,sz*0.12,-0.4,0,Math.PI*2); dc.fill();
        dc.restore();
      }
      dc.globalAlpha=1; dc.restore();
    }

    // ── GAME MODE — dark semi-transparent game background ─────
    if (window.gameMode) {
      dc.fillStyle   = 'rgba(10,8,20,0.45)';
      dc.globalAlpha = 1;
      dc.fillRect(0, 0, W, H);
    }

    // ── SURPRISE WHITE FLASH ─────────────────────────────────
    if (!window.gameMode && _flashAlpha > 0.004) {
      dc.fillStyle='#ffffff'; dc.globalAlpha=_flashAlpha; dc.fillRect(0,0,W,H); dc.globalAlpha=1;
    }

    dc.globalAlpha=1; dc.restore(); pop(); noTint();
  }

  // ─────────────────────────────────────────────────────────────
  //  RENDER FRONT
  // ─────────────────────────────────────────────────────────────
  function renderFront() {
    if (typeof push !== 'function') return;
    const W = _W(), H = _H();
    const t = performance.now()*0.001;
    push();
    const dc = drawingContext;
    dc.save();

    // ── Bunting (skip during game) ────────────────────────────
    if (!window.gameMode && _buntingAlpha > 0.01) {
      const flagW = W/(_BUNTING_FLAGS-1), ropeY = H*0.055;
      const flagH = Math.min(44,H*0.06), alpha = _buntingAlpha;
      dc.strokeStyle=`rgba(80,48,18,${(alpha*0.65).toFixed(3)})`;
      dc.lineWidth=2.5; dc.globalAlpha=1; dc.beginPath();
      for (let i = 0; i <= _BUNTING_FLAGS; i++) {
        const rx=i*flagW, normX=(rx/W-0.5)*2;
        const sagY=ropeY+normX*normX*H*0.035, sway=Math.sin(_buntingSwayT+i*0.55)*4;
        i===0?dc.moveTo(rx,sagY+sway):dc.lineTo(rx,sagY+sway);
      }
      dc.stroke();
      for (let i = 0; i < _BUNTING_FLAGS; i++) {
        const rx=i*flagW+flagW*0.5, normX=(rx/W-0.5)*2;
        const sagY=ropeY+normX*normX*H*0.035, sway=Math.sin(_buntingSwayT+i*0.55)*7;
        const col=_BUNTING_COLS[i%_BUNTING_COLS.length];
        dc.save(); dc.translate(rx+sway*0.4,sagY+sway*0.15);
        dc.rotate(Math.sin(_buntingSwayT*1.05+i*0.8)*0.09);
        dc.fillStyle=col; dc.strokeStyle=`rgba(255,255,255,${(alpha*0.35).toFixed(3)})`;
        dc.lineWidth=1; dc.globalAlpha=alpha*0.90;
        dc.beginPath(); dc.moveTo(-flagW*0.36,0); dc.lineTo(flagW*0.36,0); dc.lineTo(0,flagH);
        dc.closePath(); dc.fill(); dc.stroke(); dc.restore();
      }
      dc.globalAlpha=1;
    }

    // ── Confetti particles (physics tick ALL, draw FRONT only) ─
    for (let i = _confetti.length-1; i >= 0; i--) {
      const c = _confetti[i];
      c.vy += 0.20; c.vx += Math.sin(c.wave+t*2.4)*0.09;
      c.vx *= 0.993; c.x += c.vx; c.y += c.vy;
      c.rot += c.vr; c.wave += 0.038; c.life -= 0.008;
      if (c.life <= 0 || c.y > H+70) { _confetti.splice(i,1); continue; }
      if (c.layer !== 'front') continue;
      const a = Math.min(1,c.life*2.2);
      dc.save(); dc.globalAlpha=a; dc.fillStyle=c.col;
      dc.translate(c.x,c.y); dc.rotate(c.rot);
      if (c.type==='circle') { dc.beginPath(); dc.arc(0,0,c.w*0.5,0,Math.PI*2); dc.fill(); }
      else if (c.type==='ribbon') {
        dc.strokeStyle=c.col; dc.lineWidth=c.w; dc.lineCap='round'; dc.globalAlpha=a;
        dc.beginPath(); dc.moveTo(0,-c.h*0.5);
        dc.bezierCurveTo(c.w*1.6,-c.h*0.2,-c.w*1.6,c.h*0.2,0,c.h*0.5); dc.stroke();
      } else { dc.fillRect(-c.w*0.5,-c.h*0.5,c.w,c.h); }
      dc.restore();
    }

    // ── Burst 'out' particles ─────────────────────────────────
    if (_burst.length > 0) {
      dc.save();
      for (const p of _burst) {
        if (p.phase !== 'out') continue;
        const a = Math.min(1,p.life*1.6); if(a<0.01) continue;
        const sz = p.sz;
        const sides = 5+Math.floor(sz*0.12);
        dc.save(); dc.globalAlpha=a; dc.fillStyle=p.col;
        dc.translate(p.x,p.y); dc.rotate(p.rot);
        dc.beginPath();
        for (let j = 0; j < sides*2; j++) {
          const r=j%2===0?sz*0.55:sz*0.28, ang=(Math.PI/sides)*j;
          j===0?dc.moveTo(Math.cos(ang)*r,Math.sin(ang)*r):dc.lineTo(Math.cos(ang)*r,Math.sin(ang)*r);
        }
        dc.closePath(); dc.fill();
        dc.fillStyle='rgba(255,255,255,0.55)'; dc.globalAlpha=a*0.5;
        dc.beginPath(); dc.arc(0,0,sz*0.14,0,Math.PI*2); dc.fill();
        dc.restore();
      }

      if (!window.gameMode && window.burstState === 'remat') {
        const heroX=window.burstX||_burstCX, heroY=window.burstY||_burstCY;
        const cols=_BURST_CHAR_COLS[_burstCharId]||_BURST_CHAR_COLS.blue;
        const rp=Math.min(1,(90-(_burst.length/55)*90)/90);
        const gs=_burstR*(0.6+rp*0.8);
        const glow=dc.createRadialGradient(heroX,heroY,0,heroX,heroY,gs);
        glow.addColorStop(0,`rgba(255,255,255,${(0.5*(1-rp)+0.1).toFixed(3)})`);
        glow.addColorStop(0.3,`${cols[2]||cols[0]}88`);
        glow.addColorStop(1,`${cols[0]}00`);
        dc.fillStyle=glow; dc.globalAlpha=0.7*(1-rp*0.5);
        dc.beginPath(); dc.arc(heroX,heroY,gs,0,Math.PI*2); dc.fill();
      }

      dc.globalAlpha=1; dc.restore();
    }

    // ── GAME TARGET PARTICLES ─────────────────────────────────
    if (window.gameMode) {
      dc.save();
      for (const p of _burst) {
        if (p.phase !== 'game' || p.isPopped) continue;
        const sz  = p.gameSz || p.sz;
        const pls = 1.0 + 0.08*Math.sin(p.wobble*2.2);
        const cols = _BURST_CHAR_COLS[_burstCharId] || _BURST_CHAR_COLS.blue;

        dc.save(); dc.translate(p.x, p.y); dc.rotate(p.rot);

        const glowGrad = dc.createRadialGradient(0,0,sz*0.5,0,0,sz*pls*1.4);
        glowGrad.addColorStop(0, p.col + 'CC');
        glowGrad.addColorStop(1, p.col + '00');
        dc.fillStyle   = glowGrad; dc.globalAlpha = 0.50;
        dc.beginPath(); dc.arc(0,0,sz*pls*1.4,0,Math.PI*2); dc.fill();

        dc.globalAlpha = 0.95; dc.fillStyle = p.col;
        dc.beginPath(); dc.arc(0,0,sz*pls*0.62,0,Math.PI*2); dc.fill();

        dc.fillStyle = 'rgba(255,255,255,0.4)'; dc.globalAlpha = 0.9;
        dc.beginPath(); dc.arc(-sz*0.18*pls,-sz*0.18*pls,sz*0.22*pls,0,Math.PI*2); dc.fill();

        dc.strokeStyle = 'rgba(255,255,255,0.25)';
        dc.lineWidth   = 2; dc.globalAlpha = 0.6;
        dc.beginPath(); dc.arc(0,0,_GAME_TOUCH_THRESH + sz*0.5*pls,0,Math.PI*2); dc.stroke();

        dc.restore();
      }
      dc.globalAlpha = 1; dc.restore();
    }

    // ── POP FX SPARKS ─────────────────────────────────────────
    if (_popFX.length > 0) {
      dc.save();
      for (const fx of _popFX) {
        for (const s of fx.sparks) {
          const fa = s.life * fx.life;
          if (fa < 0.01) continue;
          dc.fillStyle   = fx.col;
          dc.globalAlpha = fa;
          dc.beginPath();
          dc.arc(fx.x + s.vx*8, fx.y + s.vy*8, 4*s.life, 0, Math.PI*2);
          dc.fill();
        }
        dc.strokeStyle = fx.col;
        dc.lineWidth   = 3*fx.life;
        dc.globalAlpha = fx.life*0.7;
        dc.beginPath(); dc.arc(fx.x, fx.y, (1-fx.life)*50+5, 0, Math.PI*2); dc.stroke();
      }
      dc.globalAlpha = 1; dc.restore();
    }

    // ── GAME HUD ──────────────────────────────────────────────
    if (window.gameMode) {
      _renderGameHUD(dc, W, H);
    }

    dc.globalAlpha=1; dc.restore(); pop(); noTint();
  }

  // ─────────────────────────────────────────────────────────────
  //  RENDER GAME HUD
  // ─────────────────────────────────────────────────────────────
  function _renderGameHUD(dc, W, H) {
    dc.save();

    const gs = window.gameState;

    // ── COUNTDOWN OVERLAY ─────────────────────────────────────
    if (gs === 'countdown') {
      dc.fillStyle = 'rgba(0,0,0,0.35)';
      dc.globalAlpha = 1;
      dc.fillRect(0, 0, W, H);

      if (_cdNumber > 0) {
        const numScale = 1 + 0.18 * Math.sin(performance.now() * 0.008);
        dc.save();
        dc.translate(W * 0.5, H * 0.42);
        dc.scale(numScale, numScale);

        // Stroke for bubbly outline effect
        dc.strokeStyle  = 'rgba(100,50,200,0.9)';
        dc.lineWidth    = 16;
        dc.lineJoin     = 'round';
        dc.font         = `bold 160px ${_bubbleFont}`;
        dc.textAlign    = 'center';
        dc.textBaseline = 'middle';
        dc.strokeText(String(_cdNumber), 0, 0);

        dc.fillStyle    = '#FFFFFF';
        dc.globalAlpha  = 1;
        dc.shadowColor  = 'rgba(180,100,255,0.9)';
        dc.shadowBlur   = 40;
        dc.fillText(String(_cdNumber), 0, 0);
        dc.shadowBlur   = 0;
        dc.restore();
      }

      if (_cdGoAlpha > 0.01) {
        dc.save();
        dc.globalAlpha = _cdGoAlpha;

        dc.strokeStyle  = 'rgba(255,120,0,1)';
        dc.lineWidth    = 14;
        dc.lineJoin     = 'round';
        dc.font         = `bold 140px ${_bubbleFont}`;
        dc.textAlign    = 'center';
        dc.textBaseline = 'middle';
        dc.strokeText('GO!', W * 0.5, H * 0.42);

        dc.fillStyle    = '#FFE44D';
        dc.shadowColor  = 'rgba(255,160,0,0.95)';
        dc.shadowBlur   = 50;
        dc.fillText('GO!', W * 0.5, H * 0.42);
        dc.shadowBlur   = 0;
        dc.restore();
      }

      if (_cdInstrAlpha > 0.01) {
        const instrY = H * 0.68;
        dc.fillStyle   = 'rgba(0,0,0,0.55)';
        dc.globalAlpha = _cdInstrAlpha;
        _roundRect(dc, W * 0.5 - 260, instrY - 30, 520, 56, 18);
        dc.fill();

        dc.fillStyle    = '#FFFFFF';
        dc.font         = 'bold 22px sans-serif';
        dc.textAlign    = 'center';
        dc.textBaseline = 'middle';
        dc.shadowColor  = 'rgba(0,0,0,0.7)';
        dc.shadowBlur   = 6;
        dc.fillText('Move your hands to burst the bubbles', W * 0.5, instrY);
        dc.shadowBlur   = 0;
        dc.globalAlpha  = 1;
      }
      dc.restore();
      return;
    }

    // ── PLAYING HUD ───────────────────────────────────────────
    if (gs === 'playing') {
      const remaining   = _gameTotalCount - _gamePopped;
      const secsDisplay = Math.ceil(_gameSecsLeft);
      const urgency     = Math.max(0, 1 - _gameSecsLeft / _GAME_TIMER_SECS);

      const ringCX = W * 0.5, ringCY = 72;
      const ringR  = 48;
      const timerFrac = _gameSecsLeft / _GAME_TIMER_SECS;

      dc.strokeStyle = 'rgba(255,255,255,0.18)';
      dc.lineWidth   = 8; dc.globalAlpha = 1;
      dc.beginPath(); dc.arc(ringCX, ringCY, ringR, 0, Math.PI*2); dc.stroke();

      const r2 = Math.floor(urgency * 255);
      const g2 = Math.floor((1-urgency) * 220);
      dc.strokeStyle = `rgb(${r2},${g2},60)`;
      dc.lineWidth   = 8; dc.lineCap = 'round'; dc.globalAlpha = 1;
      dc.beginPath();
      dc.arc(ringCX, ringCY, ringR, -Math.PI/2, -Math.PI/2 + timerFrac*Math.PI*2);
      dc.stroke();

      const pulse = urgency > 0.6 ? 1 + 0.12*Math.sin(performance.now()*0.015) : 1;
      dc.fillStyle    = secsDisplay <= 5 ? '#FF4444' : '#FFFFFF';
      dc.globalAlpha  = 1;
      dc.font         = `bold ${Math.round(36*pulse)}px sans-serif`;
      dc.textAlign    = 'center';
      dc.textBaseline = 'middle';
      dc.shadowColor  = 'rgba(0,0,0,0.6)'; dc.shadowBlur = 8;
      dc.fillText(secsDisplay, ringCX, ringCY);
      dc.shadowBlur   = 0;

      dc.fillStyle    = 'rgba(255,255,255,0.90)';
      dc.globalAlpha  = 1;
      dc.font         = 'bold 22px sans-serif';
      dc.textAlign    = 'center'; dc.textBaseline = 'alphabetic';
      dc.shadowColor  = 'rgba(0,0,0,0.7)'; dc.shadowBlur = 6;
      dc.fillText('Touch all particles!', W*0.5, ringCY - ringR - 16);
      dc.shadowBlur   = 0;

      const barX = W*0.5, barY = H - 44;
      dc.fillStyle   = 'rgba(0,0,0,0.45)';
      dc.globalAlpha = 1;
      _roundRect(dc, barX - 110, barY - 22, 220, 40, 12);
      dc.fill();
      dc.fillStyle    = 'rgba(255,255,255,0.95)';
      dc.font         = 'bold 20px sans-serif';
      dc.textAlign    = 'center'; dc.textBaseline = 'middle';
      dc.shadowColor  = 'rgba(0,0,0,0.5)'; dc.shadowBlur = 4;
      dc.fillText(`${remaining} left`, barX, barY);
      dc.shadowBlur   = 0;

      if (_cdInstrAlpha > 0.01) {
        const instrY = H * 0.68;
        dc.fillStyle   = 'rgba(0,0,0,0.50)';
        dc.globalAlpha = _cdInstrAlpha;
        _roundRect(dc, W * 0.5 - 260, instrY - 30, 520, 56, 18);
        dc.fill();
        dc.fillStyle    = '#FFFFFF';
        dc.font         = 'bold 22px sans-serif';
        dc.textAlign    = 'center'; dc.textBaseline = 'middle';
        dc.shadowColor  = 'rgba(0,0,0,0.7)'; dc.shadowBlur = 6;
        dc.fillText('Move your hands to burst the bubbles', W * 0.5, instrY);
        dc.shadowBlur   = 0;
        dc.globalAlpha  = 1;
      }

      const pd = (typeof POSE_DATA !== 'undefined') ? POSE_DATA : null;
      if (pd && pd.present) {
        const wrists = [];
        if (pd.smLWriX !== null) wrists.push({x:pd.smLWriX,y:pd.smLWriY});
        if (pd.smRWriX !== null) wrists.push({x:pd.smRWriX,y:pd.smRWriY});
        for (const wr of wrists) {
          dc.strokeStyle = 'rgba(255,255,255,0.75)';
          dc.lineWidth   = 3; dc.globalAlpha = 0.85;
          dc.beginPath(); dc.arc(wr.x,wr.y,_GAME_TOUCH_THRESH,0,Math.PI*2); dc.stroke();
          dc.fillStyle = 'rgba(255,255,255,0.30)'; dc.globalAlpha = 0.5;
          dc.beginPath(); dc.arc(wr.x,wr.y,14,0,Math.PI*2); dc.fill();
        }
      }
    }

    // ── WIN SCREEN — bubbly Lilita One font ──────────────────
    if (gs === 'win') {
      const fadeT = Math.min(1, _gameEndTimer / 20);

      // Panel with rounded corners + green glow
      dc.save();
      dc.shadowColor  = 'rgba(50,220,100,0.6)';
      dc.shadowBlur   = 30;
      dc.fillStyle    = `rgba(20,160,70,${(fadeT*0.88).toFixed(3)})`;
      dc.globalAlpha  = 1;
      _roundRect(dc, W*0.5-240, H*0.5-115, 480, 230, 32);
      dc.fill();
      dc.shadowBlur   = 0;
      dc.restore();

      dc.save();
      dc.globalAlpha = fadeT;

      // Outline stroke for bubbly look
      dc.strokeStyle  = 'rgba(0,80,30,0.95)';
      dc.lineWidth    = 10;
      dc.lineJoin     = 'round';
      dc.font         = `bold 78px ${_bubbleFont}`;
      dc.textAlign    = 'center';
      dc.textBaseline = 'middle';
      dc.strokeText('YOU WIN! 🎉', W*0.5, H*0.5 - 28);

      dc.fillStyle    = '#FFFFFF';
      dc.shadowColor  = 'rgba(0,200,80,0.9)';
      dc.shadowBlur   = 24;
      dc.fillText('YOU WIN! 🎉', W*0.5, H*0.5 - 28);
      dc.shadowBlur   = 0;

      // Sub-text
      dc.strokeStyle  = 'rgba(0,60,20,0.8)';
      dc.lineWidth    = 6;
      dc.font         = `bold 30px ${_bubbleFont}`;
      dc.strokeText(`All ${_gameInitialCount} popped!`, W*0.5, H*0.5 + 52);
      dc.fillStyle    = '#E8FFE8';
      dc.shadowBlur   = 8;
      dc.fillText(`All ${_gameInitialCount} popped!`, W*0.5, H*0.5 + 52);
      dc.shadowBlur   = 0;

      dc.restore();
    }

    // ── LOSE SCREEN — bubbly Lilita One font ─────────────────
    if (gs === 'lose') {
      const fadeT    = Math.min(1, _gameEndTimer / 20);
      const remaining = _gameTotalCount - _gamePopped;

      // Panel
      dc.save();
      dc.shadowColor  = 'rgba(220,50,50,0.7)';
      dc.shadowBlur   = 30;
      dc.fillStyle    = `rgba(160,18,18,${(fadeT*0.92).toFixed(3)})`;
      dc.globalAlpha  = 1;
      _roundRect(dc, W*0.5-250, H*0.5-120, 500, 240, 32);
      dc.fill();
      dc.shadowBlur   = 0;
      dc.restore();

      dc.save();
      dc.globalAlpha = fadeT;

      // Outline stroke
      dc.strokeStyle  = 'rgba(60,0,0,0.95)';
      dc.lineWidth    = 12;
      dc.lineJoin     = 'round';
      dc.font         = `bold 86px ${_bubbleFont}`;
      dc.textAlign    = 'center';
      dc.textBaseline = 'middle';
      dc.strokeText('GAME OVER', W*0.5, H*0.5 - 30);

      dc.fillStyle    = '#FFFFFF';
      dc.shadowColor  = 'rgba(255,80,80,0.95)';
      dc.shadowBlur   = 28;
      dc.fillText('GAME OVER', W*0.5, H*0.5 - 30);
      dc.shadowBlur   = 0;

      // Sub-text
      dc.strokeStyle  = 'rgba(60,0,0,0.8)';
      dc.lineWidth    = 6;
      dc.font         = `bold 28px ${_bubbleFont}`;
      dc.strokeText(`${remaining} particle${remaining!==1?'s':''} escaped!`, W*0.5, H*0.5 + 52);
      dc.fillStyle    = '#FFE0E0';
      dc.shadowBlur   = 8;
      dc.fillText(`${remaining} particle${remaining!==1?'s':''} escaped!`, W*0.5, H*0.5 + 52);
      dc.shadowBlur   = 0;

      dc.restore();
    }

    dc.globalAlpha = 1; dc.restore();
  }

  function _roundRect(dc, x, y, w, h, r) {
    dc.beginPath();
    dc.moveTo(x+r, y);
    dc.lineTo(x+w-r, y);       dc.quadraticCurveTo(x+w, y,   x+w, y+r);
    dc.lineTo(x+w, y+h-r);     dc.quadraticCurveTo(x+w, y+h, x+w-r, y+h);
    dc.lineTo(x+r, y+h);       dc.quadraticCurveTo(x,   y+h, x, y+h-r);
    dc.lineTo(x, y+r);         dc.quadraticCurveTo(x,   y,   x+r, y);
    dc.closePath();
  }

  // ─────────────────────────────────────────────────────────────
  //  PUBLIC API
  // ─────────────────────────────────────────────────────────────
  return {
    update() {
      _initAudio();
      _detect();
      _tickAudio();
      _tickBurst();
    },
    renderBehind,
    renderFront,
    triggerBurst,
    triggerRemat,
    notifyIntroComplete() {
      window.introComplete = true;
    },
    notifyCharacterAssigned() {
      window.characterAssigned = true;
    },
    getState() {
      return {
        active:       _active,
        G:            { ...G },
        surpState:    _surpState,
        gameMode:     window.gameMode,
        gameState:    window.gameState,
        systemMode:   window.systemMode,
        gameSecsLeft: _gameSecsLeft,
        countdown:    _cdNumber,
        bgMusicVol:   _bgMusic.vol,
      };
    },
  };

})();
