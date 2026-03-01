// ================================================================
//  A W A K E N I N G  —  gesture.js  (v9 + STATE LOCK HOOKS)
//
//  ── CHANGES vs v8 ──────────────────────────────────────────────
//  Three surgical additions only — all other logic UNTOUCHED:
//
//  PATCH 1: updateState() idle→detection transition
//    Calls window._onUserPresence(true) when user first detected.
//
//  PATCH 2: toIdle()
//    Calls window._onUserPresence(false) when user leaves frame.
//    This allows burst-reaction.js to force-stop any active game.
//
//  PATCH 3: _updateBurst() twirl fire
//    Calls window._onTwirlDetected() before triggerBurst()
//    so systemMode transitions to 'game' before game starts.
//
//  All original logic untouched. New code marked with ★ PATCH.
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


const BLOBS_PER_COLOR = 3;
const CHARS = {};


const COMPANION_BS_BASE = 300;
function computeAwakeBodyR(){
 const scale = Math.min(windowWidth, windowHeight) / 720;
 const bs = Math.max(COMPANION_BS_BASE * scale, 240);
 return bs / 2;
}


// ─────────────────────────────────────────────────────────────────
//  EXPRESSION ASSETS
// ─────────────────────────────────────────────────────────────────
let EYE_OPEN, EYE_CLOSED, EYE_SCRUNCH, EYE_SURPRISE, EYE_CRY;
let BALL_L, BALL_R;
let MOUTH_OPEN, MOUTH_WHISTLE, MOUTH_SURPRISE, MOUTH_SAD;
let _assetWarnDone = false;


// ─────────────────────────────────────────────────────────────────
//  COMPANION BLINK FSM  (v7 — smooth 4-state, expression-aware)
// ─────────────────────────────────────────────────────────────────
const COMP_BLINK = {
 state:     "open",
 blinkT:    0.0,
 frameCount: 0,
 _timer:    null,
 active:    false,


 start(){
   this.stop();
   this.state = "open";
   this.blinkT = 0.0;
   this.frameCount = 0;
   this.active = true;
   this._scheduleNext();
 },


 stop(){
   this.active = false;
   if(this._timer !== null){ clearTimeout(this._timer); this._timer = null; }
   this.state  = "open";
   this.blinkT = 0.0;
 },


 _scheduleNext(){
   if(!this.active) return;
   this._timer = setTimeout(() => {
     if(COMP_EXPR && COMP_EXPR.current === "surprise"){
       this._scheduleNext();
       return;
     }
     this.state      = "closing";
     this.frameCount = 8;
   }, 2500 + Math.random() * 2500);
 },


 tick(){
   if(!this.active) return;


   if(this.state === "open"){
     this.blinkT = lerp(this.blinkT, 0.0, 0.20);


   } else if(this.state === "closing"){
     this.blinkT = lerp(this.blinkT, 1.0, 0.28);
     if(--this.frameCount <= 0){
       this.state      = "closed";
       this.frameCount = 5;
     }


   } else if(this.state === "closed"){
     this.blinkT = lerp(this.blinkT, 1.0, 0.35);
     if(--this.frameCount <= 0){
       this.state      = "opening";
       this.frameCount = 10;
     }


   } else if(this.state === "opening"){
     this.blinkT = lerp(this.blinkT, 0.0, 0.22);
     if(--this.frameCount <= 0){
       this.state  = "open";
       this.blinkT = 0.0;
       this._scheduleNext();
     }
   }
 },


 openAlpha(){ return 1.0 - this.blinkT; }
};


// ─────────────────────────────────────────────────────────────────
//  COMBO TABLE  (intro blobs)
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
         surprise:EYE_SURPRISE,sad:EYE_CRY}[t]||null;
}
function mouthImg(t){
 if(t==="none") return null;
 return {open:MOUTH_OPEN,whistle:MOUTH_WHISTLE,
         surprise:MOUTH_SURPRISE,sad:MOUTH_SAD}[t]||null;
}
function comboOk(c){
 return !!eyeImg(c.eye)&&(c.mouth==="none"||!!mouthImg(c.mouth));
}
function pickCombo(exclude){
 const pool=COMBO_DEFS.filter(c=>comboOk(c)&&(!exclude||c.id!==exclude.id));
 if(!pool.length) return COMBO_DEFS[0];
 let r=Math.random()*pool.reduce((s,c)=>s+c.w,0);
 for(const c of pool){ r-=c.w; if(r<=0) return c; }
 return pool[0];
}


// ─────────────────────────────────────────────────────────────────
//  EXPRESSION DISTRIBUTION MANAGER
// ─────────────────────────────────────────────────────────────────
const EXPR_DIST = {
 activeSet:new Set(), timer:0, INTERVAL:280,
 init(count){
   this.activeSet.clear();
   const target=Math.floor(count*0.5);
   const idx=Array.from({length:count},(_,i)=>i);
   for(let i=idx.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[idx[i],idx[j]]=[idx[j],idx[i]];}
   for(let i=0;i<target;i++) this.activeSet.add(idx[i]);
   this.timer=this.INTERVAL;
 },
 tick(count){
   if(--this.timer>0) return;
   this.timer=this.INTERVAL+Math.floor(Math.random()*120-60);
   const swaps=1+Math.floor(Math.random()*3);
   const active=[...this.activeSet];
   const inactive=Array.from({length:count},(_,i)=>i).filter(i=>!this.activeSet.has(i));
   for(let i=active.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[active[i],active[j]]=[active[j],active[i]];}
   for(let i=inactive.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[inactive[i],inactive[j]]=[inactive[j],inactive[i]];}
   for(let i=0;i<Math.min(swaps,active.length);i++) this.activeSet.delete(active[i]);
   const max=Math.floor(count*0.65),min=Math.floor(count*0.35);
   for(let i=0;i<Math.min(swaps,inactive.length);i++){
     if(this.activeSet.size<max) this.activeSet.add(inactive[i]);
   }
   if(this.activeSet.size<min){
     const fill=Array.from({length:count},(_,i)=>i).filter(i=>!this.activeSet.has(i));
     for(let i=0;this.activeSet.size<min&&i<fill.length;i++) this.activeSet.add(fill[i]);
   }
 },
 is(idx){ return this.activeSet.has(idx); }
};


// ─────────────────────────────────────────────────────────────────
//  AUDIO — Whistle
// ─────────────────────────────────────────────────────────────────
let snd=null,sndReady=false,sndPlaying=false,sndCool=0;
function tryWhistle(){
 if(sndPlaying||sndCool>0||!sndReady||!snd) return;
 try{
   if(typeof userStartAudio==="function") userStartAudio();
   snd.setVolume(0.7); snd.play();
   sndPlaying=true; sndCool=300;
   setTimeout(()=>{sndPlaying=false;},(snd.duration?snd.duration()*1000:2200)+400);
 }catch(e){}
}
function stopWhistle(){
 if(!snd) return;
 try{snd.stop();}catch(e){}
 sndPlaying=false;
}


// ─────────────────────────────────────────────────────────────────
//  AUDIO — Wobble
// ─────────────────────────────────────────────────────────────────
let wobbleSounds=[],wobbleReady=false,wobbleCool=0,wobblePlaying=false;
function tryWobble(){
 if(wobblePlaying||wobbleCool>0||!wobbleReady||!wobbleSounds.length) return;
 try{
   if(typeof userStartAudio==="function") userStartAudio();
   const w=wobbleSounds[Math.floor(Math.random()*wobbleSounds.length)];
   w.setVolume(0.65); w.play();
   wobblePlaying=true; wobbleCool=45;
   setTimeout(()=>{wobblePlaying=false;},(w.duration?w.duration()*1000:800)+200);
 }catch(e){}
}


