/*

* ================================================================
* HFBT // R-COREX HOLOGRAPHIC PROJECTION RUNTIME
* ================================================================
* 
* Client Runtime:
* 
* SERVER
*  │
*  ├── /player/create
*  ├── /input
*  └── /stream
*          │
*          ▼
*    FRAME TRANSPORT
*          │
*          ▼
*    R-COREX STATE
*          │
*  ┌───────┼────────┐
*  ▼       ▼        ▼
* ARENA   RAYS     AUDIO
*  │       │        │
*  └───────┼────────┘
*          ▼
*   HFBT PROJECTION
*          │
*   ┌──────┴──────┐
*   ▼             ▼
* VIRTUAL       HARDWARE
* PROJECTION    BOUNDARY
* 
* Physical emitter is NEVER assumed to be available.
* The browser runtime operates in VIRTUAL_SIMULATION unless
* an external hardware transport explicitly establishes it.
* 
* ================================================================
  */

"use strict";

/* ================================================================
CORE CANVAS
================================================================ */

const canvas =
document.getElementById("battlefield");

const ctx =
canvas?.getContext("2d", {
alpha: true
});

if (!canvas || !ctx) {

throw new Error(
"HFBT::BATTLEFIELD_CANVAS_UNAVAILABLE"
);

}

/* ================================================================
HFBT RUNTIME BRIDGE
================================================================ */

const Projection =
window.HFBTProjection || {

state: {},

project() {},

emit() {},

setField() {},

setMode() {},

setVector() {},

setAudio() {},

journal() {}

};

/* ================================================================
RUNTIME STATE
================================================================ */

const Runtime = {

protocol:
"RCOREX-HF/1.1",

mode:
"VIRTUAL_SIMULATION",

connected:
false,

playerId:
null,

player:
null,

liveFrame:
null,

frame:
0,

rays:
16384,

pointer: {

x:
  canvas.width / 2,

y:
  canvas.height / 2

},

telemetry: {

fps:
  0,

latency:
  0,

frameTime:
  0,

queue:
  0

},

audio: {

left:
  0,

right:
  0,

resonance:
  0

},

vector: {

x:
  0,

y:
  0,

z:
  0,

rx:
  0,

ry:
  0,

rz:
  0

},

projection: {

active:
  false,

field:
  "BOOT",

coherence:
  0,

resonance:
  0,

strength:
  0

},

stats: {

receivedFrames:
  0,

renderedFrames:
  0,

events:
  0,

inputs:
  0,

droppedFrames:
  0

},

lastFrameTimestamp:
performance.now(),

fpsCounter:
0,

fpsTimestamp:
performance.now()

};

/* ================================================================
UI REFERENCES
================================================================ */

const ui = {

runtime:
document.getElementById("runtime"),

frame:
document.getElementById("frame"),

playerSummary:
document.getElementById("player-summary"),

health:
document.getElementById("health"),

armor:
document.getElementById("armor"),

energy:
document.getElementById("energy"),

stamina:
document.getElementById("stamina"),

score:
document.getElementById("score"),

objective:
document.getElementById("objective"),

log:
document.getElementById("log"),

field:
document.getElementById("field-status"),

emitter:
document.getElementById("emitter-status"),

projection:
document.getElementById("projection-state"),

fps:
document.getElementById("telemetry-fps"),

latency:
document.getElementById("telemetry-latency"),

frameTime:
document.getElementById("telemetry-frame-time"),

queue:
document.getElementById("telemetry-queue"),

rayCount:
document.getElementById("ray-count"),

rayState:
document.getElementById("ray-state"),

vectorState:
document.getElementById("vector-state"),

frameHash:
document.getElementById("frame-hash"),

target:
document.getElementById("target-name"),

targetDistance:
document.getElementById("target-distance"),

weapon:
document.getElementById("weapon-state"),

matrix:
document.getElementById("matrix-state"),

vectorX:
document.getElementById("vector-x"),

vectorY:
document.getElementById("vector-y"),

vectorZ:
document.getElementById("vector-z"),

vectorRX:
document.getElementById("vector-rx"),

vectorRY:
document.getElementById("vector-ry"),

vectorRZ:
document.getElementById("vector-rz"),

hudX:
document.getElementById("hud-x"),

hudY:
document.getElementById("hud-y"),

hudZ:
document.getElementById("hud-z"),

resonance:
document.getElementById("resonance-value"),

coherence:
document.getElementById("coherence-value"),

audioLeft:
document.getElementById("audio-left"),

audioRight:
document.getElementById("audio-right"),

audioResonance:
document.getElementById("audio-resonance"),

frameRate:
document.getElementById("frame-rate"),

runtimeMode:
document.getElementById("runtime-mode"),

footerMode:
document.getElementById("footer-mode"),

objectiveProgress:
document.getElementById("objective-progress"),

fieldMeter:
document.getElementById("field-meter"),

coherenceMeter:
document.getElementById("coherence-meter"),

eventCounter:
document.getElementById("event-counter"),

eventStream:
document.getElementById("event-stream"),

codeStream:
document.getElementById("code-stream"),

alert:
document.getElementById("runtime-alert"),

alertTitle:
document.getElementById("alert-title"),

alertMessage:
document.getElementById("alert-message")

};

