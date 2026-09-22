const PIECES = {
  wp:'♙', wr:'♖', wn:'♘', wb:'♗', wq:'♕', wk:'♔',
  bp:'♟', br:'♜', bn:'♞', bb:'♝', bq:'♛', bk:'♚'
};
const VALUES = {p:1,n:3,b:3,r:5,q:9,k:0};
const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

let game = new Chess(START_FEN);
let mode = 'computer';
let difficulty = 'medium';
let flipped = false;
let soundOn = true;
let gameOver = false;
let selected = null;
let timers = { w: 600, b: 600 };
let timerHandle = null;
let lastTick = null;
let moveStack = [];

const boardEl = document.getElementById('board');
const moveHistoryEl = document.getElementById('moveHistory');
const whiteClockEl = document.getElementById('whiteClock');
const blackClockEl = document.getElementById('blackClock');
const toastEl = document.getElementById('toast');
const resultModal = document.getElementById('resultModal');
const resultTitle = document.getElementById('resultTitle');
const resultText = document.getElementById('resultText');
const resultIcon = document.getElementById('resultIcon');
const materialScore = document.getElementById('materialScore');

function squareName(file, rank) { return String.fromCharCode(97+file) + (8-rank); }
function pieceKey(p) { return p.color + p.type; }
function pieceGlyph(p) { return PIECES[pieceKey(p)] || ''; }

function renderBoard() {
  boardEl.innerHTML = '';
  const files = flipped ? [...Array(8).keys()].reverse() : [...Array(8).keys()];
  const ranks = flipped ? [...Array(8).keys()] : [...Array(8).keys()].reverse();
  const history = game.history({ verbose: true });
  const last = history[history.length - 1];
  const legalTargets = selected ? game.moves({ square:selected, verbose:true }).map(m => m.to) : [];

  ranks.forEach((rank) => files.forEach((file) => {
    const sq = squareName(file, rank);
    const p = game.get(sq);
    const div = document.createElement('div');
    div.className = `square ${(file+rank)%2===0?'light':'dark'}`;
    div.dataset.square = sq;
    if (selected === sq) div.classList.add('selected');
    if (last && (last.from===sq || last.to===sq)) div.classList.add('last');
    if (p && p.type==='k' && p.color===game.turn() && game.in_check()) div.classList.add('check');

    if (file === (flipped?7:0)) {
      const c = document.createElement('span'); c.className='coord rank'; c.textContent=String(8-rank); div.appendChild(c);
    }
    if (rank === (flipped?7:0)) {
      const c = document.createElement('span'); c.className='coord file'; c.textContent=String.fromCharCode(97+file); div.appendChild(c);
    }

    if (legalTargets.includes(sq)) {
      const targetPiece = game.get(sq);
      const marker = document.createElement('span');
      marker.className = targetPiece ? 'capture-ring' : 'move-dot';
      div.appendChild(marker);
    }
    if (p) {
      const piece = document.createElement('span');
      piece.className = `piece ${p.color === 'w' ? 'white':'black'}`;
      piece.textContent = pieceGlyph(p);
      div.appendChild(piece);
    }
    div.addEventListener('click', () => onSquareClick(sq));
    boardEl.appendChild(div);
  }));
}

function onSquareClick(sq) {
  if (gameOver || (mode==='computer' && game.turn()==='b')) return;
  const p = game.get(sq);
  if (!selected) {
    if (p && p.color===game.turn()) { selected = sq; renderBoard(); }
    return;
  }
  if (p && p.color===game.turn()) { selected = sq; renderBoard(); return; }
  const moves = game.moves({square:selected, verbose:true}).filter(m => m.to===sq);
  if (!moves.length) { selected = null; renderBoard(); return; }
  const needsPromotion = moves.some(m => m.promotion);
  const promotion = needsPromotion ? choosePromotion() : undefined;
  playMove({from:selected, to:sq, ...(promotion?{promotion}:{})});
}

function choosePromotion() {
  const value = prompt('Promote to: Q (Queen), R (Rook), B (Bishop), or N (Knight)', 'Q');
  const p = (value || 'Q').toLowerCase();
  return ['q','r','b','n'].includes(p) ? p : 'q';
}

function playMove(move) {
  const result = game.move(move);
  if (!result) return;
  moveStack.push(result);
  selected = null;
  playSound(result.captured ? 'capture' : 'move');
  renderBoard(); renderHistory(); renderCaptured(); updateStatus();
  checkGameState();
  if (!gameOver && mode==='computer' && game.turn()==='b') setTimeout(computerMove, 280);
}

