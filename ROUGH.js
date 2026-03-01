// ================================================================
//  A W A K E N I N G  —  ROUGH.js
//
//  BUGS FIXED IN THIS VERSION:
//
//  FIX A — TINT STATE LEAK (root cause of invisible hands + face)
//    Dismissed blobs call tint(255, ~0). p5's push/pop does NOT
//    restore tint. That near-zero alpha tint persists globally and
//    makes everything drawn after them invisible.
//    Fix: noTint() called at top of every draw cycle, before hero
//    draws, and inside arm.draw(). Every image() call that must be
//    fully opaque now sets tint(255,255) explicitly.
//
//  FIX B — EMERGE USES ABSOLUTE frameCount (hands broken)
//    emerge phase used `frameCount * 0.009` as progress. If
//    awakening triggers at frame 400, progress = 3.6 on frame 1,
//    so all dots had pct=1 but alpha=0 — invisible for first 65
//    frames, then abruptly visible with no emerge animation.
//    Fix: replaced with this.emergeFrame counter that resets to 0
//    on every new Arm construction.
//
//  FIX C — _tickGaze() BLOCKED for awakening (eyeballs frozen)
//    update() blocked _tickGaze() during awakening mode, leaving
//    gx/gy stuck at 0. _watchNose() only runs when smoothNose
//    exists. Fix: _tickGaze() now runs every mode unconditionally.
//
//  FIX D — FACE ASSET NULL GUARD too aggressive
//    _drawAwakeFaceWorld() aborted if any single asset was null.
//    Now draws each asset independently — eyes without balls, etc.
//    Logs a single console warning if core assets are missing.
//
//  PRESERVED:
//    Combination-2 blob count  (BLOBS_PER_COLOR=3, 18 blobs total)
//    Combination-2 size range  (45-170)
//    DETECT_FRAMES=30          (~1 second detection delay)
//    All hand tracking, arm chain, expression, audio logic
// ================================================================

// ─────────────────────────────────────────────────────────────────
//  CHARACTER TABLE
// ─────────────────────────────────────────────────────────────────
const CHAR_DEFS = [
  { id:"blue",   body:"Blue_Body.png",   dot:"Blue_dot.png"   },
  { id:"cyan",   body:"Cyan_Body.png",   dot:"Cyan_dot.png"   },
  { id:"green",  body:"Green_Body.png",  dot:"green_dot.png"  },
  { id:"pink",   body:"Pink_Body.png",   dot:"Pink_Dot.png"   },
  { id:"purple", body:"Purple_Body.png", dot:"Purple_dot.png" },
  { id:"red",    body:"Red_body.png",    dot:"Red_Dot.png"    },
];

const BLOBS_PER_COLOR = 3; // 3 x 6 = 18 blobs total
const CHARS = {};

// ─────────────────────────────────────────────────────────────────
//  FIXED AWAKENED BODY SIZE
// ─────────────────────────────────────────────────────────────────
function computeAwakeBodyR(){
  const r = Math.min(windowWidth * 0.071, windowHeight * 0.16);
  return Math.max(r, 48);
}

// ─────────────────────────────────────────────────────────────────
//  EXPRESSION ASSETS
// ─────────────────────────────────────────────────────────────────
let EYE_OPEN, EYE_CLOSED, EYE_SCRUNCH, EYE_SURPRISE, EYE_CRY;
let BALL_L, BALL_R;
let MOUTH_OPEN, MOUTH_WHISTLE, MOUTH_SURPRISE, MOUTH_SAD;
let _assetWarnDone = false;

// ─────────────────────────────────────────────────────────────────
//  COMBO TABLE
// ─────────────────────────────────────────────────────────────────
const COMBO_DEFS = [
  { id:"peek",        eye:"open",     balls:true,  mouth:"none",     w:28 },
  { id:"happy",       eye:"open",     balls:true,  mouth:"open",     w:12 },
  { id:"whistle",     eye:"open",     balls:true,  mouth:"whistle",  w:18 },
  { id:"surprise-o",  eye:"open",     balls:true,  mouth:"surprise", w:6  },
  { id:"closed-hap",  eye:"closed",   balls:false, mouth:"open",     w:10 },
  { id:"closed-whi",  eye:"closed",   balls:false, mouth:"whistle",  w:14 },
  { id:"scrunch-hap", eye:"scrunch",  balls:false, mouth:"open",     w:8  },
  { id:"scrunch-whi", eye:"scrunch",  balls:false, mouth:"whistle",  w:10 },
  { id:"surprised",   eye:"surprise", balls:false, mouth:"surprise", w:5  },
  { id:"sad",         eye:"sad",      balls:false, mouth:"sad",      w:4  },
];

function eyeImg(t){
  return {open:EYE_OPEN,closed:EYE_CLOSED,scrunch:EYE_SCRUNCH,
          surprise:EYE_SURPRISE,sad:EYE_CRY}[t] || null;
}
function mouthImg(t){
  if(t==="none") return null;
  return {open:MOUTH_OPEN,whistle:MOUTH_WHISTLE,
          surprise:MOUTH_SURPRISE,sad:MOUTH_SAD}[t] || null;
}
function comboOk(c){
  return !!eyeImg(c.eye) && (c.mouth==="none" || !!mouthImg(c.mouth));
}
function pickCombo(exclude){
  const pool = COMBO_DEFS.filter(c => comboOk(c) && (!exclude || c.id !== exclude.id));
  if(!pool.length) return COMBO_DEFS[0];
  let r = Math.random() * pool.reduce((s,c) => s+c.w, 0);
  for(const c of pool){ r -= c.w; if(r <= 0) return c; }
  return pool[0];
}

