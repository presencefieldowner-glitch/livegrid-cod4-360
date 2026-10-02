'use strict';

/**
 * ================================================================
 * LIVEGRID // STATE LAYER
 * RCOREX-HF/1.1
 * ================================================================
 *
 * State architecture:
 *
 *   ProcessorRegistry
 *          |
 *          v
 *   StateSnapshot
 *          |
 *          +--> entity state
 *          +--> velocity
 *          +--> morph hash
 *          +--> metadata
 *          |
 *          v
 *   deterministic state hash
 *          |
 *          v
 *   delta / history journal
 *          |
 *          v
 *   HFBTSerializer / RuntimeCoordinator
 *
 * The StateLayer is a logical state-integrity layer.
 * It does not claim physical holographic persistence.
 * ================================================================
 */

const crypto = require('crypto');

const PROTOCOL = 'RCOREX-HF/1.1';
const MAX_SNAPSHOTS = 256;
const MAX_DELTAS = 256;
const VECTOR_DIMENSIONS = 8;

/**
 * ================================================================
 * UTILITIES
 * ================================================================
 */

function now() {
  return Date.now();
}

function clone(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return value;
  }

  return JSON.parse(
    JSON.stringify(value)
  );
}

function finite(
  value,
  fallback = 0
) {
  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function stableNormalize(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return value;
  }

  if (
    typeof value !== 'object'
  ) {
    return value;
  }

  if (
    Array.isArray(value)
  ) {
    return value.map(
      stableNormalize
    );
  }

  const result = {};

  for (
    const key of Object.keys(value).sort()
  ) {
    result[key] =
      stableNormalize(
        value[key]
      );
  }

  return result;
}

function stableStringify(
  value
) {
  return JSON.stringify(
    stableNormalize(
      value
    )
  );
}

function sha256(
  value
) {
  return crypto
    .createHash('sha256')
    .update(
      typeof value === 'string'
        ? value
        : stableStringify(value)
    )
    .digest('hex');
}

function hashPrefix(
  hash,
  length = 16
) {
  return String(
    hash || ''
  ).slice(
    0,
    length
  );
}

/**
 * ================================================================
 * STATE VECTOR
 * ================================================================
 */

function normalizeVector(
  vector,
  dimensions = VECTOR_DIMENSIONS
) {
  const source =
    Array.isArray(vector)
      ? vector
      : [];

  return Array.from(
    {
      length:
        dimensions
    },
    (_, index) =>
      finite(
        source[index],
        0
      )
  );
}

function vectorDelta(
  current,
  previous
) {
  const a =
    normalizeVector(
      current
    );

  const b =
    normalizeVector(
      previous
    );

  return a.map(
    (value, index) =>
      value - b[index]
  );
}

function vectorChanged(
  current,
  previous,
  epsilon = 0.000001
) {
  const delta =
    vectorDelta(
      current,
      previous
    );

  return delta.some(
    value =>
      Math.abs(value) >
      epsilon
  );
}

/**
 * ================================================================
 * STATE SNAPSHOT
 * ================================================================
 */

class StateSnapshot {
  constructor(
    tick,
    timestamp = now()
  ) {
    this.protocol =
      PROTOCOL;

    this.tick =
      finite(
        tick,
        0
      );

    this.timestamp =
      finite(
        timestamp,
        now()
      );

    this.entities =
      new Map();

    this.entityCount =
      0;

    this.hash =
      null;

    this.hashPrefix =
      null;

    this.integrity =
      'UNHASHED';

    this.createdAt =
      now();
  }

  /**
   * --------------------------------------------------------------
   * Add entity
   * --------------------------------------------------------------
   */