/* ================================================================
SAFE UI HELPERS
================================================================ */

function setText(element, value) {

if (element) {

element.textContent =
  value;

}

}

function clamp(value, min, max) {

return Math.max(
min,
Math.min(max, value)
);

}

function number(value, fallback = 0) {

const result =
Number(value);

return Number.isFinite(result)
? result
: fallback;

}

function percent(value) {

return clamp(
number(value),
0,
100
);

}

/* ================================================================
RUNTIME JOURNAL
================================================================ */

function log(message) {

const timestamp =
new Date()
.toLocaleTimeString();

const line =
"[${timestamp}] ${message}";

if (ui.log) {

ui.log.textContent =
  `${line}\n${ui.log.textContent}`;

}

journalEvent(
"LOG",
message
);

}

/* ================================================================
EVENT JOURNAL
================================================================ */

function journalEvent(
type,
message
) {

Runtime.stats.events++;

Projection.journal?.(
type,
message
);

if (!ui.eventStream) {

return;

}

const row =
document.createElement("div");

row.className =
"event-entry";

const time =
new Date()
.toLocaleTimeString();

row.innerHTML = `

<span>${time}</span>

<strong>${type}</strong>

<span>${message}</span>

`;

ui.eventStream.prepend(
row
);

while (
ui.eventStream.children.length > 15
) {

ui.eventStream.removeChild(
  ui.eventStream.lastChild
);

}

setText(
ui.eventCounter,
"EVENTS: ${Runtime.stats.events}"
);

}

/* ================================================================
PROJECTED CODE
================================================================ */

function projectCode(line) {

Projection.project?.(
line
);

}

/* ================================================================
CREATE PLAYER
================================================================ */

async function connectPlayer() {

try {

log(
  "player connection :: initializing"
);


const started =
  performance.now();


const response =
  await fetch(
    "/player/create",
    {
      method: "GET",
      headers: {
        "Accept":
          "application/json"
      }
    }
  );


if (!response.ok) {

  throw new Error(
    `HTTP ${response.status}`
  );

}


const data =
  await response.json();


if (!data?.id) {

  throw new Error(
    "PLAYER_ID_MISSING"
  );

}


Runtime.playerId =
  data.id;

Runtime.player =
  data.player ||
  null;

Runtime.connected =
  true;


if (ui.playerSummary) {

  ui.playerSummary.textContent =
    `PLAYER: ${
      Runtime.player?.name ||
      Runtime.playerId.slice(0, 8)
    }`;

}


Projection.setField?.(
  "ONLINE"
);


projectCode(
  "PLAYER::CONNECTED"
);


journalEvent(
  "PLAYER",
  `Connected ${Runtime.playerId.slice(0, 8)}`
);


log(
  `connected :: ${Runtime.playerId}`
);


updatePlayerHud();


return true;

} catch (error) {

Runtime.connected =
  false;


journalEvent(
  "ERROR",
  `Player connection failed: ${error.message}`
);


log(
  `player connection failed :: ${error.message}`
);


return false;

}

}

