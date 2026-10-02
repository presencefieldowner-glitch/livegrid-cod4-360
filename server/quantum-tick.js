'use strict';

const crypto = require('crypto');

/**
 * ================================================================
 * QUANTUM TICK ENGINE
 * ROUNSAVILLE MORPHMATRIX PROCESSOR
 * ================================================================
 *
 * Runtime role:
 *
 *   GameState
 *       |
 *       v
 *   QuantumTickEngine
 *       |
 *       +--> RounsavilleProcessor[]
 *       |       |
 *       |       +--> 16D MorphVector state
 *       |       +--> velocity
 *       |       +--> acceleration
 *       |       +--> collision/wavefront state
 *       |
 *       +--> MorphMatrix transforms
 *       |
 *       +--> telemetry
 *       |
 *       +--> deterministic state hashes
 *       |
 *       v
 *   HFBTRuntime
 *       |
 *       v
 *   RCOREX-HF/1.1
 *
 * IMPORTANT:
 *   JavaScript timers cannot guarantee a physical 0.125 ms scheduler.
 *   This engine therefore treats 0.125 ms as the QUANTIZATION STEP,
 *   while the host scheduler supplies actual wall-clock execution.
 *
 * Architecture:
 *   - logical tick precision: 0.125 ms
 *   - nominal quantization frequency: 8000 Hz
 *   - morphmatrix dimensionality: 16D
 *   - processor state vector: 16D
 *   - collision detection: wavefront / radius threshold
 *   - state compression: delta + hash metadata
 *   - bounded history
 *   - deterministic transform pipeline
 *   - HFBT-compatible runtime telemetry
 */

const PROTOCOL = 'RCOREX-HF/1.1';
const TRANSPORT = 'HolographicFramesByteTransport';

const TICK_RATE_HZ = 8000;
const TICK_MS = 1000 / TICK_RATE_HZ;
const MORPH_DIM = 16;

const DEFAULT_COLLISION_RADIUS = 2.5;
const MAX_HISTORY = 512;
const MAX_COLLISIONS = 256;
const MAX_TICK_BUFFER = 2048;
const MAX_EVENTS = 512;

const EPSILON = 1e-12;

function now() {
  return Date.now();
}

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function cloneArray(values) {
  return Array.from(values || [], value => finite(value));
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(String(value))
    .digest('hex');
}

function hashPrefix(value, length = 16) {
  return sha256(value).slice(0, length);
}

function generateId(prefix = 'evt') {
  if (typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }

  return `${prefix}-${sha256(`${Date.now()}-${Math.random()}`).slice(0, 24)}`;
}

/**
 * ================================================================
 * MORPH VECTOR
 * ================================================================
 *
 * A fixed 16-dimensional state vector.
 *
 * First 8 dimensions preserve compatibility with the original
 * implementation:
 *
 *   [x,y,z,w,a,b,c,d]
 *
 * Additional dimensions:
 *
 *   [8]  resonance
 *   [9]  coherence
 *   [10] energy
 *   [11] phase
 *   [12] rotationX
 *   [13] rotationY
 *   [14] rotationZ
 *   [15] field
 */

class MorphVector {
  constructor(...values) {
    this.dims = new Array(MORPH_DIM).fill(0);

    for (let i = 0; i < MORPH_DIM; i++) {
      this.dims[i] = finite(values[i], 0);
    }
  }

  static zero() {
    return new MorphVector();
  }

  static from(values) {
    const vector = new MorphVector();

    for (let i = 0; i < MORPH_DIM; i++) {
      vector.dims[i] = finite(values?.[i], 0);
    }

    return vector;
  }

  static from8(x = 0, y = 0, z = 0, w = 0, a = 0, b = 0, c = 0, d = 0) {
    return new MorphVector(
      x, y, z, w, a, b, c, d
    );
  }

  clone() {
    return MorphVector.from(this.dims);
  }

  add(other) {
    const result = new MorphVector();

    for (let i = 0; i < MORPH_DIM; i++) {
      result.dims[i] =
        this.dims[i] +
        finite(other?.dims?.[i], 0);
    }

    return result;
  }