// ─────────────────────────────────────────────────────────────────
//  EXPRESSION DISTRIBUTION MANAGER
// ─────────────────────────────────────────────────────────────────
const EXPR_DIST = {
  activeSet: new Set(),
  timer: 0,
  INTERVAL: 280,

  init(count){
    this.activeSet.clear();
    const target = Math.floor(count * 0.5);
    const idx = Array.from({length:count}, (_,i) => i);
    for(let i = idx.length-1; i > 0; i--){
      const j = Math.floor(Math.random()*(i+1));
      [idx[i],idx[j]] = [idx[j],idx[i]];
    }
    for(let i = 0; i < target; i++) this.activeSet.add(idx[i]);
    this.timer = this.INTERVAL;
  },

  tick(count){
    if(--this.timer > 0) return;
    this.timer = this.INTERVAL + Math.floor(Math.random()*120 - 60);
    const swaps   = 1 + Math.floor(Math.random()*3);
    const active  = [...this.activeSet];
    const inactive = Array.from({length:count}, (_,i) => i).filter(i => !this.activeSet.has(i));
    for(let i = active.length-1; i > 0; i--){ const j=Math.floor(Math.random()*(i+1)); [active[i],active[j]]=[active[j],active[i]]; }
    for(let i = inactive.length-1; i > 0; i--){ const j=Math.floor(Math.random()*(i+1)); [inactive[i],inactive[j]]=[inactive[j],inactive[i]]; }
    for(let i = 0; i < Math.min(swaps,active.length); i++) this.activeSet.delete(active[i]);
    const max = Math.floor(count*0.65), min = Math.floor(count*0.35);
    for(let i = 0; i < Math.min(swaps,inactive.length); i++){
      if(this.activeSet.size < max) this.activeSet.add(inactive[i]);
    }
    if(this.activeSet.size < min){
      const fill = Array.from({length:count}, (_,i) => i).filter(i => !this.activeSet.has(i));
      for(let i = 0; this.activeSet.size < min && i < fill.length; i++) this.activeSet.add(fill[i]);
    }
  },

  is(idx){ return this.activeSet.has(idx); }
};

// ─────────────────────────────────────────────────────────────────
//  AUDIO — Whistle
// ─────────────────────────────────────────────────────────────────
let snd=null, sndReady=false, sndPlaying=false, sndCool=0;
function tryWhistle(){
  if(sndPlaying || sndCool>0 || !sndReady || !snd) return;
  try{
    if(typeof userStartAudio==="function") userStartAudio();
    snd.setVolume(0.7); snd.play();
    sndPlaying=true; sndCool=300;
    setTimeout(()=>{ sndPlaying=false; }, (snd.duration ? snd.duration()*1000 : 2200)+400);
  }catch(e){}
}
function stopWhistle(){
  if(!snd) return;
  try{ snd.stop(); }catch(e){}
  sndPlaying=false;
}

// ─────────────────────────────────────────────────────────────────
//  AUDIO — Wobble
// ─────────────────────────────────────────────────────────────────
let wobbleSounds=[], wobbleReady=false, wobbleCool=0, wobblePlaying=false;
function tryWobble(){
  if(wobblePlaying || wobbleCool>0 || !wobbleReady || !wobbleSounds.length) return;
  try{
    if(typeof userStartAudio==="function") userStartAudio();
    const w = wobbleSounds[Math.floor(Math.random()*wobbleSounds.length)];
    w.setVolume(0.65); w.play();
    wobblePlaying=true; wobbleCool=45;
    setTimeout(()=>{ wobblePlaying=false; }, (w.duration ? w.duration()*1000 : 800)+200);
  }catch(e){}
}

// ─────────────────────────────────────────────────────────────────
//  FLOATING NOTES
// ─────────────────────────────────────────────────────────────────
const NOTES = [];
function spawnNote(x,y){
  NOTES.push({ x:x+Math.random()*28-14, y, a:220,
    vy:-1.4-Math.random()*1.1,
    life:65+Math.floor(Math.random()*50),
    sym:["♪","♫","♩","♬"][Math.floor(Math.random()*4)] });
}
function drawNotes(){
  for(let i=NOTES.length-1; i>=0; i--){
    const n=NOTES[i];
    n.y += n.vy; n.x += Math.sin(n.life*.12)*.5;
    n.a = lerp(n.a, 0, .03); n.life--;
    if(n.life<=0 || n.a<2){ NOTES.splice(i,1); continue; }
    push(); noStroke(); fill(255,215,60,n.a);
    textSize(13); textAlign(CENTER,CENTER); text(n.sym,n.x,n.y); pop();
  }
}