/* ================================================================
PLAYER INPUT TRANSPORT
================================================================ */

async function sendAction(
action,
speed = 1.2
) {

if (!Runtime.playerId) {

log(
  "player not connected"
);

return;

}

Runtime.stats.inputs++;

projectCode(
"INPUT::${String(action).toUpperCase()}"
);

try {

const started =
  performance.now();


const response =
  await fetch(
    "/input",
    {
      method: "POST",

      headers: {
        "Content-Type":
          "application/json",

        "Accept":
          "application/json"
      },

      body:
        JSON.stringify({

          playerId:
            Runtime.playerId,

          action,

          speed

        })

    }
  );


Runtime.telemetry.latency =
  performance.now() -
  started;


if (!response.ok) {

  throw new Error(
    `HTTP ${response.status}`
  );

}


const data =
  await response.json();


if (data?.player) {

  Runtime.player =
    data.player;

  updatePlayerHud();

}


Projection.emit?.({

  type:
    "PLAYER_INPUT",

  action,

  playerId:
    Runtime.playerId,

  timestamp:
    Date.now()

});


journalEvent(
  "INPUT",
  action
);

} catch (error) {

journalEvent(
  "INPUT_ERROR",
  error.message
);

log(
  `input failure :: ${error.message}`
);

}

}

/* ================================================================
PLAYER HUD
================================================================ */

function updatePlayerHud() {

const player =
Runtime.player;

if (!player) {

return;

}

setText(
ui.health,
Math.round(
number(player.health)
)
);

setText(
ui.armor,
Math.round(
number(player.armor)
)
);

setText(
ui.energy,
Math.round(
number(player.energy)
)
);

setText(
ui.stamina,
Math.round(
number(player.stamina)
)
);

setText(
ui.score,
number(player.score)
);

setText(
ui.playerSummary,
"PLAYER: ${ player.name || Runtime.playerId?.slice(0, 8) || "UNKNOWN" }"
);

Runtime.vector.x =
number(player.x);

Runtime.vector.y =
number(player.y);

Runtime.vector.z =
number(player.z);

Runtime.vector.rx =
number(
player.rotationX ??
player.rx
);

Runtime.vector.ry =
number(
player.rotationY ??
player.ry
);

Runtime.vector.rz =
number(
player.rotationZ ??
player.rz
);

}

/* ================================================================
FRAME NORMALIZATION
================================================================ */

function normalizeFrame(packet) {

const frame =
packet?.state ||
packet ||
{};

return {

protocol:
  frame.protocol ||
  Runtime.protocol,

frame:
  number(frame.frame),

rays:
  number(
    frame.rays,
    Runtime.rays
  ),

state:
  frame.state ||
  frame,

players:
  Array.isArray(frame.players)
    ? frame.players
    : [],

enemies:
  Array.isArray(frame.enemies)
    ? frame.enemies
    : [],

projectiles:
  Array.isArray(frame.projectiles)
    ? frame.projectiles
    : [],

objective:
  frame.objective ||
  null,

vector:
  frame.vector ||
  frame.position ||
  null,

audio:
  frame.audio ||
  null,

telemetry:
  frame.telemetry ||
  null

};

}

/* ================================================================
FRAME STATE
================================================================ */

