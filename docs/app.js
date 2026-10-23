import { AimSession } from './engine.js';

const $ = selector => document.querySelector(selector);
const MODES = {
  flick: { name: 'フリック', instruction: '表示される的をクリック。' },
  tracking: { name: 'トラッキング', instruction: '左ボタンを押したまま、動く的を追う。' },
  reflex: { name: '反応速度', instruction: '的が現れたらクリック。待機中のクリックはミスになります。' },
};
const DIFFICULTIES = { easy: 'かんたん', normal: 'ふつう', hard: 'むずかしい' };
const STORAGE_KEY = 'aimforge.sessions.v1';
const arena = $('#arena'), canvas = $('#arena-canvas'), ctx = canvas.getContext('2d');
let records = readRecords(), session = null, countdownEnd = null;
let width = 800, height = 400, toastTimer, audio = null;

function readRecords() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(data)) return [];
    return data.filter(r => r && Object.hasOwn(MODES, r.mode) && Object.hasOwn(DIFFICULTIES, r.difficulty)
      && [30,60,90].includes(r.duration)
      && ['score','hits','shots','streak','expired','trackedMs'].every(k => Number.isFinite(r[k]) && r[k] >= 0)
      && Number.isFinite(r.accuracy) && r.accuracy >= 0 && r.accuracy <= 100
      && Number.isFinite(r.date) && Math.abs(r.date) < 8640000000000000
      && (r.reaction === null || (Number.isFinite(r.reaction) && r.reaction >= 0))).slice(0,100);
  } catch { return []; }
}
function settings() {
  return { mode: $('#mode-select').value, difficulty: $('#difficulty-select').value, duration: +$('#duration-select').value };
}
function busy() { return countdownEnd !== null || ['running','paused'].includes(session?.state); }
function formatTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2,'0');
}
function toast(message) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => $('#toast').hidden = true, 3500);
}
function setControls(disabled) {
  document.querySelectorAll('.controls select').forEach(el => el.disabled = disabled);
}
function updateSettings() {
  const {mode,duration} = settings();
  $('#hud-accuracy-label').textContent = mode === 'tracking' ? '追従率' : '命中率';
  arena.setAttribute('aria-label', MODES[mode].instruction);
  if (!busy()) {
    $('#hud-time').textContent = formatTime(duration);
    $('#hud-score').textContent = '0';
    $('#hud-accuracy').textContent = '—';
  }
}
function start() {
  if (busy()) return;
  $('#result-dialog').close();
  $('#history-dialog').close();
  if ($('#sound-toggle').checked) ensureAudio();
  session = null;
  countdownEnd = performance.now() + 3000;
  setControls(true);
  $('#start-target').hidden = true;
  $('#hud').hidden = false;
  $('#game-overlay').hidden = false;
  $('#overlay-content').innerHTML = '<div class="countdown-number">3</div>';
  $('#start-button').textContent = '中断';
  updateHud();
  arena.focus({preventScroll:true});
}
function begin(now) {
  countdownEnd = null;
  session = new AimSession({...settings(), width, height});
  session.start(now);
  $('#game-overlay').hidden = true;
  $('#pause-button').textContent = '一時停止';
  $('#pause-button').hidden = false;
  beep(650, .07);
}
function reset() {
  countdownEnd = null;
  if (session) { session.pointer.held = false; session.state = 'aborted'; }
  session = null;
  $('#game-overlay').hidden = true;
  $('#start-target').hidden = false;
  $('#hud').hidden = true;
  $('#pause-button').hidden = true;
  $('#start-button').textContent = '開始';
  setControls(false);
  updateSettings();
}
function pause() {
  if (session?.state !== 'running') return;
  session.pause(performance.now());
  if (session.state === 'finished') return;
  $('#game-overlay').hidden = false;
  $('#overlay-content').innerHTML = '<div class="overlay-buttons"><button class="primary-button" id="resume-button">再開</button><button class="secondary-button" id="abort-button">中断</button></div>';
  $('#resume-button').onclick = resume;
  $('#abort-button').onclick = reset;
  $('#pause-button').textContent = '再開';
}
function resume() {
  if (session?.state !== 'paused') return;
  session.resume(performance.now());
  $('#game-overlay').hidden = true;
  $('#pause-button').textContent = '一時停止';
  arena.focus({preventScroll:true});
}
function updateHud() {
  const duration = settings().duration;
  $('#hud-time').textContent = formatTime(session ? (session.duration * 1000 - session.elapsed) / 1000 : duration);
  $('#hud-score').textContent = session ? session.score.toLocaleString('ja-JP') : '0';
  $('#hud-accuracy').textContent = session ? session.accuracy.toFixed(0) + '%' : '—';
}
function finish() {
  const result = session.result();
  if (!result) return;
  const r = {...result, date: Date.now()};
  const sameSettings = records.filter(h => h.mode === r.mode && h.difficulty === r.difficulty && h.duration === r.duration);
  const best = r.score > 0 && (!sameSettings.length || r.score > Math.max(...sameSettings.map(h => h.score)));
  records.unshift(r); records = records.slice(0,100);
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(records)); }
  catch { toast('記録をブラウザに保存できませんでした。'); }
  $('#result-subtitle').textContent = MODES[r.mode].name + ' / ' + DIFFICULTIES[r.difficulty] + ' / ' + r.duration + '秒';
  $('#result-score').textContent = r.score.toLocaleString('ja-JP');
  $('#new-best').hidden = !best;
  const metric = (label,value) => '<div><dt>' + label + '</dt><dd>' + value + '</dd></div>';
  $('#result-metrics').innerHTML = metric(r.mode === 'tracking' ? '追従率' : '命中率', r.accuracy.toFixed(1) + '%')
    + (r.mode === 'tracking'
      ? metric('追従時間',(r.trackedMs/1000).toFixed(1) + '秒')
      : metric('平均反応',r.reaction === null ? '—' : r.reaction + ' ms') + metric('命中数',r.hits + '回'));
  renderRecords();
  reset();
  $('#result-dialog').showModal();
  beep(850,.1);
}
function ensureAudio() {
  try {
    if (!audio) audio = new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume().catch(()=>{});
  } catch { $('#sound-toggle').checked = false; toast('このブラウザでは効果音を使えません。'); }
}
function beep(frequency,seconds) {
  if (!$('#sound-toggle').checked || !audio) return;
  try {
    const oscillator = audio.createOscillator(), gain = audio.createGain();
    oscillator.connect(gain); gain.connect(audio.destination);
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(.04,audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(.001,audio.currentTime+seconds);
    oscillator.start(); oscillator.stop(audio.currentTime+seconds);
  } catch {}
}
function showFeedback(event) {
  if (event) beep(event.type === 'hit' ? 950 : 160, .04);
}
function resize() {
  const rect = arena.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  width = rect.width; height = rect.height;
  const ratio = Math.min(window.devicePixelRatio || 1,2);
  canvas.width = Math.round(width * ratio); canvas.height = Math.round(height * ratio);
  ctx.setTransform(ratio,0,0,ratio,0,0);
  if (session) session.resize(width,height);
}
function draw() {
  ctx.clearRect(0,0,width,height);
  if (session?.target && ['running','paused'].includes(session.state)) {
    const t = session.target;
    const onTarget = session.mode==='tracking' && session.pointer.held && Math.hypot(session.pointer.x-t.x,session.pointer.y-t.y)<=t.radius;
    ctx.fillStyle = onTarget ? '#e0ffae' : '#c4f66b';
    ctx.beginPath(); ctx.arc(t.x,t.y,t.radius,0,Math.PI*2); ctx.fill();
    ctx.fillStyle='#111b0e';
    ctx.beginPath(); ctx.arc(t.x,t.y,3,0,Math.PI*2); ctx.fill();
    if (session.mode==='reflex') {
      ctx.beginPath();
      ctx.arc(t.x,t.y,t.radius+6,-Math.PI/2,-Math.PI/2+Math.PI*2*(1-(session.elapsed-t.born)/session.config.lifetime));
      ctx.strokeStyle='#c4f66b70'; ctx.lineWidth=2; ctx.stroke();
    }
  }
}
function frame(now) {
  if (countdownEnd !== null) {
    const remaining=Math.ceil((countdownEnd-now)/1000);
    if (remaining<=0) begin(now);
    else $('.countdown-number').textContent=remaining;
  }
  if (session?.state==='running') {
    session.step(now);
    session.events.splice(0).forEach(showFeedback);
    updateHud();
  }
  if (session?.state==='finished') finish();
  draw();
  requestAnimationFrame(frame);
}
function renderRecords() {
  $('#export-button').disabled = !records.length;
  if (!records.length) { $('#all-history').innerHTML = '<p class="empty-history">まだ記録がありません。</p>'; return; }
  $('#all-history').innerHTML = '<table><thead><tr><th>日時</th><th>モード / 難易度</th><th>時間</th><th>スコア</th><th>命中・追従率</th><th>平均反応</th></tr></thead><tbody>'
    + records.map(r=>'<tr><td>' + new Date(r.date).toLocaleString('ja-JP',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'})
      + '</td><td>' + MODES[r.mode].name + ' <small>/ ' + DIFFICULTIES[r.difficulty] + '</small></td><td>'
      + r.duration + '秒</td><td>' + r.score.toLocaleString('ja-JP') + '</td><td>' + r.accuracy.toFixed(1)
      + '%</td><td>' + (r.reaction===null?'—':r.reaction+' ms') + '</td></tr>').join('') + '</tbody></table>';
}
$('#settings-form').onsubmit = event => { event.preventDefault(); if (busy()) reset(); else start(); };
$('#start-target').onclick = start;
document.querySelectorAll('.controls select').forEach(el => el.onchange = updateSettings);
$('#pause-button').onclick = () => session?.state==='paused' ? resume() : pause();
$('#retry-button').onclick = start;
$('#result-close').onclick = () => { $('#result-dialog').close(); arena.focus({preventScroll:true}); };
$('#history-button').onclick = () => {
  if (countdownEnd!==null) reset();
  pause(); renderRecords(); $('#history-dialog').showModal();
};
$('#history-close').onclick = () => $('#history-dialog').close();
$('#sound-toggle').onchange = () => { if ($('#sound-toggle').checked) {ensureAudio();beep(650,.07);} };
$('#fullscreen-button').onclick = async() => {
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
    else if ($('#range-panel').requestFullscreen) await $('#range-panel').requestFullscreen();
    else toast('全画面表示に対応していません。');
  } catch { toast('全画面表示を開始できませんでした。'); }
};
document.addEventListener('fullscreenchange',()=>{resize();$('#fullscreen-button').textContent=document.fullscreenElement?'全画面を終了':'全画面';});
arena.addEventListener('pointermove',event=>{
  if (!session) return;
  const rect=arena.getBoundingClientRect();
  session.pointer.x=event.clientX-rect.left; session.pointer.y=event.clientY-rect.top;
});
arena.addEventListener('pointerdown',event=>{
  if (event.button!==0 || session?.state!=='running') return;
  event.preventDefault();
  const rect=arena.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;
  session.pointer={x,y,held:true};
  arena.setPointerCapture(event.pointerId);
  showFeedback(session.shoot(x,y,performance.now()));
});
window.addEventListener('pointerup',()=>{if(session)session.pointer.held=false;});
arena.addEventListener('pointercancel',()=>{if(session)session.pointer.held=false;});
arena.addEventListener('contextmenu',event=>{if(busy())event.preventDefault();});
window.addEventListener('keydown',event=>{
  if ($('#result-dialog').open || $('#history-dialog').open) return;
  if (event.code==='Space' && !event.repeat && !['BUTTON','INPUT','SELECT','TEXTAREA','A'].includes(document.activeElement?.tagName)) {
    event.preventDefault();
    if (countdownEnd!==null) return;
    if (session?.state==='running') pause();
    else if (session?.state==='paused') resume();
    else start();
  }
  if (event.key==='Escape' && busy()) reset();
});
function suspend() { if(countdownEnd!==null)reset(); else pause(); }
document.addEventListener('visibilitychange',()=>{if(document.hidden)suspend();});
window.addEventListener('blur',suspend);
window.addEventListener('storage',event=>{if(event.key===STORAGE_KEY){records=readRecords();renderRecords();}});
$('#export-button').onclick=()=>{
  const header='date,mode,difficulty,duration_seconds,score,accuracy_percent,average_reaction_ms,hits,shots,best_streak,expired,tracked_ms';
  const rows=records.map(r=>[new Date(r.date).toISOString(),r.mode,r.difficulty,r.duration,r.score,r.accuracy,r.reaction??'',r.hits,r.shots,r.streak,r.expired,r.trackedMs].join(','));
  const blob=new Blob(['\ufeff'+[header,...rows].join('\r\n')],{type:'text/csv;charset=utf-8'});
  const url=URL.createObjectURL(blob),link=document.createElement('a');
  link.href=url;link.download='aimforge-'+new Date().toLocaleDateString('sv-SE')+'.csv';link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
};
new ResizeObserver(resize).observe(arena);
updateSettings();renderRecords();resize();requestAnimationFrame(frame);

