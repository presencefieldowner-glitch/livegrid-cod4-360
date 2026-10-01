# LiveGrid COD4-360 Architecture

## Runtime Constraint

**All processing executes exclusively through HolographicFramesByteTransport (HFBT).**

No direct rendering, no direct input handling, no direct physics simulation.
Every operation is framed, serialized, and transmitted as HFBT byte payloads.

## Protocol Stack

```
Application Layer (Game Logic)
  ↓
RCOREX-HF/1.1 (Protocol Layer)
  ↓
HolographicFramesByteTransport (Transport Layer)
  ↓
Server Socket / Client Network
```

## Execution Model

### Server-Side
1. **GameState** - Authoritative world state
2. **HFBTFrameSerializer** - Converts state to HFBT byte frames
3. **ControllerInputHandler** - Consumes gamepad events via USB-C bridge
4. **InputToCommand** - Translates raw input to game commands
5. **PhysicsSimulation** - Updates all positions/velocities through frame ticks
6. **RenderFrameGenerator** - Produces visual frame data within HFBT protocol

### Client-Side
1. **HFBTFrameDeserializer** - Parses incoming byte frames
2. **GameStateReconstruct** - Rebuilds world from deserialized data
3. **ControllerInputCapture** - Captures gamepad button/analog states
4. **CommandSerializer** - Packages input as HFBT command frame
5. **ClientPrediction** - Local prediction until server confirmation
6. **CanvasRenderer** - Renders deserialized frame data to screen

## Frame Structure (HFBT)

Every frame is a serialized HFBT packet:

```
[HEADER]
  protocol: "RCOREX-HF/1.1"
  frameId: uint32
  timestamp: uint64
  transport: "HolographicFramesByteTransport"
  rays: uint16 (16384)

[PAYLOAD]
  gameState:
    players: [{id, pos, rot, health, weapon, state}]
    entities: [{id, type, pos, active}]
    world: {gravity, seed, environment}
    events: [{type, timestamp, data}]

  renderData:
    camera: {pos, rot, fov}
    lights: [{pos, color, intensity, range}]
    meshes: [{id, vertices, indices, textureId}]
    particles: [{type, pos, velocity, lifetime}]
    hud:
      minimap: {playerPos, enemies, objectives}
      killFeed: [{killer, victim, weapon, timestamp}]
      scoreBoard: [{player, kills, deaths, score}]
      weaponState: {current, ammo, reserve, attachments}

  inputAck:
    commandId: uint32
    result: "ok" | "dropped" | "retry"

[FOOTER]
  checksum: sha256
  serializedSize: uint32
```

## Controller Input → HFBT Command Flow

```
USB-C Gamepad
  ↓
Termux Input Bridge (/dev/input/eventX)
  ↓
gamepad.sh (getevent parser)
  ↓
ControllerInputHandler (server process)
  ↓
InputToCommand (X/O/Square/Triangle → move/aim/fire/reload)
  ↓
HFBT Command Frame (serialized)
  ↓
GameState.input() → PhysicsSimulation
  ↓
Updated positions/states in next HFBT frame
  ↓
HFBTFrameSerializer
  ↓
Client receives next frame (100ms latency max)
  ↓
CanvasRenderer paints
```

## No Bypass Principle

- **No direct WebGL calls outside HFBT context**
- **No raw input events processed without HFBT serialization**
- **No physics calculations outside frame tick**
- **No state mutations outside HFBTFrameDeserializer**

Every input, computation, and render operation is:
1. Serialized into HFBT protocol
2. Transmitted as byte frame
3. Deserialized on receive
4. Applied atomically to state
5. Reflected in next visual frame

## Performance Constraints (Xbox 360 equivalent)

- **GPU Memory**: 512 MB (simulated via LOD culling)
- **Frame Rate**: 30 FPS (HFBT tick rate)
- **Tick Rate**: 30 Hz (match loop updates)
- **Network Tick**: 20-30 Hz (input acknowledgment)
- **Max Players**: 16 per session
- **Ray Count**: 16,384 (HFBT optical simulation)

## File Structure

```
livegrid-cod4-360/
├── hfbt/
│   ├── frame-serializer.js      (HFBT byte encoding)
│   ├── frame-deserializer.js    (HFBT byte decoding)
│   ├── protocol.js              (RCOREX-HF/1.1 spec)
│   └── transport.js             (Socket/Stream handling)
├── engine/
│   ├── game-state.js            (Authoritative state)
│   ├── physics-engine.js        (Velocity/collision)
│   ├── weapons-system.js        (Recoil/ammo/attachments)
│   ├── player-controller.js     (Movement/animation)
│   └── killstreak-manager.js    (Rewards/progression)
├── rendering/
│   ├── frame-generator.js       (Canvas preparation)
│   ├── geometry-builder.js      (Mesh construction)
│   ├── shader-simulation.js     (Lighting/depth)
│   └── hud-renderer.js          (UI overlay)
├── input/
│   ├── gamepad-controller.js    (Button/analog mapping)
│   ├── input-handler.js         (Event parsing)
│   └── command-serializer.js    (→ HFBT frame)
├── server/
│   ├── cod4-server.js           (Main loop)
│   ├── match-manager.js         (Round/spawn logic)
│   └── network-sync.js          (Client acknowledgment)
└── client/
    ├── cod4-client.js           (Main loop)
    ├── prediction-engine.js     (Local prediction)
    └── console.html             (Canvas + HUD)
```

## Guarantee

**There is no side-channel rendering. There is no direct input processing.**

All state flows through HFBT serialization/deserialization.