// ─────────────────────────────────────────────────────────────────
//  FLOATING NOTES
// ─────────────────────────────────────────────────────────────────
const NOTES=[];
function spawnNote(x,y){
 NOTES.push({x:x+Math.random()*28-14,y,a:220,
   vy:-1.4-Math.random()*1.1,life:65+Math.floor(Math.random()*50),
   sym:["♪","♫","♩","♬"][Math.floor(Math.random()*4)]});
}
function drawNotes(){
 for(let i=NOTES.length-1;i>=0;i--){
   const n=NOTES[i];
   n.y+=n.vy; n.x+=Math.sin(n.life*.12)*.5;
   n.a=lerp(n.a,0,.03); n.life--;
   if(n.life<=0||n.a<2){NOTES.splice(i,1);continue;}
   push();noStroke();fill(255,215,60,n.a);
   textSize(13);textAlign(CENTER,CENTER);text(n.sym,n.x,n.y);pop();
 }
}


// ─────────────────────────────────────────────────────────────────
//  PAPER TEXTURE
// ─────────────────────────────────────────────────────────────────
let paperGfx=null;
function buildPaper(){
 const W=Math.ceil(windowWidth/2),H=Math.ceil(windowHeight/2);
 if(paperGfx) paperGfx.remove();
 paperGfx=createGraphics(W,H);
 paperGfx.pixelDensity(1);
 paperGfx.randomSeed(77);paperGfx.noiseSeed(77);
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
 paperGfx.stroke(162,155,142,20);paperGfx.strokeWeight(0.5);
 let lY=0;
 while(lY<H){lY+=paperGfx.random(8,15);paperGfx.line(0,lY,W,lY+paperGfx.random(-2,2));}
}
function drawPaper(){
 push();noTint();imageMode(CORNER);image(paperGfx,0,0,width,height);imageMode(CENTER);pop();
}


// ─────────────────────────────────────────────────────────────────
//  EASING
// ─────────────────────────────────────────────────────────────────
function easeInOut(t){t=constrain(t,0,1);return t<0.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;}
function easeOut3(t){return 1-Math.pow(1-constrain(t,0,1),3);}


// ─────────────────────────────────────────────────────────────────
//  FACE TRACKING
// ─────────────────────────────────────────────────────────────────
let rawNose=null,smoothNose=null;
const EXPR={
 smile:0,      smileR:0,
 mouthOpen:0,  mouthOpenR:0,
 browHeight:0, browHeightR:0,
 eyeOpen:0,    eyeOpenR:0,
 cornerDrop:0, cornerDropR:0,
};


function parseFace(){
 const faces=window.mpFaces;
 if(!faces||!faces.length){rawNose=null;return;}
 const lm=faces[0];
 const ptM=i=>({x:(1-lm[i].x)*width, y:lm[i].y*height});
 const ptU=i=>({x:lm[i].x*width,     y:lm[i].y*height});
 const D=(a,b)=>dist(a.x,a.y,b.x,b.y);
 rawNose=ptM(1);


 const eL=ptU(33), eR=ptU(263);
 const fW=D(eL,eR)||1;


 const mL=ptU(61), mR=ptU(291);
 EXPR.smileR=constrain(map(D(mL,mR)/fW, 0.32, 0.58, 0, 1), 0, 1);


 const upperLip=ptU(13), lowerLip=ptU(14);
 EXPR.mouthOpenR=constrain(map(D(upperLip,lowerLip)/fW, 0.01, 0.15, 0, 1), 0, 1);


 const lBrow=ptU(105), rBrow=ptU(334);
 const browMid=(lBrow.y+rBrow.y)*0.5;
 const eyeMid =(eL.y   +eR.y  )*0.5;
 EXPR.browHeightR=constrain(map((eyeMid-browMid)/fW, 0.06, 0.22, 0, 1), 0, 1);


 const earL=D(ptU(159),ptU(145))/(D(ptU(33),ptU(133))||1);
 const earR=D(ptU(386),ptU(374))/(D(ptU(362),ptU(263))||1);
 EXPR.eyeOpenR=constrain(map((earL+earR)*0.5, 0.12, 0.38, 0, 1), 0, 1);


 const mouthCentreY = (upperLip.y + lowerLip.y) * 0.5;
 const leftDrop  = mL.y - mouthCentreY;
 const rightDrop = mR.y - mouthCentreY;
 const avgDrop   = (leftDrop + rightDrop) * 0.5;
 EXPR.cornerDropR = constrain(map(avgDrop / fW, 0.02, 0.08, 0, 1), 0, 1);
}


function smoothExprs(){
 if(rawNose){
   if(!smoothNose) smoothNose={x:rawNose.x,y:rawNose.y};
   smoothNose.x=lerp(smoothNose.x,rawNose.x,.18);
   smoothNose.y=lerp(smoothNose.y,rawNose.y,.18);
 } else smoothNose=null;
 EXPR.smile     =lerp(EXPR.smile,     EXPR.smileR,     .06);
 EXPR.mouthOpen =lerp(EXPR.mouthOpen, EXPR.mouthOpenR, .06);
 EXPR.browHeight=lerp(EXPR.browHeight,EXPR.browHeightR,.06);
 EXPR.eyeOpen   =lerp(EXPR.eyeOpen,   EXPR.eyeOpenR,   .08);
 EXPR.cornerDrop=lerp(EXPR.cornerDrop,EXPR.cornerDropR,.05);
}


// ─────────────────────────────────────────────────────────────────
//  HAND TRACKING
// ─────────────────────────────────────────────────────────────────
const HAND_DATA={
 left: {wx:0,wy:0,px:0,py:0,present:false,smWX:null,smWY:null,smPX:null,smPY:null},
 right:{wx:0,wy:0,px:0,py:0,present:false,smWX:null,smWY:null,smPX:null,smPY:null},
};
const HAND_LERP=0.22;


function parseHands(){
 HAND_DATA.left.present=false;
 HAND_DATA.right.present=false;
 const hands=window.mpHands;
 if(!hands||!hands.length) return;
 for(const h of hands){
   if(!h.landmarks||!h.handedness) continue;
   const side=(h.handedness==="Left")?"left":"right";
   const lm=h.landmarks;
   const wristX=(1.0-lm[0].x)*width;
   const wristY=lm[0].y*height;
   const pIdxs=[0,5,9,13,17];
   let pcx=0,pcy=0;
   for(const idx of pIdxs){pcx+=(1.0-lm[idx].x);pcy+=lm[idx].y;}
   pcx=(pcx/pIdxs.length)*width;
   pcy=(pcy/pIdxs.length)*height;
   const hd=HAND_DATA[side];
   if(hd.smWX===null){hd.smWX=wristX;hd.smWY=wristY;hd.smPX=pcx;hd.smPY=pcy;}
   hd.smWX=lerp(hd.smWX,wristX,HAND_LERP);
   hd.smWY=lerp(hd.smWY,wristY,HAND_LERP);
   hd.smPX=lerp(hd.smPX,pcx,HAND_LERP);
   hd.smPY=lerp(hd.smPY,pcy,HAND_LERP);
   hd.wx=hd.smWX;hd.wy=hd.smWY;
   hd.px=hd.smPX;hd.py=hd.smPY;
   hd.present=true;
 }
}


// ─────────────────────────────────────────────────────────────────
//  POSE TRACKING
// ─────────────────────────────────────────────────────────────────
const POSE_DATA={
 present:false,
 smShoulderMidX:null, smShoulderMidY:null,
 smNoseX:null,        smNoseY:null,
 smLElbX:null,        smLElbY:null,
 smLWriX:null,        smLWriY:null,
 smRElbX:null,        smRElbY:null,
 smRWriX:null,        smRWriY:null,
 torsoOffX:0, torsoOffY:0, jumpVel:0,
};
const POSE_LERP=0.35;
let poseBaseX=null,poseBaseY=null;