// ─────────────────────────────────────────────────────────────────
//  PAPER TEXTURE
// ─────────────────────────────────────────────────────────────────
let paperGfx = null;
function buildPaper(){
  const W=Math.ceil(windowWidth/2), H=Math.ceil(windowHeight/2);
  if(paperGfx) paperGfx.remove();
  paperGfx = createGraphics(W,H);
  paperGfx.pixelDensity(1);
  paperGfx.randomSeed(77); paperGfx.noiseSeed(77);
  paperGfx.background(238,231,213);
  paperGfx.noStroke();
  for(let i=0;i<180;i++){
    const px=paperGfx.random(W),py=paperGfx.random(H),pr=paperGfx.random(18,110),v=paperGfx.random(-10,9);
    paperGfx.fill(Math.min(255,Math.max(200,238+v)),Math.min(248,Math.max(195,231+v)),Math.min(235,Math.max(180,213+v)),paperGfx.random(12,38));
    paperGfx.ellipse(px,py,pr,pr*paperGfx.random(0.4,1.7));
  }
  for(let i=0;i<W*H*0.03;i++){
    const px=paperGfx.random(W),py=paperGfx.random(H),v=paperGfx.random(-18,20);
    paperGfx.fill(Math.min(255,Math.max(160,220+v)),Math.min(248,Math.max(155,213+v)),Math.min(235,Math.max(148,200+v)),paperGfx.random(30,90));
    paperGfx.rect(px,py,1,1);
  }
  paperGfx.stroke(162,155,142,20); paperGfx.strokeWeight(0.5);
  let lY=0;
  while(lY<H){ lY+=paperGfx.random(8,15); paperGfx.line(0,lY,W,lY+paperGfx.random(-2,2)); }
}
function drawPaper(){
  // FIX A: noTint() here so paper never inherits a dirty tint
  push(); noTint(); imageMode(CORNER); image(paperGfx,0,0,width,height); imageMode(CENTER); pop();
}

// ─────────────────────────────────────────────────────────────────
//  EASING
// ─────────────────────────────────────────────────────────────────
function easeInOut(t){ t=constrain(t,0,1); return t<0.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2; }
function easeOut3(t) { return 1-Math.pow(1-constrain(t,0,1),3); }

// ─────────────────────────────────────────────────────────────────
//  FACE TRACKING
// ─────────────────────────────────────────────────────────────────
let rawNose=null, smoothNose=null;
const EXPR = {smile:0,smileR:0,eyeL:0,eyeLR:0,eyeR:0,eyeRR:0,brows:0,browsR:0};

function parseFace(){
  const faces = window.mpFaces;
  if(!faces || !faces.length){ rawNose=null; return; }
  const lm=faces[0], pt=i=>({x:lm[i].x*width, y:lm[i].y*height});
  const D=(a,b)=>dist(a.x,a.y,b.x,b.y);
  rawNose = pt(1);
  const mL=pt(61),mR=pt(291),eL=pt(33),eR=pt(263),fW=D(eL,eR)||1;
  EXPR.smileR = constrain(map(D(mL,mR)/fW,0.3,0.55,0,1),0,1);
  EXPR.eyeLR  = constrain(map(D(pt(159),pt(145))/(D(pt(33),pt(133))||1),0.1,0.4,0,1),0,1);
  EXPR.eyeRR  = constrain(map(D(pt(386),pt(374))/(D(pt(362),pt(263))||1),0.1,0.4,0,1),0,1);
  const mB=(pt(70).y+pt(300).y)*0.5, mE=(eL.y+eR.y)*0.5;
  EXPR.browsR = constrain(map((mE-mB)/(fW*1.2),0.05,0.18,0,1),0,1);
}
function smoothExprs(){
  if(rawNose){
    if(!smoothNose) smoothNose={x:rawNose.x,y:rawNose.y};
    smoothNose.x=lerp(smoothNose.x,rawNose.x,.10);
    smoothNose.y=lerp(smoothNose.y,rawNose.y,.10);
  } else smoothNose=null;
  EXPR.smile=lerp(EXPR.smile,EXPR.smileR,.08);
  EXPR.eyeL =lerp(EXPR.eyeL, EXPR.eyeLR, .08);
  EXPR.eyeR =lerp(EXPR.eyeR, EXPR.eyeRR, .08);
  EXPR.brows=lerp(EXPR.brows,EXPR.browsR,.08);
}

// ─────────────────────────────────────────────────────────────────
//  HAND TRACKING
// ─────────────────────────────────────────────────────────────────
const HAND_DATA = {
  left:  { wx:0,wy:0, px:0,py:0, present:false, smWX:null,smWY:null,smPX:null,smPY:null },
  right: { wx:0,wy:0, px:0,py:0, present:false, smWX:null,smWY:null,smPX:null,smPY:null },
};
const HAND_LERP = 0.22;

function parseHands(){
  HAND_DATA.left.present  = false;
  HAND_DATA.right.present = false;
  const hands = window.mpHands;
  if(!hands || !hands.length) return;
  for(const h of hands){
    if(!h.landmarks || !h.handedness) continue;
    const side = (h.handedness === "Left") ? "left" : "right";
    const lm   = h.landmarks;
    const wristX = (1.0 - lm[0].x) * width;
    const wristY = lm[0].y * height;
    const pIdxs = [0, 5, 9, 13, 17];
    let pcx=0, pcy=0;
    for(const idx of pIdxs){ pcx += (1.0 - lm[idx].x); pcy += lm[idx].y; }
    pcx = (pcx / pIdxs.length) * width;
    pcy = (pcy / pIdxs.length) * height;
    const hd = HAND_DATA[side];
    if(hd.smWX === null){ hd.smWX=wristX; hd.smWY=wristY; hd.smPX=pcx; hd.smPY=pcy; }
    hd.smWX = lerp(hd.smWX, wristX, HAND_LERP);
    hd.smWY = lerp(hd.smWY, wristY, HAND_LERP);
    hd.smPX = lerp(hd.smPX, pcx,    HAND_LERP);
    hd.smPY = lerp(hd.smPY, pcy,    HAND_LERP);
    hd.wx = hd.smWX; hd.wy = hd.smWY;
    hd.px = hd.smPX; hd.py = hd.smPY;
    hd.present = true;
  }
}