  addEntity(
    entityId,
    processor,
    metadata = {}
  ) {
    if (
      !entityId ||
      !processor
    ) {
      return null;
    }

    const state =
      normalizeVector(
        processor.state?.dims
      );

    const velocity =
      normalizeVector(
        processor.velocity?.dims
      );

    const morphHash =
      typeof processor.state?.toHash ===
      'function'
        ? processor.state.toHash()
        : sha256(
            state
          ).slice(
            0,
            16
          );

    const snapshot = {
      id:
        String(
          entityId
        ),

      type:
        metadata.type ||
        'unknown',

      state,

      velocity,

      morphHash,

      processorTick:
        finite(
          processor.processorTick,
          0
        ),

      metadata:
        clone(
          metadata
        )
    };

    this.entities.set(
      String(
        entityId
      ),
      snapshot
    );

    this.entityCount =
      this.entities.size;

    return snapshot;
  }

  /**
   * --------------------------------------------------------------
   * Get entity
   * --------------------------------------------------------------
   */

  getEntity(
    entityId
  ) {
    return this.entities.get(
      String(
        entityId
      )
    ) || null;
  }

  /**
   * --------------------------------------------------------------
   * Compute deterministic hash
   * --------------------------------------------------------------
   */

  computeHash() {
    const entities =
      Array.from(
        this.entities.values()
      )
        .sort(
          (a, b) =>
            a.id.localeCompare(
              b.id
            )
        )
        .map(
          entity => ({
            id:
              entity.id,

            type:
              entity.type,

            state:
              entity.state,

            velocity:
              entity.velocity,

            morphHash:
              entity.morphHash,

            processorTick:
              entity.processorTick,

            metadata:
              entity.metadata
          })
        );

    const payload = {
      protocol:
        this.protocol,

      tick:
        this.tick,

      timestamp:
        this.timestamp,

      entities
    };

    this.hash =
      sha256(
        payload
      );

    this.hashPrefix =
      hashPrefix(
        this.hash
      );

    this.integrity =
      'VERIFIED';

    return this.hash;
  }

  /**
   * --------------------------------------------------------------
   * Verify existing hash
   * --------------------------------------------------------------
   */

  verifyHash() {
    const original =
      this.hash;

    if (!original) {
      return false;
    }

    this.hash =
      null;

    this.hashPrefix =
      null;

    this.integrity =
      'UNHASHED';

    const recalculated =
      this.computeHash();

    const valid =
      recalculated ===
      original;

    this.hash =
      original;

    this.hashPrefix =
      hashPrefix(
        original
      );

    this.integrity =
      valid
        ? 'VERIFIED'
        : 'CORRUPTED';

    return valid;
  }

  /**
   * --------------------------------------------------------------
   * Serialize
   * --------------------------------------------------------------
   */

  serialize() {
    return {
      protocol:
        this.protocol,

      tick:
        this.tick,

      timestamp:
        this.timestamp,

      hash:
        this.hash,

      hashPrefix:
        this.hashPrefix,

      integrity:
        this.integrity,

      entityCount:
        this.entities.size,

      entities:
        Array.from(
          this.entities.values()
        ).map(
          entity =>
            clone(
              entity
            )
        )
    };
  }

  /**
   * --------------------------------------------------------------
   * Compact representation
   * --------------------------------------------------------------
   */

  compact() {
    return {
      tick:
        this.tick,

      timestamp:
        this.timestamp,

      hash:
        this.hash,

      entityCount:
        this.entities.size,

      entityIds:
        Array.from(
          this.entities.keys()
        )
    };
  }
}

/**
 * ================================================================
 * STATE LAYER
 * ================================================================
 */

class StateLayer {
  constructor(
    options = {}
  ) {
    this.protocol =
      PROTOCOL;

    this.maxSnapshots =
      finite(
        options.maxSnapshots,
        MAX_SNAPSHOTS
      );

    this.maxDeltas =
      finite(
        options.maxDeltas,
        MAX_DELTAS
      );

    this.snapshots =
      [];

    this.deltas =
      [];

    this.currentTick =
      0;

    this.lastKnownHash =
      null;

    this.lastHashPrefix =
      null;

    this.previousSnapshot =
      null;

    this.currentSnapshot =
      null;

    this.entityCount =
      0;

    this.totalSnapshots =
      0;

    this.totalEntitiesObserved =
      0;

    this.totalChangedEntities =
      0;

    this.totalAddedEntities =
      0;

    this.totalRemovedEntities =
      0;

    this.integrityFailures =
      0;

    this.startedAt =
      now();

    this.lastSnapshotAt =
      null;

    this.lastDeltaAt =
      null;
  }

