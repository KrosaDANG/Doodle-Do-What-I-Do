// ================================================================
//  A W A K E N I N G  —  ROUGH.js  (complete rewrite)
//
//  EXACT filenames from your folder:
//    Blue_Body.png   Blue_dot.png
//    Cyan_Body.png   Cyan_dot.png
//    Green_Body.png  green_dot.png   ← lowercase g
//    Pink_Body.png   Pink_Dot.png    ← capital D
//    Purple_Body.png Purple_dot.png
//    Red_body.png    Red_Dot.png     ← lowercase b, capital D
//
//  KEY FIXES vs previous versions:
//    1. Blobs created in a draw()-time guard (first frame after setup),
//       NOT in setup() — fixes "random is not defined" crash.
//    2. Paper texture drawn with scale(2) trick so half-res gfx fills canvas.
//    3. Canvas z-index:0, paper drawn first, blobs on top — nothing hidden.
//    4. All image() calls null-guarded.
//    5. p5.sound whistle loaded safely.
// ================================================================


// ─────────────────────────────────────────────────────────────────
//  CHARACTER TABLE  — filenames match folder EXACTLY (case-sensitive)
// ─────────────────────────────────────────────────────────────────
const CHAR_DEFS = [
 { id:"blue",   body:"Blue_Body.png",   dot:"Blue_dot.png"   },
 { id:"cyan",   body:"Cyan_Body.png",   dot:"Cyan_dot.png"   },
 { id:"green",  body:"Green_Body.png",  dot:"green_dot.png"  },
 { id:"pink",   body:"Pink_Body.png",   dot:"Pink_Dot.png"   },
 { id:"purple", body:"Purple_Body.png", dot:"Purple_dot.png" },
 { id:"red",    body:"Red_body.png",    dot:"Red_Dot.png"    },
];


const CHARS = {};          // filled in preload()
const BLOBS_PER_COLOR = 3; // 18 blobs total


// ─────────────────────────────────────────────────────────────────
//  EXPRESSION ASSETS
// ─────────────────────────────────────────────────────────────────
let EYE_OPEN, EYE_CLOSED, EYE_SCRUNCH, EYE_SURPRISE, EYE_CRY;
let BALL_L, BALL_R;
let MOUTH_OPEN, MOUTH_WHISTLE, MOUTH_SURPRISE, MOUTH_SAD;


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
 const pool = COMBO_DEFS.filter(c => comboOk(c) && (!exclude || c.id!==exclude.id));
 if(!pool.length) return COMBO_DEFS[0];
 let r = Math.random() * pool.reduce((s,c)=>s+c.w,0);
 for(const c of pool){ r-=c.w; if(r<=0) return c; }
 return pool[0];
}


// ─────────────────────────────────────────────────────────────────
//  AUDIO
// ─────────────────────────────────────────────────────────────────
let snd=null, sndReady=false, sndPlaying=false, sndCool=0;
function tryWhistle(){
 if(sndPlaying||sndCool>0||!sndReady||!snd) return;
 try{
   if(typeof userStartAudio==="function") userStartAudio();
   snd.setVolume(0.7); snd.play();
   sndPlaying=true; sndCool=300;
   setTimeout(()=>{ sndPlaying=false; }, (snd.duration?snd.duration()*1000:2200)+400);
 }catch(e){}
}


// ─────────────────────────────────────────────────────────────────
//  FLOATING MUSIC NOTES
// ─────────────────────────────────────────────────────────────────
const NOTES=[];
function spawnNote(x,y){
 NOTES.push({x:x+Math.random()*28-14, y, a:220,
   vy:-1.4-Math.random()*1.1, life:65+Math.floor(Math.random()*50),
   sym:["♪","♫","♩","♬"][Math.floor(Math.random()*4)]});
}
function drawNotes(){
 for(let i=NOTES.length-1;i>=0;i--){
   const n=NOTES[i];
   n.y+=n.vy; n.x+=Math.sin(n.life*.12)*.5;
   n.a=lerp(n.a,0,.03); n.life--;
   if(n.life<=0||n.a<2){NOTES.splice(i,1);continue;}
   push(); noStroke(); fill(255,215,60,n.a);
   textSize(13); textAlign(CENTER,CENTER); text(n.sym,n.x,n.y); pop();
 }
}