  subtract(other) {
    const result = new MorphVector();

    for (let i = 0; i < MORPH_DIM; i++) {
      result.dims[i] =
        this.dims[i] -
        finite(other?.dims?.[i], 0);
    }

    return result;
  }

  scale(scalar) {
    const s = finite(scalar, 0);

    const result = new MorphVector();

    for (let i = 0; i < MORPH_DIM; i++) {
      result.dims[i] = this.dims[i] * s;
    }

    return result;
  }

  multiply(other) {
    const result = new MorphVector();

    for (let i = 0; i < MORPH_DIM; i++) {
      result.dims[i] =
        this.dims[i] *
        finite(other?.dims?.[i], 0);
    }

    return result;
  }

  magnitudeSquared() {
    let sum = 0;

    for (let i = 0; i < MORPH_DIM; i++) {
      sum += this.dims[i] * this.dims[i];
    }

    return sum;
  }

  magnitude() {
    return Math.sqrt(this.magnitudeSquared());
  }

  normalize() {
    const magnitude = this.magnitude();

    if (magnitude <= EPSILON) {
      return MorphVector.zero();
    }

    return this.scale(1 / magnitude);
  }

  dot(other) {
    let result = 0;

    for (let i = 0; i < MORPH_DIM; i++) {
      result +=
        this.dims[i] *
        finite(other?.dims?.[i], 0);
    }

    return result;
  }

  distanceTo(other) {
    return this.subtract(other).magnitude();
  }

  lerp(other, alpha) {
    const t = clamp(finite(alpha, 0), 0, 1);

    return this.scale(1 - t).add(
      MorphVector.from(other?.dims || []).scale(t)
    );
  }

  deltaFrom(previous) {
    return this.subtract(previous);
  }

  toArray() {
    return this.dims.slice();
  }

  toJSON() {
    return this.toArray();
  }

  toHash() {
    return hashPrefix(
      this.dims
        .map(value => Number(value).toFixed(12))
        .join(',')
    );
  }

  fullHash() {
    return sha256(
      this.dims
        .map(value => Number(value).toFixed(12))
        .join(',')
    );
  }

  isFinite() {
    return this.dims.every(Number.isFinite);
  }
}

/**
 * ================================================================
 * ROUNSAVILLE PROCESSOR
 * ================================================================
 */

class RounsavilleProcessor {
  constructor(entityId, options = {}) {
    this.entityId = String(entityId);

    this.enabled = options.enabled !== false;

    this.state = MorphVector.from(
      ...(options.state || [])
    );

    this.velocity = MorphVector.from(
      ...(options.velocity || [])
    );

    this.acceleration = MorphVector.from(
      ...(options.acceleration || [])
    );

    this.previousState = this.state.clone();

    this.processorTick = 0;

    this.lastUpdateMs = 0;
    this.totalDeltaMs = 0;

    this.morphHistory = [];
    this.collisionEvents = [];

    this.forceCount = 0;
    this.collisionCount = 0;

    this.lastStateHash = this.state.toHash();
    this.lastDeltaHash = hashPrefix('zero');

    this.metadata = {
      processor: 'ROUNSAVILLE_PROCESSOR',
      architecture: 'MORPHMATRIX_16D',
      protocol: PROTOCOL
    };
  }

  reset() {
    this.state = MorphVector.zero();
    this.velocity = MorphVector.zero();
    this.acceleration = MorphVector.zero();

    this.previousState = this.state.clone();

    this.processorTick = 0;
    this.lastUpdateMs = 0;
    this.totalDeltaMs = 0;

    this.morphHistory.length = 0;
    this.collisionEvents.length = 0;

    this.forceCount = 0;
    this.collisionCount = 0;

    this.lastStateHash = this.state.toHash();
    this.lastDeltaHash = hashPrefix('zero');
  }

  applyForce(force) {
    if (!force) {
      return this.acceleration.clone();
    }

    const vector =
      force instanceof MorphVector
        ? force
        : MorphVector.from(force.dims || force);

    this.acceleration =
      this.acceleration.add(vector);

    this.forceCount += 1;

    return this.acceleration.clone();
  }