  /**
   * ==============================================================
   * SNAPSHOT CREATION
   * ==============================================================
   */

  createSnapshot(
    tick,
    timestamp,
    processorRegistry,
    metadataMap
  ) {
    const snapshot =
      new StateSnapshot(
        tick,
        timestamp
      );

    if (
      processorRegistry &&
      processorRegistry.processors &&
      typeof processorRegistry.processors.entries ===
        'function'
    ) {
      for (
        const [
          entityId,
          processor
        ]
        of processorRegistry.processors.entries()
      ) {
        const metadata =
          metadataMap?.get(
            entityId
          ) || {
            type:
              'unknown'
          };

        snapshot.addEntity(
          entityId,
          processor,
          metadata
        );
      }
    }

    snapshot.computeHash();

    /*
     * Calculate delta against the preceding
     * state before replacing previousSnapshot.
     */
    const delta =
      this.createDelta(
        this.previousSnapshot,
        snapshot
      );

    this.deltas.push(
      delta
    );

    if (
      this.deltas.length >
      this.maxDeltas
    ) {
      this.deltas.shift();
    }

    this.snapshots.push(
      snapshot
    );

    if (
      this.snapshots.length >
      this.maxSnapshots
    ) {
      this.snapshots.shift();
    }

    this.previousSnapshot =
      this.currentSnapshot;

    this.currentSnapshot =
      snapshot;

    this.currentTick =
      snapshot.tick;

    this.lastKnownHash =
      snapshot.hash;

    this.lastHashPrefix =
      snapshot.hashPrefix;

    this.entityCount =
      snapshot.entities.size;

    this.totalSnapshots +=
      1;

    this.totalEntitiesObserved +=
      snapshot.entities.size;

    this.totalChangedEntities +=
      delta.changed.length;

    this.totalAddedEntities +=
      delta.added.length;

    this.totalRemovedEntities +=
      delta.removed.length;

    this.lastSnapshotAt =
      now();

    this.lastDeltaAt =
      now();

    return snapshot;
  }

  /**
   * ==============================================================
   * DELTA GENERATION
   * ==============================================================
   */

  createDelta(
    previous,
    current
  ) {
    const added = [];
    const removed = [];
    const changed = [];
    const unchanged = [];

    if (!current) {
      return {
        tick:
          0,

        timestamp:
          now(),

        fromHash:
          previous?.hash ||
          null,

        toHash:
          null,

        added,
        removed,
        changed,
        unchanged
      };
    }

    const previousEntities =
      previous?.entities ||
      new Map();

    const currentEntities =
      current.entities ||
      new Map();

    for (
      const [
        entityId,
        entity
      ]
      of currentEntities.entries()
    ) {
      const previousEntity =
        previousEntities.get(
          entityId
        );

      if (
        !previousEntity
      ) {
        added.push(
          clone(
            entity
          )
        );

        continue;
      }

      const stateChanged =
        vectorChanged(
          entity.state,
          previousEntity.state
        );

      const velocityChanged =
        vectorChanged(
          entity.velocity,
          previousEntity.velocity
        );

      const morphChanged =
        entity.morphHash !==
        previousEntity.morphHash;

      const processorChanged =
        entity.processorTick !==
        previousEntity.processorTick;

      if (
        stateChanged ||
        velocityChanged ||
        morphChanged ||
        processorChanged
      ) {
        changed.push({
          id:
            entity.id,

          type:
            entity.type,

          state:
            clone(
              entity.state
            ),

          velocity:
            clone(
              entity.velocity
            ),

          stateDelta:
            vectorDelta(
              entity.state,
              previousEntity.state
            ),

          velocityDelta:
            vectorDelta(
              entity.velocity,
              previousEntity.velocity
            ),

          morphHash:
            entity.morphHash,

          previousMorphHash:
            previousEntity.morphHash,

          processorTick:
            entity.processorTick
        });
      } else {
        unchanged.push(
          entity.id
        );
      }
    }

    for (
      const entityId
      of previousEntities.keys()
    ) {
      if (
        !currentEntities.has(
          entityId
        )
      ) {
        removed.push(
          entityId
        );
      }
    }

    return {
      protocol:
        this.protocol,

      tick:
        current.tick,

      timestamp:
        current.timestamp,

      fromHash:
        previous?.hash ||
        null,

      fromHashPrefix:
        previous?.hashPrefix ||
        null,

      toHash:
        current.hash,

      toHashPrefix:
        current.hashPrefix,

      added,
      removed,
      changed,
      unchanged,

      counts: {
        added:
          added.length,

        removed:
          removed.length,

        changed:
          changed.length,

        unchanged:
          unchanged.length
      }
    };
  }