// ─────────────────────────────────────────────────────────────────
//  PAPER TEXTURE
// ─────────────────────────────────────────────────────────────────
let paperGfx=null;
function buildPaper(){
 // Half-res for performance; we'll draw it scaled up 2x
 const W=Math.ceil(windowWidth/2), H=Math.ceil(windowHeight/2);
 if(paperGfx) paperGfx.remove();
 paperGfx = createGraphics(W,H);
 paperGfx.pixelDensity(1);
 paperGfx.randomSeed(77); paperGfx.noiseSeed(77);
 paperGfx.background(238,231,213);
 paperGfx.noStroke();
 for(let i=0;i<180;i++){
   const px=paperGfx.random(W), py=paperGfx.random(H);
   const pr=paperGfx.random(18,110), v=paperGfx.random(-10,9);
   paperGfx.fill(
     Math.min(255,Math.max(200,238+v)),
     Math.min(248,Math.max(195,231+v)),
     Math.min(235,Math.max(180,213+v)),
     paperGfx.random(12,38));
   paperGfx.ellipse(px,py,pr,pr*paperGfx.random(0.4,1.7));
 }
 for(let i=0;i<W*H*0.03;i++){
   const px=paperGfx.random(W), py=paperGfx.random(H), v=paperGfx.random(-18,20);
   paperGfx.fill(
     Math.min(255,Math.max(160,220+v)),
     Math.min(248,Math.max(155,213+v)),
     Math.min(235,Math.max(148,200+v)),
     paperGfx.random(30,90));
   paperGfx.rect(px,py,1,1);
 }
 paperGfx.stroke(162,155,142,20); paperGfx.strokeWeight(0.5);
 let lY=0;
 while(lY<H){
   lY+=paperGfx.random(8,15);
   paperGfx.line(0,lY,W,lY+paperGfx.random(-2,2));
 }
}
function drawPaper(){
 // Draw the half-res texture scaled to full canvas — purely background
 push();
 imageMode(CORNER); noTint();
 image(paperGfx, 0,0, width, height);
 imageMode(CENTER);
 pop();
}


// ─────────────────────────────────────────────────────────────────
//  EASING HELPERS
// ─────────────────────────────────────────────────────────────────
function easeInOut(t){
 t=constrain(t,0,1);
 return t<0.5 ? 4*t*t*t : 1-Math.pow(-2*t+2,3)/2;
}
function easeOut3(t){
 return 1-Math.pow(1-constrain(t,0,1),3);
}


// ─────────────────────────────────────────────────────────────────
//  FACE TRACKING
// ─────────────────────────────────────────────────────────────────
let rawNose=null, smoothNose=null;
const EXPR={smile:0,smileR:0,eyeL:0,eyeLR:0,eyeR:0,eyeRR:0,brows:0,browsR:0};


