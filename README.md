CyberGame HFBT Server

A compact cyberpunk first-person arena server and browser client built around a strict HolographicFramesByteTransport (HFBT) runtime model.

The server maintains authoritative game state and converts each authoritative gameplay tick into an "RCOREX-HF/1.1" HFBT frame. Clients receive, validate, deserialize, reconstruct, and render those frames.

---

Runtime Architecture

                    CYBERGAME APPLICATION
                            │
                            ▼
                    AUTHORITATIVE STATE
                            │
                            ▼
                     GAMEPLAY TICK
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
          MOVEMENT        COMBAT       OBJECTIVE
              │             │             │
              └─────────────┼─────────────┘
                            ▼
                    RENDER STATE BUILD
                            │
                            ▼
                     RCOREX-HF/1.1
                            │
                            ▼
              HolographicFramesByteTransport
                            │
                            ▼
                    BYTE FRAME + HASH
                            │
                            ▼
                    SERVER TRANSPORT
                            │
                            ▼
                         CLIENT
                            │
                            ▼
                   HFBT DESERIALIZER
                            │
                            ▼
                  CLIENT STATE REBUILD
                            │
                            ▼
                    CANVAS / HUD

HFBT is the runtime boundary for gameplay state transmission.

---

Features

Authoritative Game Server

The server owns the authoritative:

- player state
- enemy state
- world state
- projectile state
- weapon state
- objective state
- score state
- gameplay events
- frame sequence
- HFBT runtime state

Clients cannot directly modify authoritative state.

---

HFBT Runtime

Every gameplay tick produces an HFBT frame.

Default protocol:

protocol:
RCOREX-HF/1.1

transport:
HolographicFramesByteTransport

mode:
VIRTUAL_SIMULATION

rays:
16384

tick rate:
30 Hz

Each frame contains:

HEADER
  protocol
  transport
  frameId
  timestamp
  tick
  rays
  payloadLength

PAYLOAD
  gameState
  renderData
  audioData
  runtime
  inputAck

FOOTER
  checksum
  serializedSize

---

Gameplay Systems

CyberGame implements a tactical cyber arena.

Player Movement

Players can:

FORWARD
BACK
STRAFE_LEFT
STRAFE_RIGHT
TURN_LEFT
TURN_RIGHT
AIM
SPRINT
DASH
JUMP

Movement is applied only during the authoritative server tick.

---

Combat

The combat system supports:

FIRE
RELOAD
AIM
PROJECTILES
DAMAGE
HEALTH
ARMOR
AMMUNITION
RECOIL

A firing command follows:

INPUT
  ↓
COMMAND
  ↓
HFBT COMMAND FRAME
  ↓
SERVER VALIDATION
  ↓
GAMESTATE
  ↓
PROJECTILE
  ↓
COLLISION
  ↓
DAMAGE
  ↓
NEXT HFBT FRAME

---

Enemy Drone AI

The arena contains server-controlled drones.

Drone states include:

IDLE
PATROL
TRACK
ATTACK
EVADE
DESTROYED

Enemy movement and combat are authoritative server operations.

---

Objective System

The match maintains objective progress:

OBJECTIVE:
DATA CORE

PROGRESS:
0–100%

Objective state is transmitted as part of the HFBT game-state payload.

---

HFBT Frame Generation

A frame is generated after every authoritative gameplay tick.

GameState
    │
    ▼
State Snapshot
    │
    ▼
Render State
    │
    ▼
Runtime State
    │
    ▼
HFBT Serializer
    │
    ▼
Byte Payload
    │
    ▼
SHA-256
    │
    ▼
HFBT Frame

Example logical frame:

{
  protocol: "RCOREX-HF/1.1",

  transport:
    "HolographicFramesByteTransport",

  mode:
    "VIRTUAL_SIMULATION",

  frameId: 1842,

  timestamp: 1790870000000,

  tick: 1842,

  rays: 16384,

  gameState: {
    players: [],
    entities: [],
    world: {},
    events: []
  },

  renderData: {
    camera: {},
    lights: [],
    meshes: [],
    particles: [],
    hud: {}
  },

  audioData: {
    sampleRate: 48000,
    channels: 2,
    format: "PCM_S16LE"
  },

  inputAck: {
    commandId: 421,
    result: "ok"
  },

  checksum:
    "sha256..."
}

The actual transport implementation may encode this structure as a binary buffer rather than transmitting JSON directly.