// ─────────────────────────────────────────────────────────────────
//  APP STATE
// ─────────────────────────────────────────────────────────────────
let STATE="idle", detectTimer=0;
const DETECT_FRAMES = 30; // ~1 second at 30fps
let blobs=[], heroIdx=0, blobsReady=false;

// ─────────────────────────────────────────────────────────────────
//  PRELOAD
// ─────────────────────────────────────────────────────────────────
function preload(){
  const warn = n => ()=>console.warn("MISSING ASSET: "+n);
  for(const d of CHAR_DEFS){
    CHARS[d.id] = {
      body: loadImage(d.body, null, warn(d.body)),
      dot:  loadImage(d.dot,  null, warn(d.dot))
    };
  }
  EYE_OPEN     = loadImage("Eyes-open-f.png",           null, warn("Eyes-open-f.png"));
  EYE_CLOSED   = loadImage("Eyes-closed-f.png",         null, warn("Eyes-closed-f.png"));
  EYE_SCRUNCH  = loadImage("Eyes-closed-scrunch-f.png", null, warn("Eyes-closed-scrunch-f.png"));
  EYE_SURPRISE = loadImage("Eyes-surprise.png",         null, warn("Eyes-surprise.png"));
  EYE_CRY      = loadImage("Eyes-cry.png",              null, warn("Eyes-cry.png"));
  BALL_L       = loadImage("Eye-ball-Lf.png",           null, warn("Eye-ball-Lf.png"));
  BALL_R       = loadImage("Eye-ball-Rf.png",           null, warn("Eye-ball-Rf.png"));
  MOUTH_OPEN     = loadImage("Mouth-f.png",   null, warn("Mouth-f.png"));
  MOUTH_WHISTLE  = loadImage("MouthW-f.png",  null, warn("MouthW-f.png"));
  MOUTH_SURPRISE = loadImage("MouthS.png",    null, warn("MouthS.png"));
  MOUTH_SAD      = loadImage("MouthSad.png",  null, warn("MouthSad.png"));
  if(typeof loadSound==="function"){
    try{
      snd = loadSound("whistle.mp3",
        ()=>{ sndReady=true; },
        ()=>console.warn("whistle.mp3 missing"));
      const w1 = loadSound("freesound_community-wobble-board-101198.mp3",
        ()=>{ wobbleSounds.push(w1); wobbleReady=true; },
        ()=>console.warn("wobble1 missing"));
      const w2 = loadSound("mrstokes302-wobble-sfx-447574.mp3",
        ()=>{ wobbleSounds.push(w2); wobbleReady=true; },
        ()=>console.warn("wobble2 missing"));
    }catch(e){ console.warn("p5.sound error:",e); }
  }
}

// ─────────────────────────────────────────────────────────────────
//  SETUP
// ─────────────────────────────────────────────────────────────────
function setup(){
  createCanvas(windowWidth, windowHeight);
  pixelDensity(displayDensity());
  imageMode(CENTER);
  textFont("sans-serif");
  buildPaper();
}

// ─────────────────────────────────────────────────────────────────
//  DRAW
//  Render order: non-hero blobs → (noTint reset) → hero arms
//                → hero body → (noTint reset) → hero face
// ─────────────────────────────────────────────────────────────────
function draw(){
  if(!blobsReady){
    blobsReady=true;
    for(const d of CHAR_DEFS){
      for(let i=0;i<BLOBS_PER_COLOR;i++){
        blobs.push(new BlobChar(blobs.length, d.id));
      }
    }
    EXPR_DIST.init(blobs.length);
    console.log("Blobs ready:", blobs.length);
  }

  // FIX A: clean tint slate every frame before anything draws
  noTint();
  drawPaper();

  parseFace();
  smoothExprs();
  parseHands();
  updateState();
  handleCollisions();
  if(sndCool > 0) sndCool--;
  if(wobbleCool > 0) wobbleCool--;
  EXPR_DIST.tick(blobs.length);

  // Non-hero blobs
  for(let i=0;i<blobs.length;i++){
    if((STATE==="selection"||STATE==="awakening") && i===heroIdx) continue;
    blobs[i].update();
    blobs[i].draw();
  }

  // FIX A: clear any tint leak from dismissed blobs before hero draws
  noTint();

  // Hero last (on top of everything)
  if(STATE==="selection"||STATE==="awakening"){
    blobs[heroIdx].update();
    blobs[heroIdx].draw();
  }

  drawNotes();
  drawHUD();
}

// ─────────────────────────────────────────────────────────────────
//  STATE MACHINE
// ─────────────────────────────────────────────────────────────────
function updateState(){
  if(!blobs.length) return;
  if(STATE==="idle"){
    if(smoothNose){ STATE="detection"; detectTimer=0; blobs.forEach(b=>b.onDetection()); }
  } else if(STATE==="detection"){
    if(!smoothNose){ toIdle(); return; }
    if(++detectTimer >= DETECT_FRAMES){
      STATE="selection"; heroIdx=closestCenter();
      const ids = Object.keys(CHARS);
      blobs[heroIdx].charId = ids[Math.floor(Math.random()*ids.length)];
      blobs.forEach((b,i) => i===heroIdx ? b.onSelection() : b.onDismiss());
    }
  } else if(STATE==="selection"){
    if(!smoothNose){ toIdle(); return; }
    const h = blobs[heroIdx];
    if(dist(h.x,h.y,width/2,height/2)<12 && h.r>h.baseR*1.4){
      STATE="awakening"; blobs[heroIdx].onAwakening();
    }
  } else if(STATE==="awakening"){
    if(!smoothNose) toIdle();
  }
}
function toIdle(){ STATE="idle"; detectTimer=0; blobs.forEach(b=>b.onIdle()); }
function closestCenter(){
  let best=0, bd=Infinity;
  blobs.forEach((b,i)=>{ const d=dist(b.x,b.y,width/2,height/2); if(d<bd){bd=d;best=i;} });
  return best;
}

