import { AimSession } from './engine.js';
const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const MODES = {
  flick: { name: 'フリック', target: '固定・ランダム出現', control: '左クリック', instruction: '表示される的を、正確にクリック', tip: '速さより、まずは正確さ。的の中心を意識して、無理のない速度から始めよう。' },
  tracking: { name: 'トラッキング', target: '移動・壁でバウンド', control: '左ボタンを押したまま追う', instruction: '左ボタンを押しながら、的を追い続ける', tip: '力を抜いて、滑らかに。左ボタンを押し続けながら、的の中心をカーソルで追いかけよう。' },
  reflex: { name: '反応速度', target: '時間制限つき・ランダム出現', control: '出現した瞬間にクリック', instruction: '的が現れた瞬間にクリック。待機中は撃たない', tip: '的が見えるまで待つことも、精度の一部。視野を広く保ち、出現した瞬間を捉えよう。' },
};
const DIFF_NAMES = { easy: 'EASY', normal: 'STANDARD', hard: 'HARD' };
const STORAGE_KEY = 'aimforge.sessions.v1';
let history = readHistory(), mode = 'flick', difficulty = 'normal', duration = 30;
let session = null, countdown = null, countdownEnd = 0, particles = [], sound = false, audio = null, toastTimer, shownResult = false;
const arena = $('#arena'), canvas = $('#arena-canvas'), ctx = canvas.getContext('2d');
let width = 800, height = 324;

