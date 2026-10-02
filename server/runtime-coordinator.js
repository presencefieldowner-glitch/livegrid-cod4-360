'use strict';

/**
 * ================================================================
 * ROUNSAVILLE RUNTIME COORDINATOR
 * ================================================================
 *
 * Runtime pipeline:
 *
 *   GameState
 *       |
 *       v
 *   RuntimeCoordinator
 *       |
 *       +--> ProcessorRegistry
 *       |
 *       +--> QuantumTickEngine
 *       |       |
 *       |       +--> 16D MorphVector
 *       |       +--> RounsavilleProcessor
 *       |       +--> quantum sub-ticks
 *       |
 *       +--> WavefrontCollisionDetector
 *       |
 *       +--> StateLayer
 *       |
 *       +--> HFBTSerializer
 *       |
 *       v
 *   HFBTRuntime
 *       |
 *       v
 *   RCOREX-HF/1.1
 *
 * This coordinator does not claim physical holographic emission.
 * Physical emitter state remains controlled by HFBTRuntime.
 */

const crypto = require('crypto');

const {
  QuantumTickEngine,
  MorphVector,
  PROTOCOL,
  TRANSPORT,
  MORPH_DIM
} = require('./quantum-tick');

const {
  ProcessorRegistry
} = require('./processor-registry');

const {
  WavefrontCollisionDetector
} = require('./collision-layer');

const {
  StateLayer
} = require('./state-layer');

const {
  HFBTSerializer
} = require('./serialization-layer');

const MAX_FRAME_HISTORY = 256;
const MAX_ERROR_HISTORY = 128;

const DEFAULT_DELTA_MS = 16.6667;

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

function hash(value) {
  return crypto
    .createHash('sha256')
    .update(
      typeof value === 'string'
        ? value
        : JSON.stringify(value)
    )
    .digest('hex');
}

function safeClone(value) {
  if (value === undefined) {
    return undefined;
  }

  try {
    return JSON.parse(
      JSON.stringify(value)
    );
  } catch {
    return value;
  }
}

class RuntimeCoordinator {
  constructor(gameState, hfbtRuntime, options = {}) {
    this.gameState = gameState;
    this.hfbtRuntime = hfbtRuntime;

    this.protocol =
      options.protocol ||
      PROTOCOL ||
      'RCOREX-HF/1.1';

    this.transport =
      options.transport ||
      TRANSPORT ||
      'HolographicFramesByteTransport';

    this.quantum =
      options.quantum ||
      new QuantumTickEngine(
        options.quantumOptions || {}
      );

    this.registry =
      options.registry ||
      new ProcessorRegistry();

    this.collision =
      options.collision ||
      new WavefrontCollisionDetector();

    this.state =
      options.state ||
      new StateLayer();

    this.serializer =
      options.serializer ||
      new HFBTSerializer();

    this.entityMetadata =
      new Map();

    this.frameHistory =
      [];

    this.frameIndex =
      0;

    this.startedAt =
      now();

    this.lastTickAt =
      this.startedAt;

    this.lastFrame =
      null;

    this.lastCollision =
      null;

    this.lastSnapshot =
      null;

    this.lastError =
      null;

    this.errorHistory =
      [];

    this.metrics = {
      ticks: 0,
      frames: 0,

      registeredEntities: 0,
      activeEntities: 0,

      playerSyncs: 0,
      enemySyncs: 0,

      collisions: 0,

      serializationFailures: 0,
      quantumFailures: 0,
      collisionFailures: 0,
      stateFailures: 0,

      totalTickMs: 0,
      maxTickMs: 0,
      lastTickMs: 0
    };

    this.runtimeState = {
      protocol: this.protocol,
      transport: this.transport,

      coordinator:
        'ROUNSAVILLE_RUNTIME_COORDINATOR',

      architecture:
        'GAMESTATE_MORPHMATRIX_HFBT_PIPELINE',

      dimensionality:
        MORPH_DIM || 16,

      status:
        'ONLINE',

      startedAt:
        this.startedAt
    };
  }

  /**
   * ================================================================
   * INTERNAL EVENT / ERROR HANDLING
   * ================================================================
   */