// ─────────────────────────────────────────────────────────────────
//  COLLISION
// ─────────────────────────────────────────────────────────────────
function handleCollisions(){
  if(STATE!=="idle" && STATE!=="detection") return;
  for(let i=0;i<blobs.length;i++) for(let j=i+1;j<blobs.length;j++){
    const a=blobs[i], b=blobs[j];
    const dx=b.x-a.x, dy=b.y-a.y, d=Math.sqrt(dx*dx+dy*dy), mn=a.r+b.r;
    if(d<mn && d>0.001){
      const nx=dx/d, ny=dy/d, ov=(mn-d)*0.5;
      a.x-=nx*ov; a.y-=ny*ov; b.x+=nx*ov; b.y+=ny*ov;
      const dv=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
      if(dv<0){
        const im=dv*0.85;
        a.vx+=im*nx; a.vy+=im*ny; b.vx-=im*nx; b.vy-=im*ny;
        a.sqxT=random(1.2,1.45); b.sqxT=random(1.2,1.45);
        if(Math.abs(dv)>0.5) tryWobble();
      }
    }
  }
}

function drawHUD(){
  // FIX A: noTint before text so it's never rendered invisible
  noTint();
  noStroke(); fill(60,50,40,100); textSize(11); textFont("monospace"); textAlign(LEFT,TOP);
  const hL=HAND_DATA.left.present?"L✓":"L—", hR=HAND_DATA.right.present?"R✓":"R—";
  text(STATE+" | face:"+(smoothNose?"✓":"—")+" | "+hL+" "+hR+" | "+detectTimer+"/"+DETECT_FRAMES, 12, 12);
}
function windowResized(){ resizeCanvas(windowWidth,windowHeight); buildPaper(); }


// ═════════════════════════════════════════════════════════════════
//  BLOB CLASS
// ═════════════════════════════════════════════════════════════════
class BlobChar{
  constructor(idx, charId){
    this.idx    = idx;
    this.charId = charId;
    this.mode   = "idle";

    this.baseR = random(45, 170);    // Combination-2 size range
    this.r     = this.baseR;
    this.x     = random(this.baseR+20, width  - this.baseR-20);
    this.y     = random(this.baseR+20, height - this.baseR-20);
    const sp   = p5.Vector.random2D().mult(2.0);
    this.vx=sp.x; this.vy=sp.y;

    this.sqx=1; this.sqxT=1;
    this.alpha=255; this.alphaT=255;
    this.driftX=0; this.driftY=0;

    this.comboCurr = pickCombo(null); this.comboNext=null;
    this.fadeT=1; this.exprState="holding";
    this.holdTimer = Math.floor(random(40,200));
    this.noteTimer=0; this.isWhistling=false;
    this.blinkTimer=Math.floor(random(80,220));
    this.blinkState="open"; this.blinkFrames=0;
    this.gx=0; this.gy=0; this.gxT=0; this.gyT=0;
    this.gazeTimer=Math.floor(random(60,140));

    this.popFrames=0; this.POP_TOTAL=120;
    this.popStartX=0; this.popStartY=0; this.popStartR=0;
    this.awakeR=0;

    this.handPhase="none"; this.handTimer=0; this.arms=[];
  }

  onIdle(){
    this.mode="idle"; this.alphaT=255; this.sqxT=1;
    const s=p5.Vector.random2D().mult(2.0); this.vx=s.x; this.vy=s.y;
    this.handPhase="none"; this.arms=[];
    this.exprState="holding"; this.holdTimer=Math.floor(random(40,180));
    this.isWhistling=false;
  }
  onDetection(){ this.mode="detection"; }

  onSelection(){
    this.mode="chosen"; this.vx=0; this.vy=0;
    this.popStartX=this.x; this.popStartY=this.y; this.popStartR=this.r;
    this.popFrames=0;
    this.awakeR = computeAwakeBodyR();
    this.comboCurr=null; this.comboNext=null;
    this.exprState="holding"; this.holdTimer=999999;
    this.isWhistling=false;
    stopWhistle();
  }

  onDismiss(){
    this.mode="dismissed"; this.alphaT=0; this.vx=0; this.vy=0;
    const e = Math.floor(random(4));
    this.driftX = [random(width),random(width),-200,width+200][e];
    this.driftY = [-200,height+200,random(height),random(height)][e];
  }

  onAwakening(){
    this.mode="awakening"; this.handPhase="emerge"; this.handTimer=0;
    this.isWhistling=false;
    stopWhistle();
    // FIX C: reset gaze state so eyeballs animate from awakening start
    this.gx=0; this.gy=0; this.gxT=0; this.gyT=0;
    this.gazeTimer=Math.floor(random(60,140));
    const di = CHARS[this.charId] ? CHARS[this.charId].dot : null;
    this.arms = [new Arm(this,di,"left"), new Arm(this,di,"right")];
  }

  update(){
    this._move(); this._spring();
    // Expression: idle + detection only
    if(this.mode==="idle" || this.mode==="detection") this._tickExpr();
    // FIX C: _tickGaze runs for ALL modes — awakening included
    this._tickGaze();
    // Nose gaze tracking: chosen + awakening
    if(this.mode==="chosen" || this.mode==="awakening") this._watchNose();
    // Hand mechanics: awakening only
    if(this.mode==="awakening") this._tickHands();
  }

