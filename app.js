// Screens: home, duel, results, squad chart. State lives in engine.js; this file only draws it.

const app = document.getElementById('app');

let data = load();
data.players = data.players || [];
let run = data.run;
let busy = false;
let clearArmed = false;

function persist() {
  data.run = run;
  save(data);
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

function photo(i) {
  const a = ARTISTS[i];
  const initials = a.name.replace(/[^\w\s]/g, '').split(/\s+/).map(w => w[0]).join('').slice(0, 2);
  return `<span class="ph" data-initials="${esc(initials)}"><img src="${a.img}" alt="" onerror="this.remove()"></span>`;
}

function song(i) {
  return `<button class="sg" data-play="${i}"><span class="pl"></span><span dir="auto">${esc(songTitle(ARTISTS[i]))}</span></button>`;
}

function sizeClass(name) {
  return name.length <= 10 ? 'l' : name.length <= 15 ? 'm' : 's';
}

function playState(i, state) {
  document.querySelectorAll(`[data-play="${i}"]`).forEach(b => {
    b.classList.remove('loading', 'playing', 'failed');
    if (state !== 'stopped') b.classList.add(state);
  });
}

function stop() {
  stopPreview(playState);
}

// ---------- home ----------

function showHome() {
  stop();
  const resumable = run && !isDone(run);
  const rap = ARTISTS.filter(a => a.pool === 'rap').length;
  app.innerHTML = `
  <section class="home">
    <div class="half top">
      <h1>Who You<br>Got?</h1>
      <p class="lede">Two artists at a time. The one you don't pick is out. Last one standing is your number one.</p>
    </div>
    <div class="half bot">
      <label class="field"><span>Who's playing?</span>
        <input id="name" maxlength="20" autocomplete="off" placeholder="Your name"></label>
      <p class="mix">${rap} rappers and ${ARTISTS.length - rap} house artists, all mixed together.</p>
      <div class="start">
        <button class="go" id="start">Start</button>
        <p class="est">${ARTISTS.length - 1} picks, fewer if you skip artists you don't know.</p>
        <div class="more">
          ${resumable ? `<button class="link" id="resume">Continue ${esc(run.name)}'s game</button>` : ''}
          ${data.players.length ? `<button class="link" id="squad">Who everyone got (${data.players.length})</button>` : ''}
        </div>
      </div>
    </div>
  </section>`;
}

function start() {
  const typed = app.querySelector('#name').value.trim();
  const name = typed || `Player ${data.players.length + 1}`;
  run = newRun(name);
  for (const i of run.order) new Image().src = ARTISTS[i].img;
  persist();
  showDuel();
}

// ---------- duel ----------

function side(i, other, pos) {
  const a = ARTISTS[i];
  return `
  <div class="half ${pos}" role="button" tabindex="0" data-win="${i}" data-lose="${other}" aria-label="${esc(a.name)}">
    ${photo(i)}
    <div class="nm ${sizeClass(a.name)}">${esc(a.name)}</div>
    ${song(i)}
    <button class="dk" data-gone="${i}">Don't know</button>
  </div>`;
}

function showDuel() {
  stop();
  const pair = nextPair(run);
  if (!pair) return finish();
  const left = alive(run).length;
  const total = run.picks + picksLeft(run);
  app.innerHTML = `
  <section class="duel">
    <div class="prog" style="width:${(run.picks / total * 100).toFixed(1)}%"></div>
    <div class="bar">
      <button id="undo"${run.history.length ? '' : ' disabled'}>&lsaquo; Undo</button>
      <span>${left === 2 ? 'Final' : `${left} left`}</span>
      <button id="quit">Quit</button>
    </div>
    ${side(pair[0], pair[1], 'top')}
    <div class="or">OR</div>
    ${side(pair[1], pair[0], 'bot')}
  </section>`;
  pair.forEach(prefetchPreview);
}

function choose(half) {
  if (busy) return;
  busy = true;
  stop();
  const win = +half.dataset.win, lose = +half.dataset.lose;
  half.classList.add('chosen');
  app.querySelector(`.half[data-win="${lose}"]`).classList.add('lost');
  setTimeout(() => {
    busy = false;
    pick(run, win, lose);
    persist();
    showDuel();
  }, 230);
}

function skip(i) {
  if (busy) return;
  stop();
  dontKnow(run, i);
  persist();
  showDuel();
}

function finish() {
  const top = ranking(run).slice(0, 5);
  if (top.length) {
    const entry = { name: run.name, top, at: Date.now() };
    const at = data.players.findIndex(p => p.name.toLowerCase() === run.name.toLowerCase());
    if (at >= 0) data.players[at] = entry; else data.players.push(entry);
  }
  persist();
  showResults();
}

// ---------- results ----------

function row(i, rank, extra) {
  return `<li><span class="rk">${rank}</span>${photo(i)}
    <div class="tx"><b>${esc(ARTISTS[i].name)}</b>${extra ?? song(i)}</div></li>`;
}

function showResults() {
  stop();
  const [first, ...rest] = ranking(run).slice(0, 5);
  app.innerHTML = first === undefined ? `
  <section class="results">
    <div class="half top champ"><p class="who">${esc(run.name)}</p><div class="nm m">Nobody left</div></div>
    <div class="half bot">
      <p class="empty">You skipped everyone. Try a different mix.</p>
      <div class="actions"><button class="go" id="next">Start over</button></div>
    </div>
  </section>` : `
  <section class="results">
    <div class="half top champ">
      <p class="who">${esc(run.name)}'s number one</p>
      <div class="pic">${photo(first)}<span class="badge">1</span></div>
      <div class="nm ${sizeClass(ARTISTS[first].name)}">${esc(ARTISTS[first].name)}</div>
      ${song(first)}
    </div>
    <div class="half bot">
      ${rest.length ? `<ol class="list">${rest.map((i, r) => row(i, r + 2)).join('')}</ol>` : ''}
      <div class="actions">
        <button class="go" id="next">Next player</button>
        <button class="link" id="squad">Who everyone got (${data.players.length})</button>
      </div>
    </div>
  </section>`;
  window.scrollTo(0, 0);
}

// ---------- who everyone got ----------

function showSquad() {
  stop();
  clearArmed = false;
  const players = data.players.slice().sort((a, b) => b.at - a.at);
  app.innerHTML = `
  <section class="squad">
    <div class="half top">
      <button class="back" id="home">&lsaquo; Back</button>
      <h2>Who everyone got</h2>
    </div>
    <div class="half bot">
      ${players.length ? `<ul class="list">${players.map(p => `
        <li>${photo(p.top[0])}<div class="tx"><b>${esc(p.name)}</b>
          <span class="got">${esc(ARTISTS[p.top[0]].name)}</span></div></li>`).join('')}</ul>` :
        '<p class="empty">Nobody has finished a game yet.</p>'}
      ${players.length ? '<button class="link clear" id="clear">Clear the list</button>' : ''}
    </div>
  </section>`;
  window.scrollTo(0, 0);
}

function clearSquad(btn) {
  if (!clearArmed) {
    clearArmed = true;
    btn.textContent = 'Tap again to delete everyone';
    return;
  }
  data.players = [];
  persist();
  showSquad();
}

// ---------- input ----------

app.addEventListener('click', e => {
  const t = e.target;
  const el = sel => t.closest(sel);
  let b;
  if ((b = el('[data-play]'))) return togglePreview(+b.dataset.play, playState);
  if ((b = el('[data-gone]'))) return skip(+b.dataset.gone);
  if ((b = el('button'))) {
    switch (b.id) {
      case 'start': return start();
      case 'resume': return showDuel();
      case 'undo': if (!busy && undo(run)) { persist(); showDuel(); } return;
      case 'quit': case 'home': return showHome();
      case 'next': run = null; persist(); return showHome();
      case 'squad': return showSquad();
      case 'clear': return clearSquad(b);
    }
    return;
  }
  if ((b = el('.duel .half'))) choose(b);
});

document.addEventListener('keydown', e => {
  if (e.target.matches('input')) {
    if (e.key === 'Enter') start();
    return;
  }
  const duel = app.querySelector('.duel');
  if (!duel) return;
  if (e.key === 'ArrowUp' || e.key === '1') choose(duel.querySelector('.top'));
  else if (e.key === 'ArrowDown' || e.key === '2') choose(duel.querySelector('.bot'));
  else if ((e.key === 'Backspace' || e.key === 'z') && !busy && undo(run)) { persist(); showDuel(); }
});

showHome();
