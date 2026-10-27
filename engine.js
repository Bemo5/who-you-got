// Ranking engine, storage and song previews. No DOM here except the audio element.

// How the picks are chosen:
// An artist is a "contender" while everyone who has beaten them is already ranked.
// Two contenders have never met (if they had, the loser would not be a contender),
// so any two of them make a fair matchup, and each pick knocks exactly one out.
// When one contender is left, they take the next rank. Pairing the contenders with
// the fewest wins first keeps it bracket-shaped, so finding #2, #3... only replays
// the handful of artists who lost to the people already ranked.

function newRun(name, pools, want = 5) {
  const ids = ARTISTS.map((a, i) => i).filter(i => pools.includes(ARTISTS[i].pool));
  for (let i = ids.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return { name, pools, want, order: ids, ranked: [], gone: [], beats: [], picks: 0, history: [] };
}

function active(run) {
  return run.order.filter(i => !run.ranked.includes(i) && !run.gone.includes(i));
}

function contenders(run) {
  return active(run).filter(i =>
    run.beats.every(([w, l]) => l !== i || run.ranked.includes(w) || run.gone.includes(w)));
}

function winsOver(run, i) {
  const live = new Set(active(run));
  return run.beats.filter(([w, l]) => w === i && live.has(l)).length;
}

// Ranks everyone who is the last contender standing.
function settle(run) {
  while (run.ranked.length < run.want) {
    const c = contenders(run);
    if (c.length !== 1) break;
    run.ranked.push(c[0]);
  }
}

function isDone(run) {
  return run.ranked.length >= run.want || active(run).length === 0;
}

// The next two artists to show, or null when the run is finished.
function nextPair(run) {
  if (isDone(run)) return null;
  const c = contenders(run);
  if (c.length < 2) return null;
  const pos = i => run.order.indexOf(i);
  c.sort((a, b) => winsOver(run, a) - winsOver(run, b) || pos(a) - pos(b));
  return [c[0], c[1]];
}

function snapshot(run) {
  const { history, ...rest } = run;
  return JSON.stringify(rest);
}

function pick(run, winner, loser) {
  run.history.push(snapshot(run));
  run.beats.push([winner, loser]);
  run.picks++;
  settle(run);
}

function dontKnow(run, i) {
  run.history.push(snapshot(run));
  run.gone.push(i);
  run.picks++;
  settle(run);
}

function undo(run) {
  const prev = run.history.pop();
  if (!prev) return false;
  const history = run.history;
  Object.assign(run, JSON.parse(prev), { history });
  return true;
}

function keepGoing(run, more = 5) {
  run.want += more;
  settle(run);
}

// Rough picks left: finish the current knockout, then about log2(n) per rank still wanted.
function picksLeft(run) {
  if (isDone(run)) return 0;
  const n = active(run).length;
  const later = Math.max(0, run.want - run.ranked.length - 1);
  return contenders(run).length - 1 + later * Math.ceil(Math.log2(Math.max(2, n)));
}

function estimateFor(pools) {
  const n = ARTISTS.filter(a => pools.includes(a.pool)).length;
  return n ? n - 1 + 4 * Math.ceil(Math.log2(Math.max(2, n))) : 0;
}

// ---- storage (this phone only) ----

const STORE = 'wyg.v1';
function load() {
  try { return JSON.parse(localStorage.getItem(STORE)) || { players: [], run: null }; }
  catch { return { players: [], run: null }; }
}
function save(data) {
  try { localStorage.setItem(STORE, JSON.stringify(data)); } catch {}
}

// Points for the squad chart: #1 gets 5, #5 gets 1.
function squadChart(players) {
  const score = new Map();
  for (const p of players) {
    p.top.slice(0, 5).forEach((id, r) => {
      const s = score.get(id) || { id, pts: 0, fans: [] };
      s.pts += 5 - r;
      s.fans.push(p.name);
      score.set(id, s);
    });
  }
  return [...score.values()].sort((a, b) => b.pts - a.pts || b.fans.length - a.fans.length);
}

// ---- song previews (Deezer 30s clips, fetched fresh because the links expire) ----

const audio = new Audio();
const previewCache = new Map();
let playingId = null;

function jsonp(url, timeout = 8000) {
  return new Promise((resolve, reject) => {
    const cb = 'dz' + Math.random().toString(36).slice(2);
    const s = document.createElement('script');
    const t = setTimeout(() => { cleanup(); reject(new Error('timeout')); }, timeout);
    function cleanup() { clearTimeout(t); delete window[cb]; s.remove(); }
    window[cb] = data => { cleanup(); resolve(data); };
    s.onerror = () => { cleanup(); reject(new Error('load')); };
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