  recordError(stage, error) {
    const record = {
      stage,
      message:
        error?.message ||
        String(error),

      timestamp:
        now(),

      frameIndex:
        this.frameIndex
    };

    this.lastError =
      record;

    this.errorHistory.push(
      record
    );

    while (
      this.errorHistory.length >
      MAX_ERROR_HISTORY
    ) {
      this.errorHistory.shift();
    }

    return record;
  }

  emitRuntimeEvent(type, data = {}) {
    if (
      this.hfbtRuntime &&
      typeof this.hfbtRuntime.event === 'function'
    ) {
      try {
        return this.hfbtRuntime.event(
          type,
          {
            coordinator:
              'ROUNSAVILLE_RUNTIME_COORDINATOR',

            frameIndex:
              this.frameIndex,

            ...data
          }
        );
      } catch (error) {
        this.recordError(
          'runtime-event',
          error
        );
      }
    }

    return null;
  }

  /**
   * ================================================================
   * ENTITY REGISTRATION
   * ================================================================
   */

  registerEntity(
    entityId,
    entityType,
    initialState = {}
  ) {
    const id =
      String(entityId);

    const metadata = {
      id,

      type:
        entityType ||
        'UNKNOWN',

      state:
        initialState.state ||
        'ACTIVE',

      createdAt:
        now(),

      lastUpdate:
        now(),

      source:
        initialState.source ||
        'GAME_STATE'
    };

    this.entityMetadata.set(
      id,
      metadata
    );

    let processor = null;

    try {
      processor =
        this.registry.register(
          id,
          entityType,
          initialState
        );
    } catch (error) {
      this.recordError(
        'processor-registry-register',
        error
      );
    }

    /*
     * Register with the quantum processor layer.
     */
    let quantumProcessor =
      this.quantum.getProcessor(id);

    if (!quantumProcessor) {
      try {
        quantumProcessor =
          this.quantum.registerProcessor(
            id,
            {
              state:
                this.buildMorphState(
                  initialState
                )
            }
          );
      } catch (error) {
        this.recordError(
          'quantum-register',
          error
        );
      }
    }

    /*
     * Explicitly synchronize initial state.
     */
    if (quantumProcessor) {
      quantumProcessor.state =
        this.buildMorphState(
          initialState
        );

      quantumProcessor.previousState =
        quantumProcessor.state.clone();

      quantumProcessor.lastStateHash =
        quantumProcessor.state.toHash();
    }

    this.metrics.registeredEntities =
      this.entityMetadata.size;

    this.emitRuntimeEvent(
      'ENTITY_REGISTERED',
      {
        entityId: id,
        entityType:
          metadata.type
      }
    );

    return processor || quantumProcessor;
  }

  unregisterEntity(entityId) {
    const id =
      String(entityId);

    const metadata =
      this.entityMetadata.get(id);

    let registryResult =
      false;

    let quantumResult =
      false;

    try {
      if (
        typeof this.registry.unregister ===
        'function'
      ) {
        registryResult =
          this.registry.unregister(id);
      } else if (
        this.registry.processors
      ) {
        registryResult =
          this.registry.processors.delete(id);
      }
    } catch (error) {
      this.recordError(
        'processor-registry-unregister',
        error
      );
    }

    try {
      quantumResult =
        this.quantum.unregisterProcessor
          ? this.quantum.unregisterProcessor(id)
          : false;
    } catch (error) {
      this.recordError(
        'quantum-unregister',
        error
      );
    }

    this.entityMetadata.delete(id);

    this.metrics.registeredEntities =
      this.entityMetadata.size;

    this.emitRuntimeEvent(
      'ENTITY_UNREGISTERED',
      {
        entityId: id,
        existed:
          Boolean(metadata)
      }
    );

    return (
      registryResult ||
      quantumResult ||
      Boolean(metadata)
    );
  }

  /**
   * ================================================================
   * MORPH STATE CONSTRUCTION
   * ================================================================
   *
   * 16D layout:
   *
   * [0]  x
   * [1]  y
   * [2]  z
   * [3]  w / orientation
   * [4]  health
   * [5]  energy
   * [6]  stamina
   * [7]  score
   * [8]  resonance
   * [9]  coherence
   * [10] velocityX
   * [11] velocityY
   * [12] velocityZ
   * [13] rotationX
   * [14] rotationY
   * [15] rotationZ
   */