  applyImpulse(impulse) {
    if (!impulse) {
      return this.velocity.clone();
    }

    const vector =
      impulse instanceof MorphVector
        ? impulse
        : MorphVector.from(impulse.dims || impulse);

    this.velocity =
      this.velocity.add(vector);

    return this.velocity.clone();
  }

  updateState(deltaMs) {
    if (!this.enabled) {
      return;
    }

    const safeDeltaMs = Math.max(
      0,
      finite(deltaMs, 0)
    );

    const dt = safeDeltaMs / 1000;

    this.previousState =
      this.state.clone();

    /*
     * Velocity integration.
     */
    this.velocity =
      this.velocity.add(
        this.acceleration.scale(dt)
      );

    /*
     * Position / state integration.
     */
    this.state =
      this.state.add(
        this.velocity.scale(dt)
      );

    /*
     * Clear accumulated acceleration
     * after this processor step.
     */
    this.acceleration =
      MorphVector.zero();

    this.processorTick += 1;
    this.lastUpdateMs = safeDeltaMs;
    this.totalDeltaMs += safeDeltaMs;

    const delta =
      this.state.deltaFrom(
        this.previousState
      );

    this.lastStateHash =
      this.state.toHash();

    this.lastDeltaHash =
      delta.toHash();

    this.recordHistory(delta);
  }

  recordHistory(delta) {
    const record = {
      tick: this.processorTick,
      timestamp: now(),

      state: this.state.toArray(),
      velocity: this.velocity.toArray(),

      delta: delta.toArray(),

      stateHash: this.state.toHash(),
      deltaHash: delta.toHash()
    };

    this.morphHistory.push(record);

    while (
      this.morphHistory.length >
      MAX_HISTORY
    ) {
      this.morphHistory.shift();
    }
  }

  collideWith(other, distance, metadata = {}) {
    const safeDistance =
      Math.max(0, finite(distance));

    const event = {
      id: generateId('collision'),

      time: now(),

      tick: this.processorTick,

      entityA: this.entityId,
      entityB: String(other?.entityId ?? 'unknown'),

      distance: safeDistance,

      threshold:
        finite(
          metadata.threshold,
          DEFAULT_COLLISION_RADIUS
        ),

      penetration: Math.max(
        0,
        finite(metadata.threshold, DEFAULT_COLLISION_RADIUS) -
        safeDistance
      ),

      type: metadata.type || 'WAVEFRONT_COLLISION',

      hash: generateId('hash')
    };

    this.collisionEvents.push(event);

    while (
      this.collisionEvents.length >
      MAX_COLLISIONS
    ) {
      this.collisionEvents.shift();
    }

    this.collisionCount += 1;

    return event;
  }

  getRecentHistory(limit = 8) {
    const count = clamp(
      Math.floor(finite(limit, 8)),
      0,
      MAX_HISTORY
    );

    return this.morphHistory
      .slice(-count);
  }

  getSnapshot() {
    return {
      entityId: this.entityId,

      enabled: this.enabled,

      state: this.state.toArray(),

      velocity:
        this.velocity.toArray(),

      acceleration:
        this.acceleration.toArray(),

      previousState:
        this.previousState.toArray(),

      processorTick:
        this.processorTick,

      lastUpdateMs:
        this.lastUpdateMs,

      totalDeltaMs:
        this.totalDeltaMs,

      morphHash:
        this.state.toHash(),

      deltaHash:
        this.lastDeltaHash,

      forceCount:
        this.forceCount,

      collisionCount:
        this.collisionCount,

      recentCollisions:
        this.collisionEvents.slice(-8),

      recentHistory:
        this.getRecentHistory(4),

      metadata: {
        ...this.metadata
      }
    };
  }
}

/**
 * ================================================================
 * QUANTUM TICK ENGINE
 * ================================================================
 */