function parsePose(){
 const pose=window.mpPose;
 if(!pose||!pose.poseLandmarks||pose.poseLandmarks.length<17){
   POSE_DATA.present=false; return;
 }
 POSE_DATA.present=true;
 const lm=pose.poseLandmarks;
 const mx=i=>(1.0-lm[i].x)*width;
 const my=i=>lm[i].y*height;


 const smx=(mx(11)+mx(12))*0.5;
 const smy=(my(11)+my(12))*0.5;


 if(POSE_DATA.smShoulderMidX===null){
   POSE_DATA.smShoulderMidX=smx;  POSE_DATA.smShoulderMidY=smy;
   POSE_DATA.smNoseX=mx(0);       POSE_DATA.smNoseY=my(0);
   POSE_DATA.smLElbX=mx(13);      POSE_DATA.smLElbY=my(13);
   POSE_DATA.smLWriX=mx(15);      POSE_DATA.smLWriY=my(15);
   POSE_DATA.smRElbX=mx(14);      POSE_DATA.smRElbY=my(14);
   POSE_DATA.smRWriX=mx(16);      POSE_DATA.smRWriY=my(16);
 }
 POSE_DATA.smShoulderMidX=lerp(POSE_DATA.smShoulderMidX,smx,POSE_LERP);
 POSE_DATA.smShoulderMidY=lerp(POSE_DATA.smShoulderMidY,smy,POSE_LERP);
 POSE_DATA.smNoseX=lerp(POSE_DATA.smNoseX,mx(0),POSE_LERP);
 POSE_DATA.smNoseY=lerp(POSE_DATA.smNoseY,my(0),POSE_LERP);
 POSE_DATA.smLElbX=lerp(POSE_DATA.smLElbX,mx(13),POSE_LERP);
 POSE_DATA.smLElbY=lerp(POSE_DATA.smLElbY,my(13),POSE_LERP);
 POSE_DATA.smLWriX=lerp(POSE_DATA.smLWriX,mx(15),POSE_LERP);
 POSE_DATA.smLWriY=lerp(POSE_DATA.smLWriY,my(15),POSE_LERP);
 POSE_DATA.smRElbX=lerp(POSE_DATA.smRElbX,mx(14),POSE_LERP);
 POSE_DATA.smRElbY=lerp(POSE_DATA.smRElbY,my(14),POSE_LERP);
 POSE_DATA.smRWriX=lerp(POSE_DATA.smRWriX,mx(16),POSE_LERP);
 POSE_DATA.smRWriY=lerp(POSE_DATA.smRWriY,my(16),POSE_LERP);
}


function applyPoseToHero(hero){
 let noseX, noseY;
 if(smoothNose){
   noseX = smoothNose.x;
   noseY = smoothNose.y;
 } else if(POSE_DATA.present && POSE_DATA.smNoseX !== null){
   noseX = POSE_DATA.smNoseX;
   noseY = POSE_DATA.smNoseY;
 } else {
   return;
 }


 if(poseBaseX === null){ poseBaseX = noseX; poseBaseY = noseY; }


 let shoulderDeltaX = 0, shoulderDeltaY = 0;
 if(POSE_DATA.present && POSE_DATA.smShoulderMidX !== null){
   shoulderDeltaX = (POSE_DATA.smShoulderMidX - poseBaseX) * 0.18;
   shoulderDeltaY = (POSE_DATA.smShoulderMidY - poseBaseY) * 0.10;
   const velY = POSE_DATA.smShoulderMidY - (poseBaseY + shoulderDeltaY);
   if(velY < -8) POSE_DATA.jumpVel = lerp(POSE_DATA.jumpVel, -height*0.025, 0.35);
 }
 POSE_DATA.jumpVel = lerp(POSE_DATA.jumpVel, 0, 0.14);


 const targetX = noseX + shoulderDeltaX;
 const targetY = noseY + shoulderDeltaY + POSE_DATA.jumpVel;


 hero.companionOffX = lerp(hero.companionOffX || 0, targetX - width/2,  0.14);
 hero.companionOffY = lerp(hero.companionOffY || 0, targetY - height/2, 0.14);
}


// ─────────────────────────────────────────────────────────────────
//  COMPANION EXPRESSION CLASSIFIER  (v7 — unchanged)
// ─────────────────────────────────────────────────────────────────
const COMP_EXPR = {
 current:       "neutral",
 target:        "neutral",
 blendT:        1.0,
 BLEND_SPEED:   0.055,
 pendingTarget: "neutral",
 holdTimer:     0,
 HOLD_FRAMES:   6,


 update(){
   const s  = EXPR.smile;
   const m  = EXPR.mouthOpen;
   const b  = EXPR.browHeight;
   const e  = EXPR.eyeOpen;
   const cd = EXPR.cornerDrop;


   let newTarget;


   if(e > 0.72 && m > 0.60 && b > 0.55){
     newTarget = "surprise";
   } else if(cd > 0.40 && m < 0.35 && s < 0.45){
     newTarget = "sad";
   } else if(s > 0.50 && cd < 0.25){
     newTarget = "happy";
   } else {
     newTarget = "neutral";
   }


   if(newTarget === this.pendingTarget){
     this.holdTimer++;
   } else {
     this.pendingTarget = newTarget;
     this.holdTimer = 0;
   }


   if(this.holdTimer >= this.HOLD_FRAMES && newTarget !== this.target){
     this.target = newTarget;
     this.blendT = 0.0;
   }


   this.blendT = Math.min(this.blendT + this.BLEND_SPEED, 1.0);
   if(this.blendT >= 1.0) this.current = this.target;
 },


 get(){ return this.blendT >= 0.5 ? this.target : this.current; },
 weight(){ return easeOut3(this.blendT); }
};


function compEyeImg(expr){
 if(expr === "surprise") return EYE_SURPRISE;
 if(expr === "sad")      return EYE_CRY;
 return EYE_OPEN;
}
function compMouthImg(expr){
 if(expr === "surprise") return MOUTH_SURPRISE;
 if(expr === "sad")      return MOUTH_SAD;
 return MOUTH_OPEN;
}


// ─────────────────────────────────────────────────────────────────
//  MOUTH-OPEN FLOAT
// ─────────────────────────────────────────────────────────────────
let mouthOpenVal=0;
function updateMouthOpen(){
 if(!companionMode||!POSE_DATA.present){
   mouthOpenVal=lerp(mouthOpenVal,0,0.08);
   return;
 }
 const noseY = POSE_DATA.smNoseY;
 const lWriY = POSE_DATA.smLWriY;
 const rWriY = POSE_DATA.smRWriY;
 const handsUp = (lWriY !== null && lWriY < noseY - 60) ||
                 (rWriY !== null && rWriY < noseY - 60);
 mouthOpenVal=lerp(mouthOpenVal, handsUp ? 1 : 0, 0.08);
}


// ─────────────────────────────────────────────────────────────────
//  PUPIL SYSTEM
// ─────────────────────────────────────────────────────────────────
const PUPIL_MAX     = 9;
const pupilOffset   = { x: 0, y: 0 };
const pupilTarget   = { x: 0, y: 0 };
const prevCompNose  = { x: null, y: null };


function updatePupilVel(){
 if(!companionMode || !smoothNose){
   pupilOffset.x  = lerp(pupilOffset.x,  0, 0.08);
   pupilOffset.y  = lerp(pupilOffset.y,  0, 0.08);
   pupilTarget.x  = lerp(pupilTarget.x,  0, 0.08);
   pupilTarget.y  = lerp(pupilTarget.y,  0, 0.08);
   prevCompNose.x = null;
   prevCompNose.y = null;
   return;
 }


 if(prevCompNose.x === null){
   prevCompNose.x = smoothNose.x;
   prevCompNose.y = smoothNose.y;
 }


 const velX = smoothNose.x - prevCompNose.x;
 const velY = smoothNose.y - prevCompNose.y;


 prevCompNose.x = lerp(prevCompNose.x, smoothNose.x, 0.06);
 prevCompNose.y = lerp(prevCompNose.y, smoothNose.y, 0.06);


 pupilTarget.x = lerp(pupilTarget.x,
   Math.max(-PUPIL_MAX, Math.min(PUPIL_MAX, velX * 25)), 0.2);
 pupilTarget.y = lerp(pupilTarget.y,
   Math.max(-PUPIL_MAX, Math.min(PUPIL_MAX, velY * 25)), 0.2);


 pupilOffset.x = lerp(pupilOffset.x, pupilTarget.x, 0.10);
 pupilOffset.y = lerp(pupilOffset.y, pupilTarget.y, 0.10);
}


