// Knockout engine, storage and song previews. No DOM here except the audio element.

// Whoever you don't pick is out for good. Artists with the fewest wins meet first,
// so it plays like a bracket: winners face winners and the last one standing is #1.
// Everyone else is ranked by how far they got (wins), then by how late they went out.

function newRun(name) {
  const ids = ARTISTS.map((a, i) => i);
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return { name, order: ids, wins: {}, out: [], gone: [], picks: 0, history: [] };
}

function alive(run) {
  return run.order.filter(i => !run.out.includes(i) && !run.gone.includes(i));
}

function wins(run, i) {
  return run.wins[i] || 0;
}

function isDone(run) {
  return alive(run).length <= 1;
}

// The next two artists to show, or null when the knockout is over.
function nextPair(run) {
  const left = alive(run);
  if (left.length < 2) return null;
  const pos = i => run.order.indexOf(i);
  left.sort((a, b) => wins(run, a) - wins(run, b) || pos(a) - pos(b));
  return [left[0], left[1]];
}

function snapshot(run) {
  const { history, ...rest } = run;
  return JSON.stringify(rest);
}

function pick(run, winner, loser) {
  run.history.push(snapshot(run));
  run.wins[winner] = wins(run, winner) + 1;
  run.out.push(loser);
  run.picks++;
}

function dontKnow(run, i) {
  run.history.push(snapshot(run));
  run.gone.push(i);
  run.picks++;
}

function undo(run) {
  const prev = run.history.pop();
  if (!prev) return false;
  const history = run.history;
  Object.assign(run, JSON.parse(prev), { history });
  return true;
}

// Champion first, then everyone knocked out: more wins first, later exits first.
function ranking(run) {
  const outAt = i => run.out.indexOf(i);
  const knocked = run.out.slice().sort((a, b) => wins(run, b) - wins(run, a) || outAt(b) - outAt(a));
  return [...alive(run), ...knocked];
}

function picksLeft(run) {
  return Math.max(0, alive(run).length - 1);
}

// ---- storage (this phone only) ----

const STORE = 'wyg.v2';
function load() {
  try { return JSON.parse(localStorage.getItem(STORE)) || { players: [], run: null }; }
  catch { return { players: [], run: null }; }
}
function save(data) {
  try { localStorage.setItem(STORE, JSON.stringify(data)); } catch {}
}

// ---- song previews (Deezer 30s clips, fetched fresh because the links expire) ----

const audio = new Audio();
const previewCache = new Map();
let playingId = null;

function jsonp(url, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const cb = 'dz' + Math.random().toString(36).slice(2);
    const s = document.createElement('script');
    const done = () => { clearTimeout(t); s.remove(); };
    // A reply that shows up after the timeout still calls cb, so leave a no-op behind.
    const t = setTimeout(() => { window[cb] = () => delete window[cb]; done(); reject(new Error('timeout')); }, timeout);
    window[cb] = data => { delete window[cb]; done(); resolve(data); };
    s.onerror = () => { delete window[cb]; done(); reject(new Error('load')); };
    s.src = url + (url.includes('?') ? '&' : '?') + 'output=jsonp&callback=' + cb;
    document.head.appendChild(s);
  });
}

async function previewUrl(a) {
  if (previewCache.has(a.t)) return previewCache.get(a.t);
  const track = await jsonp('https://api.deezer.com/track/' + a.t);
  if (!track.preview) throw new Error('no preview');
  previewCache.set(a.t, track.preview);
  return track.preview;
}

// Toggles the clip for artist index i. onState(i, 'loading'|'playing'|'stopped'|'failed').
async function togglePreview(i, onState) {
  if (playingId === i) { stopPreview(onState); return; }
  stopPreview(onState);
  playingId = i;
  onState(i, 'loading');
  try {
    // A cached link plays straight from the tap, which iPhones need to allow sound.
    const a = ARTISTS[i];
    const url = previewCache.get(a.t) || await previewUrl(a);
    if (playingId !== i) return;
    audio.src = url;
    await audio.play();
    onState(i, 'playing');
    audio.onended = () => { if (playingId === i) { playingId = null; onState(i, 'stopped'); } };
  } catch {
    if (playingId === i) { playingId = null; onState(i, 'failed'); }
  }
}

function prefetchPreview(i) {
  previewUrl(ARTISTS[i]).catch(() => {});
}

function stopPreview(onState) {
  if (playingId === null) return;
  const i = playingId;
  playingId = null;
  audio.pause();
  if (onState) onState(i, 'stopped');
}

function songTitle(a) {
  return a.song.replace(/\s*[([].*?[)\]]/g, '').trim() || a.song;
}