function updateRuntimeState(frame) {

const normalized =
normalizeFrame(frame);

Runtime.liveFrame =
normalized;

Runtime.frame =
normalized.frame;

Runtime.rays =
normalized.rays;

Runtime.stats.receivedFrames++;

const now =
performance.now();

Runtime.telemetry.frameTime =
now -
Runtime.lastFrameTimestamp;

Runtime.lastFrameTimestamp =
now;

Runtime.fpsCounter++;

if (
now -
Runtime.fpsTimestamp >= 1000
) {

Runtime.telemetry.fps =
  Runtime.fpsCounter;

Runtime.fpsCounter =
  0;

Runtime.fpsTimestamp =
  now;

}

/*

* Server-provided vector state.
  */

if (normalized.vector) {

Runtime.vector = {

  ...Runtime.vector,

  ...normalized.vector

};

}

/*

* Server-provided audio state.
  */

if (normalized.audio) {

Runtime.audio = {

  ...Runtime.audio,

  ...normalized.audio

};

}

/*

* Server telemetry.
  */

if (normalized.telemetry) {

Runtime.telemetry = {

  ...Runtime.telemetry,

  ...normalized.telemetry

};

}

/*

* Locate current player.
  */

const playerState =
normalized.players.find(
player =>
player.id ===
Runtime.playerId
);

if (playerState) {

Runtime.player =
  playerState;

updatePlayerHud();

}

updateProjectionState(
normalized
);

updateRuntimeHud(
normalized
);

Runtime.stats.renderedFrames++;

}

/* ================================================================
PROJECTION STATE
================================================================ */

function updateProjectionState(frame) {

const state =
frame.state ||
{};

Runtime.projection.active =
true;

Runtime.projection.field =
state.field ||
"ONLINE";

Runtime.projection.coherence =
number(
state.coherence,
0.7076129521834406
);

Runtime.projection.resonance =
number(
state.resonance,
0.4467788645683021
);

Runtime.projection.strength =
number(
state.fieldStrength,
0.82
);

Projection.setField?.(
Runtime.projection.field
);

Projection.setVector?.(
Runtime.vector
);

Projection.setAudio?.(
Runtime.audio
);

Projection.emit?.({

type:
  "FRAME",

frame:
  Runtime.frame,

rays:
  Runtime.rays,

vector:
  Runtime.vector,

audio:
  Runtime.audio

});

projectCode(
"FRAME::${Runtime.frame}"
);

if (
ui.field
) {

ui.field.textContent =
  Runtime.projection.field;

}

}

/* ================================================================
RUNTIME HUD
================================================================ */

function updateRuntimeHud(frame) {

setText(
ui.runtime,
"RUNTIME: ${ frame.protocol } / ${ frame.rays } RAYS"
);

setText(
ui.frame,
"FRAME: ${ frame.frame }"
);

setText(
ui.rayCount,
Runtime.rays
);

setText(
ui.rayState,
"ONLINE"
);

setText(
ui.vectorState,
"SYNC"
);

setText(
ui.fps,
Runtime.telemetry.fps
);

setText(
ui.frameRate,
"${Runtime.telemetry.fps} FPS"
);

setText(
ui.frameTime,
"${Runtime.telemetry.frameTime.toFixed(2)} ms"
);

setText(
ui.latency,
"${Runtime.telemetry.latency.toFixed(2)} ms"
);

setText(
ui.queue,
Runtime.telemetry.queue
);

setText(
ui.vectorX,
Runtime.vector.x.toFixed(3)
);

setText(
ui.vectorY,
Runtime.vector.y.toFixed(3)
);

setText(
ui.vectorZ,
Runtime.vector.z.toFixed(3)
);

setText(
ui.vectorRX,
Runtime.vector.rx.toFixed(3)
);

setText(
ui.vectorRY,
Runtime.vector.ry.toFixed(3)
);

setText(
ui.vectorRZ,
Runtime.vector.rz.toFixed(3)
);

setText(
ui.hudX,
Math.round(
Runtime.vector.x
)
);

setText(
ui.hudY,
Math.round(
Runtime.vector.y
)
);

setText(
ui.hudZ,
Math.round(
Runtime.vector.z
)
);

setText(
ui.resonance,
Runtime.projection.resonance
.toFixed(6)
);

setText(
ui.coherence,
"${Math.round( Runtime.projection.coherence * 100 )}%"
);

setText(
ui.audioLeft,
Runtime.audio.left
.toFixed(2)
);

setText(
ui.audioRight,
Runtime.audio.right
.toFixed(2)
);

setText(
ui.audioResonance,
Runtime.audio.resonance
.toFixed(2)
);

if (
ui.objective &&
frame.objective
) {

const progress =
  percent(
    frame.objective.progress
  );


ui.objective.textContent =
  `${
    frame.objective.name ||
    "DATA CORE"
  }: ${Math.round(progress)}%`;


if (
  ui.objectiveProgress
) {

  ui.objectiveProgress.style.width =
    `${progress}%`;

}

}

if (
ui.coherenceMeter
) {

ui.coherenceMeter.style.width =
  `${clamp(
    Runtime.projection.coherence * 100,
    0,
    100
  )}%`;

}

if (
ui.fieldMeter
) {

ui.fieldMeter.style.width =
  `${clamp(
    Runtime.projection.strength * 100,
    0,
    100
  )}%`;

}

updateTargetHud(
frame
);

}