  buildMorphState(source = {}) {
    const resonance =
      finite(
        source.resonance,
        this.hfbtRuntime?.resonance ??
        0
      );

    const coherence =
      finite(
        source.coherence,
        this.hfbtRuntime?.coherence ??
        0
      );

    return new MorphVector(
      finite(source.x),
      finite(source.y),
      finite(source.z),

      finite(
        source.w,
        source.yaw || 0
      ),

      finite(source.health),
      finite(source.energy),
      finite(source.stamina),
      finite(source.score),

      resonance,
      coherence,

      finite(
        source.velocityX,
        source.vx
      ),

      finite(
        source.velocityY,
        source.vy
      ),

      finite(
        source.velocityZ,
        source.vz
      ),

      finite(
        source.rotationX,
        source.rx
      ),

      finite(
        source.rotationY,
        source.ry
      ),

      finite(
        source.rotationZ,
        source.rz
      )
    );
  }

  /**
   * ================================================================
   * GAME STATE -> MORPHMATRIX SYNCHRONIZATION
   * ================================================================
   */

  syncFromGame() {
    if (!this.gameState) {
      return;
    }

    /*
     * --------------------------------------------------------------
     * PLAYERS
     * --------------------------------------------------------------
     */

    if (
      this.gameState.players &&
      typeof this.gameState.players.values ===
        'function'
    ) {
      for (
        const player
        of this.gameState.players.values()
      ) {
        if (!player?.id) {
          continue;
        }

        const id =
          String(player.id);

        let processor =
          this.quantum.getProcessor(id);

        if (!processor) {
          this.registerEntity(
            id,
            'PLAYER',
            player
          );

          processor =
            this.quantum.getProcessor(id);
        }

        if (!processor) {
          continue;
        }

        /*
         * Do not replace velocity/acceleration
         * while the quantum engine is operating.
         *
         * GameState remains authoritative for
         * gameplay position and resources.
         */
        processor.state =
          this.buildMorphState(
            player
          );

        processor.previousState =
          processor.state.clone();

        processor.lastStateHash =
          processor.state.toHash();

        const metadata =
          this.entityMetadata.get(id);

        if (metadata) {
          metadata.type =
            'PLAYER';

          metadata.state =
            player.state ||
            'ACTIVE';

          metadata.lastUpdate =
            now();
        }

        this.metrics.playerSyncs += 1;
      }
    }

    /*
     * --------------------------------------------------------------
     * ENEMIES
     * --------------------------------------------------------------
     */

    if (
      this.gameState.enemies &&
      typeof this.gameState.enemies.values ===
        'function'
    ) {
      for (
        const enemy
        of this.gameState.enemies.values()
      ) {
        if (!enemy?.id) {
          continue;
        }

        const id =
          String(enemy.id);

        let processor =
          this.quantum.getProcessor(id);

        if (!processor) {
          this.registerEntity(
            id,
            'ENEMY',
            enemy
          );

          processor =
            this.quantum.getProcessor(id);
        }

        if (!processor) {
          continue;
        }

        processor.state =
          this.buildMorphState({
            ...enemy,

            energy:
              finite(
                enemy.energy,
                enemy.speed
              ),

            stamina:
              enemy.state === 'TRACK'
                ? 1
                : 0,

            score:
              finite(enemy.score)
          });

        processor.previousState =
          processor.state.clone();

        processor.lastStateHash =
          processor.state.toHash();

        const metadata =
          this.entityMetadata.get(id);

        if (metadata) {
          metadata.type =
            'ENEMY';

          metadata.state =
            enemy.state ||
            'ACTIVE';

          metadata.lastUpdate =
            now();
        }

        this.metrics.enemySyncs += 1;
      }
    }

    this.reconcileEntities();
  }

  /**
   * Remove quantum processors whose entities
   * no longer exist in GameState.
   */
  reconcileEntities() {
    const liveIds =
      new Set();

    if (
      this.gameState?.players &&
      typeof this.gameState.players.keys ===
        'function'
    ) {
      for (
        const id
        of this.gameState.players.keys()
      ) {
        liveIds.add(
          String(id)
        );
      }
    }

    if (
      this.gameState?.enemies &&
      typeof this.gameState.enemies.keys ===
        'function'
    ) {
      for (
        const id
        of this.gameState.enemies.keys()
      ) {
        liveIds.add(
          String(id)
        );
      }
    }

    for (
      const id
      of this.entityMetadata.keys()
    ) {
      if (!liveIds.has(id)) {
        this.unregisterEntity(id);
      }
    }

    this.metrics.activeEntities =
      liveIds.size;
  }