class QuantumTickEngine {
  constructor(options = {}) {
    this.protocol =
      options.protocol || PROTOCOL;

    this.transport =
      options.transport || TRANSPORT;

    this.tickRateHz =
      finite(
        options.tickRateHz,
        TICK_RATE_HZ
      );

    this.tickMs =
      1000 / this.tickRateHz;

    this.quantizationMs =
      finite(
        options.quantizationMs,
        TICK_MS
      );

    this.morphMatrixDim =
      MORPH_DIM;

    this.collisionRadius =
      finite(
        options.collisionRadius,
        DEFAULT_COLLISION_RADIUS
      );

    this.processors =
      new Map();

    this.globalTick = 0;

    this.lastTickTime =
      now();

    this.lastDeltaMs =
      0;

    this.totalRuntimeMs =
      0;

    this.tickBuffer = [];

    this.processorWavefront = [];

    this.events = [];

    this.metrics = {
      tickCount: 0,

      subTickCount: 0,

      processorUpdates: 0,

      collisionChecks: 0,

      collisions: 0,

      transforms: 0,

      droppedTicks: 0,

      totalProcessingMs: 0,

      maxProcessingMs: 0,

      lastProcessingMs: 0
    };

    this.startedAt =
      now();

    this.active =
      true;

    this.runtimeState = {
      engine: 'QUANTUM_TICK_ENGINE',

      processor: 'ROUNSAVILLE_PROCESSOR',

      matrix: 'MORPHMATRIX',

      dimensionality:
        this.morphMatrixDim,

      quantizationMs:
        this.quantizationMs,

      nominalTickRateHz:
        this.tickRateHz,

      status: 'ONLINE'
    };

    this.emitEvent(
      'QUANTUM_TICK_ENGINE_INITIALIZED',
      {
        tickRateHz: this.tickRateHz,

        quantizationMs:
          this.quantizationMs,

        morphMatrixDim:
          this.morphMatrixDim
      }
    );
  }

  emitEvent(type, data = {}) {
    const event = {
      id: generateId('qte'),

      type,

      timestamp: now(),

      globalTick:
        this.globalTick,

      data
    };

    this.events.push(event);

    while (
      this.events.length >
      MAX_EVENTS
    ) {
      this.events.shift();
    }

    return event;
  }

  registerProcessor(entityId, options = {}) {
    const id = String(entityId);

    if (this.processors.has(id)) {
      return this.processors.get(id);
    }

    const processor =
      new RounsavilleProcessor(
        id,
        options
      );

    this.processors.set(
      id,
      processor
    );

    this.emitEvent(
      'PROCESSOR_REGISTERED',
      {
        entityId: id
      }
    );

    return processor;
  }

  unregisterProcessor(entityId) {
    const id = String(entityId);

    const existed =
      this.processors.delete(id);

    if (existed) {
      this.emitEvent(
        'PROCESSOR_UNREGISTERED',
        {
          entityId: id
        }
      );
    }

    return existed;
  }

  getProcessor(entityId) {
    return this.processors.get(
      String(entityId)
    );
  }

  hasProcessor(entityId) {
    return this.processors.has(
      String(entityId)
    );
  }

  clearProcessors() {
    const count =
      this.processors.size;

    this.processors.clear();

    this.emitEvent(
      'PROCESSORS_CLEARED',
      {
        count
      }
    );
  }

