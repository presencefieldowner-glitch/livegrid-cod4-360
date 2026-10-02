'use strict';

/*
 * ============================================================
 * CYBERGAME // HFBT ARENA
 * HolographicFramesByteTransport Runtime
 * RCOREX-HF/1.1
 *
 * Runtime responsibilities:
 *   - frame generation
 *   - state transport
 *   - SHA-256 frame integrity
 *   - ray-field metadata
 *   - projection state
 *   - vector state
 *   - resonance/coherence
 *   - layered audio metadata
 *   - runtime telemetry
 *   - virtual holographic transport
 *
 * HARDWARE BOUNDARY:
 *   This runtime does NOT claim to control a physical laser,
 *   optical emitter, or holographic projector.
 *
 *   Physical hardware remains:
 *     physicalLaserControl: false
 *     physicalOpticalEmitter: false
 * ============================================================
 */

const crypto = require('crypto');

const PROTOCOL = 'RCOREX-HF/1.1';

const TRANSPORT =
  'HolographicFramesByteTransport';

const MODE =
  'VIRTUAL_SIMULATION';

const RAYS = 16384;

const PHYSICAL_LASER_CONTROL = false;

const PHYSICAL_OPTICAL_EMITTER = false;

const AUDIO_SAMPLE_RATE = 48000;

const AUDIO_CHANNELS = 2;

const AUDIO_FORMAT =
  'PCM_S16LE';

const AUDIO_FRAME_MS = 100;

const AUDIO_FRAME_BYTES = 19200;


/* ============================================================
   UTILITY FUNCTIONS
   ============================================================ */

function now() {
  return Date.now();
}

function clone(value) {
  return JSON.parse(
    JSON.stringify(value)
  );
}