  /**
   * ================================================================
   * PROCESSOR COLLECTION
   * ================================================================
   */

  getProcessors() {
    try {
      if (
        this.registry &&
        typeof this.registry.getAll ===
          'function'
      ) {
        const processors =
          this.registry.getAll();

        if (Array.isArray(processors)) {
          return processors;
        }
      }
    } catch (error) {
      this.recordError(
        'registry-get-all',
        error
      );
    }

    if (
      this.registry?.processors instanceof Map
    ) {
      return Array.from(
        this.registry.processors.values()
      );
    }

    if (
      this.quantum?.processors instanceof Map
    ) {
      return Array.from(
        this.quantum.processors.values()
      );
    }

    return [];
  }

  /**
   * ================================================================
   * COLLISION PROCESSING
   * ================================================================
   */

  detectCollisions(processors) {
    try {
      if (
        this.collision &&
        typeof this.collision.detect ===
          'function'
      ) {
        const result =
          this.collision.detect(
            processors
          );

        this.lastCollision =
          result;

        if (
          Array.isArray(result)
        ) {
          this.metrics.collisions +=
            result.length;
        } else if (
          Number.isFinite(
            result?.count
          )
        ) {
          this.metrics.collisions +=
            result.count;
        }

        return result;
      }
    } catch (error) {
      this.metrics.collisionFailures += 1;

      this.recordError(
        'collision-detection',
        error
      );
    }

    return [];
  }

  /**
   * ================================================================
   * STATE SNAPSHOT
   * ================================================================
   */

  createStateSnapshot() {
    try {
      if (
        this.state &&
        typeof this.state.createSnapshot ===
          'function'
      ) {
        return this.state.createSnapshot(
          this.frameIndex,
          now(),
          this.registry,
          this.entityMetadata
        );
      }
    } catch (error) {
      this.metrics.stateFailures += 1;

      this.recordError(
        'state-snapshot',
        error
      );
    }

    return {
      frameIndex:
        this.frameIndex,

      timestamp:
        now(),

      entities:
        Array.from(
          this.entityMetadata.entries()
        ).map(
          ([id, metadata]) => ({
            id,
            ...metadata
          })
        )
    };
  }

  /**
   * ================================================================
   * SERIALIZATION
   * ================================================================
   */

  serializeFrame(
    snapshot,
    collision
  ) {
    try {
      if (
        this.serializer &&
        typeof this.serializer.serialize ===
          'function'
      ) {
        return this.serializer.serialize(
          this.gameState,
          snapshot,
          collision,
          this.hfbtRuntime
        );
      }
    } catch (error) {
      this.metrics.serializationFailures += 1;

      this.recordError(
        'serialization',
        error
      );

      /*
       * Continue with a coordinator-level
       * emergency frame rather than destroying
       * the runtime loop.
       */
    }

    return this.buildFallbackFrame(
      snapshot,
      collision
    );
  }

  buildFallbackFrame(
    snapshot,
    collision
  ) {
    const quantumState =
      this.quantum.buildRuntimeState
        ? this.quantum.buildRuntimeState()
        : this.quantum.getSnapshot();

    const payload = {
      protocol:
        this.protocol,

      transport:
        this.transport,

      frame:
        this.frameIndex,

      timestamp:
        now(),

      quantum:
        quantumState,

      state:
        snapshot,

      collision
    };

    const serialized =
      JSON.stringify(payload);

    return {
      ...payload,

      hash:
        hash(serialized),

      hashPrefix:
        hash(serialized).slice(0, 16)
    };
  }

  /**
   * ================================================================
   * MAIN RUNTIME TICK
   * ================================================================
   */

