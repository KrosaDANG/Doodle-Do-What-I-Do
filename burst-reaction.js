// ================================================================
//  G E S T U R E   R E A C T I O N   S Y S T E M  — v7 + BURST
//  gestureReactions.js
//
//  ── UNCHANGED vs v7 ────────────────────────────────────────────
//  All confetti, rock/fire, surprise, heart visuals + audio
//  detection, cooldowns, priority, fade system: UNTOUCHED.
//
//  ── BURST ADDITION ─────────────────────────────────────────────
//  triggerBurst(x, y, charId, radius)
//    Called by gesture.js when fast movement detected.
//    Spawns 60 shatter particles from body colour themed dot images,
//    plus a shockwave ring, all flying outward with physics.
//
//  triggerRemat()
//    Called by gesture.js when it's time to reconverge.
//    Particles switch to "pull" mode and spiral back to centre.
//    Character reappears as last particle converges.
//
//  renderBehind() — unchanged + draws burst shockwave ring
//  renderFront()  — unchanged + draws burst shatter particles
//  update()       — unchanged + ticks burst particle physics
// ================================================================

const gestureReactionSystem = (() => {

  // ─────────────────────────────────────────────────────────────
  //  AUDIO — Web Audio API (completely unchanged)
  // ─────────────────────────────────────────────────────────────
  let _audioCtx   = null;
  let _audioReady = false;

  const _loopTracks = {
    romantic: { file: 'romantic meme.mp3', src: null, gain: null, vol: 0, targetVol: 0 },
    owa:      { file: 'owa.mp3',           src: null, gain: null, vol: 0, targetVol: 0 },
  };
  const _oneShots = {
    wow: { file: 'wow meme.mp3', buf: null },
    yay: { file: 'YAY Kids (Celebration) Sound Effect [Free Download].mp3', buf: null },
  };

  function _initAudio() {
    if (_audioReady) return;
    if (!((typeof companionMode !== 'undefined') && companionMode)) return;
    try { _audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch(e) { return; }
    _audioReady = true;
    function fetchBuf(file, cb) {
      fetch(file).then(r => { if (!r.ok) throw 0; return r.arrayBuffer(); })
        .then(ab => _audioCtx.decodeAudioData(ab)).then(buf => cb(buf)).catch(() => {});
    }
    for (const key in _oneShots) {
      const s = _oneShots[key]; fetchBuf(s.file, buf => { s.buf = buf; });
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
  }

  function _tickAudio() {
    if (!_audioReady || !_audioCtx) return;
    const now = _audioCtx.currentTime;
    for (const key in _loopTracks) {
      const t = _loopTracks[key]; if (!t.gain) continue;
      t.vol += (t.targetVol - t.vol) * 0.08;
      t.gain.gain.setTargetAtTime(Math.max(0, Math.min(1, t.vol)), now, 0.05);
    }
  }

  function _playOnce(key) {
    if (!_audioReady || !_audioCtx) return;
    const s = _oneShots[key]; if (!s || !s.buf) return;
    try {
      const src = _audioCtx.createBufferSource(), g = _audioCtx.createGain();
      src.buffer = s.buf; src.loop = false;
      g.gain.setValueAtTime(0.88, _audioCtx.currentTime);
      src.connect(g); g.connect(_audioCtx.destination); src.start();
    } catch(e) {}
  }

  // ─────────────────────────────────────────────────────────────
  //  GESTURE INTENSITIES + COOLDOWNS (completely unchanged)
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
  //  DETECTION — all unchanged
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
      x:    W * 0.20 + Math.random() * W * 0.60,
      y:    H * 0.55 + Math.random() * H * 0.30,
      vy:   -(0.4 + Math.random() * 0.7),
      vx:   (Math.random() - 0.5) * 0.35,
      size: 7 + Math.random() * 13,
      life: 1.0,
      wave: Math.random() * Math.PI * 2,
    };
  }

  let _shakeX = 0, _shakeY = 0;
  let _flashAlpha = 0;
  let _prevSurpriseActive = false;

  function _drawHeartShape(dc, cx, cy, r) {
    const top    = cy - r * 0.50;
    const mid    = cy - r * 0.05;
    const bottom = cy + r * 0.50;
    const halfW  = r * 0.50;
    dc.beginPath();
    dc.moveTo(cx, mid);
    dc.bezierCurveTo(cx - halfW * 0.18, top, cx - halfW, top, cx - halfW, cy - r * 0.05);
    dc.bezierCurveTo(cx - halfW, cy + r * 0.22, cx - halfW * 0.22, cy + r * 0.35, cx, bottom);
    dc.bezierCurveTo(cx + halfW * 0.22, cy + r * 0.35, cx + halfW, cy + r * 0.22, cx + halfW, cy - r * 0.05);
    dc.bezierCurveTo(cx + halfW, top, cx + halfW * 0.18, top, cx, mid);
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
    return {
      x:    Math.random() * _W(),
      y:    top ? 0 : _H(),
      bW:   80 + Math.random() * 240,
      cH:   0,
      spd:  (top ? 3 : 9) + Math.random() * 16,
      life: Math.random() * 0.8,
      seed: Math.random() * 100,
      top:  !!top,
    };
  }
  function _resetFireBlob(b) {
    b.x = Math.random() * _W(); b.y = b.top ? 0 : _H();
    b.cH = 0; b.life = 0;
    b.spd = (b.top ? 3 : 9) + Math.random() * 16;
    b.seed = Math.random() * 100;
  }
  function _initFire() {
    if (_fireOk) return;
    for (let i = 0; i < _FIRE_N; i++) _fire.push(_newFireBlob(i < _FIRE_N * 0.22));
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
      _surpMini.push({
        ang:   Math.random() * Math.PI * 2,
        d:     0.28 + Math.random() * 0.22,
        rot:   Math.random() * Math.PI * 2,
        spikes: 8 + Math.floor(Math.random() * 6),
      });
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
    const ang = fromTop
      ? Math.PI * 0.5 + (Math.random() - 0.5) * Math.PI * 0.7
      : Math.random() * Math.PI * 2;
    const spd  = fromTop ? 2.5 + Math.random() * 4.5 : 5 + Math.random() * 13;
    const type = Math.random() < 0.14 ? 'circle' : Math.random() < 0.22 ? 'ribbon' : 'rect';
    const layer = Math.random() < 0.30 ? 'back' : 'front';
    return {
      x, y,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd - (fromTop ? 0 : 2 + Math.random() * 7),
      vr: (Math.random() - 0.5) * 0.36,
      rot: Math.random() * Math.PI * 2,
      w:   type === 'ribbon' ? 4 + Math.random() * 5  : 7 + Math.random() * 13,
      h:   type === 'ribbon' ? 18 + Math.random() * 24 : 5 + Math.random() * 10,
      col: _CONF_COLS[Math.floor(Math.random() * _CONF_COLS.length)],
      life: 1.0,
      type,
      layer,
      wave: Math.random() * Math.PI * 2,
    };
  }

  // ─────────────────────────────────────────────────────────────
  //  BUNTING
  // ─────────────────────────────────────────────────────────────
  const _BUNTING_COLS = [
    '#FF6B6B','#FFD93D','#6BCB77','#4D96FF','#FF9248',
    '#C77DFF','#FFA0AC','#90E0EF','#FFBF47',
  ];
  const _BUNTING_FLAGS = 20;
  let _buntingAlpha = 0;
  let _buntingSwayT = 0;

  // ─────────────────────────────────────────────────────────────
  //  HALFTONE helper for surprise
  // ─────────────────────────────────────────────────────────────
  function _drawHalftone(dc, cx, cy, radius, alpha) {
    if (alpha < 0.005) return;
    const spacing = 26;
    const rows = Math.ceil(radius * 2 / spacing) + 1;
    dc.globalAlpha = 1;
    for (let row = -rows; row <= rows; row++) {
      for (let col = -rows; col <= rows; col++) {
        const px = col * spacing + (row % 2 === 0 ? spacing * 0.5 : 0);
        const py = row * spacing * 0.87;
        const d  = Math.sqrt(px * px + py * py);
        if (d > radius * 1.05) continue;
        const fade = Math.max(0, (d - radius * 0.5) / (radius * 0.55));
        const dotR = 1.5 + fade * 5.5;
        dc.fillStyle = `rgba(30,5,0,${(alpha * (0.3 + fade * 0.5)).toFixed(3)})`;
        dc.beginPath();
        dc.arc(cx + px, cy + py, dotR, 0, Math.PI * 2);
        dc.fill();
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  ★ NEW — BURST SYSTEM
  //
  //  Character-colour palette maps for shatter particles.
  //  Each particle is a coloured blob that flies outward then
  //  reconverges during rematerialisation.
  //
  //  States mirrored from window.burstState (set by gesture.js):
  //    "idle"  — nothing happening
  //    "burst" — particles flying outward
  //    "remat" — particles being pulled back inward
  // ─────────────────────────────────────────────────────────────
  const _BURST_CHAR_COLS = {
    blue:   ['#4A90D9','#2C5F8A','#7BB8E8','#1A3A5C','#A8D4F5'],
    cyan:   ['#2ECFCF','#1A8A8A','#6BE5E5','#0D5252','#A0F0F0'],
    green:  ['#4CAF50','#2E7D32','#81C784','#1B5E20','#C8E6C9'],
    pink:   ['#F06292','#AD1457','#F48FB1','#880E4F','#FCE4EC'],
    purple: ['#9C27B0','#6A1B9A','#CE93D8','#38006B','#F3E5F5'],
    red:    ['#F44336','#B71C1C','#EF9A9A','#7F0000','#FFCDD2'],
  };

  // Shatter particle pool
  const _burst = [];
  let _burstActive = false;
  let _burstCX = 0, _burstCY = 0;
  let _burstR  = 120;
  let _burstCharId = 'blue';

  // Shockwave ring
  let _shockRadius = 0;
  let _shockAlpha  = 0;
  let _shockActive = false;

  // Particle builder
  function _mkBurstParticle(cx, cy, charId, radius) {
    const ang   = Math.random() * Math.PI * 2;
    const spd   = 6 + Math.random() * 16;
    const cols  = _BURST_CHAR_COLS[charId] || _BURST_CHAR_COLS.blue;
    const col   = cols[Math.floor(Math.random() * cols.length)];
    const sz    = 8 + Math.random() * (radius * 0.22);
    // Spawn from random position within body radius
    const spawnD = Math.random() * radius * 0.6;
    return {
      x:      cx + Math.cos(ang) * spawnD,
      y:      cy + Math.sin(ang) * spawnD,
      vx:     Math.cos(ang) * spd,
      vy:     Math.sin(ang) * spd - 3 - Math.random() * 4,
      vr:     (Math.random() - 0.5) * 0.25,
      rot:    Math.random() * Math.PI * 2,
      col,
      sz,
      life:   1.0,
      phase:  'out',     // 'out' or 'in'
      wave:   Math.random() * Math.PI * 2,
      delay:  Math.random() * 0.22,  // stagger remat pull-in start
    };
  }

  // Trigger burst — called by gesture.js
  function triggerBurst(cx, cy, charId, radius) {
    _burstCX     = cx;
    _burstCY     = cy;
    _burstCharId = charId;
    _burstR      = radius;
    _burstActive = true;
    _burst.length = 0;

    const N = 55 + Math.floor(radius * 0.25);
    for (let i = 0; i < N; i++) {
      _burst.push(_mkBurstParticle(cx, cy, charId, radius));
    }

    // Shockwave
    _shockRadius = 0;
    _shockAlpha  = 1.0;
    _shockActive = true;
  }

  // Trigger rematerialise — called by gesture.js
  function triggerRemat() {
    for (const p of _burst) {
      p.phase = 'in';
    }
  }

  // Tick burst particles physics
  function _tickBurst() {
    if (!_burstActive || _burst.length === 0) return;

    // Update target centre from hero position (follows user during remat)
    const heroX = window.burstX || _burstCX;
    const heroY = window.burstY || _burstCY;

    const t = performance.now() * 0.001;
    const W = _W(), H = _H();

    // Shockwave expand
    if (_shockActive) {
      _shockRadius += 22;
      _shockAlpha  *= 0.84;
      if (_shockAlpha < 0.01) { _shockActive = false; _shockAlpha = 0; }
    }

    let allIn = true;
    for (let i = _burst.length - 1; i >= 0; i--) {
      const p = _burst[i];

      if (p.phase === 'out') {
        // Fly outward with gravity + wind
        p.vx  += (Math.random() - 0.5) * 0.4;
        p.vy  += 0.28;
        p.vx  *= 0.97;
        p.x   += p.vx;
        p.y   += p.vy;
        p.rot += p.vr;
        p.wave += 0.04;
        p.life -= 0.004;
        if (p.life < 0) p.life = 0;
        allIn = false;

      } else {
        // 'in' phase — pull toward current hero centre
        if (p.delay > 0) { p.delay -= 0.018; allIn = false; continue; }

        const dx    = heroX - p.x;
        const dy    = heroY - p.y;
        const dist  = Math.sqrt(dx * dx + dy * dy);

        if (dist < 8) {
          // Arrived — remove particle
          _burst.splice(i, 1);
          continue;
        }

        // Magnetic pull — accelerates as gets closer
        const pullStr = 0.18 + (1 - Math.min(dist / 400, 1)) * 0.35;
        p.vx = _lp(p.vx, (dx / dist) * dist * pullStr * 0.12, 0.25);
        p.vy = _lp(p.vy, (dy / dist) * dist * pullStr * 0.12, 0.25);
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr * 0.5;
        p.wave += 0.06;
        // Fade back in as it converges
        p.life = Math.min(1.0, p.life + 0.012);
        allIn = false;
      }
    }

    if (_burst.length === 0) {
      _burstActive = false;
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  MAIN DETECT + STATE UPDATE
  // ─────────────────────────────────────────────────────────────
  function _detect() {
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
    if (confScore > G.confetti) G.confetti = Math.min(confScore, G.confetti + 0.12);
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

    // Surprise state machine
    if (_active === 'surprise') {
      if (_surpState === 'off' || _surpState === 'out') {
        _surpState = 'in'; _surpHoldFrames = 0; _randomiseMini();
      }
      if (_surpState === 'in') {
        _surpTargetScale = _lp(_surpTargetScale, 1.12, 0.22);
        _surpScale = _lp(_surpScale, _surpTargetScale, 0.28);
        _surpAlpha += (1.0 - _surpAlpha) * 0.28;
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
        _surpScale = _lp(_surpScale, 0, 0.07);
        _surpAlpha = _lp(_surpAlpha, 0, 0.055);
        if (_surpAlpha < 0.008) {
          _surpState = 'off'; _surpScale = 0; _surpAlpha = 0; _surpTargetScale = 0;
        }
      }
    }

    if (G.heart > 0.05) _heartPhase = (_heartPhase + 0.006) % 1.0;

    if (_active === 'heart') {
      if (--_heartPartTimer <= 0 && _heartParticles.length < _HEART_PART_MAX) {
        _heartParticles.push(_mkHeartParticle(_W(), _H()));
        _heartPartTimer = 18 + Math.floor(Math.random() * 18);
      }
    }

    if (_active === 'rock' && G.rock > 0.4) {
      const shakeAmt = G.rock * 2.2;
      _shakeX = (Math.random() - 0.5) * shakeAmt;
      _shakeY = (Math.random() - 0.5) * shakeAmt;
    } else {
      _shakeX *= 0.75;
      _shakeY *= 0.75;
    }

    const isSurpriseActive = (_active === 'surprise');
    if (isSurpriseActive && !_prevSurpriseActive) {
      _flashAlpha = 1.0;
    }
    _prevSurpriseActive = isSurpriseActive;
    _flashAlpha *= 0.55;
    if (_flashAlpha < 0.005) _flashAlpha = 0;

    if (_active === 'rock') { _initFire(); _heatT += 0.04; }

    _buntingAlpha = _lp(_buntingAlpha, (_active === 'confetti') ? 1.0 : 0.0, 0.08);
    if (_active === 'confetti') _buntingSwayT += 0.022;

    if (_active === 'confetti' && _confetti.length < _CONF_MAX) {
      const W = _W(), H = _H();
      const cx = W / 2, cy = H * 0.40;
      const burstN = Math.min(8, _CONF_MAX - _confetti.length);
      for (let k = 0; k < burstN; k++) {
        _confetti.push(_mkPiece(
          cx + (Math.random() - 0.5) * 340,
          cy + (Math.random() - 0.5) * 180,
          false
        ));
      }
      const rainN = Math.min(4, _CONF_MAX - _confetti.length);
      for (let k = 0; k < rainN; k++) {
        _confetti.push(_mkPiece(Math.random() * _W(), -10 - Math.random() * 40, true));
      }
    }
  }

  // ─────────────────────────────────────────────────────────────
  //  RENDER BEHIND
  // ─────────────────────────────────────────────────────────────
  function renderBehind() {
    if (typeof push !== 'function') return;
    const W = _W(), H = _H();
    const t = performance.now() * 0.001;
    push();
    const dc = drawingContext;
    dc.save();

    // ════════════════════════════════════════════
    //  HEART
    // ════════════════════════════════════════════
    if (G.heart > 0.02) {
      const cx = W / 2, cy = H / 2;
      const maxRadius   = Math.sqrt(W * W + H * H) * 0.85;
      const ringCount   = 12;
      const ringSpacing = maxRadius / ringCount;
      const breathe = 1.0 + 0.03 * Math.sin(t * 1.1);

      const glowR = maxRadius * 0.55 * G.heart;
      const glow  = dc.createRadialGradient(cx, cy, 0, cx, cy, glowR);
      glow.addColorStop(0,   `rgba(255,100,160,${(G.heart * 0.28).toFixed(3)})`);
      glow.addColorStop(0.5, `rgba(240,60,120,${(G.heart * 0.14).toFixed(3)})`);
      glow.addColorStop(1,   'rgba(220,30,90,0)');
      dc.fillStyle = glow; dc.globalAlpha = 1;
      dc.beginPath(); dc.arc(cx, cy, glowR, 0, Math.PI * 2); dc.fill();

      dc.save();
      dc.translate(cx, cy); dc.scale(breathe, breathe); dc.translate(-cx, -cy);
      for (let i = ringCount; i >= 0; i--) {
        const phase = (_heartPhase + i / ringCount) % 1.0;
        const r = phase * maxRadius + ringSpacing * 0.5;
        if (r < 2) continue;
        dc.fillStyle   = (i % 2 === 0) ? '#E8437A' : '#FFB3CC';
        dc.globalAlpha = G.heart;
        _drawHeartShape(dc, cx, cy, r);
        dc.fill();
      }
      dc.restore();
      dc.globalAlpha = 1;

      for (let i = _heartParticles.length - 1; i >= 0; i--) {
        const p = _heartParticles[i];
        p.y  += p.vy;
        p.x  += p.vx + Math.sin(p.wave + t * 1.3) * 0.3;
        p.wave += 0.025;
        p.life -= 0.008;
        if (p.life <= 0 || p.y < -40) { _heartParticles.splice(i, 1); continue; }
        const pa = Math.min(1, p.life * 2.0) * G.heart * 0.55;
        if (pa < 0.01) continue;
        const s = p.size * (1.0 + 0.03 * Math.sin(t * 1.1));
        dc.globalAlpha = pa;
        _drawHeartShape(dc, p.x, p.y, s * 0.6);
        dc.fillStyle = '#FF6BA0';
        dc.fill();
      }
      dc.globalAlpha = 1;
    }

    // ════════════════════════════════════════════
    //  ROCK / FIRE
    // ════════════════════════════════════════════
    const fi = (_active === 'rock') ? G.rock : _lp(0, G.rock, 0.04);
    if (fi > 0.02) {
      _initFire();
      dc.save();
      dc.translate(_shakeX, _shakeY);

      const bgGrad = dc.createRadialGradient(W*0.5, H*0.5, 0, W*0.5, H*0.5, Math.max(W,H) * 0.75);
      bgGrad.addColorStop(0,    `rgba(55,3,0,${(fi * 0.85).toFixed(3)})`);
      bgGrad.addColorStop(0.50, `rgba(18,0,0,${(fi * 0.92).toFixed(3)})`);
      bgGrad.addColorStop(1,    `rgba(0,0,0,${(fi * 0.98).toFixed(3)})`);
      dc.fillStyle = bgGrad; dc.globalAlpha = 1;
      dc.fillRect(0, 0, W, H);

      const crackPulse = 0.5 + 0.5 * Math.sin(t * 1.9);
      dc.lineWidth   = 1;
      dc.globalAlpha = 1;
      const crackSpacing = 56;
      for (let cx2 = 0; cx2 < W; cx2 += crackSpacing) {
        for (let cy2 = 0; cy2 < H; cy2 += crackSpacing) {
          const jx = Math.sin(cx2 * 0.065 + t * 0.85) * 14;
          const jy = Math.cos(cy2 * 0.065 + t * 0.70) * 14;
          const crAlpha = fi * 0.14 * crackPulse;
          dc.strokeStyle = `rgba(255,75,0,${crAlpha.toFixed(3)})`;
          dc.beginPath();
          dc.moveTo(cx2 + jx, cy2);
          dc.lineTo(cx2 + crackSpacing * 0.5 - jx, cy2 + crackSpacing * 0.5 + jy);
          dc.lineTo(cx2 + crackSpacing + jx, cy2 + crackSpacing);
          dc.stroke();
        }
      }

      for (const b of _fire) {
        b.cH  += b.spd * fi;
        b.life += 0.018;
        if (b.life >= 1.0) _resetFireBlob(b);
        const env = fi * Math.sin(b.life * Math.PI);
        if (env < 0.018) continue;
        const xO  = Math.sin(b.cH * 0.032 + b.seed) * 24;
        const bx  = b.x + xO;
        const by  = b.top ? 0 : H;
        const dir = b.top ? 1 : -1;
        const maxH = b.top ? H * 0.20 : H * 0.65;
        const fw  = b.bW * env;
        const fh  = Math.min(b.cH * env, maxH);
        const LAYERS = [
          { col:'rgba(90,0,0,1)',        sc:1.00, a: 0.72 },
          { col:'rgba(190,15,0,1)',      sc:0.80, a: 0.82 },
          { col:'rgba(255,70,0,1)',      sc:0.58, a: 0.88 },
          { col:'rgba(255,155,0,1)',     sc:0.36, a: 0.92 },
          { col:'rgba(255,228,75,1)',    sc:0.18, a: 0.97 },
          { col:'rgba(255,255,195,0.85)',sc:0.07, a: 1.00 },
        ];
        dc.globalCompositeOperation = 'source-over';
        for (const ly of LAYERS) {
          const cW = fw * ly.sc, cH = fh * ly.sc;
          if (cW < 1 || cH < 1) continue;
          dc.fillStyle = ly.col; dc.globalAlpha = env * ly.a;
          dc.beginPath();
          dc.moveTo(bx - cW * 0.5, by);
          dc.bezierCurveTo(bx-cW*1.14, by+dir*cH*0.20, bx-cW*0.10, by+dir*cH*0.78, bx, by+dir*cH);
          dc.bezierCurveTo(bx+cW*0.10, by+dir*cH*0.78, bx+cW*1.14, by+dir*cH*0.20, bx+cW*0.5, by);
          dc.fill();
        }
        dc.globalCompositeOperation = 'lighter';
        const grd = dc.createRadialGradient(bx, by, 0, bx, by, fw * 0.95);
        grd.addColorStop(0, `rgba(255,110,0,${(env * 0.38).toFixed(3)})`);
        grd.addColorStop(1, 'rgba(180,30,0,0)');
        dc.fillStyle = grd; dc.globalAlpha = env * 0.65;
        dc.beginPath(); dc.ellipse(bx, by, fw * 0.72, fw * 0.17, 0, 0, Math.PI*2); dc.fill();
        dc.globalCompositeOperation = 'source-over';
      }

      const shimAmt = fi * 0.16 * (0.65 + 0.35 * Math.sin(t * 3.3));
      const shimmer = dc.createLinearGradient(0, H*0.32, 0, H*0.68);
      shimmer.addColorStop(0,   'rgba(0,0,0,0)');
      shimmer.addColorStop(0.4, `rgba(8,0,0,${shimAmt.toFixed(3)})`);
      shimmer.addColorStop(0.6, `rgba(8,0,0,${shimAmt.toFixed(3)})`);
      shimmer.addColorStop(1,   'rgba(0,0,0,0)');
      dc.fillStyle = shimmer; dc.globalAlpha = 1;
      dc.fillRect(0, H*0.32, W, H*0.36);

      const vig = dc.createRadialGradient(W*0.5, H*0.5, H*0.22, W*0.5, H*0.5, Math.max(W,H)*0.75);
      vig.addColorStop(0, 'rgba(0,0,0,0)');
      vig.addColorStop(1, `rgba(0,0,0,${(fi * 0.78).toFixed(3)})`);
      dc.fillStyle = vig; dc.globalAlpha = 1; dc.fillRect(0, 0, W, H);

      dc.globalAlpha = 1;
      dc.globalCompositeOperation = 'source-over';
      dc.restore();
    }

    // ════════════════════════════════════════════
    //  SURPRISE
    // ════════════════════════════════════════════
    if (_surpAlpha > 0.008 && _surpScale > 0.01) {
      const cx   = W * 0.5, cy = H * 0.42;
      const BASE  = Math.min(W, H) * 0.56;
      const alpha = _surpAlpha;
      const sc    = _surpScale;

      dc.save();
      dc.translate(cx, cy);
      dc.scale(sc, sc);

      const bgBurst = dc.createRadialGradient(0, 0, 0, 0, 0, BASE * 2.4);
      bgBurst.addColorStop(0,    `rgba(255,245,55,${(alpha * 0.92).toFixed(3)})`);
      bgBurst.addColorStop(0.20, `rgba(255,175,0,${(alpha * 0.82).toFixed(3)})`);
      bgBurst.addColorStop(0.55, `rgba(220,55,0,${(alpha * 0.60).toFixed(3)})`);
      bgBurst.addColorStop(1,    `rgba(80,8,0,${(alpha * 0.22).toFixed(3)})`);
      dc.fillStyle = bgBurst; dc.globalAlpha = 1;
      dc.beginPath(); dc.arc(0, 0, BASE * 2.4, 0, Math.PI * 2); dc.fill();

      dc.restore();
      dc.save();
      _drawHalftone(dc, cx, cy, BASE * 1.9 * sc, alpha * 0.13);
      dc.translate(cx, cy); dc.scale(sc, sc);

      const LINE_N    = 32;
      const lineExtent = BASE * 2.8;
      for (let i = 0; i < LINE_N; i++) {
        const ang   = (i / LINE_N) * Math.PI * 2;
        const inner = BASE * 0.20;
        const outer = lineExtent + Math.sin(i * 1.65) * BASE * 0.14;
        const lw    = 4.5 + Math.sin(i * 0.95) * 3.0;
        dc.strokeStyle = `rgba(10,3,0,${(alpha * 0.88).toFixed(3)})`;
        dc.lineWidth   = lw; dc.lineCap = 'butt'; dc.globalAlpha = 1;
        dc.beginPath();
        dc.moveTo(Math.cos(ang) * inner, Math.sin(ang) * inner);
        dc.lineTo(Math.cos(ang) * outer, Math.sin(ang) * outer);
        dc.stroke();
      }

      const SPIKES = 26;
      const outerR = BASE * 1.12, innerR = BASE * 0.62;
      dc.fillStyle   = `rgba(255,228,0,${(alpha * 0.97).toFixed(3)})`;
      dc.strokeStyle = `rgba(150,70,0,${(alpha * 0.72).toFixed(3)})`;
      dc.lineWidth   = 5; dc.globalAlpha = 1;
      dc.beginPath();
      for (let i = 0; i < SPIKES * 2; i++) {
        const r   = i % 2 === 0 ? outerR : innerR;
        const ang = (Math.PI / SPIKES) * i - Math.PI / 2;
        i === 0
          ? dc.moveTo(Math.cos(ang)*r, Math.sin(ang)*r)
          : dc.lineTo(Math.cos(ang)*r, Math.sin(ang)*r);
      }
      dc.closePath(); dc.fill(); dc.stroke();

      for (const m of _surpMini) {
        const mx = Math.cos(m.ang) * BASE * m.d;
        const my = Math.sin(m.ang) * BASE * m.d;
        const mR = BASE * (0.11 + m.d * 0.09), miR = mR * 0.50;
        dc.fillStyle   = `rgba(255,205,0,${(alpha * 0.90).toFixed(3)})`;
        dc.strokeStyle = `rgba(180,75,0,${(alpha * 0.55).toFixed(3)})`;
        dc.lineWidth   = 2; dc.globalAlpha = 1;
        dc.save();
        dc.translate(mx, my);
        dc.rotate(m.rot + performance.now() * 0.0003);
        dc.beginPath();
        for (let i = 0; i < m.spikes * 2; i++) {
          const r   = i % 2 === 0 ? mR : miR;
          const ang = (Math.PI / m.spikes) * i;
          i === 0
            ? dc.moveTo(Math.cos(ang)*r, Math.sin(ang)*r)
            : dc.lineTo(Math.cos(ang)*r, Math.sin(ang)*r);
        }
        dc.closePath(); dc.fill(); dc.stroke();
        dc.restore();
      }

      const flash = dc.createRadialGradient(0, 0, 0, 0, 0, BASE * 0.38);
      flash.addColorStop(0,   `rgba(255,255,255,${(alpha * 0.97).toFixed(3)})`);
      flash.addColorStop(0.5, `rgba(255,252,140,${(alpha * 0.65).toFixed(3)})`);
      flash.addColorStop(1,   'rgba(255,200,0,0)');
      dc.fillStyle = flash; dc.globalAlpha = 1;
      dc.beginPath(); dc.arc(0, 0, BASE * 0.38, 0, Math.PI * 2); dc.fill();

      dc.restore();
      dc.globalAlpha = 1;
    }

    // ════════════════════════════════════════════
    //  CONFETTI BACK LAYER
    // ════════════════════════════════════════════
    if (_confetti.length > 0) {
      for (let i = 0; i < _confetti.length; i++) {
        const c = _confetti[i];
        if (c.layer !== 'back') continue;
        const a = Math.min(1, c.life * 2.2) * 0.68;
        if (a < 0.01) continue;
        dc.save();
        dc.globalAlpha = a;
        dc.fillStyle   = c.col;
        dc.translate(c.x, c.y);
        dc.rotate(c.rot);
        if (c.type === 'circle') {
          dc.beginPath(); dc.arc(0, 0, c.w * 0.44, 0, Math.PI * 2); dc.fill();
        } else if (c.type === 'ribbon') {
          dc.strokeStyle = c.col; dc.lineWidth = c.w * 0.8; dc.lineCap = 'round';
          dc.globalAlpha = a;
          dc.beginPath();
          dc.moveTo(0, -c.h * 0.5);
          dc.bezierCurveTo(c.w*1.6, -c.h*0.2, -c.w*1.6, c.h*0.2, 0, c.h*0.5);
          dc.stroke();
        } else {
          dc.fillRect(-c.w * 0.44, -c.h * 0.44, c.w * 0.88, c.h * 0.88);
        }
        dc.restore();
      }
      dc.globalAlpha = 1;
    }

    // ════════════════════════════════════════════
    //  ★ NEW — BURST SHOCKWAVE RING (behind character)
    // ════════════════════════════════════════════
    if (_shockActive && _shockAlpha > 0.01) {
      const cols = _BURST_CHAR_COLS[_burstCharId] || _BURST_CHAR_COLS.blue;
      const col1 = cols[0];
      const col2 = cols[2] || cols[0];
      dc.save();
      dc.strokeStyle = col1;
      dc.lineWidth   = 8 + _shockRadius * 0.04;
      dc.globalAlpha = _shockAlpha * 0.9;
      dc.beginPath();
      dc.arc(_burstCX, _burstCY, _shockRadius, 0, Math.PI * 2);
      dc.stroke();
      // Second ring slightly behind
      dc.strokeStyle = col2;
      dc.lineWidth   = 3;
      dc.globalAlpha = _shockAlpha * 0.5;
      dc.beginPath();
      dc.arc(_burstCX, _burstCY, _shockRadius * 0.88, 0, Math.PI * 2);
      dc.stroke();
      dc.restore();
    }

    // ════════════════════════════════════════════
    //  ★ NEW — BURST PARTICLES BACK LAYER (phase 'in' behind char)
    // ════════════════════════════════════════════
    if (_burst.length > 0) {
      dc.save();
      for (const p of _burst) {
        if (p.phase !== 'in') continue;  // 'in' particles go behind during remat
        const a = Math.min(1, p.life * 1.8) * 0.75;
        if (a < 0.01) continue;
        dc.save();
        dc.globalAlpha = a;
        dc.fillStyle   = p.col;
        dc.translate(p.x, p.y);
        dc.rotate(p.rot);
        const sz = p.sz;
        // Draw as rounded blob
        dc.beginPath();
        dc.ellipse(0, 0, sz * 0.55, sz * 0.4, 0, 0, Math.PI * 2);
        dc.fill();
        // Inner highlight
        dc.fillStyle = 'rgba(255,255,255,0.28)';
        dc.beginPath();
        dc.ellipse(-sz * 0.10, -sz * 0.08, sz * 0.18, sz * 0.12, -0.4, 0, Math.PI * 2);
        dc.fill();
        dc.restore();
      }
      dc.globalAlpha = 1;
      dc.restore();
    }

    // ════════════════════════════════════════════
    //  SURPRISE WHITE FLASH
    // ════════════════════════════════════════════
    if (_flashAlpha > 0.004) {
      dc.fillStyle   = '#ffffff';
      dc.globalAlpha = _flashAlpha;
      dc.fillRect(0, 0, W, H);
      dc.globalAlpha = 1;
    }

    dc.globalAlpha = 1;
    dc.restore();
    pop();
    noTint();
  }

  // ─────────────────────────────────────────────────────────────
  function renderFront() {
    if (typeof push !== 'function') return;
    const W = _W(), H = _H();
    const t = performance.now() * 0.001;
    push();
    const dc = drawingContext;
    dc.save();

    // ── Bunting ─────────────────────────────────────────────
    if (_buntingAlpha > 0.01) {
      const flagW   = W / (_BUNTING_FLAGS - 1);
      const ropeY   = H * 0.055;
      const flagH   = Math.min(44, H * 0.06);
      const alpha   = _buntingAlpha;

      dc.strokeStyle = `rgba(80,48,18,${(alpha * 0.65).toFixed(3)})`;
      dc.lineWidth   = 2.5; dc.globalAlpha = 1;
      dc.beginPath();
      for (let i = 0; i <= _BUNTING_FLAGS; i++) {
        const rx    = i * flagW;
        const normX = (rx / W - 0.5) * 2;
        const sagY  = ropeY + normX * normX * H * 0.035;
        const sway  = Math.sin(_buntingSwayT + i * 0.55) * 4;
        i === 0 ? dc.moveTo(rx, sagY + sway) : dc.lineTo(rx, sagY + sway);
      }
      dc.stroke();

      for (let i = 0; i < _BUNTING_FLAGS; i++) {
        const rx    = i * flagW + flagW * 0.5;
        const normX = (rx / W - 0.5) * 2;
        const sagY  = ropeY + normX * normX * H * 0.035;
        const sway  = Math.sin(_buntingSwayT + i * 0.55) * 7;
        const col   = _BUNTING_COLS[i % _BUNTING_COLS.length];
        dc.save();
        dc.translate(rx + sway * 0.4, sagY + sway * 0.15);
        dc.rotate(Math.sin(_buntingSwayT * 1.05 + i * 0.8) * 0.09);
        dc.fillStyle   = col;
        dc.strokeStyle = `rgba(255,255,255,${(alpha * 0.35).toFixed(3)})`;
        dc.lineWidth   = 1;
        dc.globalAlpha = alpha * 0.90;
        dc.beginPath();
        dc.moveTo(-flagW * 0.36, 0);
        dc.lineTo( flagW * 0.36, 0);
        dc.lineTo( 0,             flagH);
        dc.closePath();
        dc.fill(); dc.stroke();
        dc.restore();
      }
      dc.globalAlpha = 1;
    }

    // ── Confetti particles — physics tick ALL, draw FRONT layer only
    for (let i = _confetti.length - 1; i >= 0; i--) {
      const c = _confetti[i];
      c.vy  += 0.20;
      c.vx  += Math.sin(c.wave + t * 2.4) * 0.09;
      c.vx  *= 0.993;
      c.x   += c.vx;
      c.y   += c.vy;
      c.rot += c.vr;
      c.wave += 0.038;
      c.life -= 0.008;
      if (c.life <= 0 || c.y > H + 70) { _confetti.splice(i, 1); continue; }
      if (c.layer !== 'front') continue;
      const a = Math.min(1, c.life * 2.2);
      dc.save();
      dc.globalAlpha = a;
      dc.fillStyle   = c.col;
      dc.translate(c.x, c.y);
      dc.rotate(c.rot);
      if (c.type === 'circle') {
        dc.beginPath(); dc.arc(0, 0, c.w * 0.5, 0, Math.PI * 2); dc.fill();
      } else if (c.type === 'ribbon') {
        dc.strokeStyle = c.col; dc.lineWidth = c.w; dc.lineCap = 'round';
        dc.globalAlpha = a;
        dc.beginPath();
        dc.moveTo(0, -c.h * 0.5);
        dc.bezierCurveTo(c.w*1.6, -c.h*0.2, -c.w*1.6, c.h*0.2, 0, c.h*0.5);
        dc.stroke();
      } else {
        dc.fillRect(-c.w * 0.5, -c.h * 0.5, c.w, c.h);
      }
      dc.restore();
    }

    // ════════════════════════════════════════════
    //  ★ NEW — BURST PARTICLES FRONT LAYER (phase 'out' in front of char)
    //  Also draws: implosion glow ring during remat
    // ════════════════════════════════════════════
    if (_burst.length > 0) {
      dc.save();
      for (const p of _burst) {
        if (p.phase !== 'out') continue;  // outbound fragments in front
        const a = Math.min(1, p.life * 1.6);
        if (a < 0.01) continue;
        dc.save();
        dc.globalAlpha = a;
        dc.fillStyle   = p.col;
        dc.translate(p.x, p.y);
        dc.rotate(p.rot);
        const sz = p.sz;
        // Jagged shard shape — alternating large/small radius polygon
        const sides = 5 + Math.floor(p.sz * 0.12);
        dc.beginPath();
        for (let j = 0; j < sides * 2; j++) {
          const r   = j % 2 === 0 ? sz * 0.55 : sz * 0.28;
          const ang = (Math.PI / sides) * j;
          j === 0
            ? dc.moveTo(Math.cos(ang) * r, Math.sin(ang) * r)
            : dc.lineTo(Math.cos(ang) * r, Math.sin(ang) * r);
        }
        dc.closePath();
        dc.fill();
        // White sparkle centre
        dc.fillStyle   = 'rgba(255,255,255,0.55)';
        dc.globalAlpha = a * 0.5;
        dc.beginPath();
        dc.arc(0, 0, sz * 0.14, 0, Math.PI * 2);
        dc.fill();
        dc.restore();
      }

      // Remat implosion glow — soft halo at hero position during pull-in
      if (window.burstState === 'remat') {
        const heroX = window.burstX || _burstCX;
        const heroY = window.burstY || _burstCY;
        const cols  = _BURST_CHAR_COLS[_burstCharId] || _BURST_CHAR_COLS.blue;
        const rematProgress = Math.min(1, (90 - (_burst.length / 55) * 90) / 90);
        const glowSize = _burstR * (0.6 + rematProgress * 0.8);
        const glow  = dc.createRadialGradient(heroX, heroY, 0, heroX, heroY, glowSize);
        glow.addColorStop(0,   `rgba(255,255,255,${(0.5 * (1 - rematProgress) + 0.1).toFixed(3)})`);
        glow.addColorStop(0.3, `${cols[2] || cols[0]}88`);
        glow.addColorStop(1,   `${cols[0]}00`);
        dc.fillStyle   = glow;
        dc.globalAlpha = 0.7 * (1 - rematProgress * 0.5);
        dc.beginPath();
        dc.arc(heroX, heroY, glowSize, 0, Math.PI * 2);
        dc.fill();
      }

      dc.globalAlpha = 1;
      dc.restore();
    }

    dc.globalAlpha = 1;
    dc.restore();
    pop();
    noTint();
  }

  // ─────────────────────────────────────────────────────────────
  //  PUBLIC API
  // ─────────────────────────────────────────────────────────────
  return {
    update()           { _initAudio(); _detect(); _tickAudio(); _tickBurst(); },
    renderBehind,
    renderFront,
    triggerBurst,   // ★ NEW
    triggerRemat,   // ★ NEW
    getState()  { return { active: _active, G: { ...G }, surpState: _surpState }; },
  };

})();