function computerMove() {
  if (gameOver || mode!=='computer' || game.turn()!=='b') return;
  const moves = game.moves({verbose:true});
  if (!moves.length) return;
  const depth = difficulty==='easy' ? 1 : difficulty==='medium' ? 2 : 3;
  let bestMove = moves[0], bestScore = Infinity;
  for (const m of moves) {
    game.move(m);
    const score = minimax(depth-1, -Infinity, Infinity, true);
    game.undo();
    const jitter = difficulty==='easy' ? Math.random()*1.2 : difficulty==='medium' ? Math.random()*.25 : 0;
    const adjusted = score + jitter;
    if (adjusted < bestScore) { bestScore=adjusted; bestMove=m; }
  }
  game.move(bestMove);
  moveStack.push(bestMove);
  playSound(bestMove.captured ? 'capture' : 'move');
  renderBoard(); renderHistory(); renderCaptured(); updateStatus(); checkGameState();
}

function minimax(depth, alpha, beta, maximizing) {
  if (depth===0 || game.game_over()) return evaluateBoard();
  const moves=game.moves({verbose:true});
  if (maximizing) {
    let max=-Infinity;
    for (const m of moves) { game.move(m); max=Math.max(max,minimax(depth-1,alpha,beta,false)); game.undo(); alpha=Math.max(alpha,max); if(beta<=alpha) break; }
    return max;
  }
  let min=Infinity;
  for (const m of moves) { game.move(m); min=Math.min(min,minimax(depth-1,alpha,beta,true)); game.undo(); beta=Math.min(beta,min); if(beta<=alpha) break; }
  return min;
}

function evaluateBoard() {
  let score=0;
  for (const file of 'abcdefgh') for (let rank=1; rank<=8; rank++) {
    const p=game.get(file+rank); if (!p) continue;
    let v=VALUES[p.type];
    const center = ['d4','e4','d5','e5'].includes(file+rank) ? .18 : 0;
    v += center;
    score += p.color==='w' ? v : -v;
  }
  if (game.in_check()) score += game.turn()==='w' ? -0.35 : 0.35;
  return score;
}

function renderHistory() {
  const hist=game.history({verbose:true});
  if (!hist.length) { moveHistoryEl.className='moves empty'; moveHistoryEl.textContent='No moves yet'; return; }
  moveHistoryEl.className='moves';
  moveHistoryEl.innerHTML='';
  for (let i=0;i<hist.length;i+=2) {
    const row=document.createElement('div'); row.className='move-pair';
    const n=document.createElement('span'); n.className='move-number'; n.textContent=`${i/2+1}.`;
    const w=document.createElement('span'); w.textContent=formatSAN(hist[i]);
    const b=document.createElement('span'); b.textContent=hist[i+1]?formatSAN(hist[i+1]):'';
    row.append(n,w,b); moveHistoryEl.appendChild(row);
  }
  moveHistoryEl.scrollTop=moveHistoryEl.scrollHeight;
}
function formatSAN(m) { return m.san || `${m.from}-${m.to}`; }

function renderCaptured() {
  const hist=game.history({verbose:true});
  const takenByWhite=[]; const takenByBlack=[];
  hist.forEach(m => { if (!m.captured) return; (m.color==='w'?takenByWhite:takenByBlack).push(PIECES[(m.color==='w'?'b':'w')+m.captured]); });
  document.getElementById('whiteCaptured').innerHTML=takenByWhite.map(x=>`<span class="captured-piece black">${x}</span>`).join('');
  document.getElementById('blackCaptured').innerHTML=takenByBlack.map(x=>`<span class="captured-piece white">${x}</span>`).join('');
  let white=0,black=0; hist.forEach(m=>{if(m.captured){ if(m.color==='w') white += VALUES[m.captured]; else black += VALUES[m.captured]; }});
  const diff=white-black; materialScore.textContent=`${diff>0?'+':''}${diff.toFixed(1)}`;
}

function updateStatus() {
  const turn=game.turn();
  const top=document.getElementById('topStatus'); const bottom=document.getElementById('bottomStatus');
  if (mode==='local') { top.textContent='Player 2 · Black'; bottom.textContent=turn==='w'?'Your turn · White':'Player 2 · Black — thinking'; }
  else { top.textContent='Computer · Black'; bottom.textContent=turn==='w'?'Your turn · White':'Computer is thinking'; }
  document.querySelector('.top-player .clock').classList.toggle('active', turn==='b');
  document.querySelector('.bottom-player .clock').classList.toggle('active', turn==='w');
}

function checkGameState() {
  if (game.in_checkmate()) endGame(game.turn()==='w' ? 'Black wins' : 'White wins', 'Checkmate — the king has no legal escape.', game.turn()==='w' ? '♚':'♔');
  else if (game.in_stalemate()) endGame('Draw', 'Stalemate — no legal move remains.', '½');
  else if (game.in_threefold_repetition()) endGame('Draw', 'Threefold repetition.', '½');
  else if (game.insufficient_material()) endGame('Draw', 'Insufficient material.', '½');
  else if (game.in_check()) showToast('CHECK');
}