/* ================================================================
TARGET HUD
================================================================ */

function updateTargetHud(frame) {

const enemies =
frame.enemies || [];

if (!enemies.length) {

setText(
  ui.target,
  "NO TARGET"
);

setText(
  ui.targetDistance,
  "DISTANCE: ----"
);

return;

}

const player =
Runtime.player;

if (!player) {

return;

}

let closest =
null;

let closestDistance =
Infinity;

for (
const enemy of enemies
) {

const dx =
  number(enemy.x) -
  number(player.x);

const dy =
  number(enemy.y) -
  number(player.y);

const dz =
  number(enemy.z) -
  number(player.z);


const distance =
  Math.sqrt(
    dx * dx +
    dy * dy +
    dz * dz
  );


if (
  distance <
  closestDistance
) {

  closest =
    enemy;

  closestDistance =
    distance;

}

}

if (!closest) {

return;

}

setText(
ui.target,
closest.name ||
closest.id ||
"HOSTILE"
);

setText(
ui.targetDistance,
"DISTANCE: ${ closestDistance.toFixed(1) }"
);

}

/* ================================================================
HOLOGRAPHIC ARENA RENDERER
================================================================ */

function drawArena() {

const width =
canvas.width;

const height =
canvas.height;

ctx.clearRect(
0,
0,
width,
height
);

/*

* Deep projection field.
  */

const gradient =
ctx.createRadialGradient(
width / 2,
height / 2,
10,
width / 2,
height / 2,
width * 0.75
);

gradient.addColorStop(
0,
"rgba(15,60,90,0.24)"
);

gradient.addColorStop(
0.5,
"rgba(5,20,45,0.18)"
);

gradient.addColorStop(
1,
"rgba(0,0,0,0)"
);

ctx.fillStyle =
gradient;

ctx.fillRect(
0,
0,
width,
height
);

/*

* Primary spatial grid.
  */

drawProjectionGrid();

/*

* Server entities.
  */

drawObjective();

drawPlayers();

drawEnemies();

drawProjectiles();

/*

* Projection center.
  */

drawProjectionCore();

/*

* Operator targeting reticle.
  */

drawReticle();

Runtime.stats.renderedFrames++;

}

/* ================================================================
SPATIAL GRID
================================================================ */

function drawProjectionGrid() {

const width =
canvas.width;

const height =
canvas.height;

const grid =
32;

ctx.save();

for (
let x = 0;
x <= width;
x += grid
) {

ctx.strokeStyle =
  "rgba(118,247,255,0.07)";

ctx.lineWidth =
  1;

ctx.beginPath();

ctx.moveTo(
  x,
  0
);

ctx.lineTo(
  x,
  height
);

ctx.stroke();

}

for (
let y = 0;
y <= height;
y += grid
) {

ctx.strokeStyle =
  "rgba(118,247,255,0.07)";

ctx.beginPath();

ctx.moveTo(
  0,
  y
);

ctx.lineTo(
  width,
  y
);

ctx.stroke();

}

/*

* Center axes.
  */

ctx.strokeStyle =
"rgba(255,255,255,0.12)";

ctx.beginPath();

ctx.moveTo(
width / 2,
0
);

ctx.lineTo(
width / 2,
height
);

ctx.moveTo(
0,
height / 2
);

ctx.lineTo(
width,
height / 2
);

ctx.stroke();

ctx.restore();

}

/* ================================================================
OBJECTIVE
================================================================ */