  _move(){
    if(this.mode==="idle"||this.mode==="detection"){
      this.x+=this.vx; this.y+=this.vy; this._walls();
      this.r = lerp(this.r, this.baseR, .12);
    } else if(this.mode==="chosen"){
      this.popFrames = Math.min(this.popFrames+1, this.POP_TOTAL);
      const t = this.popFrames / this.POP_TOTAL;
      this.x = lerp(this.popStartX, width/2,  easeInOut(t));
      this.y = lerp(this.popStartY, height/2, easeInOut(t));
      this.r = lerp(this.popStartR, this.awakeR, easeOut3(constrain((t-.1)/.9, 0, 1)));
    } else if(this.mode==="awakening"){
      this.x = lerp(this.x, width/2,  .05);
      this.y = lerp(this.y, height/2, .05);
      this.r = lerp(this.r, this.awakeR, .08);
    } else if(this.mode==="dismissed"){
      this.x = lerp(this.x, this.driftX, .04);
      this.y = lerp(this.y, this.driftY, .04);
      this.r = lerp(this.r, this.baseR,  .07);
    }
  }
  _walls(){
    if(this.x-this.r<0)     { this.x=this.r;        this.vx*=-1; this.sqxT=random(1.2,1.4); }
    if(this.x+this.r>width) { this.x=width-this.r;  this.vx*=-1; this.sqxT=random(1.2,1.4); }
    if(this.y-this.r<0)     { this.y=this.r;         this.vy*=-1; this.sqxT=random(1.2,1.4); }
    if(this.y+this.r>height){ this.y=height-this.r;  this.vy*=-1; this.sqxT=random(1.2,1.4); }
  }
  _spring(){
    this.sqx = lerp(this.sqx, this.sqxT, .10);
    if(Math.abs(this.sqx-this.sqxT)<0.012 && this.sqxT!==1) this.sqxT=1;
    this.alpha = lerp(this.alpha, this.alphaT, .07);
  }

  _tickExpr(){
    if(this.exprState==="holding"){
      if(--this.holdTimer<=0){
        this.comboNext = pickCombo(this.comboCurr);
        this.fadeT=0; this.exprState="fading";
        const willWhistle = this.comboNext.mouth==="whistle" && EXPR_DIST.is(this.idx);
        this.isWhistling = willWhistle;
        if(willWhistle) tryWhistle();
        this.noteTimer=0;
      }
    } else {
      this.fadeT = Math.min(this.fadeT+random(.03,.07), 1.0);
      if(this.fadeT>=1.0){
        this.comboCurr=this.comboNext; this.comboNext=null;
        this.exprState="holding"; this.holdTimer=Math.floor(random(100,280));
        this.isWhistling = this.comboCurr.mouth==="whistle" && EXPR_DIST.is(this.idx);
      }
    }
    if(EXPR_DIST.is(this.idx) && this.comboCurr && (this.comboCurr.balls||this.comboCurr.eye==="open")){
      this._tickBlink();
    }
    if(this.isWhistling && EXPR_DIST.is(this.idx)){
      if(--this.noteTimer<=0){ spawnNote(this.x, this.y-this.r*.85); this.noteTimer=Math.floor(random(13,28)); }
    } else if(!EXPR_DIST.is(this.idx)){
      this.isWhistling=false;
    }
  }
  _tickBlink(){
    if     (this.blinkState==="open")    { if(--this.blinkTimer<=0){ this.blinkState="closing"; this.blinkFrames=3; } }
    else if(this.blinkState==="closing") { if(--this.blinkFrames<=0){ this.blinkState="closed";  this.blinkFrames=4; } }
    else if(this.blinkState==="closed")  { if(--this.blinkFrames<=0){ this.blinkState="opening"; this.blinkFrames=5; } }
    else if(this.blinkState==="opening") { if(--this.blinkFrames<=0){ this.blinkState="open"; this.blinkTimer=Math.floor(random(80,220)); } }
  }
  _tickGaze(){
    // FIX C: runs for every mode, including awakening
    if(--this.gazeTimer<=0){
      this.gxT=random(-9,9); this.gyT=random(-6,6);
      this.gazeTimer=Math.floor(random(55,145));
    }
    this.gx=lerp(this.gx,this.gxT,.04);
    this.gy=lerp(this.gy,this.gyT,.04);
  }
  _watchNose(){
    if(!smoothNose) return;
    const ang=atan2(smoothNose.y-this.y, smoothNose.x-this.x), mo=this.r*.18;
    this.gx=lerp(this.gx, cos(ang)*mo, .18);
    this.gy=lerp(this.gy, sin(ang)*mo, .18);
  }
  _tickHands(){
    this.handTimer++;
    for(const arm of this.arms) arm.update(this.handPhase, this.r, this.x, this.y);
    if     (this.handPhase==="emerge"     && this.handTimer>65) { this.handPhase="form";       this.handTimer=0; }
    else if(this.handPhase==="form"       && this.handTimer>90) { this.handPhase="horizontal"; this.handTimer=0; }
    else if(this.handPhase==="horizontal" && this.handTimer>55) { this.handPhase="alive";      this.handTimer=0; }
  }