// ─────────────────────────────────────────────────────────────────
//  TWIRL-BURST SYSTEM
// ─────────────────────────────────────────────────────────────────
const TWIRL_CONSEC   = 6;
const BURST_HOLD     = 90;
const BURST_REMAT    = 150;
const BURST_COOLDOWN = 240;


window.burstState  = "idle";
window.burstX      = 0;
window.burstY      = 0;
window.burstColor  = "blue";
window.burstRadius = 120;


let _twirlConsec = 0;
let _bTimer      = 0;
let _bCooldown   = 0;


function _updateBurst(){
 if(!companionMode || !blobs.length){
   _resetBurstTracking();
   return;
 }


 const hero = blobs[heroIdx];
 if(_bCooldown > 0) _bCooldown--;


 if(window.burstState === "idle"){
   const pd = window.mpPose;
   const lm = pd && pd.poseLandmarks;
   if(lm && lm.length >= 13){
     const lShoulderX = lm[11].x;
     const rShoulderX = lm[12].x;
     const shoulderSpread = Math.abs(lShoulderX - rShoulderX);
     const backTurned = shoulderSpread < 0.12;
     _twirlConsec = backTurned ? _twirlConsec + 1 : 0;


     if(_twirlConsec >= TWIRL_CONSEC && _bCooldown === 0){
       // ★ PATCH 3: Notify state lock system before firing burst
       if(typeof window._onTwirlDetected === 'function') window._onTwirlDetected();


       window.burstState  = "burst";
       window.burstX      = hero.x;
       window.burstY      = hero.y;
       window.burstColor  = hero.charId;
       window.burstRadius = hero.r;
       _bTimer      = 0;
       _twirlConsec = 0;
       if(typeof gestureReactionSystem !== 'undefined' &&
          typeof gestureReactionSystem.triggerBurst === 'function'){
         gestureReactionSystem.triggerBurst(hero.x, hero.y, hero.charId, hero.r);
       }
     }
   } else {
     _twirlConsec = 0;
   }
 }


 if(window.burstState === "burst"){
   hero.alphaT = 0;
   hero.alpha  = 0;
   _bTimer++;
   if(_bTimer >= BURST_HOLD){
     window.burstState = "remat";
     _bTimer = 0;
     if(typeof gestureReactionSystem !== 'undefined' &&
        typeof gestureReactionSystem.triggerRemat === 'function'){
       gestureReactionSystem.triggerRemat();
     }
   }
 }


 if(window.burstState === "remat"){
   const prog    = _bTimer / BURST_REMAT;
   const t       = constrain((prog - 0.75) / 0.25, 0, 1);
   const targetA = Math.floor(easeOut3(t) * 255);
   hero.alphaT = targetA;
   hero.alpha  = Math.min(hero.alpha, targetA);
   _bTimer++;
   if(_bTimer > BURST_REMAT){
     window.burstState = "idle";
     _bCooldown  = BURST_COOLDOWN;
     _bTimer     = 0;
     hero.alphaT = 255;
   }
 }


 if(window.burstState === "idle" && hero.mode === "awakening"){
   hero.alphaT = 255;
 }
}


function _resetBurstTracking(){
 _twirlConsec = 0; _bTimer = 0; _bCooldown = 0;
 window.burstState = "idle";
 if(blobs.length && heroIdx < blobs.length){
   blobs[heroIdx].alphaT = 255;
   blobs[heroIdx].alpha  = 255;
 }
}


// ─────────────────────────────────────────────────────────────────
//  APP STATE
// ─────────────────────────────────────────────────────────────────
let STATE="idle",detectTimer=0;
const DETECT_FRAMES=30;
let blobs=[],heroIdx=0,blobsReady=false;


let introMode=true,popupMode=false,companionMode=false;


// ─────────────────────────────────────────────────────────────────
//  PRELOAD
// ─────────────────────────────────────────────────────────────────
function preload(){
 const warn=n=>()=>console.warn("MISSING ASSET: "+n);
 for(const d of CHAR_DEFS){
   CHARS[d.id]={
     body:loadImage(d.body,null,warn(d.body)),
     dot: loadImage(d.dot, null,warn(d.dot))
   };
 }
 EYE_OPEN    =loadImage("Eyes-open-f.png",          null,warn("Eyes-open-f.png"));
 EYE_CLOSED  =loadImage("Eyes-closed-f.png",        null,warn("Eyes-closed-f.png"));
 EYE_SCRUNCH =loadImage("Eyes-closed-scrunch-f.png",null,warn("Eyes-closed-scrunch-f.png"));
 EYE_SURPRISE=loadImage("Eyes-surprise.png",        null,warn("Eyes-surprise.png"));
 EYE_CRY     =loadImage("Eyes-cry.png",             null,warn("Eyes-cry.png"));
 BALL_L      =loadImage("Eye-ball-Lf.png",          null,warn("Eye-ball-Lf.png"));
 BALL_R      =loadImage("Eye-ball-Rf.png",          null,warn("Eye-ball-Rf.png"));
 MOUTH_OPEN    =loadImage("Mouth-f.png",  null,warn("Mouth-f.png"));
 MOUTH_WHISTLE =loadImage("MouthW-f.png", null,warn("MouthW-f.png"));
 MOUTH_SURPRISE=loadImage("MouthS.png",   null,warn("MouthS.png"));
 MOUTH_SAD     =loadImage("MouthSad.png", null,warn("MouthSad.png"));
}


let _audioCtx = null;
function _loadAudioLazy(){
 try{ _audioCtx = new (window.AudioContext||window.webkitAudioContext)(); }
 catch(e){ return; }


 function fetchSound(file, onBuf){
   fetch(file)
     .then(r=>{ if(!r.ok) throw 0; return r.arrayBuffer(); })
     .then(ab=>_audioCtx.decodeAudioData(ab))
     .then(buf=>onBuf(buf))
     .catch(()=>{});
 }


 fetchSound("whistle.mp3", buf=>{
   snd = {
     _buf: buf,
     isLoaded(){ return true; },
     setVolume(v){ this._vol=v; },
     _vol: 0.7,
     play(){
       if(!_audioCtx) return;
       const src=_audioCtx.createBufferSource();
       const g=_audioCtx.createGain();
       src.buffer=this._buf; src.loop=false;
       g.gain.setValueAtTime(this._vol, _audioCtx.currentTime);
       src.connect(g); g.connect(_audioCtx.destination);
       src.start();
       this._src=src;
     },
     stop(){ try{ if(this._src) this._src.stop(); }catch(e){} },
     duration(){ return this._buf ? this._buf.duration : 2.2; },
     _src: null,
   };
   sndReady = true;
 });


 ["freesound_community-wobble-board-101198.mp3",
  "mrstokes302-wobble-sfx-447574.mp3"].forEach(file=>{
   fetchSound(file, buf=>{
     const w = {
       _buf: buf,
       isLoaded(){ return true; },
       setVolume(v){ this._vol=v; },
       _vol: 0.65,
       play(){
         if(!_audioCtx) return;
         const src=_audioCtx.createBufferSource();
         const g=_audioCtx.createGain();
         src.buffer=this._buf; src.loop=false;
         g.gain.setValueAtTime(this._vol, _audioCtx.currentTime);
         src.connect(g); g.connect(_audioCtx.destination);
         src.start();
       },
       duration(){ return this._buf ? this._buf.duration : 0.8; },
     };
     wobbleSounds.push(w);
     wobbleReady = true;
   });
 });
}


// ─────────────────────────────────────────────────────────────────
//  SETUP
// ─────────────────────────────────────────────────────────────────
function setup(){
 createCanvas(windowWidth,windowHeight);
 pixelDensity(displayDensity());
 imageMode(CENTER);
 textFont("sans-serif");
 buildPaper();
 _loadAudioLazy();
}