  /**
   * ==============================================================
   * SNAPSHOT LOOKUP
   * ==============================================================
   */

  getSnapshot(
    tick
  ) {
    const numericTick =
      Number(
        tick
      );

    for (
      let i =
        this.snapshots.length -
        1;
      i >= 0;
      i--
    ) {
      if (
        this.snapshots[i].tick ===
        numericTick
      ) {
        return this.snapshots[i];
      }
    }

    return null;
  }

  getLatestSnapshot() {
    return (
      this.currentSnapshot ||
      null
    );
  }

  getPreviousSnapshot() {
    return (
      this.previousSnapshot ||
      null
    );
  }

  /**
   * ==============================================================
   * HISTORY
   * ==============================================================
   */

  getHistory(
    limit = 32
  ) {
    const safeLimit =
      Math.max(
        1,
        Math.min(
          this.snapshots.length,
          finite(
            limit,
            32
          )
        )
      );

    return this.snapshots
      .slice(
        -safeLimit
      )
      .map(
        snapshot =>
          snapshot.serialize()
      );
  }

  getDeltaHistory(
    limit = 32
  ) {
    const safeLimit =
      Math.max(
        1,
        Math.min(
          this.deltas.length,
          finite(
            limit,
            32
          )
        )
      );

    return this.deltas
      .slice(
        -safeLimit
      )
      .map(
        delta =>
          clone(
            delta
          )
      );
  }

  /**
   * ==============================================================
   * ENTITY HISTORY
   * ==============================================================
   */

  getEntityHistory(
    entityId,
    limit = 32
  ) {
    const id =
      String(
        entityId
      );

    const history = [];

    for (
      const snapshot
      of this.snapshots
    ) {
      const entity =
        snapshot.entities.get(
          id
        );

      if (entity) {
        history.push(
          {
            tick:
              snapshot.tick,

            timestamp:
              snapshot.timestamp,

            hash:
              snapshot.hash,

            entity:
              clone(
                entity
              )
          }
        );
      }
    }

    return history.slice(
      -Math.max(
        1,
        finite(
          limit,
          32
        )
      )
    );
  }

  /**
   * ==============================================================
   * INTEGRITY
   * ==============================================================
   */

  verifyLatest() {
    if (
      !this.currentSnapshot
    ) {
      return {
        valid:
          false,

        reason:
          'NO_SNAPSHOT'
      };
    }

    const valid =
      this.currentSnapshot.verifyHash();

    if (!valid) {
      this.integrityFailures +=
        1;
    }

    return {
      valid,

      tick:
        this.currentSnapshot.tick,

      hash:
        this.currentSnapshot.hash,

      hashPrefix:
        this.currentSnapshot.hashPrefix,

      integrity:
        this.currentSnapshot.integrity
    };
  }

