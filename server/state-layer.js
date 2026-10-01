'use strict';

const crypto = require('crypto');

class StateSnapshot {
  constructor(tick, timestamp) {
    this.tick = tick;
    this.timestamp = timestamp;
    this.entities = new Map();
    this.hash = null;
  }

  addEntity(entityId, processor, metadata = {}) {
    const snapshot = {
      id: entityId,
      type: metadata.type || 'unknown',
      state: processor.state.dims.slice(0, 8),
      velocity: processor.velocity.dims.slice(0, 8),
      morphHash: processor.state.toHash(),
      processorTick: processor.processorTick,
      metadata
    };

    this.entities.set(entityId, snapshot);
    return snapshot;
  }

  computeHash() {
    const values = Array.from(this.entities.values())
      .map(e => e.morphHash)
      .join(':');

    this.hash = crypto.createHash('sha256').update(values).digest('hex');
    return this.hash;
  }

  serialize() {
    return {
      tick: this.tick,
      timestamp: this.timestamp,
      hash: this.hash,
      entities: Array.from(this.entities.values())
    };
  }
}

class StateLayer {
  constructor() {
    this.snapshots = [];
    this.currentTick = 0;
    this.lastKnownHash = null;
  }

  createSnapshot(tick, timestamp, processorRegistry, metadataMap) {
    const snapshot = new StateSnapshot(tick, timestamp);

    for (const [entityId, processor] of processorRegistry.processors.entries()) {
      const metadata = metadataMap.get(entityId) || { type: 'unknown' };
      snapshot.addEntity(entityId, processor, metadata);
    }

    snapshot.computeHash();
    this.snapshots.push(snapshot);
    if (this.snapshots.length > 256) this.snapshots.shift();

    this.currentTick = tick;
    this.lastKnownHash = snapshot.hash;

    return snapshot;
  }

  getStatus() {
    return {
      currentTick: this.currentTick,
      snapshotCount: this.snapshots.length,
      lastKnownHash: this.lastKnownHash
    };
  }
}

module.exports = { StateLayer, StateSnapshot };