function drawObjective() {

const objective =
Runtime.liveFrame?.objective;

if (!objective) {

return;

}

const x =
canvas.width / 2 +
number(objective.x) * 9;

const y =
canvas.height / 2 +
number(objective.z) * 9;

ctx.save();

/*

* Objective halo.
  */

const glow =
ctx.createRadialGradient(
x,
y,
2,
x,
y,
42
);

glow.addColorStop(
0,
"rgba(125,255,184,0.5)"
);

glow.addColorStop(
1,
"rgba(125,255,184,0)"
);

ctx.fillStyle =
glow;

ctx.beginPath();

ctx.arc(
x,
y,
42,
0,
Math.PI * 2
);

ctx.fill();

ctx.strokeStyle =
"#7dffb8";

ctx.lineWidth =
2;

ctx.beginPath();

ctx.arc(
x,
y,
14,
0,
Math.PI * 2
);

ctx.stroke();

ctx.beginPath();

ctx.moveTo(
x - 22,
y
);

ctx.lineTo(
x + 22,
y
);

ctx.moveTo(
x,
y - 22
);

ctx.lineTo(
x,
y + 22
);

ctx.stroke();

ctx.restore();

}

/* ================================================================
PLAYER RENDERING
================================================================ */

function drawPlayers() {

const players =
Runtime.liveFrame?.players ||
[];

for (
const player of players
) {

const x =
  canvas.width / 2 +
  number(player.x) * 9;


const y =
  canvas.height / 2 +
  number(player.z) * 9;


const isLocal =
  player.id ===
  Runtime.playerId;


ctx.save();


ctx.shadowBlur =
  isLocal
    ? 22
    : 10;


ctx.shadowColor =
  isLocal
    ? "#76f7ff"
    : "#9f7dff";


ctx.fillStyle =
  isLocal
    ? "#76f7ff"
    : "#9f7dff";


ctx.beginPath();

ctx.arc(
  x,
  y,
  isLocal ? 9 : 6,
  0,
  Math.PI * 2
);

ctx.fill();


/*
 * Direction vector.
 */

const rotation =
  number(
    player.rotation ??
    player.ry
  );


const radians =
  rotation *
  Math.PI /
  180;


ctx.strokeStyle =
  isLocal
    ? "#ffffff"
    : "#cbbfff";

ctx.beginPath();

ctx.moveTo(
  x,
  y
);

ctx.lineTo(
  x +
  Math.sin(radians) * 20,

  y -
  Math.cos(radians) * 20
);

ctx.stroke();


ctx.restore();

}

}

/* ================================================================
ENEMY RENDERING
================================================================ */

function drawEnemies() {

const enemies =
Runtime.liveFrame?.enemies ||
[];

for (
const enemy of enemies
) {

const x =
  canvas.width / 2 +
  number(enemy.x) * 9;


const y =
  canvas.height / 2 +
  number(enemy.z) * 9;


const health =
  clamp(
    number(enemy.health, 100),
    0,
    100
  );


ctx.save();


/*
 * Enemy projection glow.
 */

ctx.shadowBlur =
  18;

ctx.shadowColor =
  "#ff5ab3";


ctx.fillStyle =
  "#ff5ab3";


ctx.beginPath();

ctx.arc(
  x,
  y,
  8,
  0,
  Math.PI * 2
);

ctx.fill();


/*
 * Target brackets.
 */

ctx.strokeStyle =
  "rgba(255,90,179,0.8)";

ctx.lineWidth =
  1;


const size =
  15;


ctx.beginPath();

ctx.moveTo(
  x - size,
  y - size + 5
);

ctx.lineTo(
  x - size,
  y - size
);

ctx.lineTo(
  x - size + 5,
  y - size
);


ctx.moveTo(
  x + size - 5,
  y - size
);

ctx.lineTo(
  x + size,
  y - size
);

ctx.lineTo(
  x + size,
  y - size + 5
);


ctx.moveTo(
  x - size,
  y + size - 5
);

ctx.lineTo(
  x - size,
  y + size
);

ctx.lineTo(
  x - size + 5,
  y + size
);


ctx.moveTo(
  x + size - 5,
  y + size
);

ctx.lineTo(
  x + size,
  y + size
);

ctx.lineTo(
  x + size,
  y + size - 5
);

ctx.stroke();


/*
 * Health bar.
 */

ctx.shadowBlur =
  0;


ctx.fillStyle =
  "rgba(255,255,255,0.25)";


ctx.fillRect(
  x - 10,
  y - 17,
  20,
  3
);


ctx.fillStyle =
  "#ff0a6c";


ctx.fillRect(
  x - 10,
  y - 17,
  20 *
  (health / 100),
  3
);


ctx.restore();

}

}