function parseFace(){
 const faces=window.mpFaces;
 if(!faces||!faces.length){ rawNose=null; return; }
 const lm=faces[0];
 const pt=i=>({x:lm[i].x*width, y:lm[i].y*height});
 const D=(a,b)=>dist(a.x,a.y,b.x,b.y);
 rawNose=pt(1);
 const mL=pt(61),mR=pt(291),eL=pt(33),eR=pt(263),fW=D(eL,eR)||1;
 EXPR.smileR=constrain(map(D(mL,mR)/fW,0.3,0.55,0,1),0,1);
 EXPR.eyeLR =constrain(map(D(pt(159),pt(145))/(D(pt(33),pt(133))||1),0.1,0.4,0,1),0,1);
 EXPR.eyeRR =constrain(map(D(pt(386),pt(374))/(D(pt(362),pt(263))||1),0.1,0.4,0,1),0,1);
 const mB=(pt(70).y+pt(300).y)*0.5, mE=(eL.y+eR.y)*0.5;
 EXPR.browsR=constrain(map((mE-mB)/(fW*1.2),0.05,0.18,0,1),0,1);
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
//  APP STATE
// ─────────────────────────────────────────────────────────────────
let STATE="idle", detectTimer=0;
const DETECT_FRAMES=150;
let blobs=[], heroIdx=0;
let blobsReady=false;  // ← key flag: blobs only created after p5 is running


// ─────────────────────────────────────────────────────────────────
//  PRELOAD  — only assets, no random() calls here
// ─────────────────────────────────────────────────────────────────
function preload(){
 const warn = n => () => console.warn("MISSING ASSET: " + n);


 for(const d of CHAR_DEFS){
   CHARS[d.id] = {
     body: loadImage(d.body, null, warn(d.body)),
     dot:  loadImage(d.dot,  null, warn(d.dot)),
   };
 }


 EYE_OPEN    = loadImage("Eyes-open-f.png",           null, warn("Eyes-open-f.png"));
 EYE_CLOSED  = loadImage("Eyes-closed-f.png",         null, warn("Eyes-closed-f.png"));
 EYE_SCRUNCH = loadImage("Eyes-closed-scrunch-f.png", null, warn("Eyes-closed-scrunch-f.png"));
 EYE_SURPRISE= loadImage("Eyes-surprise.png",         null, warn("Eyes-surprise.png"));
 EYE_CRY     = loadImage("Eyes-cry.png",              null, warn("Eyes-cry.png"));
 BALL_L      = loadImage("Eye-ball-Lf.png",           null, warn("Eye-ball-Lf.png"));
 BALL_R      = loadImage("Eye-ball-Rf.png",           null, warn("Eye-ball-Rf.png"));


 MOUTH_OPEN    = loadImage("Mouth-f.png",   null, warn("Mouth-f.png"));
 MOUTH_WHISTLE = loadImage("MouthW-f.png",  null, warn("MouthW-f.png"));
 MOUTH_SURPRISE= loadImage("MouthS.png",    null, warn("MouthS.png"));
 MOUTH_SAD     = loadImage("MouthSad.png",  null, warn("MouthSad.png"));


 if(typeof loadSound==="function"){
   try{
     snd = loadSound("whistle.mp3",
       ()=>{ sndReady=true; console.log("whistle.mp3 loaded"); },
       ()=>  console.warn("whistle.mp3 not found"));
   }catch(e){ console.warn("p5.sound error:",e); }
 }
}


// ─────────────────────────────────────────────────────────────────
//  SETUP  — canvas + paper only. NO new Blob() here!
// ─────────────────────────────────────────────────────────────────
function setup(){
 createCanvas(windowWidth, windowHeight);
 pixelDensity(displayDensity());
 imageMode(CENTER);
 textFont("sans-serif");
 buildPaper();
 console.log("setup() done — blobs will be created on first draw frame");
}


// ─────────────────────────────────────────────────────────────────
//  DRAW LOOP
// ─────────────────────────────────────────────────────────────────
function draw(){


 // ── FIRST FRAME: create blobs now that p5 random() exists ──
 if(!blobsReady){
   blobsReady=true;
   for(const d of CHAR_DEFS){
     for(let i=0;i<BLOBS_PER_COLOR;i++){
       blobs.push(new BlobChar(blobs.length, d.id));
     }
   }
   console.log("Blobs created:", blobs.length);
 }


 // ── BACKGROUND — drawn first so it's always BEHIND blobs ──
 drawPaper();


 // ── FACE & EXPRESSIONS ────────────────────────────────────
 parseFace();
 smoothExprs();
 updateState();
 handleCollisions();
 if(sndCool>0) sndCool--;


 // ── DRAW ALL BLOBS (hero last = on top) ───────────────────
 for(let i=0;i<blobs.length;i++){
   if((STATE==="selection"||STATE==="awakening") && i===heroIdx) continue;
   blobs[i].update();
   blobs[i].draw();
 }
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
   if(smoothNose){
     STATE="detection"; detectTimer=0;
     blobs.forEach(b=>b.onDetection());
   }
 } else if(STATE==="detection"){
   if(!smoothNose){ toIdle(); return; }
   if(++detectTimer>=DETECT_FRAMES){
     STATE="selection";
     heroIdx=closestCenter();
     const ids=Object.keys(CHARS);
     blobs[heroIdx].charId = ids[Math.floor(Math.random()*ids.length)];
     blobs.forEach((b,i)=> i===heroIdx ? b.onSelection() : b.onDismiss());
   }
 } else if(STATE==="selection"){
   if(!smoothNose){ toIdle(); return; }
   const h=blobs[heroIdx];
   if(dist(h.x,h.y,width/2,height/2)<12 && h.r > h.baseR*2.5){
     STATE="awakening";
     blobs[heroIdx].onAwakening();
   }
 } else if(STATE==="awakening"){
   if(!smoothNose) toIdle();
 }
}
function toIdle(){
 STATE="idle"; detectTimer=0;
 blobs.forEach(b=>b.onIdle());
}
function closestCenter(){
 let best=0, bd=Infinity;
 blobs.forEach((b,i)=>{
   const d=dist(b.x,b.y,width/2,height/2);
   if(d<bd){bd=d;best=i;}
 });
 return best;
}