  /**
   * --------------------------------------------------------------
   * MAIN TICK
   * --------------------------------------------------------------
   *
   * The engine subdivides the supplied wall-clock delta into
   * logical quantization steps.
   *
   * This does NOT claim that Node.js executed every 0.125 ms as a
   * real-time hardware interrupt. It processes the state using
   * that logical resolution.
   */
  tick(deltaMs) {
    if (!this.active) {
      return this.getStatus();
    }

    const start =
      process.hrtime.bigint();

    const currentTime =
      now();

    let safeDeltaMs =
      finite(
        deltaMs,
        currentTime - this.lastTickTime
      );

    safeDeltaMs =
      clamp(
        safeDeltaMs,
        0,
        1000
      );

    this.lastTickTime =
      currentTime;

    this.lastDeltaMs =
      safeDeltaMs;

    this.totalRuntimeMs +=
      safeDeltaMs;

    /*
     * Determine the logical number of
     * quantum subdivisions.
     */
    const subTicks =
      Math.max(
        1,
        Math.ceil(
          safeDeltaMs /
          this.quantizationMs
        )
      );

    const subDeltaMs =
      safeDeltaMs /
      subTicks;

    for (
      let i = 0;
      i < subTicks;
      i++
    ) {
      this.globalTick += 1;

      this.metrics.tickCount += 1;

      this.metrics.subTickCount += 1;

      /*
       * Update every registered processor.
       */
      for (
        const processor
        of this.processors.values()
      ) {
        processor.updateState(
          subDeltaMs
        );

        this.metrics.processorUpdates += 1;
      }

      /*
       * Wavefront collision pass.
       */
      this.detectWavefrontCollisions();

      /*
       * Capture the quantum state.
       */
      const processorSnapshots =
        Array.from(
          this.processors.values()
        ).map(
          processor =>
            processor.getSnapshot()
        );

      this.tickBuffer.push({
        globalTick:
          this.globalTick,

        timestamp:
          now(),

        deltaMs:
          subDeltaMs,

        processorSnapshots
      });

      while (
        this.tickBuffer.length >
        MAX_TICK_BUFFER
      ) {
        this.tickBuffer.shift();
      }
    }

    const processingMs =
      Number(
        process.hrtime.bigint() -
        start
      ) / 1e6;

    this.metrics.lastProcessingMs =
      processingMs;

    this.metrics.totalProcessingMs +=
      processingMs;

    this.metrics.maxProcessingMs =
      Math.max(
        this.metrics.maxProcessingMs,
        processingMs
      );

    this.emitEvent(
      'QUANTUM_TICK',
      {
        deltaMs: safeDeltaMs,

        subTicks,

        subDeltaMs,

        processorCount:
          this.processors.size
      }
    );

    return this.getStatus();
  }

  /**
   * --------------------------------------------------------------
   * WAVEFRONT COLLISION ENGINE
   * --------------------------------------------------------------
   */

  detectWavefrontCollisions() {
    const entities =
      Array.from(
        this.processors.values()
      );

    this.processorWavefront =
      entities.map(processor => ({
        entityId:
          processor.entityId,

        position:
          processor.state.toArray(),

        velocity:
          processor.velocity.toArray(),

        magnitude:
          processor.state.magnitude(),

        hash:
          processor.state.toHash()
      }));

    for (
      let i = 0;
      i < entities.length;
      i++
    ) {
      for (
        let j = i + 1;
        j < entities.length;
        j++
      ) {
        const a = entities[i];
        const b = entities[j];

        this.metrics.collisionChecks += 1;

        const posDiff =
          a.state.subtract(
            b.state
          );

        const distance =
          posDiff.magnitude();

        if (
          distance <=
          this.collisionRadius
        ) {
          const event =
            a.collideWith(
              b,
              distance,
              {
                threshold:
                  this.collisionRadius
              }
            );

          b.collideWith(
            a,
            distance,
            {
              threshold:
                this.collisionRadius
            }
          );

          this.metrics.collisions += 1;

          this.emitEvent(
            'WAVEFRONT_COLLISION',
            event
          );
        }
      }
    }
  }

  /**
   * --------------------------------------------------------------
   * MORPH MATRIX TRANSFORM
   * --------------------------------------------------------------
   *
   * Accepts:
   *
   *   [
   *     [ ...16 values ],
   *     [ ...16 values ],
   *     ...
   *   ]
   *
   * Missing values are treated as zero.
   */

  morphMatrixTransform(
    entityId,
    transformMatrix
  ) {
    const processor =
      this.getProcessor(entityId);

    if (!processor) {
      return null;
    }

    const state =
      processor.state.dims;

    const matrix =
      Array.isArray(transformMatrix)
        ? transformMatrix
        : [];

    const transformed =
      new Array(
        this.morphMatrixDim
      ).fill(0);

    for (
      let i = 0;
      i < this.morphMatrixDim;
      i++
    ) {
      const row =
        Array.isArray(matrix[i])
          ? matrix[i]
          : [];

      for (
        let j = 0;
        j < this.morphMatrixDim;
        j++
      ) {
        transformed[i] +=
          finite(row[j], 0) *
          finite(state[j], 0);
      }
    }

    this.metrics.transforms += 1;

    const result =
      MorphVector.from(
        transformed
      );

    this.emitEvent(
      'MORPHMATRIX_TRANSFORM',
      {
        entityId:
          String(entityId),

        hash:
          result.toHash()
      }
    );

    return result.toArray();
  }