  tick(
    deltaMs = DEFAULT_DELTA_MS
  ) {
    const start =
      process.hrtime.bigint();

    this.frameIndex += 1;

    const safeDeltaMs =
      clamp(
        finite(
          deltaMs,
          DEFAULT_DELTA_MS
        ),
        0,
        1000
      );

    /*
     * 1. Synchronize authoritative GameState.
     */
    this.syncFromGame();

    /*
     * 2. Execute logical quantum/morphmatrix
     *    processing.
     */
    try {
      this.quantum.tick(
        safeDeltaMs
      );
    } catch (error) {
      this.metrics.quantumFailures += 1;

      this.recordError(
        'quantum-tick',
        error
      );
    }

    /*
     * 3. Collect current processor state.
     */
    const processors =
      this.getProcessors();

    /*
     * 4. Detect wavefront collisions.
     */
    const collision =
      this.detectCollisions(
        processors
      );

    /*
     * 5. Build state-layer snapshot.
     */
    const snapshot =
      this.createStateSnapshot();

    this.lastSnapshot =
      snapshot;

    /*
     * 6. Serialize into the HFBT frame.
     */
    const frame =
      this.serializeFrame(
        snapshot,
        collision
      );

    /*
     * 7. Attach coordinator metadata.
     */
    const coordinatorFrame = {
      protocol:
        this.protocol,

      transport:
        this.transport,

      coordinator:
        'ROUNSAVILLE_RUNTIME_COORDINATOR',

      frameIndex:
        this.frameIndex,

      generatedAt:
        now(),

      deltaMs:
        safeDeltaMs,

      quantumTick:
        this.quantum.globalTick,

      processorCount:
        processors.length,

      collision,

      snapshot,

      frame
    };

    const frameHash =
      hash(
        coordinatorFrame
      );

    coordinatorFrame.frameHash =
      frameHash;

    coordinatorFrame.frameHashPrefix =
      frameHash.slice(0, 16);

    /*
     * 8. Store bounded frame history.
     */
    this.frameHistory.push(
      coordinatorFrame
    );

    while (
      this.frameHistory.length >
      MAX_FRAME_HISTORY
    ) {
      this.frameHistory.shift();
    }

    this.lastFrame =
      coordinatorFrame;

    this.metrics.frames += 1;
    this.metrics.ticks += 1;

    /*
     * 9. Runtime telemetry.
     */
    const processingMs =
      Number(
        process.hrtime.bigint() -
        start
      ) / 1e6;

    this.metrics.lastTickMs =
      processingMs;

    this.metrics.totalTickMs +=
      processingMs;

    this.metrics.maxTickMs =
      Math.max(
        this.metrics.maxTickMs,
        processingMs
      );

    this.lastTickAt =
      now();

    /*
     * 10. Notify HFBT runtime.
     */
    this.emitRuntimeEvent(
      'RUNTIME_COORDINATOR_FRAME',
      {
        frameIndex:
          this.frameIndex,

        quantumTick:
          this.quantum.globalTick,

        processorCount:
          processors.length,

        collisionCount:
          Array.isArray(collision)
            ? collision.length
            : undefined,

        frameHashPrefix:
          coordinatorFrame.frameHashPrefix,

        processingMs
      }
    );

    return coordinatorFrame;
  }

  /**
   * ================================================================
   * DIRECT HFBT FRAME BUILD
   * ================================================================
   *
   * Useful when the caller wants the coordinator's current state
   * pushed through HFBTRuntime.buildFrame().
   */

  buildHFBTFrame() {
    if (
      !this.hfbtRuntime ||
      typeof this.hfbtRuntime.buildFrame !==
        'function'
    ) {
      return null;
    }

    const state = {
      protocol:
        this.protocol,

      transport:
        this.transport,

      coordinator:
        this.getStatus(),

      quantum:
        this.quantum.buildRuntimeState
          ? this.quantum.buildRuntimeState()
          : this.quantum.getSnapshot(),

      gameState:
        this.gameState?.snapshot
          ? this.gameState.snapshot()
          : safeClone(
              this.gameState
            ),

      lastCollision:
        this.lastCollision
    };

    try {
      const frame =
        this.hfbtRuntime.buildFrame(
          state
        );

      return frame;
    } catch (error) {
      this.recordError(
        'hfbt-frame-build',
        error
      );

      return null;
    }
  }

  /**
   * ================================================================
   * FRAME HISTORY
   * ================================================================
   */