// ─────────────────────────────────────────────────────────────────
//  COLLISIONS
// ─────────────────────────────────────────────────────────────────
function handleCollisions(){
 if(STATE!=="idle"&&STATE!=="detection") return;
 for(let i=0;i<blobs.length;i++){
   for(let j=i+1;j<blobs.length;j++){
     const a=blobs[i], b=blobs[j];
     const dx=b.x-a.x, dy=b.y-a.y;
     const d=Math.sqrt(dx*dx+dy*dy), mn=a.r+b.r;
     if(d<mn&&d>0.001){
       const nx=dx/d, ny=dy/d, ov=(mn-d)*0.5;
       a.x-=nx*ov; a.y-=ny*ov; b.x+=nx*ov; b.y+=ny*ov;
       const dv=(b.vx-a.vx)*nx+(b.vy-a.vy)*ny;
       if(dv<0){
         const im=dv*0.85;
         a.vx+=im*nx; a.vy+=im*ny; b.vx-=im*nx; b.vy-=im*ny;
         a.sqxT=random(1.2,1.45); b.sqxT=random(1.2,1.45);
       }
     }
   }
 }
}


// ─────────────────────────────────────────────────────────────────
//  HUD
// ─────────────────────────────────────────────────────────────────
function drawHUD(){
 noStroke(); fill(60,50,40,100); textSize(11);
 textFont("monospace"); textAlign(LEFT,TOP);
 text(STATE+" | face:"+(smoothNose?"✓":"—")+" | "+detectTimer+"/"+DETECT_FRAMES, 12, 12);
}


function windowResized(){
 resizeCanvas(windowWidth,windowHeight);
 buildPaper();
}




// ═════════════════════════════════════════════════════════════════
//  BLOB CLASS   (renamed BlobChar to avoid clash with browser Blob)
// ═════════════════════════════════════════════════════════════════
class BlobChar {
 constructor(idx, charId){
   this.idx    = idx;
   this.charId = charId;
   this.mode   = "idle";


   // Size & position — safe because this is called from draw()
   this.baseR = random(45, 170);
   this.r     = this.baseR;
   this.x     = random(this.baseR+20, width  - this.baseR - 20);
   this.y     = random(this.baseR+20, height - this.baseR - 20);


   const sp = p5.Vector.random2D().mult(2.0);
   this.vx = sp.x; this.vy = sp.y;


   this.sqx = 1;   this.sqxT = 1;
   this.alpha = 255; this.alphaT = 255;
   this.driftX = 0; this.driftY = 0;


   // Expression
   this.comboCurr  = pickCombo(null);
   this.comboNext  = null;
   this.fadeT      = 1;
   this.exprState  = "holding";
   this.holdTimer  = Math.floor(random(40,200));
   this.noteTimer  = 0;
   this.isWhistling= false;


   // Blink
   this.blinkTimer  = Math.floor(random(80,220));
   this.blinkState  = "open";
   this.blinkFrames = 0;


   // Gaze
   this.gx=0; this.gy=0; this.gxT=0; this.gyT=0;
   this.gazeTimer = Math.floor(random(60,140));


   // Pop (selection)
   this.popFrames  = 0;
   this.POP_TOTAL  = 120;
   this.popStartX  = 0; this.popStartY = 0; this.popStartR = 0;


   // Arms (awakening)
   this.handPhase = "none";
   this.handTimer = 0;
   this.arms      = [];
 }