  /**
   * --------------------------------------------------------------
   * TRANSFORM + COMMIT
   * --------------------------------------------------------------
   */

  applyMorphTransform(
    entityId,
    transformMatrix
  ) {
    const processor =
      this.getProcessor(entityId);

    if (!processor) {
      return null;
    }

    const transformed =
      this.morphMatrixTransform(
        entityId,
        transformMatrix
      );

    if (!transformed) {
      return null;
    }

    processor.state =
      MorphVector.from(
        transformed
      );

    processor.lastStateHash =
      processor.state.toHash();

    this.emitEvent(
      'MORPH_STATE_COMMITTED',
      {
        entityId:
          String(entityId),

        morphHash:
          processor.state.toHash()
      }
    );

    return processor.getSnapshot();
  }

  /**
   * --------------------------------------------------------------
   * FORCE / IMPULSE
   * --------------------------------------------------------------
   */

  applyForce(entityId, force) {
    const processor =
      this.getProcessor(entityId);

    if (!processor) {
      return null;
    }

    const vector =
      force instanceof MorphVector
        ? force
        : MorphVector.from(
            force?.dims || force
          );

    return processor.applyForce(
      vector
    );
  }

  applyImpulse(entityId, impulse) {
    const processor =
      this.getProcessor(entityId);

    if (!processor) {
      return null;
    }

    const vector =
      impulse instanceof MorphVector
        ? impulse
        : MorphVector.from(
            impulse?.dims || impulse
          );

    return processor.applyImpulse(
      vector
    );
  }

  /**
   * --------------------------------------------------------------
   * STATE DELTA
   * --------------------------------------------------------------
   */

  getDelta(entityId) {
    const processor =
      this.getProcessor(entityId);

    if (!processor) {
      return null;
    }

    return processor.state
      .deltaFrom(
        processor.previousState
      )
      .toArray();
  }

  /**
   * --------------------------------------------------------------
   * SNAPSHOT
   * --------------------------------------------------------------
   */

  getSnapshot() {
    return {
      protocol:
        this.protocol,

      transport:
        this.transport,

      engine:
        this.runtimeState.engine,

      processor:
        this.runtimeState.processor,

      matrix:
        this.runtimeState.matrix,

      dimensionality:
        this.morphMatrixDim,

      tickRateHz:
        this.tickRateHz,

      quantizationMs:
        this.quantizationMs,

      globalTick:
        this.globalTick,

      active:
        this.active,

      processorCount:
        this.processors.size,

      processors:
        Array.from(
          this.processors.values()
        ).map(
          processor =>
            processor.getSnapshot()
        ),

      wavefront:
        this.processorWavefront,

      metrics:
        {
          ...this.metrics
        }
    };
  }

  /**
   * --------------------------------------------------------------
   * STATUS
   * --------------------------------------------------------------
   */

  getStatus() {
    const uptimeMs =
      now() -
      this.startedAt;

    const averageProcessingMs =
      this.metrics.tickCount > 0
        ? this.metrics.totalProcessingMs /
          this.metrics.tickCount
        : 0;

    return {
      protocol:
        this.protocol,

      transport:
        this.transport,

      engine:
        'QUANTUM_TICK_ENGINE',

      processor:
        'ROUNSAVILLE_PROCESSOR',

      status:
        this.active
          ? 'ONLINE'
          : 'STOPPED',

      active:
        this.active,

      globalTick:
        this.globalTick,

      tickRateHz:
        this.tickRateHz,

      tickMs:
        Number(
          this.tickMs.toFixed(6)
        ),

      quantizationMs:
        Number(
          this.quantizationMs.toFixed(6)
        ),

      morphMatrixDim:
        this.morphMatrixDim,

      processorCount:
        this.processors.size,

      tickBufferSize:
        this.tickBuffer.length,

      eventBufferSize:
        this.events.length,

      collisionRadius:
        this.collisionRadius,

      uptimeMs,

      metrics: {
        ...this.metrics,

        averageProcessingMs:
          Number(
            averageProcessingMs.toFixed(6)
          )
      }
    };
  }