  // ── DRAW: arms → body → face ─────────────────────────────────
  draw(){
    if(this.alpha < 2) return;

    // FIX A: clean tint at start of every individual blob draw
    noTint();

    // Arms BEHIND body (awakening only)
    if(this.mode==="awakening"){
      for(const arm of this.arms) arm.draw();
    }

    // Body (may set tint for alpha fade on dismissed blobs)
    push();
    translate(this.x, this.y);
    this._drawBodyAndIdleFace();
    pop();

    // FIX A: hard reset after body so face never inherits body tint
    noTint();

    // Awakening face drawn in world space, always on top of body
    if(this.mode==="awakening"){
      this._drawAwakeFaceWorld();
    }
  }

  _drawBodyAndIdleFace(){
    const imgs = CHARS[this.charId];
    if(!imgs || !imgs.body) return;
    const sz=this.r*2, sX=this.sqx, sY=1/sX;

    push();
    scale(sX,sY);
    tint(255, this.alpha); // intentional alpha for dismissed fade
    image(imgs.body,0,0,sz,sz);
    pop();

    // Idle/detection expressions only — not chosen or awakening
    if(this.mode==="chosen" || this.mode==="awakening") return;
    if(!EXPR_DIST.is(this.idx) || !this.comboCurr) return;

    // FIX A: reset tint to full before drawing expressions
    tint(255, 255);
    this._drawCombo(this.comboCurr, this.alpha, sz, sX, sY);
    if(this.exprState==="fading" && this.comboNext && this.fadeT>0.02)
      this._drawCombo(this.comboNext, this.alpha*this.fadeT, sz, sX, sY);
  }

  _drawCombo(combo, fa, sz, sX, sY){
    if(!combo || fa<3) return;
    const ei = eyeImg(combo.eye); if(!ei) return;
    const EW=sz*.88, EH=sz*.36, eyeY=-this.r*.12;
    const BSZ=this.r*.42, BSP=this.r*.28, MW=sz*.56, MH=sz*.23, MY=this.r*.38;
    push(); scale(sX,sY);
    tint(255,fa); image(ei,0,eyeY,EW,EH);
    if(combo.balls && BALL_L && BALL_R){
      let bA=fa;
      if     (this.blinkState==="closing") bA=map(this.blinkFrames,3,0,fa,0);
      else if(this.blinkState==="closed")  bA=0;
      else if(this.blinkState==="opening") bA=map(this.blinkFrames,5,0,0,fa);
      if(bA>2){ tint(255,bA); image(BALL_L,-BSP+this.gx,eyeY+this.gy,BSZ,BSZ); image(BALL_R,BSP+this.gx,eyeY+this.gy,BSZ,BSZ); }
    }
    if(combo.mouth!=="none"){ const mi=mouthImg(combo.mouth); if(mi){ tint(255,fa); image(mi,0,MY,MW,MH); } }
    pop();
  }

  // FIX D: draw each face asset independently — no silent abort on missing asset
  // FIX A: every image() uses explicit tint(255,255) — never inherits global state
  _drawAwakeFaceWorld(){
    if(!EYE_OPEN && !MOUTH_OPEN){
      if(!_assetWarnDone){
        console.warn("Awakening face assets not loaded — check filenames");
        _assetWarnDone=true;
      }
      return;
    }

    const bx=this.x, by=this.y, r=this.r;
    const sz=r*2, sX=this.sqx, sY=1/sX;
    const EW=sz*.88, EH=sz*.36, eyeY=-r*.12;
    const BSZ=r*.42, BSP=r*.28;
    const MW=sz*.56, MH=sz*.23, MY=r*.38;

    push();
    imageMode(CENTER);

    // Eye whites
    if(EYE_OPEN){
      push();
      translate(bx, by); scale(sX, sY);
      tint(255, 255); // FIX A: always fully opaque
      image(EYE_OPEN, 0, eyeY, EW, EH);
      pop();
    }

    // Eyeballs (gaze-driven by _tickGaze + _watchNose)
    if(BALL_L && BALL_R){
      push();
      translate(bx, by); scale(sX, sY);
      tint(255, 255); // FIX A: always fully opaque
      image(BALL_L, -BSP+this.gx, eyeY+this.gy, BSZ, BSZ);
      image(BALL_R,  BSP+this.gx, eyeY+this.gy, BSZ, BSZ);
      pop();
    }

    // Mouth
    if(MOUTH_OPEN){
      push();
      translate(bx, by); scale(sX, sY);
      tint(255, 255); // FIX A: always fully opaque
      image(MOUTH_OPEN, 0, MY, MW, MH);
      pop();
    }

    pop();

    // FIX A: clean up after face draw
    noTint();
  }
}


// ═════════════════════════════════════════════════════════════════
//  ARM CLASS
//
//  FIX B: uses this.emergeFrame (local counter, starts at 0)
//         instead of global frameCount — ensures correct emerge
//         animation regardless of when awakening triggers.
//  FIX A: arm.draw() calls noTint() before dot images so dismissed-
//         blob tint leaks can never hide the dot chain.
// ═════════════════════════════════════════════════════════════════
class Arm{
  constructor(blob, dotImg, side){
    this.blob        = blob;
    this.dotImg      = dotImg;
    this.side        = side;
    this.wigT        = random(100);
    this.wigSpd      = random(.016,.026);
    this.wigAmp      = 0;
    this.angle       = (side==="left") ? PI : 0;
    this.N           = 12;
    this.dots        = [];
    // FIX B: local frame counter — reset to 0 every new Arm
    this.emergeFrame = 0;

    for(let i=0;i<this.N;i++){
      this.dots.push({ x:blob.x, y:blob.y, alpha:0,
        ns:random(1000), delay:i*0.07 });
    }
    this.tipSmX    = blob.x;
    this.tipSmY    = blob.y;
    this.horizReady = false;
  }