  verifySnapshot(
    tick
  ) {
    const snapshot =
      this.getSnapshot(
        tick
      );

    if (!snapshot) {
      return {
        valid:
          false,

        reason:
          'SNAPSHOT_NOT_FOUND',

        tick:
          Number(
            tick
          )
      };
    }

    const valid =
      snapshot.verifyHash();

    if (!valid) {
      this.integrityFailures +=
        1;
    }

    return {
      valid,

      tick:
        snapshot.tick,

      hash:
        snapshot.hash,

      hashPrefix:
        snapshot.hashPrefix,

      integrity:
        snapshot.integrity
    };
  }

  /**
   * ==============================================================
   * SERIALIZED STATE
   * ==============================================================
   */

  serialize() {
    return {
      protocol:
        this.protocol,

      tick:
        this.currentTick,

      timestamp:
        this.currentSnapshot?.timestamp ||
        null,

      hash:
        this.lastKnownHash,

      hashPrefix:
        this.lastHashPrefix,

      integrity:
        this.currentSnapshot?.integrity ||
        'UNAVAILABLE',

      entityCount:
        this.entityCount,

      snapshotCount:
        this.snapshots.length,

      entities:
        this.currentSnapshot
          ? Array.from(
              this.currentSnapshot.entities.values()
            ).map(
              entity =>
                clone(
                  entity
                )
            )
          : []
    };
  }

  /**
   * ==============================================================
   * COMPACT STATE
   * ==============================================================
   */

  compact() {
    return {
      protocol:
        this.protocol,

      tick:
        this.currentTick,

      hash:
        this.lastKnownHash,

      hashPrefix:
        this.lastHashPrefix,

      entityCount:
        this.entityCount,

      snapshotCount:
        this.snapshots.length,

      deltaCount:
        this.deltas.length
    };
  }

  /**
   * ==============================================================
   * STATUS
   * ==============================================================
   */

  getStatus() {
    return {
      protocol:
        this.protocol,

      currentTick:
        this.currentTick,

      snapshotCount:
        this.snapshots.length,

      deltaCount:
        this.deltas.length,

      entityCount:
        this.entityCount,

      lastKnownHash:
        this.lastKnownHash,

      lastHashPrefix:
        this.lastHashPrefix,

      integrity:
        this.currentSnapshot?.integrity ||
        'UNAVAILABLE',

      totalSnapshots:
        this.totalSnapshots,

      totalEntitiesObserved:
        this.totalEntitiesObserved,

      totalChangedEntities:
        this.totalChangedEntities,

      totalAddedEntities:
        this.totalAddedEntities,

      totalRemovedEntities:
        this.totalRemovedEntities,

      integrityFailures:
        this.integrityFailures,

      lastSnapshotAt:
        this.lastSnapshotAt,

      lastDeltaAt:
        this.lastDeltaAt,

      uptimeMs:
        now() -
        this.startedAt
    };
  }

  /**
   * ==============================================================
   * RESET
   * ==============================================================
   */

  reset() {
    this.snapshots.length =
      0;

    this.deltas.length =
      0;

    this.currentTick =
      0;

    this.lastKnownHash =
      null;

    this.lastHashPrefix =
      null;

    this.previousSnapshot =
      null;

    this.currentSnapshot =
      null;

    this.entityCount =
      0;

    this.totalSnapshots =
      0;

    this.totalEntitiesObserved =
      0;

    this.totalChangedEntities =
      0;

    this.totalAddedEntities =
      0;

    this.totalRemovedEntities =
      0;

    this.integrityFailures =
      0;

    this.lastSnapshotAt =
      null;

    this.lastDeltaAt =
      null;
  }
}

/**
 * ================================================================
 * EXPORTS
 * ================================================================
 */

module.exports = {
  StateLayer,
  StateSnapshot,

  PROTOCOL
};