  /**
   * --------------------------------------------------------------
   * HISTORY
   * --------------------------------------------------------------
   */

  getTickHistory(limit = 32) {
    const count =
      clamp(
        Math.floor(
          finite(limit, 32)
        ),
        0,
        MAX_TICK_BUFFER
      );

    return this.tickBuffer
      .slice(-count);
  }

  getEvents(limit = 32) {
    const count =
      clamp(
        Math.floor(
          finite(limit, 32)
        ),
        0,
        MAX_EVENTS
      );

    return this.events
      .slice(-count);
  }

  getProcessorHistory(
    entityId,
    limit = 32
  ) {
    const processor =
      this.getProcessor(entityId);

    if (!processor) {
      return [];
    }

    return processor
      .getRecentHistory(limit);
  }

  /**
   * --------------------------------------------------------------
   * FRAME-READY STATE
   * --------------------------------------------------------------
   *
   * This produces a compact state package suitable for passing
   * into HFBTRuntime.buildFrame().
   */

  buildRuntimeState() {
    const processorStates =
      Array.from(
        this.processors.values()
      ).map(
        processor => ({
          entityId:
            processor.entityId,

          state:
            processor.state.toArray(),

          velocity:
            processor.velocity.toArray(),

          stateHash:
            processor.state.toHash(),

          deltaHash:
            processor.lastDeltaHash
        })
      );

    const serialized =
      JSON.stringify(
        processorStates
      );

    return {
      protocol:
        this.protocol,

      transport:
        this.transport,

      engine:
        'QUANTUM_TICK_ENGINE',

      processor:
        'ROUNSAVILLE_PROCESSOR',

      matrix:
        'MORPHMATRIX_16D',

      globalTick:
        this.globalTick,

      processorCount:
        processorStates.length,

      processors:
        processorStates,

      wavefront:
        this.processorWavefront,

      stateHash:
        hashPrefix(
          serialized,
          32
        ),

      generatedAt:
        now()
    };
  }

  /**
   * --------------------------------------------------------------
   * RESET
   * --------------------------------------------------------------
   */

  reset() {
    for (
      const processor
      of this.processors.values()
    ) {
      processor.reset();
    }

    this.globalTick = 0;

    this.lastTickTime =
      now();

    this.lastDeltaMs = 0;

    this.totalRuntimeMs = 0;

    this.tickBuffer.length = 0;

    this.processorWavefront.length = 0;

    this.metrics = {
      tickCount: 0,
      subTickCount: 0,
      processorUpdates: 0,
      collisionChecks: 0,
      collisions: 0,
      transforms: 0,
      droppedTicks: 0,
      totalProcessingMs: 0,
      maxProcessingMs: 0,
      lastProcessingMs: 0
    };

    this.emitEvent(
      'QUANTUM_ENGINE_RESET'
    );

    return this.getStatus();
  }

  /**
   * --------------------------------------------------------------
   * STOP / START
   * --------------------------------------------------------------
   */

  stop() {
    this.active = false;

    this.runtimeState.status =
      'STOPPED';

    this.emitEvent(
      'QUANTUM_ENGINE_STOPPED'
    );

    return this.getStatus();
  }

  start() {
    this.active = true;

    this.lastTickTime =
      now();

    this.runtimeState.status =
      'ONLINE';

    this.emitEvent(
      'QUANTUM_ENGINE_STARTED'
    );

    return this.getStatus();
  }
}

/**
 * ================================================================
 * EXPORTS
 * ================================================================
 */

module.exports = {
  QuantumTickEngine,
  RounsavilleProcessor,
  MorphVector,

  PROTOCOL,
  TRANSPORT,

  TICK_RATE_HZ,
  TICK_MS,

  MORPH_DIM,

  DEFAULT_COLLISION_RADIUS
};