---

Input Architecture

Raw keyboard/gamepad input is converted into commands.

KEYBOARD / GAMEPAD
        │
        ▼
ControllerInputHandler
        │
        ▼
InputToCommand
        │
        ▼
HFBT Command Serializer
        │
        ▼
HFBT COMMAND FRAME
        │
        ▼
SERVER

The browser does not directly mutate "GameState".

---

Testing Controls

Keyboard controls provide a controller-free testing path.

W       FORWARD
S       BACK
A       STRAFE LEFT
D       STRAFE RIGHT

Q       TURN LEFT
E       TURN RIGHT

SPACE   DASH
SHIFT   SPRINT

F       FIRE
R       RELOAD

1       ABILITY

Browser buttons provide the same command interface for testing.

---

Server-Sent Events

The browser can subscribe to:

GET /stream

The stream carries HFBT frame events.

Example:

event: FRAME
data: {...}

Additional runtime events may include:

STATE
EVENT
INPUT_ACK
RUNTIME

SSE is a delivery mechanism for the already-generated HFBT runtime frames; it is not a second gameplay-state authority.

---

Browser Client

The browser client contains:

HFBT Client
    │
    ▼
Frame Validation
    │
    ▼
Frame Deserialization
    │
    ▼
GameState Reconstruction
    │
    ├──────────────┐
    ▼              ▼
HUD State      Render State
    │              │
    └──────┬───────┘
           ▼
        Canvas

The canvas only consumes reconstructed frame data.

---

HUD

The browser HUD exposes:

PLAYER
HEALTH
ARMOR
ENERGY
STAMINA
SCORE

OBJECTIVE
DATA CORE %

TARGET
DISTANCE
WEAPON
AMMO

HFBT FRAME
FRAME ID
FRAME HASH
RAY COUNT
RUNTIME MODE

TELEMETRY
FPS
LATENCY
FRAME TIME
QUEUE

VECTOR
X
Y
Z
RX
RY
RZ

AUDIO
WORLD AUDIO
HFBT OVERLAY
RESONANCE

---

Runtime Telemetry

The HFBT runtime tracks:

generatedFrames
transportedFrames
droppedFrames
bytes
queue
fps
frameTime
latency
uptime

The runtime also maintains:

coherence
resonance
projectionStrength
vector
rayState
matrixState
projectionState
emitterStatus

---

Virtual Hardware Boundary

The current software runtime operates in:

MODE:
VIRTUAL_SIMULATION

Default physical state:

PHYSICAL_EMITTER:
FALSE

PHYSICAL_LASER_CONTROL:
FALSE

Therefore the runtime can generate and transport simulated HFBT ray/frame data without claiming that the Android device is physically emitting holographic or laser light.

---

Layered Audio

The runtime supports two logical audio layers:

LAYER 1
WORLD_AUDIO

LAYER 2
HFBT_OVERLAY

WORLD AUDIO
     │
     ├──────────────┐
     │              │
     ▼              ▼
GAME AUDIO      HFBT OVERLAY
     │              │
     └──────┬───────┘
            ▼
        AUDIO STATE
            │
            ▼
        HFBT FRAME

The current frame architecture describes the PCM audio state. Actual audible output requires a client audio sink.

---

API

Health

GET /health

Returns runtime health.

Example:

{
  "ok": true,
  "service": "CyberGame HFBT Server",
  "protocol": "RCOREX-HF/1.1"
}

---

Status

GET /status

Returns combined server, game, runtime, transport, and telemetry state.

---

Game

GET /game

Returns the current authoritative game snapshot.

---

Runtime

GET /runtime

Returns HFBT runtime state.

---

Stream

GET /stream

Opens the live HFBT event stream.

---

Create Player

GET /player/create

Creates a player session.

The resulting player ID is then used for input commands.

---

Input

POST /input

Example:

{
  "playerId": "player-001",
  "action": "forward",
  "pressed": true
}

The server converts this input into an HFBT command before applying it.

---

Command

POST /command

Accepts an explicit game command.

Example:

{
  "playerId": "player-001",
  "type": "FIRE",
  "sequence": 1042
}

---

Command Lifecycle

POST /input
      │
      ▼
Input Validator
      │
      ▼
InputToCommand
      │
      ▼
Command ID
      │
      ▼
HFBT Command Serialization
      │
      ▼
Command Queue
      │
      ▼
30 Hz Authoritative Tick
      │
      ▼
