const canvas = document.getElementById('battlefield');
const ctx = canvas.getContext('2d');

let playerId = null;
let liveFrame = null;
let currentPlayer = null;

const ui = {
  runtime: document.getElementById('runtime'),
  frame: document.getElementById('frame'),
  playerSummary: document.getElementById('player-summary'),
  health: document.getElementById('health'),
  armor: document.getElementById('armor'),
  energy: document.getElementById('energy'),
  stamina: document.getElementById('stamina'),
  score: document.getElementById('score'),
  objective: document.getElementById('objective'),
  log: document.getElementById('log')
};

function log(message) {
  ui.log.textContent = `[${new Date().toLocaleTimeString()}] ${message}\n${ui.log.textContent}`;
}

async function connectPlayer() {
  const response = await fetch('/player/create');
  const data = await response.json();
  playerId = data.id;
  currentPlayer = data.player;
  ui.playerSummary.textContent = `PLAYER: ${playerId.slice(0, 8)}`;
  log(`connected :: ${playerId}`);
}

async function sendAction(action) {
  if (!playerId) {
    log('player not connected');
    return;
  }

  const response = await fetch('/input', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playerId, action })
  });

  const data = await response.json();
  if (data.player) {
    currentPlayer = data.player;
    updatePlayerHud();
  }
}

function updatePlayerHud() {
  if (!currentPlayer) return;
  ui.health.textContent = Math.round(currentPlayer.health);
  ui.armor.textContent = Math.round(currentPlayer.armor);
  ui.energy.textContent = Math.round(currentPlayer.energy);
  ui.stamina.textContent = Math.round(currentPlayer.stamina);
  ui.score.textContent = currentPlayer.score;
}

function drawArena() {
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);

  const grid = 28;
  for (let x = 0; x < w; x += grid) {
    ctx.strokeStyle = 'rgba(118, 247, 255, 0.08)';
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }

  for (let y = 0; y < h; y += grid) {
    ctx.strokeStyle = 'rgba(118, 247, 255, 0.08)';
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  const objective = liveFrame?.state?.objective;
  if (objective) {
    const px = w / 2 + (objective.x * 9);
    const py = h / 2 + (objective.z * 9);
    ctx.fillStyle = '#7dffb8';
    ctx.beginPath();
    ctx.arc(px, py, 14, 0, Math.PI * 2);
    ctx.fill();
  }

  if (currentPlayer) {
    const px = w / 2 + (currentPlayer.x * 9);
    const py = h / 2 + (currentPlayer.z * 9);
    ctx.fillStyle = '#76f7ff';
    ctx.beginPath();
    ctx.arc(px, py, 8, 0, Math.PI * 2);
    ctx.fill();
  }

  if (liveFrame?.state?.enemies) {
    for (const enemy of liveFrame.state.enemies) {
      const ex = w / 2 + (enemy.x * 9);
      const ey = h / 2 + (enemy.z * 9);
      ctx.fillStyle = '#ff5ab3';
      ctx.beginPath();
      ctx.arc(ex, ey, 7, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  if (liveFrame?.state?.projectiles) {
    for (const projectile of liveFrame.state.projectiles) {
      const px = w / 2 + (projectile.x * 9);
      const py = h / 2 + (projectile.z * 9);
      ctx.fillStyle = '#ffd76a';
      ctx.fillRect(px - 2, py - 2, 4, 4);
    }
  }
}

function updateHudFromFrame(frame) {
  liveFrame = frame.state;
  ui.runtime.textContent = `RUNTIME: ${frame.protocol} / ${frame.rays} RAYS`;
  ui.frame.textContent = `FRAME: ${frame.frame}`;
  if (liveFrame?.objective) {
    ui.objective.textContent = `${liveFrame.objective.name}: ${Math.round(liveFrame.objective.progress)}%`;
  }

  const playerState = liveFrame?.players?.find(p => p.id === playerId) || currentPlayer;
  if (playerState) {
    currentPlayer = playerState;
    updatePlayerHud();
    ui.playerSummary.textContent = `PLAYER: ${playerState.name}`;
  }

  drawArena();
}

function wireControls() {
  document.querySelectorAll('button[data-action]').forEach(button => {
    button.addEventListener('click', () => sendAction(button.dataset.action));
  });

  document.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (key === 'w') sendAction('forward');
    if (key === 's') sendAction('back');
    if (key === 'a') sendAction('strafe_left');
    if (key === 'd') sendAction('strafe_right');
    if (key === 'q') sendAction('turn_left');
    if (key === 'e') sendAction('turn_right');
    if (key === ' ') sendAction('fire');
    if (key === 'r') sendAction('reload');
    if (key === 'shift') sendAction('dash');
    if (key === 'f') sendAction('ability');
  });
}

function connectStream() {
  const stream = new EventSource('/stream');

  stream.onmessage = (event) => {
    const message = JSON.parse(event.data);
    if (message.type === 'FRAME') {
      updateHudFromFrame(message.frame);
    }
  };

  stream.onerror = () => {
    log('stream reconnecting :: waiting for live HFBT sync');
  };
}

wireControls();
connectPlayer();
connectStream();