// ─────────────────────────────────────────────────────────────────
//  DRAW
// ─────────────────────────────────────────────────────────────────
function draw(){
 if(!blobsReady){
   blobsReady=true;
   for(const d of CHAR_DEFS)
     for(let i=0;i<BLOBS_PER_COLOR;i++) blobs.push(new BlobChar(blobs.length,d.id));
   EXPR_DIST.init(blobs.length);
   console.log("Blobs ready:",blobs.length);
 }


 noTint();
 drawPaper();


 if(typeof gestureReactionSystem !== 'undefined') gestureReactionSystem.renderBehind();


 parseFace(); smoothExprs();
 parseHands();
 parsePose();


 updateState();


 _updateBurst();


 if(typeof gestureReactionSystem !== 'undefined') gestureReactionSystem.update();


 handleCollisions();
 if(sndCool>0) sndCool--;
 if(wobbleCool>0) wobbleCool--;
 EXPR_DIST.tick(blobs.length);


 if(companionMode){
   COMP_EXPR.update();
   COMP_BLINK.tick();
 }
 updateMouthOpen();
 updatePupilVel();


 for(let i=0;i<blobs.length;i++){
   if((STATE==="selection"||STATE==="awakening")&&i===heroIdx) continue;
   blobs[i].update();
   blobs[i].draw();
 }
 noTint();


 if(STATE==="selection"||STATE==="awakening"){
   blobs[heroIdx].update();
   blobs[heroIdx].draw();
 }


 drawNotes();


 if(typeof gestureReactionSystem !== 'undefined') gestureReactionSystem.renderFront();


 drawHUD();
}


// ─────────────────────────────────────────────────────────────────
//  DETECTION PRESENCE HELPER
// ─────────────────────────────────────────────────────────────────
function anyPresent(){
 return !!(smoothNose || POSE_DATA.present ||
           HAND_DATA.left.present || HAND_DATA.right.present);
}


// ─────────────────────────────────────────────────────────────────
//  STATE MACHINE
// ─────────────────────────────────────────────────────────────────
function updateState(){
 if(!blobs.length) return;


 if(STATE==="idle"){
   if(anyPresent()){
     STATE="detection"; detectTimer=0;
     blobs.forEach(b=>b.onDetection());
     // ★ PATCH 1: Notify state lock — user entered frame
     if(typeof window._onUserPresence === 'function') window._onUserPresence(true);
   }
 } else if(STATE==="detection"){
   if(!anyPresent()){ toIdle(); return; }
   if(++detectTimer>=DETECT_FRAMES){
     STATE="selection";
     heroIdx=closestCenter();
     const ids=Object.keys(CHARS);
     blobs[heroIdx].charId=ids[Math.floor(Math.random()*ids.length)];
     blobs.forEach((b,i)=>i===heroIdx?b.onSelection():b.onDismiss());
   }
 } else if(STATE==="selection"){
   if(!anyPresent()){ toIdle(); return; }
   const h=blobs[heroIdx];
   if(h.awakeR>0 && h.r>h.awakeR*0.85 && dist(h.x,h.y,width/2,height/2)<h.awakeR*0.5){
     STATE="awakening";
     blobs[heroIdx].onAwakening();
     poseBaseX=null; poseBaseY=null;
   }
 } else if(STATE==="awakening"){
   if(!anyPresent()){ toIdle(); return; }
   applyPoseToHero(blobs[heroIdx]);
 }


 introMode    =(STATE==="idle"||STATE==="detection");
 popupMode    =(STATE==="selection");
 companionMode=(STATE==="awakening");
}


function toIdle(){
 STATE="idle"; detectTimer=0;
 blobs.forEach(b=>b.onIdle());
 introMode=true; popupMode=false; companionMode=false;
 poseBaseX=null; poseBaseY=null;
 POSE_DATA.present=false;
 POSE_DATA.smShoulderMidX=null; POSE_DATA.smShoulderMidY=null;
 POSE_DATA.smNoseX=null;        POSE_DATA.smNoseY=null;
 POSE_DATA.smLElbX=null;        POSE_DATA.smLElbY=null;
 POSE_DATA.smLWriX=null;        POSE_DATA.smLWriY=null;
 POSE_DATA.smRElbX=null;        POSE_DATA.smRElbY=null;
 POSE_DATA.smRWriX=null;        POSE_DATA.smRWriY=null;
 POSE_DATA.torsoOffX=0;         POSE_DATA.torsoOffY=0; POSE_DATA.jumpVel=0;
 COMP_EXPR.current="neutral"; COMP_EXPR.target="neutral"; COMP_EXPR.blendT=1;
 COMP_EXPR.pendingTarget="neutral"; COMP_EXPR.holdTimer=0;
 mouthOpenVal=0;
 pupilOffset.x=0;  pupilOffset.y=0;
 pupilTarget.x=0;  pupilTarget.y=0;
 prevCompNose.x=null; prevCompNose.y=null;
 COMP_BLINK.stop();
 _resetBurstTracking();
 // ★ PATCH 2: Notify state lock — user left frame
 if(typeof window._onUserPresence === 'function') window._onUserPresence(false);
}


function closestCenter(){
 let best=0,bd=Infinity;
 blobs.forEach((b,i)=>{const d=dist(b.x,b.y,width/2,height/2);if(d<bd){bd=d;best=i;}});
 return best;
}


// ─────────────────────────────────────────────────────────────────
//  COLLISION  (intro only)
// ─────────────────────────────────────────────────────────────────
function handleCollisions(){
 if(STATE!=="idle"&&STATE!=="detection") return;
 for(let i=0;i<blobs.length;i++) for(let j=i+1;j<blobs.length;j++){
   const a=blobs[i],b=blobs[j];
   const dx=b.x-a.x,dy=b.y-a.y,d=Math.sqrt(dx*dx+dy*dy),mn=a.r+b.r;
   if(d<mn&&d>0.001){
     const nx=dx/d,ny=dy/d,ov=(mn-d)*0.5;
     a.x-=nx*ov;a.y-=ny*ov;b.x+=nx*ov;b.y+=ny*ov;
     const dv=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
     if(dv<0){
       const im=dv*0.85;
       a.vx+=im*nx;a.vy+=im*ny;b.vx-=im*nx;b.vy-=im*ny;
       a.sqxT=random(1.2,1.45);b.sqxT=random(1.2,1.45);
       if(Math.abs(dv)>0.5) tryWobble();
     }
   }
 }
}


// ─────────────────────────────────────────────────────────────────
//  HUD
// ─────────────────────────────────────────────────────────────────
function drawHUD(){
 noTint();
 noStroke();fill(60,50,40,110);textSize(11);textFont("monospace");textAlign(LEFT,TOP);
 const hL=HAND_DATA.left.present?"L✓":"L—",hR=HAND_DATA.right.present?"R✓":"R—";
 const mStr=introMode?"intro":popupMode?"popup":"companion";
 const h=blobs[heroIdx];
 const rStr=h?(h.r.toFixed(0)+"/"+h.awakeR.toFixed(0)):"—";
 const blinkStr="blink:"+COMP_BLINK.state+"("+COMP_BLINK.blinkT.toFixed(2)+")";
 const exprStr="expr:"+COMP_EXPR.get()+"("+COMP_EXPR.blendT.toFixed(2)+")";
 const det="det:"+( smoothNose?"face":"—" )+"|"+( POSE_DATA.present?"pose":"—" )+"|"+hL+" "+hR;
 const burstStr="|burst:"+window.burstState+"(twirl:"+_twirlConsec+")";
 const sysStr="|sys:"+window.systemMode;
 text(STATE+"|"+mStr+"|"+det
   +"|mo:"+mouthOpenVal.toFixed(2)
   +"|"+blinkStr
   +"|"+exprStr
   +"|r:"+rStr
   +burstStr
   +sysStr, 12, 12);
}
function windowResized(){resizeCanvas(windowWidth,windowHeight);buildPaper();}