GameState
      │
      ▼
HFBT Frame
      │
      ▼
SSE / Network

---

Project Structure

cybergame-hfbt/
│
├── hfbt/
│   ├── protocol.js
│   ├── frame-serializer.js
│   ├── frame-deserializer.js
│   ├── command-serializer.js
│   ├── command-deserializer.js
│   ├── checksum.js
│   └── transport.js
│
├── engine/
│   ├── game-state.js
│   ├── physics-engine.js
│   ├── weapons-system.js
│   ├── projectile-engine.js
│   ├── player-controller.js
│   ├── enemy-ai.js
│   └── objective-system.js
│
├── runtime/
│   ├── hfbt-runtime.js
│   ├── runtime-coordinator.js
│   ├── quantum-tick.js
│   └── state-layer.js
│
├── rendering/
│   ├── frame-generator.js
│   ├── geometry-builder.js
│   ├── lod-system.js
│   └── hud-renderer.js
│
├── input/
│   ├── controller-input-handler.js
│   ├── input-to-command.js
│   ├── gamepad-controller.js
│   └── gamepad.sh
│
├── server/
│   ├── server.cjs
│   ├── match-manager.js
│   ├── network-sync.js
│   └── client-session.js
│
├── client/
│   ├── app.js
│   ├── hfbt-client.js
│   ├── state-reconstructor.js
│   ├── prediction-engine.js
│   ├── canvas-renderer.js
│   └── index.html
│
├── public/
│   ├── app.js
│   ├── styles.css
│   └── index.html
│
├── package.json
└── README.md

---

Quick Start

Install dependencies:

npm install

Start the server:

npm start

Open:

http://127.0.0.1:8787

Health:

http://127.0.0.1:8787/health

Runtime status:

http://127.0.0.1:8787/status

Game state:

http://127.0.0.1:8787/game

HFBT runtime:

http://127.0.0.1:8787/runtime

Live stream:

http://127.0.0.1:8787/stream

---

Runtime Guarantees

CyberGame follows the HFBT boundary:

INPUT
  ↓
COMMAND
  ↓
HFBT SERIALIZATION
  ↓
HFBT TRANSPORT
  ↓
SERVER DESERIALIZATION
  ↓
AUTHORITATIVE GAME TICK
  ↓
GAME STATE
  ↓
RENDER STATE
  ↓
HFBT SERIALIZATION
  ↓
HFBT TRANSPORT
  ↓
CLIENT DESERIALIZATION
  ↓
CLIENT STATE
  ↓
CANVAS / HUD

The architecture prohibits:

raw input → GameState

raw input → renderer

unverified network data → GameState

independent physics → GameState

independent render state → network

client prediction → authoritative state

---

Performance Target

FRAME RATE       30 FPS
GAME TICK        30 Hz
NETWORK TICK     20–30 Hz
MAX PLAYERS      16
HFBT RAYS        16,384
AUDIO            48 kHz / 2-channel
FRAME HISTORY    bounded
EVENT HISTORY    bounded
PROJECTILES      bounded
PARTICLES        LOD controlled

The 30 FPS / 30 Hz values are runtime targets. Actual achieved performance is reported through HFBT telemetry rather than assumed.

---

Core Runtime Principle

CyberGame is not a collection of independent rendering, input, physics, and networking paths.

It is one framed state pipeline:

                ┌───────────────┐
                │    INPUT      │
                └───────┬───────┘
                        ▼
                ┌───────────────┐
                │    COMMAND    │
                └───────┬───────┘
                        ▼
                ┌───────────────┐
                │     HFBT      │
                └───────┬───────┘
                        ▼
                ┌───────────────┐
                │  GAME STATE   │
                └───────┬───────┘
                        ▼
                ┌───────────────┐
                │    PHYSICS    │
                └───────┬───────┘
                        ▼
                ┌───────────────┐
                │ RENDER STATE  │
                └───────┬───────┘
                        ▼
                ┌───────────────┐
                │     HFBT      │
                └───────┬───────┘
                        ▼
                ┌───────────────┐
                │   NETWORK     │
                └───────┬───────┘
                        ▼
                ┌───────────────┐
                │ HFBT CLIENT   │
                └───────┬───────┘
                        ▼
                ┌───────────────┐
                │    CANVAS     │
                └───────────────┘

HolographicFramesByteTransport is the authoritative framing boundary for the CyberGame runtime.