/* ================================================================
PROJECTILE RENDERING
================================================================ */

function drawProjectiles() {

const projectiles =
Runtime.liveFrame?.projectiles ||
[];

for (
const projectile of projectiles
) {

const x =
  canvas.width / 2 +
  number(projectile.x) * 9;


const y =
  canvas.height / 2 +
  number(projectile.z) * 9;


ctx.save();


ctx.shadowBlur =
  12;

ctx.shadowColor =
  "#ffd76a";


ctx.fillStyle =
  "#ffd76a";


ctx.fillRect(
  x - 2,
  y - 2,
  4,
  4
);


ctx.restore();

}

}

/* ================================================================
HOLOGRAPHIC CORE
================================================================ */

function drawProjectionCore() {

const x =
canvas.width / 2;

const y =
canvas.height / 2;

const time =
performance.now() /
1000;

const radius =
45 +
Math.sin(time * 2) * 4;

ctx.save();

ctx.strokeStyle =
"rgba(118,247,255,0.16)";

ctx.lineWidth =
1;

for (
let i = 0;
i < 3;
i++
) {

ctx.beginPath();

ctx.arc(
  x,
  y,
  radius + i * 16,
  time * (i + 1),
  time * (i + 1) +
    Math.PI * 1.5
);

ctx.stroke();

}

ctx.restore();

}

/* ================================================================
TARGET RETICLE
================================================================ */

function drawReticle() {

const x =
Runtime.pointer.x;

const y =
Runtime.pointer.y;

ctx.save();

ctx.strokeStyle =
"rgba(223,248,255,0.9)";

ctx.lineWidth =
1;

const size =
10;

ctx.beginPath();

ctx.moveTo(
x - size,
y
);

ctx.lineTo(
x + size,
y
);

ctx.moveTo(
x,
y - size
);

ctx.lineTo(
x,
y + size
);

ctx.stroke();

ctx.beginPath();

ctx.arc(
x,
y,
18,
0,
Math.PI * 2
);

ctx.stroke();

ctx.restore();

}

/* ================================================================
POINTER / SPATIAL INPUT
================================================================ */

function updatePointer(event) {

const rect =
canvas.getBoundingClientRect();

Runtime.pointer.x =
(
(event.clientX -
rect.left) /
rect.width
) *
canvas.width;

Runtime.pointer.y =
(
(event.clientY -
rect.top) /
rect.height
) *
canvas.height;

}

/* ================================================================
INPUT MATRIX
================================================================ */

function wireControls() {

document
.querySelectorAll(
"button[data-action]"
)
.forEach(button => {

  button.addEventListener(
    "click",
    () => {

      sendAction(
        button.dataset.action
      );

    }
  );

});

document.addEventListener(
"keydown",
event => {

  /*
   * Prevent repeated browser behavior
   * for game controls.
   */

  const key =
    event.key.toLowerCase();


  const actions = {

    w:
      "forward",

    s:
      "back",

    a:
      "strafe_left",

    d:
      "strafe_right",

    q:
      "turn_left",

    e:
      "turn_right",

    " ":
      "fire",

    r:
      "reload",

    shift:
      "dash",

    f:
      "ability"

  };


  const action =
    actions[key];


  if (!action) {

    return;

  }


  event.preventDefault();


  sendAction(
    action
  );

}

);

canvas.addEventListener(
"pointermove",
updatePointer
);

canvas.addEventListener(
"pointerdown",
event => {

  if (
    event.button === 0
  ) {

    sendAction(
      "fire"
    );

  }

}

);

}