// ═════════════════════════════════════════════════════════════════
//  BLOB CLASS
// ═════════════════════════════════════════════════════════════════
class BlobChar{
 constructor(idx,charId){
   this.idx=idx; this.charId=charId; this.mode="idle";
   this.baseR=random(45,170);
   this.r=this.baseR;
   this.x=random(this.baseR+20,width-this.baseR-20);
   this.y=random(this.baseR+20,height-this.baseR-20);
   const sp=p5.Vector.random2D().mult(2.0);
   this.vx=sp.x; this.vy=sp.y;
   this.sqx=1; this.sqxT=1;
   this.alpha=255; this.alphaT=255;
   this.driftX=0; this.driftY=0;
   this.comboCurr=pickCombo(null); this.comboNext=null;
   this.fadeT=1; this.exprState="holding";
   this.holdTimer=Math.floor(random(40,200));
   this.noteTimer=0; this.isWhistling=false;
   this.blinkTimer=Math.floor(random(80,220));
   this.blinkState="open"; this.blinkFrames=0;
   this.gx=0; this.gy=0; this.gxT=0; this.gyT=0;
   this.gazeTimer=Math.floor(random(60,140));
   this.popFrames=0; this.POP_TOTAL=120;
   this.popStartX=0; this.popStartY=0; this.popStartR=0;
   this.awakeR=0;
   this.handPhase="none"; this.handTimer=0; this.arms=[];
   this.bezierArms=[];
   this.companionOffX=0; this.companionOffY=0;
 }


 onIdle(){
   this.mode="idle"; this.alphaT=255; this.sqxT=1;
   const s=p5.Vector.random2D().mult(2.0); this.vx=s.x; this.vy=s.y;
   this.handPhase="none"; this.arms=[];
   this.bezierArms=[];
   this.exprState="holding"; this.holdTimer=Math.floor(random(40,180));
   this.isWhistling=false; this.companionOffX=0; this.companionOffY=0;
 }
 onDetection(){ this.mode="detection"; }


 onSelection(){
   this.mode="chosen"; this.vx=0; this.vy=0;
   this.popStartX=this.x; this.popStartY=this.y; this.popStartR=this.r;
   this.popFrames=0;
   this.awakeR=computeAwakeBodyR();
   this.comboCurr=null; this.comboNext=null;
   this.exprState="holding"; this.holdTimer=999999;
   this.isWhistling=false; stopWhistle();
   this.arms=[]; this.bezierArms=[];
 }


 onDismiss(){
   this.mode="dismissed"; this.alphaT=0; this.vx=0; this.vy=0;
   const e=Math.floor(random(4));
   this.driftX=[random(width),random(width),-200,width+200][e];
   this.driftY=[-200,height+200,random(height),random(height)][e];
 }


 onAwakening(){
   this.mode="awakening";
   this.isWhistling=false; stopWhistle();
   this.gx=0; this.gy=0; this.gxT=0; this.gyT=0;
   this.gazeTimer=Math.floor(random(60,140));
   this.handPhase="none"; this.handTimer=0; this.arms=[];
   const di=CHARS[this.charId]?CHARS[this.charId].dot:null;
   this.bezierArms=[
     new BezierArm(this,di,"left"),
     new BezierArm(this,di,"right")
   ];
   COMP_BLINK.start();
 }


 update(){
   this._move(); this._spring();
   if(this.mode==="idle"||this.mode==="detection") this._tickExpr();
   this._tickGaze();
   if(this.mode==="chosen") this._watchNose();
   if(this.mode==="awakening"&&companionMode){
     for(const arm of this.bezierArms) arm.update(this.r,this.x,this.y);
   }
 }


 _move(){
   if(this.mode==="idle"||this.mode==="detection"){
     this.x+=this.vx; this.y+=this.vy; this._walls();
     this.r=lerp(this.r,this.baseR,.12);
   } else if(this.mode==="chosen"){
     this.popFrames=Math.min(this.popFrames+1,this.POP_TOTAL);
     const t=this.popFrames/this.POP_TOTAL;
     this.x=lerp(this.popStartX,width/2, easeInOut(t));
     this.y=lerp(this.popStartY,height/2,easeInOut(t));
     this.r=lerp(this.popStartR,this.awakeR,easeOut3(constrain((t-.1)/.9,0,1)));
   } else if(this.mode==="awakening"){
     const tx=width/2  + (companionMode ? this.companionOffX : 0);
     const ty=height/2 + (companionMode ? this.companionOffY : 0);
     this.x=lerp(this.x,tx,.14);
     this.y=lerp(this.y,ty,.14);
     this.r=lerp(this.r,this.awakeR,.08);
   } else if(this.mode==="dismissed"){
     this.x=lerp(this.x,this.driftX,.04);
     this.y=lerp(this.y,this.driftY,.04);
     this.r=lerp(this.r,this.baseR,.07);
   }
 }
 _walls(){
   if(this.x-this.r<0)     {this.x=this.r;        this.vx*=-1;this.sqxT=random(1.2,1.4);}
   if(this.x+this.r>width) {this.x=width-this.r;  this.vx*=-1;this.sqxT=random(1.2,1.4);}
   if(this.y-this.r<0)     {this.y=this.r;         this.vy*=-1;this.sqxT=random(1.2,1.4);}
   if(this.y+this.r>height){this.y=height-this.r;  this.vy*=-1;this.sqxT=random(1.2,1.4);}
 }
 _spring(){
   this.sqx=lerp(this.sqx,this.sqxT,.10);
   if(Math.abs(this.sqx-this.sqxT)<0.012&&this.sqxT!==1) this.sqxT=1;
   this.alpha=lerp(this.alpha,this.alphaT,.07);
 }


 _tickExpr(){
   if(this.exprState==="holding"){
     if(--this.holdTimer<=0){
       this.comboNext=pickCombo(this.comboCurr);
       this.fadeT=0;this.exprState="fading";
       const willWhistle=this.comboNext.mouth==="whistle"&&EXPR_DIST.is(this.idx);
       this.isWhistling=willWhistle;
       if(willWhistle) tryWhistle();
       this.noteTimer=0;
     }
   } else {
     this.fadeT=Math.min(this.fadeT+random(.03,.07),1.0);
     if(this.fadeT>=1.0){
       this.comboCurr=this.comboNext;this.comboNext=null;
       this.exprState="holding";this.holdTimer=Math.floor(random(100,280));
       this.isWhistling=this.comboCurr.mouth==="whistle"&&EXPR_DIST.is(this.idx);
     }
   }
   if(EXPR_DIST.is(this.idx)&&this.comboCurr&&(this.comboCurr.balls||this.comboCurr.eye==="open")){
     this._tickBlink();
   }
   if(this.isWhistling&&EXPR_DIST.is(this.idx)){
     if(--this.noteTimer<=0){spawnNote(this.x,this.y-this.r*.85);this.noteTimer=Math.floor(random(13,28));}
   } else if(!EXPR_DIST.is(this.idx)){
     this.isWhistling=false;
   }
 }
 _tickBlink(){
   if     (this.blinkState==="open")    {if(--this.blinkTimer<=0){this.blinkState="closing";this.blinkFrames=3;}}
   else if(this.blinkState==="closing") {if(--this.blinkFrames<=0){this.blinkState="closed"; this.blinkFrames=4;}}
   else if(this.blinkState==="closed")  {if(--this.blinkFrames<=0){this.blinkState="opening";this.blinkFrames=5;}}
   else if(this.blinkState==="opening") {if(--this.blinkFrames<=0){this.blinkState="open";this.blinkTimer=Math.floor(random(80,220));}}
 }
 _tickGaze(){
   if(--this.gazeTimer<=0){
     this.gxT=random(-9,9);this.gyT=random(-6,6);
     this.gazeTimer=Math.floor(random(55,145));
   }
   this.gx=lerp(this.gx,this.gxT,.04);
   this.gy=lerp(this.gy,this.gyT,.04);
 }
 _watchNose(){
   if(!smoothNose) return;
   const ang=atan2(smoothNose.y-this.y,smoothNose.x-this.x),mo=this.r*.18;
   this.gx=lerp(this.gx,cos(ang)*mo,.18);
   this.gy=lerp(this.gy,sin(ang)*mo,.18);
 }