  getFrameHistory(limit = 32) {
    const count =
      clamp(
        Math.floor(
          finite(limit, 32)
        ),
        0,
        MAX_FRAME_HISTORY
      );

    return this.frameHistory
      .slice(-count);
  }

  getLastFrame() {
    return this.lastFrame;
  }

  /**
   * ================================================================
   * ENTITY STATE
   * ================================================================
   */

  getEntityState(entityId) {
    const id =
      String(entityId);

    const processor =
      this.quantum.getProcessor(id);

    const metadata =
      this.entityMetadata.get(id);

    if (!processor && !metadata) {
      return null;
    }

    return {
      entityId: id,

      metadata:
        metadata
          ? {
              ...metadata
            }
          : null,

      processor:
        processor
          ? processor.getSnapshot()
          : null
    };
  }

  /**
   * ================================================================
   * RUNTIME STATUS
   * ================================================================
   */

  getStatus() {
    const uptimeMs =
      now() -
      this.startedAt;

    const averageTickMs =
      this.metrics.ticks > 0
        ? this.metrics.totalTickMs /
          this.metrics.ticks
        : 0;

    return {
      protocol:
        this.protocol,

      transport:
        this.transport,

      coordinator:
        'ROUNSAVILLE_RUNTIME_COORDINATOR',

      architecture:
        'GAMESTATE_MORPHMATRIX_HFBT_PIPELINE',

      status:
        this.runtimeState.status,

      startedAt:
        this.startedAt,

      uptimeMs,

      frameIndex:
        this.frameIndex,

      lastTickAt:
        this.lastTickAt,

      processorCount:
        this.quantum?.processors?.size ??
        0,

      entityCount:
        this.entityMetadata.size,

      frameHistorySize:
        this.frameHistory.length,

      dimensionality:
        MORPH_DIM || 16,

      quantum:
        typeof this.quantum?.getStatus ===
        'function'
          ? this.quantum.getStatus()
          : null,

      processor:
        typeof this.registry?.getStatus ===
        'function'
          ? this.registry.getStatus()
          : {
              processorCount:
                this.registry?.processors?.size ??
                0
            },

      collision:
        typeof this.collision?.getStatus ===
        'function'
          ? this.collision.getStatus()
          : null,

      state:
        typeof this.state?.getStatus ===
        'function'
          ? this.state.getStatus()
          : null,

      serializer:
        typeof this.serializer?.getStatus ===
        'function'
          ? this.serializer.getStatus()
          : null,

      metrics: {
        ...this.metrics,

        averageTickMs:
          Number(
            averageTickMs.toFixed(6)
          )
      },

      errors: {
        last:
          this.lastError,

        count:
          this.errorHistory.length
      }
    };
  }

  /**
   * ================================================================
   * RUNTIME RESET
   * ================================================================
   */

  reset() {
    this.frameHistory.length = 0;

    this.frameIndex = 0;

    this.lastFrame = null;

    this.lastCollision = null;

    this.lastSnapshot = null;

    this.lastError = null;

    this.errorHistory.length = 0;

    this.startedAt =
      now();

    this.lastTickAt =
      this.startedAt;

    if (
      typeof this.quantum?.reset ===
      'function'
    ) {
      this.quantum.reset();
    }

    this.metrics = {
      ticks: 0,
      frames: 0,
      registeredEntities:
        this.entityMetadata.size,
      activeEntities: 0,
      playerSyncs: 0,
      enemySyncs: 0,
      collisions: 0,
      serializationFailures: 0,
      quantumFailures: 0,
      collisionFailures: 0,
      stateFailures: 0,
      totalTickMs: 0,
      maxTickMs: 0,
      lastTickMs: 0
    };

    this.runtimeState.status =
      'ONLINE';

    this.emitRuntimeEvent(
      'RUNTIME_COORDINATOR_RESET'
    );

    return this.getStatus();
  }

  /**
   * ================================================================
   * SHUTDOWN
   * ================================================================
   */

  shutdown() {
    this.runtimeState.status =
      'STOPPED';

    if (
      typeof this.quantum?.stop ===
      'function'
    ) {
      this.quantum.stop();
    }

    this.emitRuntimeEvent(
      'RUNTIME_COORDINATOR_SHUTDOWN'
    );

    return this.getStatus();
  }
}

module.exports = {
  RuntimeCoordinator
};