function finite(value, fallback = 0) {
  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function clamp(
  value,
  min,
  max
) {
  return Math.min(
    max,
    Math.max(min, value)
  );
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(
      typeof value === 'string'
        ? value
        : JSON.stringify(value)
    )
    .digest('hex');
}

function hashPrefix(
  hash,
  length = 16
) {
  return String(hash)
    .slice(0, length);
}

function vectorLength(vector) {
  return Math.hypot(
    finite(vector?.x),
    finite(vector?.y),
    finite(vector?.z)
  );
}

function normalizeVector(
  vector
) {
  const length =
    vectorLength(vector);

  if (length <= 0) {
    return {
      x: 0,
      y: 0,
      z: 1
    };
  }

  return {
    x: finite(vector.x) / length,
    y: finite(vector.y) / length,
    z: finite(vector.z) / length
  };
}


/* ============================================================
   HFBT RUNTIME
   ============================================================ */

class HFBTRuntime {
  constructor(options = {}) {
    this.protocol =
      PROTOCOL;

    this.transport =
      TRANSPORT;

    this.mode =
      MODE;

    this.rays =
      RAYS;

    this.frames = 0;

    this.startedAt =
      now();

    this.lastFrameAt =
      null;

    this.lastFrameHash =
      null;

    this.lastFrameHashPrefix =
      null;

    this.frameHistory = [];

    this.maxFrameHistory =
      120;

    this.status =
      'INITIALIZING';

    this.fieldStatus =
      'VIRTUAL';

    this.projectionState =
      'READY';

    this.emitterStatus =
      'DISABLED';

    this.rayState =
      'READY';

    this.matrixState =
      'MORPHMATRIX_READY';

    this.physicalLaserControl =
      PHYSICAL_LASER_CONTROL;

    this.physicalOpticalEmitter =
      PHYSICAL_OPTICAL_EMITTER;

    this.coherence =
      finite(
        options.coherence,
        0.7076129521834406
      );

    this.resonance =
      finite(
        options.resonance,
        0.4467788645683021
      );

    this.projectionStrength =
      clamp(
        finite(
          options.projectionStrength,
          0.82
        ),
        0,
        1
      );

    this.vector = {
      x: 0,
      y: 1.6,
      z: 26,

      rx: 0,
      ry: 0,
      rz: 0
    };

    this.audio = {
      enabled: true,

      sampleRate:
        AUDIO_SAMPLE_RATE,

      channels:
        AUDIO_CHANNELS,

      format:
        AUDIO_FORMAT,

      frameMs:
        AUDIO_FRAME_MS,

      frameBytes:
        AUDIO_FRAME_BYTES,

      layer1: {
        name: 'WORLD_AUDIO',

        enabled: true,

        gain: 0.72
      },

      layer2: {
        name: 'HFBT_OVERLAY',

        enabled: true,

        gain: 0.48,

        state: 'READY'
      },

      left: 0,

      right: 0,

      resonance:
        this.resonance
    };

    this.telemetry = {
      generatedFrames: 0,

      transportedFrames: 0,

      droppedFrames: 0,

      bytes: 0,

      queue: 0,

      fps: 0,

      frameTime: 0,

      latency: 0,

      lastFrameTimestamp: null,

      uptimeMs: 0
    };

    this.events = [];

    this.status =
      'ONLINE';

    this.event(
      'HFBT_RUNTIME_INITIALIZED',
      {
        protocol:
          this.protocol,

        transport:
          this.transport,

        mode:
          this.mode,

        rays:
          this.rays,

        physicalLaserControl:
          this.physicalLaserControl,

        physicalOpticalEmitter:
          this.physicalOpticalEmitter
      }
    );
  }


  /* ==========================================================
     EVENT JOURNAL
     ========================================================== */

  event(
    type,
    data = {}
  ) {
    const entry = {
      id:
        crypto.randomUUID(),

      type,

      timestamp:
        now(),

      frame:
        this.frames,

      data:
        clone(data)
    };

    this.events.push(
      entry
    );

    if (
      this.events.length > 200
    ) {
      this.events.shift();
    }

    return entry;
  }


  /* ==========================================================
     STATUS
     ========================================================== */

  getStatus() {
    this.telemetry.uptimeMs =
      now() -
      this.startedAt;

    return {
      available: true,

      ready:
        this.status === 'ONLINE',

      protocol:
        this.protocol,

      transport:
        this.transport,

      mode:
        this.mode,

      rays:
        this.rays,

      frames:
        this.frames,

      uptimeMs:
        this.telemetry.uptimeMs,

      physicalLaserControl:
        this.physicalLaserControl,

      physicalOpticalEmitter:
        this.physicalOpticalEmitter,

      emitterStatus:
        this.emitterStatus,

      fieldStatus:
        this.fieldStatus,

      projectionState:
        this.projectionState,

      rayState:
        this.rayState,

      matrixState:
        this.matrixState,

      coherence:
        this.coherence,

      resonance:
        this.resonance,

      projectionStrength:
        this.projectionStrength,

      vector:
        clone(this.vector),

      audio:
        clone(this.audio),

      telemetry:
        clone(this.telemetry),

      lastFrameHash:
        this.lastFrameHash,

      lastFrameHashPrefix:
        this.lastFrameHashPrefix
    };
  }


  /* ==========================================================
     UPDATE VECTOR
     ========================================================== */

  setVector(vector = {}) {
    this.vector = {
      x: finite(
        vector.x,
        this.vector.x
      ),

      y: finite(
        vector.y,
        this.vector.y
      ),

      z: finite(
        vector.z,
        this.vector.z
      ),

      rx: finite(
        vector.rx,
        this.vector.rx
      ),

      ry: finite(
        vector.ry,
        this.vector.ry
      ),

      rz: finite(
        vector.rz,
        this.vector.rz
      )
    };

    this.event(
      'VECTOR_UPDATED',
      {
        vector:
          clone(this.vector)
      }
    );

    return clone(
      this.vector
    );
  }


  /* ==========================================================
     UPDATE RESONANCE
     ========================================================== */

  setResonance(
    resonance
  ) {
    this.resonance =
      clamp(
        finite(
          resonance,
          this.resonance
        ),
        0,
        1
      );

    this.audio.resonance =
      this.resonance;

    this.event(
      'RESONANCE_UPDATED',
      {
        resonance:
          this.resonance
      }
    );

    return this.resonance;
  }


  /* ==========================================================
     UPDATE COHERENCE
     ========================================================== */

  setCoherence(
    coherence
  ) {
    this.coherence =
      clamp(
        finite(
          coherence,
          this.coherence
        ),
        0,
        1
      );

    this.event(
      'COHERENCE_UPDATED',
      {
        coherence:
          this.coherence
      }
    );

    return this.coherence;
  }


  /* ==========================================================
     UPDATE PROJECTION
     ========================================================== */

  setProjection(
    state = {}
  ) {
    this.projectionState =
      state.active === false
        ? 'READY'
        : 'ACTIVE';

    this.fieldStatus =
      state.field ||
      'VIRTUAL';

    this.projectionStrength =
      clamp(
        finite(
          state.strength,
          this.projectionStrength
        ),
        0,
        1
      );

    this.rayState =
      this.projectionState === 'ACTIVE'
        ? 'TRANSPORTING'
        : 'READY';

    this.event(
      'PROJECTION_UPDATED',
      {
        state:
          this.projectionState,

        field:
          this.fieldStatus,

        strength:
          this.projectionStrength
      }
    );

    return {
      state:
        this.projectionState,

      field:
        this.fieldStatus,

      strength:
        this.projectionStrength
    };
  }


  /* ==========================================================
     AUDIO STATE
     ========================================================== */

  setAudio(
    state = {}
  ) {
    if (
      state.enabled !== undefined
    ) {
      this.audio.enabled =
        Boolean(
          state.enabled
        );
    }

    if (
      state.layer1
    ) {
      this.audio.layer1 =
        {
          ...this.audio.layer1,
          ...state.layer1
        };
    }

    if (
      state.layer2
    ) {
      this.audio.layer2 =
        {
          ...this.audio.layer2,
          ...state.layer2
        };
    }

    this.audio.left =
      clamp(
        finite(
          state.left,
          this.audio.left
        ),
        0,
        1
      );

    this.audio.right =
      clamp(
        finite(
          state.right,
          this.audio.right
        ),
        0,
        1
      );

    this.audio.resonance =
      this.resonance;

    this.event(
      'AUDIO_STATE_UPDATED',
      {
        audio:
          clone(this.audio)
      }
    );

    return clone(
      this.audio
    );
  }


  /* ==========================================================
     LAYER 2 AUDIO OVERLAY
     ========================================================== */

  emitAudioOverlay(
    event = {}
  ) {
    const intensity =
      clamp(
        finite(
          event.intensity,
          0.5
        ),
        0,
        1
      );

    this.audio.layer2.state =
      'ACTIVE';

    this.audio.left =
      clamp(
        intensity *
          this.audio.layer2.gain,
        0,
        1
      );

    this.audio.right =
      clamp(
        intensity *
          this.audio.layer2.gain *
          0.92,
        0,
        1
      );

    this.audio.resonance =
      this.resonance;

    const result = {
      layer:
        'HFBT_OVERLAY',

      event:
        event.type ||
        'RUNTIME',

      intensity,

      left:
        this.audio.left,

      right:
        this.audio.right,

      resonance:
        this.audio.resonance,

      sampleRate:
        this.audio.sampleRate,

      channels:
        this.audio.channels,

      format:
        this.audio.format,

      frameMs:
        this.audio.frameMs,

      frameBytes:
        this.audio.frameBytes
    };

    this.event(
      'AUDIO_OVERLAY_EMITTED',
      result
    );

    return result;
  }


  /* ==========================================================
     BUILD FRAME
     ========================================================== */

  buildFrame(
    gameState
  ) {
    const frameStarted =
      now();

    this.frames += 1;

    const timestamp =
      now();

    const state =
      clone(
        gameState || {}
      );

    /*
     * If GameState already contains its own
     * runtime information, preserve it while
     * overlaying the authoritative transport
     * state generated here.
     */

    const runtimeState = {
      protocol:
        this.protocol,

      transport:
        this.transport,

      mode:
        this.mode,

      rays:
        this.rays,

      physicalLaserControl:
        this.physicalLaserControl,

      physicalOpticalEmitter:
        this.physicalOpticalEmitter,

      emitterStatus:
        this.emitterStatus,

      fieldStatus:
        this.fieldStatus,

      projectionState:
        this.projectionState,

      rayState:
        this.rayState,

      matrixState:
        this.matrixState,

      coherence:
        this.coherence,

      resonance:
        this.resonance,

      projectionStrength:
        this.projectionStrength,

      vector:
        clone(this.vector),

      audio:
        clone(this.audio)
    };

    const payload = {
      protocol:
        this.protocol,

      transport:
        this.transport,

      mode:
        this.mode,

      frameId:
        this.frames,

      timestamp,

      rays:
        this.rays,

      runtime:
        runtimeState,

      state
    };

    /*
     * Canonical serialized payload becomes
     * the integrity source for this frame.
     */

    const serialized =
      JSON.stringify(
        payload
      );

    const hash =
      sha256(
        serialized
      );

    const frameTime =
      now() -
      frameStarted;

    this.lastFrameAt =
      timestamp;

    this.lastFrameHash =
      hash;

    this.lastFrameHashPrefix =
      hashPrefix(hash);

    this.telemetry.generatedFrames += 1;

    this.telemetry.transportedFrames += 1;

    this.telemetry.bytes +=
      Buffer.byteLength(
        serialized,
        'utf8'
      );

    this.telemetry.frameTime =
      frameTime;

    this.telemetry.fps =
      frameTime > 0
        ? Math.round(
            1000 /
            frameTime
          )
        : 0;

    this.telemetry.lastFrameTimestamp =
      timestamp;

    this.telemetry.uptimeMs =
      timestamp -
      this.startedAt;

    /*
     * Keep a rolling frame history.
     */

    this.frameHistory.push({
      frame:
        this.frames,

      timestamp,

      hash,

      hashPrefix:
        this.lastFrameHashPrefix,

      bytes:
        Buffer.byteLength(
          serialized,
          'utf8'
        )
    });

    if (
      this.frameHistory.length >
      this.maxFrameHistory
    ) {
      this.frameHistory.shift();
    }

    this.projectionState =
      'ACTIVE';

    this.rayState =
      'TRANSPORTING';

    this.event(
      'FRAME_GENERATED',
      {
        frame:
          this.frames,

        rays:
          this.rays,

        hashPrefix:
          this.lastFrameHashPrefix,

        bytes:
          Buffer.byteLength(
            serialized,
            'utf8'
          )
      }
    );

    return {
      protocol:
        this.protocol,

      transport:
        this.transport,

      mode:
        this.mode,

      frame:
        this.frames,

      frameId:
        this.frames,

      timestamp,

      generatedAt:
        timestamp,

      rays:
        this.rays,

      hash,

      frameHash:
        hash,

      frameHashPrefix:
        this.lastFrameHashPrefix,

      bytes:
        Buffer.byteLength(
          serialized,
          'utf8'
        ),

      runtime:
        runtimeState,

      projection: {
        protocol:
          this.protocol,

        mode:
          this.mode,

        active:
          true,

        field:
          this.fieldStatus,

        coherence:
          this.coherence,

        resonance:
          this.resonance,

        strength:
          this.projectionStrength,

        rays:
          this.rays
      },

      vector:
        clone(this.vector),

      audio:
        clone(this.audio),

      state
    };
  }


  /* ==========================================================
     FRAME HISTORY
     ========================================================== */

  getFrameHistory(
    limit = 20
  ) {
    const count =
      Math.max(
        1,
        Math.min(
          finite(limit, 20),
          this.maxFrameHistory
        )
      );

    return this.frameHistory
      .slice(-count)
      .map(clone);
  }


  /* ==========================================================
     EVENT HISTORY
     ========================================================== */

  getEvents(
    limit = 20
  ) {
    const count =
      Math.max(
        1,
        Math.min(
          finite(limit, 20),
          200
        )
      );

    return this.events
      .slice(-count)
      .map(clone);
  }


  /* ==========================================================
     VERIFY FRAME
     ========================================================== */

  verifyFrame(
    frame
  ) {
    if (
      !frame ||
      !frame.hash
    ) {
      return {
        valid: false,

        reason:
          'MISSING_HASH'
      };
    }

    const reconstructed = {
      protocol:
        frame.protocol,

      transport:
        frame.transport,

      mode:
        frame.mode,

      frameId:
        frame.frameId ||
        frame.frame,

      timestamp:
        frame.timestamp,

      rays:
        frame.rays,

      runtime:
        frame.runtime,

      state:
        frame.state
    };

    const serialized =
      JSON.stringify(
        reconstructed
      );

    const calculatedHash =
      sha256(
        serialized
      );

    const valid =
      calculatedHash ===
      frame.hash;

    return {
      valid,

      expected:
        frame.hash,

      calculated:
        calculatedHash,

      expectedPrefix:
        hashPrefix(
          frame.hash
        ),

      calculatedPrefix:
        hashPrefix(
          calculatedHash
        )
    };
  }


  /* ==========================================================
     FRAME RESET
     ========================================================== */

  resetFrameTransport() {
    this.projectionState =
      'READY';

    this.rayState =
      'READY';

    this.audio.layer2.state =
      'READY';

    this.audio.left = 0;

    this.audio.right = 0;

    this.telemetry.queue = 0;

    this.event(
      'FRAME_TRANSPORT_RESET',
      {
        frame:
          this.frames
      }
    );

    return this.getStatus();
  }


  /* ==========================================================
     SHUTDOWN
     ========================================================== */

  shutdown() {
    this.status =
      'STOPPED';

    this.projectionState =
      'OFFLINE';

    this.fieldStatus =
      'OFFLINE';

    this.rayState =
      'OFFLINE';

    this.audio.layer2.state =
      'OFFLINE';

    this.event(
      'HFBT_RUNTIME_STOPPED',
      {
        frame:
          this.frames
      }
    );

    return this.getStatus();
  }
}


/* ============================================================
   EXPORTS
   ============================================================ */

module.exports = {
  HFBTRuntime,

  PROTOCOL,

  TRANSPORT,

  MODE,

  RAYS,

  AUDIO_SAMPLE_RATE,

  AUDIO_CHANNELS,

  AUDIO_FORMAT,

  AUDIO_FRAME_MS,

  AUDIO_FRAME_BYTES
};