 draw(){
   if(this.alpha<2) return;
   noTint();


   if(this.mode==="awakening"&&companionMode){
     if(window.burstState === "idle" || window.burstState === "remat"){
       for(const arm of this.bezierArms) arm.draw();
     }
   }


   push();
   translate(this.x,this.y);
   this._drawBodyAndIdleFace();
   pop();


   noTint();


   if(this.mode==="awakening"){
     this._drawFaceWorld();
   }
 }


 _drawBodyAndIdleFace(){
   const imgs=CHARS[this.charId];
   if(!imgs||!imgs.body) return;
   const sz=this.r*2,sX=this.sqx,sY=1/sX;
   push();scale(sX,sY);tint(255,this.alpha);image(imgs.body,0,0,sz,sz);pop();
   if(this.mode==="chosen"||this.mode==="awakening") return;
   if(!EXPR_DIST.is(this.idx)||!this.comboCurr) return;
   tint(255,255);
   this._drawCombo(this.comboCurr,this.alpha,sz,sX,sY);
   if(this.exprState==="fading"&&this.comboNext&&this.fadeT>0.02)
     this._drawCombo(this.comboNext,this.alpha*this.fadeT,sz,sX,sY);
 }


 _drawCombo(combo,fa,sz,sX,sY){
   if(!combo||fa<3) return;
   const ei=eyeImg(combo.eye);if(!ei) return;
   const EW=sz*.88,EH=sz*.36,eyeY=-this.r*.12;
   const BSZ=this.r*.42,BSP=this.r*.28,MW=sz*.56,MH=sz*.23,MY=this.r*.38;
   push();scale(sX,sY);
   tint(255,fa);image(ei,0,eyeY,EW,EH);
   if(combo.balls&&BALL_L&&BALL_R){
     let bA=fa;
     if     (this.blinkState==="closing") bA=map(this.blinkFrames,3,0,fa,0);
     else if(this.blinkState==="closed")  bA=0;
     else if(this.blinkState==="opening") bA=map(this.blinkFrames,5,0,0,fa);
     if(bA>2){tint(255,bA);image(BALL_L,-BSP+this.gx,eyeY+this.gy,BSZ,BSZ);image(BALL_R,BSP+this.gx,eyeY+this.gy,BSZ,BSZ);}
   }
   if(combo.mouth!=="none"){const mi=mouthImg(combo.mouth);if(mi){tint(255,fa);image(mi,0,MY,MW,MH);}}
   pop();
 }


 _drawFaceWorld(){
   if(window.burstState === "burst") return;


   const bx=this.x, by=this.y, r=this.r;
   if(r<4) return;
   const BS=r*2;
   const sX=this.sqx, sY=1/sX;


   const EW_W   = BS * 0.43;
   const EW_H   = BS * 0.23;
   const EW_CY  = -BS * 0.055;


   const EC_W   = BS * 0.43;
   const EC_H   = BS * 0.12;
   const EC_CY  = -BS * 0.06;


   const EB_SIZE = BS * 0.095;
   const EBL_CX  = -BS * 0.135;
   const EBR_CX  =  BS * 0.095;
   const EB_CY   = -BS * 0.075;


   const MO_W   = BS * 0.38;
   const MO_H   = BS * 0.19;
   const MO_CY  = BS * 0.225;


   let px = pupilOffset.x;
   let py = pupilOffset.y;
   const pDist = Math.sqrt(px * px + py * py);
   const SAFE = 5;
   if(pDist > SAFE){ const sc = SAFE / pDist; px *= sc; py *= sc; }


   const mScale = 1 + mouthOpenVal * 0.5;
   const mW     = MO_W * mScale;
   const mH     = MO_H * mScale;
   const mCY    = MO_CY;


   const openA   = COMP_BLINK.openAlpha();
   const closedA = COMP_BLINK.blinkT;


   const expr    = COMP_EXPR.get();
   const eyeIm   = compEyeImg(expr);
   const mouthIm = compMouthImg(expr);


   const surpriseW = (expr === "surprise") ? 1.12 : 1.0;
   const ewW  = EW_W * surpriseW;
   const ewH  = EW_H * surpriseW;
   const ewCY = EW_CY - (ewH - EW_H) * 0.5;


   const showBalls = (expr === "neutral" || expr === "happy") && openA > 0.25;


   const faceAlpha = (window.burstState === "remat")
     ? this.alpha / 255
     : 1.0;
   if(faceAlpha < 0.01) return;


   push(); imageMode(CENTER);


   if(eyeIm && openA > 0.02){
     push(); translate(bx,by); scale(sX,sY);
     tint(255, 255 * openA * faceAlpha);
     image(eyeIm, 0, ewCY, ewW, ewH);
     pop();
   }


   if(showBalls && BALL_L && BALL_R){
     push(); translate(bx,by); scale(sX,sY);
     tint(255, 255 * openA * faceAlpha);
     image(BALL_L, EBL_CX + px, EB_CY + py, EB_SIZE, EB_SIZE);
     image(BALL_R, EBR_CX + px, EB_CY + py, EB_SIZE, EB_SIZE);
     pop();
   }


   if(EYE_CLOSED && closedA > 0.02){
     push(); translate(bx,by); scale(sX,sY);
     tint(255, 255 * closedA * faceAlpha);
     image(EYE_CLOSED, 0, EC_CY, EC_W, EC_H);
     pop();
   }


   if(mouthIm){
     push(); translate(bx,by); scale(sX,sY);
     tint(255, 255 * faceAlpha);
     image(mouthIm, 0, mCY, mW, mH);
     pop();
   }


   pop();
   noTint();
 }
}




// ═════════════════════════════════════════════════════════════════
//  BEZIER ARM CLASS  (companionMode only)
// ═════════════════════════════════════════════════════════════════
class BezierArm{
 constructor(blob,dotImg,side){
   this.blob=blob;
   this.dotImg=dotImg;
   this.side=side;
   this.N=14;
   this.time=0;
   this.emergeT=0;
   this.dots=Array.from({length:this.N},()=>({x:blob.x,y:blob.y}));
   this.smWriX=blob.x; this.smWriY=blob.y;
   this.smElbX=blob.x; this.smElbY=blob.y;
 }


 _anchor(r,bx,by){
   const BS=r*2;
   const dir=(this.side==="left")?-1:1;
   return {x:bx + dir*(BS*0.42 - r*0.12), y:by + BS*0.05};
 }


 _restWrist(r,bx,by){
   const BS=r*2;
   const dir=(this.side==="left")?-1:1;
   return {x:bx + dir*(BS*0.42 + BS*1.2), y:by + BS*0.05};
 }


 _restElbow(anchor,wrist){
   return {x:(anchor.x+wrist.x)*0.5, y:(anchor.y+wrist.y)*0.5 + this.blob.r*0.12};
 }