 // ── STATE TRANSITIONS ──────────────────────────────────────
 onIdle(){
   this.mode="idle"; this.alphaT=255; this.sqxT=1;
   const s=p5.Vector.random2D().mult(2.0);
   this.vx=s.x; this.vy=s.y;
   this.handPhase="none"; this.arms=[];
   this.exprState="holding"; this.holdTimer=Math.floor(random(40,180));
 }
 onDetection(){ this.mode="detection"; }
 onSelection(){
   this.mode="chosen"; this.vx=0; this.vy=0;
   this.popStartX=this.x; this.popStartY=this.y; this.popStartR=this.r;
   this.popFrames=0;
 }
 onDismiss(){
   this.mode="dismissed"; this.alphaT=0; this.vx=0; this.vy=0;
   const e=Math.floor(random(4));
   this.driftX=[random(width),random(width),-200,width+200][e];
   this.driftY=[-200,height+200,random(height),random(height)][e];
 }
 onAwakening(){
   this.mode="awakening"; this.handPhase="emerge"; this.handTimer=0;
   const di = CHARS[this.charId] ? CHARS[this.charId].dot : null;
   this.arms = [new Arm(this,di,"left"), new Arm(this,di,"right")];
 }


 // ── UPDATE ─────────────────────────────────────────────────
 update(){
   this._move();
   this._spring();
   if(this.mode!=="dismissed"){
     this._tickExpr();
     this._tickGaze();
   }
   if(this.mode==="detection"||this.mode==="chosen") this._watchNose();
   if(this.mode==="awakening") this._tickHands();
 }


 _move(){
   if(this.mode==="idle"||this.mode==="detection"){
     this.x+=this.vx; this.y+=this.vy;
     this._walls();
     this.r=lerp(this.r,this.baseR,.12);
   } else if(this.mode==="chosen"){
     this.popFrames = Math.min(this.popFrames+1, this.POP_TOTAL);
     const t=this.popFrames/this.POP_TOTAL;
     this.x=lerp(this.popStartX, width/2,  easeInOut(t));
     this.y=lerp(this.popStartY, height/2, easeInOut(t));
     this.r=lerp(this.popStartR, this.baseR*3.5, easeOut3(constrain((t-.1)/.9,0,1)));
   } else if(this.mode==="awakening"){
     this.x=lerp(this.x,width/2, .05);
     this.y=lerp(this.y,height/2,.05);
   } else if(this.mode==="dismissed"){
     this.x=lerp(this.x,this.driftX,.04);
     this.y=lerp(this.y,this.driftY,.04);
     this.r=lerp(this.r,this.baseR,.07);
   }
 }
 _walls(){
   if(this.x-this.r<0)        {this.x=this.r;           this.vx*=-1; this.sqxT=random(1.2,1.4);}
   if(this.x+this.r>width)    {this.x=width-this.r;     this.vx*=-1; this.sqxT=random(1.2,1.4);}
   if(this.y-this.r<0)        {this.y=this.r;            this.vy*=-1; this.sqxT=random(1.2,1.4);}
   if(this.y+this.r>height)   {this.y=height-this.r;    this.vy*=-1; this.sqxT=random(1.2,1.4);}
 }
 _spring(){
   this.sqx=lerp(this.sqx,this.sqxT,.10);
   if(Math.abs(this.sqx-this.sqxT)<0.012 && this.sqxT!==1) this.sqxT=1;
   this.alpha=lerp(this.alpha,this.alphaT,.07);
 }