function endGame(title,text,icon) {
  gameOver=true; stopTimer(); playSound('end');
  resultTitle.textContent=title; resultText.textContent=text; resultIcon.textContent=icon; resultModal.showModal();
}

function newGame() {
  game=new Chess(START_FEN); moveStack=[]; selected=null; gameOver=false;
  const mins=Number(document.getElementById('timeControl').value); timers={w:mins*60,b:mins*60}; lastTick=null;
  renderAll(); startTimer();
  resultModal.close();
  showToast('NEW GAME');
}
function renderAll(){ renderBoard(); renderHistory(); renderCaptured(); updateStatus(); updateClocks(); }

function startTimer(){ stopTimer(); lastTick=performance.now(); timerHandle=setInterval(()=>{
  const now=performance.now(); const dt=(now-lastTick)/1000; lastTick=now;
  if (gameOver) return;
  timers[game.turn()]-=dt;
  if(timers[game.turn()]<=0){timers[game.turn()]=0;updateClocks();endGame(game.turn()==='w'?'Black wins on time':'White wins on time','The clock reached zero.','⏱');return;}
  updateClocks();
},100); }
function stopTimer(){ if(timerHandle){clearInterval(timerHandle);timerHandle=null;} }
function updateClocks(){
  const fmt=s=>{s=Math.max(0,s);return `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`};
  whiteClockEl.textContent=fmt(timers.w); blackClockEl.textContent=fmt(timers.b);
  whiteClockEl.classList.toggle('low',timers.w<30); blackClockEl.classList.toggle('low',timers.b<30);
}

function undoMove(){
  if(!moveStack.length || gameOver) return;
  if(mode==='computer' && game.turn()==='w' && moveStack.length>=2){ game.undo(); game.undo(); moveStack.splice(-2); }
  else { game.undo(); moveStack.pop(); }
  selected=null; renderAll(); showToast('MOVE UNDONE');
}
function resign(){ if(gameOver) return; endGame(mode==='computer'?'Computer wins':'Game resigned', 'You resigned this game.', '⚑'); }

function setMode(next){ mode=next; document.querySelectorAll('.seg').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode)); document.getElementById('modePill').textContent=mode==='computer'?'VS COMPUTER':'2 PLAYERS'; newGame(); }
function flipBoard(){ flipped=!flipped; renderBoard(); }
function chooseDifficulty(){difficulty=document.getElementById('difficulty').value; showToast(`${difficulty.toUpperCase()} MODE`);}
function changeTime(){newGame();}

function playSound(kind){
  if(!soundOn) return;
  try{
    const C=window.AudioContext||window.webkitAudioContext; if(!C) return;
    const ctx=new C(); const o=ctx.createOscillator(); const g=ctx.createGain(); o.connect(g);g.connect(ctx.destination);
    const freq={move:430,capture:290,end:180}[kind]||430; o.frequency.value=freq; o.type='sine'; g.gain.setValueAtTime(.0001,ctx.currentTime); g.gain.exponentialRampToValueAtTime(.06,ctx.currentTime+.01); g.gain.exponentialRampToValueAtTime(.0001,ctx.currentTime+.11); o.start();o.stop(ctx.currentTime+.12);
  }catch(e){}
}
function showToast(text){toastEl.textContent=text;toastEl.classList.add('show');clearTimeout(showToast.t);showToast.t=setTimeout(()=>toastEl.classList.remove('show'),1200);}

// Controls
window.addEventListener('resize',renderBoard);
document.getElementById('newGameBtn').onclick=newGame;
document.getElementById('modalNewGame').onclick=newGame;
document.getElementById('undoBtn').onclick=undoMove;
document.getElementById('flipBtn').onclick=flipBoard;
document.getElementById('resignBtn').onclick=resign;
document.getElementById('clearHistory').onclick=()=>showToast('HISTORY CANNOT BE CLEARED MID-GAME');
document.getElementById('soundBtn').onclick=()=>{soundOn=!soundOn;document.getElementById('soundBtn').textContent=soundOn?'⌕':'×';showToast(soundOn?'SOUND ON':'SOUND OFF');};
document.getElementById('themeBtn').onclick=()=>{document.body.classList.toggle('light');showToast(document.body.classList.contains('light')?'LIGHT MODE':'NOIR MODE');};
document.querySelectorAll('.seg').forEach(b=>b.onclick=()=>setMode(b.dataset.mode));
document.getElementById('difficulty').onchange=chooseDifficulty;
document.getElementById('timeControl').onchange=changeTime;

document.addEventListener('keydown',e=>{ if(e.key==='Escape'){selected=null;renderBoard();} if(e.key.toLowerCase()==='n')newGame(); if(e.key.toLowerCase()==='f')flipBoard(); });

renderAll(); startTimer();