 update(r,bx,by){
   this.time += 0.016;
   this.emergeT = Math.min(this.emergeT + 0.016, 1.0);


   const anchor = this._anchor(r,bx,by);


   let elbowTarget, wristTarget;
   if(POSE_DATA.present && POSE_DATA.smLElbX !== null){
     if(this.side==="left"){
       elbowTarget = {x:POSE_DATA.smLElbX, y:POSE_DATA.smLElbY};
       wristTarget = {x:POSE_DATA.smLWriX, y:POSE_DATA.smLWriY};
     } else {
       elbowTarget = {x:POSE_DATA.smRElbX, y:POSE_DATA.smRElbY};
       wristTarget = {x:POSE_DATA.smRWriX, y:POSE_DATA.smRWriY};
     }
   } else {
     const restW = this._restWrist(r,bx,by);
     wristTarget = restW;
     elbowTarget = this._restElbow(anchor, restW);
   }


   this.smElbX = lerp(this.smElbX, elbowTarget.x, 0.55);
   this.smElbY = lerp(this.smElbY, elbowTarget.y, 0.55);
   this.smWriX = lerp(this.smWriX, wristTarget.x, 0.55);
   this.smWriY = lerp(this.smWriY, wristTarget.y, 0.55);


   const elbow = {x:this.smElbX, y:this.smElbY};
   const wrist = {x:this.smWriX, y:this.smWriY};


   const ux=wrist.x-anchor.x, uy=wrist.y-anchor.y;
   const ln=Math.sqrt(ux*ux+uy*uy)||1;
   const px=-uy/ln, py=ux/ln;


   for(let i=0;i<this.N;i++){
     const t=i/(this.N-1);
     const inv=1-t;
     const bxc=inv*inv*anchor.x + 2*inv*t*elbow.x + t*t*wrist.x;
     const byc=inv*inv*anchor.y + 2*inv*t*elbow.y + t*t*wrist.y;
     const wig=Math.sin(this.time*4+i*0.6)*4;
     const emerge=easeOut3(constrain(this.emergeT*2-t,0,1));


     if(i === 0){
       this.dots[0].x = anchor.x;
       this.dots[0].y = anchor.y;
     } else {
       const tx2=lerp(anchor.x, bxc+px*wig, emerge);
       const ty2=lerp(anchor.y, byc+py*wig, emerge);
       this.dots[i].x=lerp(this.dots[i].x, tx2, 0.55);
       this.dots[i].y=lerp(this.dots[i].y, ty2, 0.55);
     }
   }
 }


 draw(){
   if(!this.dotImg) return;
   const BS=this.blob.r*2;
   const szMax=82/300*BS;
   const szMin=28/300*BS;
   const alpha=floor(255*easeOut3(this.emergeT));
   if(alpha<4) return;


   push(); imageMode(CENTER); noTint();
   for(let i=0;i<this.N;i++){
     const t=i/(this.N-1);
     const sz=lerp(szMax,szMin,t);
     tint(255,alpha);
     image(this.dotImg, this.dots[i].x, this.dots[i].y, sz, sz);
   }
   noTint();
   pop();
 }
}




// ═════════════════════════════════════════════════════════════════
//  ARM CLASS  (intro only — unchanged)
// ═════════════════════════════════════════════════════════════════
class Arm{
 constructor(blob,dotImg,side){
   this.blob=blob;this.dotImg=dotImg;this.side=side;
   this.wigT=random(100);this.wigSpd=random(.016,.026);this.wigAmp=0;
   this.angle=(side==="left")?PI:0;
   this.N=12;this.dots=[];
   this.emergeFrame=0;


   for(let i=0;i<this.N;i++){
     this.dots.push({x:blob.x,y:blob.y,alpha:0,ns:random(1000),delay:i*0.07});
   }
   this.tipSmX=blob.x;this.tipSmY=blob.y;
   this.horizReady=false;
 }


 _dsz(r){return r*0.52;}
 _step(r){return this._dsz(r)*0.45;}
 _horizTip(r,bx,by){
   return {x:bx+cos(this.angle)*(r*0.82+this._step(r)*(this.N-1)),y:by};
 }
 _shoulderAnchor(r,bx,by){
   return {x:bx+cos(this.angle)*r*0.82, y:by-r*0.15};
 }


 update(phase,r,bx,by){
   this.wigT+=this.wigSpd;
   const step=this._step(r);


   if(phase==="emerge"){
     this.emergeFrame++;
     const progress=this.emergeFrame*0.022;
     for(let i=0;i<this.N;i++){
       const d=this.dots[i];
       const pct=constrain(progress-d.delay,0,1);
       const eo=easeOut3(pct);
       const finalDist=r*0.10+step*i;
       d.x=lerp(d.x,bx+cos(this.angle)*finalDist*eo,0.09);
       d.y=lerp(d.y,by,0.09);
       d.alpha=lerp(d.alpha,230*pct,0.07);
     }


   } else if(phase==="form"){
     this.wigAmp=lerp(this.wigAmp,r*0.05,0.04);
     const rx=bx+cos(this.angle)*r*0.82;
     this.dots[0].x=lerp(this.dots[0].x,rx,0.14);
     this.dots[0].y=lerp(this.dots[0].y,by,0.14);
     this.dots[0].alpha=lerp(this.dots[0].alpha,235,0.10);
     for(let i=1;i<this.N;i++){
       const prev=this.dots[i-1];
       this.dots[i].x=lerp(this.dots[i].x,prev.x+cos(this.angle)*step,0.13);
       this.dots[i].y=lerp(this.dots[i].y,prev.y,0.13);
       this.dots[i].alpha=lerp(this.dots[i].alpha,235,0.09);
     }


   } else if(phase==="horizontal"){
     this.wigAmp=lerp(this.wigAmp,r*0.04,0.05);
     if(!this.horizReady){
       const ht=this._horizTip(r,bx,by);
       this.tipSmX=ht.x;this.tipSmY=ht.y;this.horizReady=true;
     }
     const rx=bx+cos(this.angle)*r*0.82;
     this.dots[0].x=lerp(this.dots[0].x,rx,0.14);
     this.dots[0].y=lerp(this.dots[0].y,by,0.14);
     this.dots[0].alpha=lerp(this.dots[0].alpha,235,0.10);
     for(let i=1;i<this.N;i++){
       const prev=this.dots[i-1];
       this.dots[i].x=lerp(this.dots[i].x,prev.x+cos(this.angle)*step,0.13);
       this.dots[i].y=lerp(this.dots[i].y,prev.y,0.13);
       this.dots[i].alpha=lerp(this.dots[i].alpha,235,0.09);
     }


   } else if(phase==="alive"){
     this.wigAmp=lerp(this.wigAmp,r*0.12,0.03);


     const anchor=this._shoulderAnchor(r,bx,by);
     this.dots[0].x=lerp(this.dots[0].x,anchor.x,0.14);
     this.dots[0].y=lerp(this.dots[0].y,anchor.y,0.14);
     this.dots[0].alpha=lerp(this.dots[0].alpha,235,0.10);


     const hd=HAND_DATA[this.side];
     if(hd&&hd.present){
       this.tipSmX=lerp(this.tipSmX,hd.px,0.22);
       this.tipSmY=lerp(this.tipSmY,hd.py,0.22);
     } else {
       const ht=this._horizTip(r,bx,by);
       this.tipSmX=lerp(this.tipSmX,ht.x,0.04);
       this.tipSmY=lerp(this.tipSmY,ht.y,0.04);
     }


     const last=this.dots[this.N-1];
     last.x=lerp(last.x,this.tipSmX,0.20);
     last.y=lerp(last.y,this.tipSmY,0.20);
     last.alpha=lerp(last.alpha,235,0.09);


     for(let i=1;i<this.N-1;i++){
       this._snake(i,step);
       this.dots[i].alpha=lerp(this.dots[i].alpha,235,0.09);
     }
   }
 }


 _snake(i,step){
   const prev=this.dots[i-1],d=this.dots[i];
   const dx=d.x-prev.x,dy=d.y-prev.y;
   const dst=Math.sqrt(dx*dx+dy*dy)||0.001;
   const nx=dx/dst,ny=dy/dst;
   const perp=atan2(ny,nx)+HALF_PI;
   const wa=this.wigAmp*(1+i*0.05);
   const w=(noise(d.ns+this.wigT,i*0.5)-0.5)*2*wa;
   d.x=lerp(d.x,prev.x+nx*step+cos(perp)*w,0.14);
   d.y=lerp(d.y,prev.y+ny*step+sin(perp)*w,0.14);
 }


 draw(){
   if(!this.dotImg) return;
   const ds=this._dsz(this.blob.r);
   push();imageMode(CENTER);
   noTint();
   for(const d of this.dots){
     if(d.alpha<4) continue;
     tint(255,d.alpha);
     image(this.dotImg,d.x,d.y,ds,ds);
   }
   noTint();
   pop();
 }
}