function readHistory() {
  try {
    const records = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(records) ? records.filter(r => r && validModes().includes(r.mode) && ['easy','normal','hard'].includes(r.difficulty) && [30,60,90].includes(r.duration) && ['score','hits','shots','streak','expired','trackedMs'].every(k=>Number.isFinite(r[k])&&r[k]>=0) && Number.isFinite(r.accuracy) && r.accuracy >= 0 && r.accuracy <= 100 && Number.isFinite(r.date) && Math.abs(r.date)<8640000000000000 && (r.reaction === null || (Number.isFinite(r.reaction)&&r.reaction>=0))).slice(0, 100) : [];
  } catch { return []; }
}
// Kept independent from UI initialization so malformed browser storage cannot stop startup.
function toast(text) { clearTimeout(toastTimer); $('#toast').textContent = text; $('#toast').hidden = false; toastTimer = setTimeout(() => $('#toast').hidden = true, 3800); }
function isBusy() { return countdown !== null || ['running','paused'].includes(session?.state); }
function setSelection() {
  $$('.mode-card').forEach(b => { b.classList.toggle('selected', b.dataset.mode === mode); b.setAttribute('aria-pressed', b.dataset.mode === mode); });
  $$('[data-difficulty]').forEach(b => { b.classList.toggle('selected', b.dataset.difficulty === difficulty); b.setAttribute('aria-pressed', b.dataset.difficulty === difficulty); });
  $$('[data-duration]').forEach(b => { b.classList.toggle('selected', +b.dataset.duration === duration); b.setAttribute('aria-pressed', +b.dataset.duration === duration); });
  $('#summary-mode').textContent = MODES[mode].name; $('#summary-target').textContent = MODES[mode].target; $('#summary-control').textContent = MODES[mode].control;
  $('#difficulty-tag').textContent = ({easy:'FOUNDATION',normal:'BALANCED',hard:'CHALLENGING'})[difficulty];
  $('#mode-instruction').textContent = MODES[mode].instruction; $('#training-tip').textContent = MODES[mode].tip;
  $('#hud-accuracy-label').textContent = mode === 'tracking' ? 'TRACKING RATE' : 'ACCURACY';
  arena.setAttribute('aria-label', `射撃場。${MODES[mode].instruction}`);
  if (!isBusy()) { $('#hud-time').textContent = formatTime(duration); $('#hud-score').textContent = '0000'; $('#hud-accuracy').innerHTML = '—<small>%</small>'; }
}
function disableSettings(disabled) { $$('.mode-card, [data-difficulty], [data-duration]').forEach(b => b.disabled = disabled); }
function formatTime(seconds) { const s = Math.max(0, Math.ceil(seconds)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; }
function start() {
  if (isBusy()) return;
  $('#result-dialog').close();
  if (sound) ensureAudio();
  shownResult = false; session = null; particles = []; countdownEnd = performance.now() + 3000;
  countdown = 3; disableSettings(true); $('#idle-art').hidden = true; $('#idle-caption').hidden = true;
  $('#game-overlay').hidden = false; $('#overlay-content').innerHTML = '<div class="countdown-number">3</div><div class="overlay-label">FOCUS. BREATHE. AIM.</div>';
  $('#start-button').disabled = true; $('#start-button span').textContent = '準備中…'; $('#range-status').textContent = '準備中';
  $('#hud-score').textContent = '0000'; $('#hud-accuracy').innerHTML = '—<small>%</small>'; $('#hud-time').textContent = formatTime(duration);
  arena.focus({preventScroll:true});
}
function begin(now) {
  countdown = null; session = new AimSession({mode,difficulty,duration,width,height}); session.start(now);
  $('#game-overlay').hidden = true; $('#range-status').textContent = 'セッション進行中'; $('#pause-button').hidden = false; $('#pause-button').textContent = '一時停止';
  arena.classList.add('playing'); $('#start-button').disabled = false; $('#start-button span').textContent = 'セッションを中断'; beep(700, .08);
}
function reset() {
  countdown = null; if (session) { session.state = 'aborted'; session.pointer.held = false; } session = null; particles = [];
  $('#game-overlay').hidden = true; $('#idle-art').hidden = false; $('#idle-caption').hidden = false; $('#pause-button').hidden = true;
  $('#range-status').textContent = '射撃場'; arena.classList.remove('playing'); $('#start-button').disabled = false; $('#start-button span').textContent = 'トレーニング開始';
  disableSettings(false); setSelection();
}
function pause() {
  if (session?.state !== 'running') return;
  session.pause(performance.now()); if (session.state === 'finished') return;
  $('#game-overlay').hidden = false; $('#overlay-content').innerHTML = '<h3 class="overlay-title">ひと呼吸、おこう。</h3><p class="overlay-description">準備ができたら、続きから。</p><div class="overlay-buttons"><button id="resume-button">再開する</button><button id="abort-button">中断する</button></div>';
  $('#resume-button').onclick = resume; $('#abort-button').onclick = () => { reset(); toast('セッションを中断しました。記録は保存されません。'); };
  $('#range-status').textContent = '一時停止中'; $('#pause-button').textContent = '再開';
}
function resume() { if (session?.state !== 'paused') return; session.resume(performance.now()); $('#game-overlay').hidden = true; $('#range-status').textContent = 'セッション進行中'; $('#pause-button').textContent = '一時停止'; arena.focus({preventScroll:true}); }
function finish() {
  if (shownResult) return;
  shownResult = true;
  const r = {...session.result(), date: Date.now()};
  const comparable = history.filter(h => h.mode === r.mode && h.difficulty === r.difficulty && h.duration === r.duration);
  const best = r.score > 0 && (!comparable.length || r.score > Math.max(...comparable.map(h => h.score)));
  history.unshift(r); history = history.slice(0,100);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(history)); } catch { toast('ブラウザの保存領域が使えないため、この結果は今回の画面内に保持します。'); }
  $('#result-subtitle').textContent = `${MODES[r.mode].name} / ${DIFF_NAMES[r.difficulty]} / ${r.duration}秒`;
  $('#result-score').textContent = r.score.toLocaleString('ja-JP'); $('#new-best').hidden = !best;
  const metric = (value,unit,label) => `<div><strong>${value}<small>${unit}</small></strong><span>${label}</span></div>`;
  $('#result-metrics').innerHTML = metric(r.accuracy.toFixed(1),'%',r.mode==='tracking'?'追従率':'命中率') + (r.mode==='tracking' ? metric((r.trackedMs/1000).toFixed(1),'秒','追従時間') + metric(r.duration,'秒','練習時間') : metric(r.reaction ?? '—','ms','平均反応') + metric(r.hits,'HITS','命中数'));
  $('#result-note').textContent = r.mode==='tracking' ? '左ボタンを押して的を追えた時間が、そのまま成果に。' : `最大連続命中 ${r.streak}回 · ミス ${r.shots-r.hits}回${r.mode==='reflex'?` · 見逃し ${r.expired}回`:''}`;
  updateHistory(); reset(); $('#result-dialog').showModal(); beep(880,.15);
}
function ensureAudio() { try { if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)(); if (audio.state === 'suspended') audio.resume().catch(()=>{}); } catch { sound = false; updateSound(); toast('このブラウザでは効果音を使えません。'); } }
function beep(freq, seconds) { if (!sound || !audio) return; try { const o=audio.createOscillator(),g=audio.createGain(); o.connect(g);g.connect(audio.destination);o.type='sine';o.frequency.value=freq;g.gain.setValueAtTime(.045,audio.currentTime);g.gain.exponentialRampToValueAtTime(.001,audio.currentTime+seconds);o.start();o.stop(audio.currentTime+seconds); } catch {} }
function updateSound() { $('#sound-button use').setAttribute('href',sound?'#sound':'#mute'); $('#sound-button').setAttribute('aria-pressed', sound); $('#sound-button').setAttribute('aria-label',sound?'効果音をオフにする':'効果音をオンにする'); }
function feedback(event) {
  if (!event) return;
  const hit = event.type === 'hit', el = $('#feedback');
  if (hit) { for(let i=0;i<10;i++) { const a=Math.random()*Math.PI*2; particles.push({x:event.x,y:event.y,vx:Math.cos(a)*(30+Math.random()*70),vy:Math.sin(a)*(30+Math.random()*70),life:1}); } beep(950,.045); }
  else { beep(160,.06); arena.classList.add('miss-flash'); setTimeout(()=>arena.classList.remove('miss-flash'),100); }
  el.className = `feedback ${hit?'':'miss'}`; el.textContent = hit?`+${event.points}`:event.type==='expired'?'MISSED':'MISS';
  void el.offsetWidth; el.classList.add('pop');
}
function resize() {
  const rect=arena.getBoundingClientRect(); if (!rect.width || !rect.height) return;
  width=rect.width;height=rect.height;const ratio=Math.min(window.devicePixelRatio||1,2);
  canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);ctx.setTransform(ratio,0,0,ratio,0,0);
  if(session) session.resize(width,height);
}
function draw(now,delta) {
  ctx.clearRect(0,0,width,height);
  if (session?.target && ['running','paused'].includes(session.state)) {
    const t=session.target,held=session.mode==='tracking'&&session.pointer.held&&Math.hypot(session.pointer.x-t.x,session.pointer.y-t.y)<=t.radius;
    ctx.save(); ctx.translate(t.x,t.y); ctx.shadowBlur=held?30:18;ctx.shadowColor='#c4f665';
    ctx.beginPath();ctx.arc(0,0,t.radius,0,Math.PI*2);ctx.fillStyle=held?'#dcff9f':'#bcec63';ctx.fill();ctx.shadowBlur=0;
    ctx.beginPath();ctx.arc(0,0,t.radius*.66,0,Math.PI*2);ctx.strokeStyle='#17290b';ctx.lineWidth=2;ctx.stroke();
    ctx.beginPath();ctx.arc(0,0,t.radius*.25,0,Math.PI*2);ctx.fillStyle='#203610';ctx.fill();
    if (session.mode==='reflex') {ctx.beginPath();ctx.arc(0,0,t.radius+7,-Math.PI/2,-Math.PI/2+Math.PI*2*(1-(session.elapsed-t.born)/session.config.lifetime));ctx.strokeStyle='#c4f66580';ctx.lineWidth=2;ctx.stroke();}
    ctx.restore();
  } else if(session?.mode==='reflex'&&session.state==='running') {ctx.font='10px Consolas, monospace';ctx.fillStyle='#71895c';ctx.textAlign='center';ctx.fillText('WAIT FOR THE TARGET',width/2,height/2);}
  for (const p of particles) {p.life-=delta/420;p.x+=p.vx*delta/1000;p.y+=p.vy*delta/1000;ctx.globalAlpha=Math.max(0,p.life);ctx.fillStyle='#d3ff80';ctx.fillRect(p.x,p.y,2,2);}ctx.globalAlpha=1;particles=particles.filter(p=>p.life>0);
}
let previousFrame=performance.now();
function frame(now) {
  const delta=Math.min(50,now-previousFrame);previousFrame=now;
  if (countdown !== null) {
    const remaining=Math.ceil((countdownEnd-now)/1000);
    if (remaining<=0) begin(now);
    else if (remaining!==countdown) {countdown=remaining;$('.countdown-number').textContent=remaining;beep(450,.055);}
  }
  if (session?.state==='running') {
    session.step(now);session.events.splice(0).forEach(feedback);
    $('#hud-time').textContent=formatTime((session.duration*1000-session.elapsed)/1000);
    $('#hud-score').textContent=String(session.score).padStart(4,'0');
    $('#hud-accuracy').innerHTML=`${session.accuracy.toFixed(0)}<small>%</small>`;
  }
  if(session?.state==='finished') finish();
  draw(now,delta);requestAnimationFrame(frame);
}
function updateHistory() {
  const today=new Date().toLocaleDateString('ja-JP');$('#today-count').textContent=history.filter(r=>new Date(r.date).toLocaleDateString('ja-JP')===today).length;
  const best=history.filter(r=>r.mode==='flick'&&r.difficulty==='normal'&&r.duration===30);
  $('#best-score').textContent=best.length?Math.max(...best.map(r=>r.score)).toLocaleString('ja-JP'):'—';
  const clicks=history.filter(r=>r.mode!=='tracking'&&r.shots>0);$('#best-accuracy').textContent=clicks.length?Math.max(...clicks.map(r=>r.accuracy)).toFixed(0):'—';
  const reactions=history.filter(r=>r.mode==='reflex'&&r.reaction!==null);$('#best-reaction').textContent=reactions.length?Math.min(...reactions.map(r=>r.reaction)):'—';
  $('#history-count').textContent=history.length;$('#recent-history').innerHTML=table(history.slice(0,3));$('#all-history').innerHTML=table(history);
  $('#performance-summary').innerHTML=`<div><span>完了したセッション</span><strong>${history.length}</strong><small>回</small></div><div><span>累計トレーニング時間</span><strong>${(history.reduce((s,r)=>s+r.duration,0)/60).toFixed(1)}</strong><small>分</small></div><div><span>累計獲得ポイント</span><strong>${history.reduce((s,r)=>s+r.score,0).toLocaleString('ja-JP')}</strong><small>PTS</small></div>`;
  const recent=history.slice(0,10).reverse();$('#chart-bars').innerHTML=recent.length?recent.map((r,i)=>`<div class="chart-item" title="${MODES[r.mode].name} ${r.accuracy}%"><span>${r.accuracy}%</span><div style="height:${r.accuracy*.72}%"></div><small>${new Date(r.date).toLocaleDateString('ja-JP',{month:'numeric',day:'numeric'})} · ${i+1}</small></div>`).join(''):'<div class="history-empty"><span>セッションを完了すると、ここに成長の記録が表示されます。</span></div>';
  $('#export-button').disabled=!history.length;
}
function table(records) {
  if(!records.length)return '<div class="history-empty"><svg><use href="#chart"/></svg><div><strong>あなたの最初の記録を、ここに。</strong><span>トレーニングを完了すると、結果が自動で保存されます。</span></div></div>';
  return '<table><thead><tr><th>日時</th><th>モード / 難易度</th><th>時間</th><th>スコア</th><th>命中・追従率</th><th>平均反応</th></tr></thead><tbody>'+records.map(r=>`<tr><td>${new Date(r.date).toLocaleString('ja-JP',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})}</td><td><span class="mode-badge ${r.mode}"></span>${MODES[r.mode].name} <span style="font-size:7px;color:#738663">/ ${DIFF_NAMES[r.difficulty]}</span></td><td>${r.duration}秒</td><td class="score-cell">${r.score.toLocaleString('ja-JP')}</td><td>${r.accuracy.toFixed(1)}%</td><td>${r.reaction===null?'—':r.reaction+' ms'}</td></tr>`).join('')+'</tbody></table>';
}
function showView(view) {
  if(!['training','performance','guide'].includes(view))view='training';
  if(session?.state==='running')pause();
  if(countdown!==null)reset();
  $$('.view').forEach(v=>v.hidden=v.id!==`${view}-view`);$$('[data-view]').forEach(b=>{b.classList.toggle('active',b.dataset.view===view);if(b.dataset.view===view)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
  $('#breadcrumb').textContent=({training:'トレーニング',performance:'パフォーマンス',guide:'トレーニングガイド'})[view];
  if(location.hash!==`#${view}`)window.history.replaceState(null,'',`#${view}`);
  if(view==='training')resize();window.scrollTo({top:0,behavior:'instant'});
}
$$('.mode-card').forEach(b=>b.onclick=()=>{mode=b.dataset.mode;setSelection();});
$$('[data-difficulty]').forEach(b=>b.onclick=()=>{difficulty=b.dataset.difficulty;setSelection();});
$$('[data-duration]').forEach(b=>b.onclick=()=>{duration=+b.dataset.duration;setSelection();});
$$('[data-view]').forEach(b=>b.onclick=()=>showView(b.dataset.view));
$$('[data-open-performance]').forEach(b=>b.onclick=()=>showView('performance'));
$$('[data-open-training]').forEach(b=>b.onclick=()=>showView('training'));
$('.brand').onclick=e=>{e.preventDefault();showView('training');};
$('#start-button').onclick=()=>{if(isBusy()){reset();toast('セッションを中断しました。記録は保存されません。');}else start();};
$('#pause-button').onclick=()=>session?.state==='paused'?resume():pause();
$('#sound-button').onclick=()=>{sound=!sound;if(sound)ensureAudio();updateSound();if(sound)beep(650,.08);};
$('#fullscreen-button').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if($('#range-panel').requestFullscreen)await $('#range-panel').requestFullscreen();else toast('このブラウザでは全画面表示を使えません。');}catch{toast('全画面表示を開始できませんでした。');}};
['result-close','result-back'].forEach(id=>$('#'+id).onclick=()=>$('#result-dialog').close());
$('#retry-button').onclick=start;
arena.addEventListener('pointermove',e=>{if(session){const r=arena.getBoundingClientRect();session.pointer.x=e.clientX-r.left;session.pointer.y=e.clientY-r.top;}});
arena.addEventListener('pointerdown',e=>{if(e.button!==0||session?.state!=='running')return;e.preventDefault();const r=arena.getBoundingClientRect(),x=e.clientX-r.left,y=e.clientY-r.top;session.pointer={x,y,held:true};arena.setPointerCapture(e.pointerId);feedback(session.shoot(x,y,performance.now()));});
window.addEventListener('pointerup',()=>{if(session)session.pointer.held=false;});
arena.addEventListener('pointercancel',()=>{if(session)session.pointer.held=false;});
arena.addEventListener('contextmenu',e=>{if(isBusy())e.preventDefault();});
window.addEventListener('keydown',e=>{if(e.code==='Space'&&!e.repeat&&!$('#result-dialog').open&&!$('#training-view').hidden&&!['BUTTON','INPUT','SELECT','TEXTAREA','A'].includes(document.activeElement?.tagName)){e.preventDefault();if(countdown!==null)return;if(session?.state==='running')pause();else if(session?.state==='paused')resume();else start();}if(e.key==='Escape'&&isBusy()&&!$('#result-dialog').open){reset();toast('セッションを中断しました。');}});
document.addEventListener('visibilitychange',()=>{if(document.hidden){if(countdown!==null)reset();else pause();}});
window.addEventListener('blur',()=>{if(countdown!==null)reset();else pause();});
document.addEventListener('fullscreenchange',()=>{resize();$('#fullscreen-button').setAttribute('aria-label',document.fullscreenElement?'全画面表示を終了':'射撃場を全画面表示');});
window.addEventListener('hashchange',()=>showView(location.hash.slice(1)));
window.addEventListener('storage',e=>{if(e.key===STORAGE_KEY){history=readHistory();updateHistory();}});
$('#export-button').onclick=()=>{const header='date,mode,difficulty,duration_seconds,score,accuracy_percent,average_reaction_ms,hits,shots,best_streak,expired,tracked_ms';const rows=history.map(r=>[new Date(r.date).toISOString(),r.mode,r.difficulty,r.duration,r.score,r.accuracy,r.reaction??'',r.hits,r.shots,r.streak,r.expired,r.trackedMs].join(','));const blob=new Blob(['\ufeff'+[header,...rows].join('\r\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`aimforge-${new Date().toLocaleDateString('sv-SE')}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
new ResizeObserver(resize).observe(arena);
setSelection();updateHistory();showView(location.hash.slice(1));resize();requestAnimationFrame(frame);

// Hoisted function avoids depending on UI configuration when reading storage.
function validModes() {return ['flick','tracking','reflex'];}