  _dsz(r){ return r * 0.52; }
  _step(r){ return this._dsz(r) * 0.45; }

  _horizTip(r, bx, by){
    return {
      x: bx + cos(this.angle) * (r*0.82 + this._step(r)*(this.N-1)),
      y: by
    };
  }

  update(phase, r, bx, by){
    this.wigT += this.wigSpd;
    const step = this._step(r);

    if(phase==="emerge"){
      // FIX B: increment local counter, not global frameCount
      this.emergeFrame++;
      const progress = this.emergeFrame * 0.009;
      for(let i=0;i<this.N;i++){
        const d   = this.dots[i];
        const pct = constrain(progress - d.delay, 0, 1);
        const eo  = easeOut3(pct);
        const finalDist = r * 0.10 + step * i;
        d.x = lerp(d.x, bx + cos(this.angle)*finalDist*eo, 0.09);
        d.y = lerp(d.y, by, 0.09);
        d.alpha = lerp(d.alpha, 230*pct, 0.07);
      }

    } else if(phase==="form"){
      this.wigAmp = lerp(this.wigAmp, r*0.05, 0.04);
      const rx = bx + cos(this.angle)*r*0.82;
      this.dots[0].x = lerp(this.dots[0].x, rx, 0.14);
      this.dots[0].y = lerp(this.dots[0].y, by, 0.14);
      this.dots[0].alpha = lerp(this.dots[0].alpha, 235, 0.10);
      for(let i=1;i<this.N;i++){
        const prev=this.dots[i-1];
        this.dots[i].x = lerp(this.dots[i].x, prev.x+cos(this.angle)*step, 0.13);
        this.dots[i].y = lerp(this.dots[i].y, prev.y, 0.13);
        this.dots[i].alpha = lerp(this.dots[i].alpha, 235, 0.09);
      }

    } else if(phase==="horizontal"){
      this.wigAmp = lerp(this.wigAmp, r*0.04, 0.05);
      if(!this.horizReady){
        const ht = this._horizTip(r,bx,by);
        this.tipSmX=ht.x; this.tipSmY=ht.y;
        this.horizReady=true;
      }
      const rx = bx + cos(this.angle)*r*0.82;
      this.dots[0].x = lerp(this.dots[0].x, rx, 0.14);
      this.dots[0].y = lerp(this.dots[0].y, by, 0.14);
      this.dots[0].alpha = lerp(this.dots[0].alpha, 235, 0.10);
      for(let i=1;i<this.N;i++){
        const prev=this.dots[i-1];
        this.dots[i].x = lerp(this.dots[i].x, prev.x+cos(this.angle)*step, 0.13);
        this.dots[i].y = lerp(this.dots[i].y, prev.y, 0.13);
        this.dots[i].alpha = lerp(this.dots[i].alpha, 235, 0.09);
      }

    } else if(phase==="alive"){
      this.wigAmp = lerp(this.wigAmp, r*0.12, 0.03);
      const hd = HAND_DATA[this.side];
      if(hd && hd.present){
        this.dots[0].x = lerp(this.dots[0].x, hd.wx, 0.22);
        this.dots[0].y = lerp(this.dots[0].y, hd.wy, 0.22);
        this.tipSmX = lerp(this.tipSmX, hd.px, 0.22);
        this.tipSmY = lerp(this.tipSmY, hd.py, 0.22);
      } else {
        const rx = bx + cos(this.angle)*r*0.82;
        this.dots[0].x = lerp(this.dots[0].x, rx, 0.08);
        this.dots[0].y = lerp(this.dots[0].y, by, 0.08);
        const ht = this._horizTip(r,bx,by);
        this.tipSmX = lerp(this.tipSmX, ht.x, 0.04);
        this.tipSmY = lerp(this.tipSmY, ht.y, 0.04);
      }
      this.dots[0].alpha = lerp(this.dots[0].alpha, 235, 0.10);

      const last = this.dots[this.N-1];
      last.x = lerp(last.x, this.tipSmX, 0.20);
      last.y = lerp(last.y, this.tipSmY, 0.20);
      last.alpha = lerp(last.alpha, 235, 0.09);

      for(let i=1;i<this.N-1;i++){
        this._snake(i, step);
        this.dots[i].alpha = lerp(this.dots[i].alpha, 235, 0.09);
      }
    }
  }

  _snake(i, step){
    const prev=this.dots[i-1], d=this.dots[i];
    const dx=d.x-prev.x, dy=d.y-prev.y;
    const dst=Math.sqrt(dx*dx+dy*dy)||0.001;
    const nx=dx/dst, ny=dy/dst;
    const perp=atan2(ny,nx)+HALF_PI;
    const wa=this.wigAmp*(1+i*0.05);
    const w=(noise(d.ns+this.wigT, i*0.5)-0.5)*2*wa;
    d.x=lerp(d.x, prev.x+nx*step+cos(perp)*w, 0.14);
    d.y=lerp(d.y, prev.y+ny*step+sin(perp)*w, 0.14);
  }

  draw(){
    if(!this.dotImg) return;
    const ds = this._dsz(this.blob.r);
    push();
    imageMode(CENTER);
    // FIX A: explicit noTint() before dot loop — dismissed-blob tint
    //         leak can never make dot chain invisible
    noTint();
    for(const d of this.dots){
      if(d.alpha<4) continue;
      tint(255, d.alpha); // each dot sets its own alpha explicitly
      image(this.dotImg, d.x, d.y, ds, ds);
    }
    noTint(); // leave clean state for whatever draws next
    pop();
  }
}