 // ── EXPRESSION ─────────────────────────────────────────────
 _tickExpr(){
   if(this.exprState==="holding"){
     if(--this.holdTimer<=0){
       this.comboNext  = pickCombo(this.comboCurr);
       this.fadeT      = 0;
       this.exprState  = "fading";
       this.isWhistling= this.comboNext.mouth==="whistle";
       if(this.isWhistling) tryWhistle();
       this.noteTimer=0;
     }
   } else {
     this.fadeT = Math.min(this.fadeT + random(.03,.07), 1.0);
     if(this.fadeT>=1.0){
       this.comboCurr  = this.comboNext;
       this.comboNext  = null;
       this.exprState  = "holding";
       this.holdTimer  = Math.floor(random(100,280));
       this.isWhistling= this.comboCurr.mouth==="whistle";
     }
   }
   if(this.comboCurr && (this.comboCurr.balls || this.comboCurr.eye==="open")){
     this._tickBlink();
   }
   if(this.isWhistling){
     if(--this.noteTimer<=0){
       spawnNote(this.x, this.y-this.r*.85);
       this.noteTimer=Math.floor(random(13,28));
     }
   }
 }
 _tickBlink(){
   if     (this.blinkState==="open")    { if(--this.blinkTimer<=0){this.blinkState="closing";this.blinkFrames=3;} }
   else if(this.blinkState==="closing") { if(--this.blinkFrames<=0){this.blinkState="closed";this.blinkFrames=4;} }
   else if(this.blinkState==="closed")  { if(--this.blinkFrames<=0){this.blinkState="opening";this.blinkFrames=5;} }
   else if(this.blinkState==="opening") { if(--this.blinkFrames<=0){this.blinkState="open";this.blinkTimer=Math.floor(random(80,220));} }
 }
 _tickGaze(){
   if(--this.gazeTimer<=0){
     this.gxT=random(-9,9); this.gyT=random(-6,6);
     this.gazeTimer=Math.floor(random(55,145));
   }
   this.gx=lerp(this.gx,this.gxT,.04);
   this.gy=lerp(this.gy,this.gyT,.04);
 }
 _watchNose(){
   if(!smoothNose) return;
   const ang=atan2(smoothNose.y-this.y, smoothNose.x-this.x);
   const mo=this.r*0.18;
   this.gx=lerp(this.gx,cos(ang)*mo,.18);
   this.gy=lerp(this.gy,sin(ang)*mo,.18);
 }
 _tickHands(){
   this.handTimer++;
   for(const arm of this.arms) arm.update(this.handPhase,this.r,this.x,this.y);
   if     (this.handPhase==="emerge"&&this.handTimer>60) {this.handPhase="form"; this.handTimer=0;}
   else if(this.handPhase==="form"  &&this.handTimer>90) {this.handPhase="alive";this.handTimer=0;}
 }


 // ── DRAW ───────────────────────────────────────────────────
 draw(){
   if(this.alpha<2) return;
   push();
   translate(this.x, this.y);
   this._drawBody();
   pop();
   if(this.mode==="awakening") for(const arm of this.arms) arm.draw();
 }


 _drawBody(){
   const imgs = CHARS[this.charId];
   if(!imgs || !imgs.body) return;
   const sz=this.r*2, sX=this.sqx, sY=1/sX;
   push(); scale(sX,sY); tint(255,this.alpha);
   image(imgs.body,0,0,sz,sz);
   pop();
   this._drawFace(sz,sX,sY);
 }


 _drawFace(sz,sX,sY){
   if(this.mode==="awakening"){ this._drawAwakeFace(sz,sX,sY); return; }
   if(!this.comboCurr) return;
   this._drawCombo(this.comboCurr, this.alpha, sz, sX, sY);
   if(this.exprState==="fading" && this.comboNext && this.fadeT>0.02)
     this._drawCombo(this.comboNext, this.alpha*this.fadeT, sz, sX, sY);
 }


 _drawCombo(combo, fa, sz, sX, sY){
   if(!combo||fa<3) return;
   const ei=eyeImg(combo.eye); if(!ei) return;


   const EW=sz*.88, EH=sz*.36, eyeY=-this.r*.12;
   const BSZ=this.r*.42, BSP=this.r*.28;
   const MW=sz*.56, MH=sz*.23, MY=this.r*.38;


   push(); scale(sX,sY);
   tint(255,fa); image(ei,0,eyeY,EW,EH);


   if(combo.balls && BALL_L && BALL_R){
     let bA=fa;
     if     (this.blinkState==="closing") bA=map(this.blinkFrames,3,0,fa,0);
     else if(this.blinkState==="closed")  bA=0;
     else if(this.blinkState==="opening") bA=map(this.blinkFrames,5,0,0,fa);
     if(bA>2){
       tint(255,bA);
       image(BALL_L,-BSP+this.gx,eyeY+this.gy,BSZ,BSZ);
       image(BALL_R, BSP+this.gx,eyeY+this.gy,BSZ,BSZ);
     }
   }


   if(combo.mouth!=="none"){
     const mi=mouthImg(combo.mouth);
     if(mi){ tint(255,fa); image(mi,0,MY,MW,MH); }
   }
   pop();
 }