/* ================================================================
LIVE FRAME STREAM
================================================================ */

function connectStream() {

const stream =
new EventSource(
"/stream"
);

stream.onopen = () => {

Runtime.projection.active =
  true;


Projection.setField?.(
  "STREAM_ONLINE"
);


journalEvent(
  "STREAM",
  "Live HFBT frame transport connected"
);


log(
  "stream connected :: live HFBT synchronization active"
);

};

stream.onmessage =
event => {

  try {

    const message =
      JSON.parse(
        event.data
      );


    if (
      message.type ===
      "FRAME"
    ) {

      updateRuntimeState(
        message.frame
      );


      drawArena();

    }


    else if (
      message.type ===
      "EVENT"
    ) {

      journalEvent(
        message.event?.type ||
        "REMOTE",

        message.event?.message ||
        "Remote runtime event"
      );

    }


    else if (
      message.type ===
      "STATE"
    ) {

      updateRuntimeState(
        message.state
      );

      drawArena();

    }


  } catch (error) {

    journalEvent(
      "STREAM_ERROR",
      `Frame parse failure: ${error.message}`
    );

  }

};

stream.onerror = () => {

Runtime.projection.active =
  false;


Projection.setField?.(
  "STREAM_RECONNECTING"
);


journalEvent(
  "STREAM",
  "Connection interrupted; browser EventSource will reconnect"
);


log(
  "stream reconnecting :: waiting for live HFBT sync"
);

};

}

/* ================================================================
LOCAL RENDER LOOP
================================================================ */

function renderLoop() {

/*

* Render continuously even if the server stream pauses.
* The most recent authoritative server state remains visible.
  */

drawArena();

requestAnimationFrame(
renderLoop
);

}

/* ================================================================
RUNTIME HEALTH
================================================================ */

function updateRuntimeHealth() {

const state =
Projection.state ||
{};

Runtime.mode =
state.mode ||
Runtime.mode;

setText(
ui.emitter,
state.physicalEmitter
? "PHYSICAL"
: "VIRTUAL"
);

setText(
ui.runtimeMode,
Runtime.mode
);

setText(
ui.footerMode,
Runtime.mode
);

/*

* Explicitly preserve the hardware boundary.
  */

if (
state.physicalEmitter !== true
) {

const optical =
  document.getElementById(
    "optical-output"
  );


const laser =
  document.getElementById(
    "laser-control"
  );


if (optical) {

  optical.textContent =
    "DISABLED";

}


if (laser) {

  laser.textContent =
    "DISABLED";

}

}

}

/* ================================================================
GLOBAL HFBT API
================================================================ */

window.HFBTGame = {

state:
Runtime,

sendAction,

connectPlayer,

reconnectStream:
connectStream,

getFrame() {

return Runtime.liveFrame;

},

getPlayer() {

return Runtime.player;

},

getRuntimeState() {

return structuredClone(
  Runtime
);

},

project(code) {

projectCode(
  code
);

},

emit(payload) {

Projection.emit?.(
  payload
);

}

};

/* ================================================================
INITIALIZATION
================================================================ */

async function initializeHFBTClient() {

projectCode(
"CLIENT::INITIALIZING"
);

journalEvent(
"BOOT",
"HFBT client runtime initializing"
);

updateRuntimeHealth();

wireControls();

/*

* Connect player and stream independently.
* A stream failure must not destroy the local renderer.
  */

await connectPlayer();

connectStream();

/*

* Start continuous local projection.
  */

requestAnimationFrame(
renderLoop
);

projectCode(
"CLIENT::ONLINE"
);

journalEvent(
"BOOT",
"HFBT client runtime operational"
);

log(
"HFBT client operational :: awaiting live frames"
);

}

/* ================================================================
START
================================================================ */

initializeHFBTClient()
.catch(error => {

journalEvent(
  "FATAL",
  error.message
);


log(
  `runtime initialization failure :: ${error.message}`
);

});