 _drawAwakeFace(sz,sX,sY){
   if(!EYE_OPEN||!MOUTH_OPEN||!BALL_L||!BALL_R) return;
   const EW=sz*.88,EH=sz*.36,eyeY=-this.r*.12;
   const BSZ=this.r*.42,BSP=this.r*.28,MW=sz*.56,MH=sz*.23,MY=this.r*.38;
   push(); scale(sX,sY); tint(255,this.alpha);
   image(EYE_OPEN,0,eyeY,EW,EH);
   if(smoothNose){
     const ang=atan2(smoothNose.y-this.y,smoothNose.x-this.x);
     this.gx=lerp(this.gx,cos(ang)*this.r*.08,.12);
     this.gy=lerp(this.gy,sin(ang)*this.r*.08,.12);
   }
   image(BALL_L,-BSP+this.gx,eyeY+this.gy,BSZ,BSZ);
   image(BALL_R, BSP+this.gx,eyeY+this.gy,BSZ,BSZ);
   image(MOUTH_OPEN,0,MY,MW,MH);
   pop();
 }
}




// ═════════════════════════════════════════════════════════════════
//  ARM CLASS  — wiggly snake dot chains
// ═════════════════════════════════════════════════════════════════
class Arm {
 constructor(blob, dotImg, side){
   this.blob   = blob;
   this.dotImg = dotImg;
   this.side   = side;
   this.wigT   = random(100);
   this.wigSpd = random(.02,.04);
   this.wigAmp = 0;
   this.angle  = side==="left" ? PI+random(-.4,.4) : random(-.4,.4);


   const N=Math.floor(random(7,10));
   this.dots=[];
   for(let i=0;i<N;i++){
     this.dots.push({x:blob.x,y:blob.y,alpha:0,ns:random(1000),delay:i*.10});
   }
 }


 update(phase,bodyR,bx,by){
   this.wigT += this.wigSpd;
   const seg=bodyR*.38;


   if(phase==="emerge"){
     this.wigAmp=lerp(this.wigAmp,bodyR*.25,.06);
     const el=frameCount*.012;
     for(let i=0;i<this.dots.length;i++){
       const d=this.dots[i];
       const pct=constrain(el-d.delay,0,1);
       const ang=this.angle+(noise(d.ns+this.wigT,i*.6)-.5)*2.2;
       const dout=easeOut3(pct)*bodyR*(1.1+i*.28);
       d.x=lerp(d.x,bx+cos(ang)*dout,.11);
       d.y=lerp(d.y,by+sin(ang)*dout,.11);
       d.alpha=lerp(d.alpha,220*pct,.09);
     }
   } else if(phase==="form"||phase==="alive"){
     this.wigAmp=lerp(this.wigAmp,bodyR*(phase==="alive"?.40:.30),.035);
     const rw=sin(this.wigT*1.5)*.35+sin(this.wigT*.7)*.15;
     this.dots[0].x=lerp(this.dots[0].x,bx+cos(this.angle+rw)*bodyR*.72,.14);
     this.dots[0].y=lerp(this.dots[0].y,by+sin(this.angle+rw)*bodyR*.72,.14);
     this.dots[0].alpha=lerp(this.dots[0].alpha,230,.10);
     for(let i=1;i<this.dots.length;i++){
       const prev=this.dots[i-1], d=this.dots[i];
       const perp=this.angle+HALF_PI, wa=this.wigAmp*(1+i*.12);
       const w1=(noise(d.ns+this.wigT,i*.55)-.5)*2*wa;
       const w2=(noise(d.ns+this.wigT*1.8+30,i*.3)-.5)*wa*.45;
       d.x=lerp(d.x,prev.x+cos(this.angle)*seg+cos(perp)*(w1+w2),.13);
       d.y=lerp(d.y,prev.y+sin(this.angle)*seg+sin(perp)*(w1+w2),.13);
       d.alpha=lerp(d.alpha,230,.09);
     }
   }
 }


 draw(){
   if(!this.dotImg) return;
   const ds=this.blob.r*.46;
   push(); imageMode(CENTER);
   for(const d of this.dots){
     if(d.alpha<4) continue;
     tint(255,d.alpha);
     image(this.dotImg,d.x,d.y,ds,ds);
   }
   pop();
 }
}

