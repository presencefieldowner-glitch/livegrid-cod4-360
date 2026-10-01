'use strict';

const { QuantumTickEngine, MorphVector } = require('./quantum-tick');
const { ProcessorRegistry } = require('./processor-registry');
const { WavefrontCollisionDetector } = require('./collision-layer');
const { StateLayer } = require('./state-layer');
const { HFBTSerializer } = require('./serialization-layer');

class RuntimeCoordinator {
  constructor(gameState, hfbtRuntime) {
    this.gameState = gameState;
    this.hfbtRuntime = hfbtRuntime;

    this.quantum = new QuantumTickEngine();
    this.registry = new ProcessorRegistry();
    this.collision = new WavefrontCollisionDetector();
    this.state = new StateLayer();
    this.serializer = new HFBTSerializer();

    this.entityMetadata = new Map();
    this.frameHistory = [];
    this.frameIndex = 0;
  }

  registerEntity(entityId, entityType, initialState = {}) {
    this.entityMetadata.set(entityId, {
      type: entityType,
      state: initialState.state || 'ACTIVE',
      lastUpdate: Date.now()
    });

    const processor = this.registry.register(entityId, entityType, initialState);
    this.quantum.registerProcessor(entityId);

    if (processor) {
      this.quantum.getProcessor(entityId).state = new MorphVector(
        initialState.x || 0,
        initialState.y || 0,
        initialState.z || 0,
        initialState.w || 0,
        initialState.health || 0,
        initialState.energy || 0,
        initialState.stamina || 0,
        initialState.score || 0
      );
    }

    return processor;
  }

  syncFromGame() {
    for (const player of this.gameState.players.values()) {
      const processor = this.quantum.getProcessor(player.id);
      if (!processor) continue;

      processor.state = new MorphVector(
        player.x,
        player.y,
        player.z,
        0,
        player.health,
        player.energy,
        player.stamina,
        player.score
      );
    }

    for (const enemy of this.gameState.enemies.values()) {
      const processor = this.quantum.getProcessor(enemy.id);
      if (!processor) continue;

      processor.state = new MorphVector(
        enemy.x,
        enemy.y,
        enemy.z,
        0,
        enemy.health,
        enemy.speed,
        enemy.state === 'TRACK' ? 1 : 0,
        0
      );
    }
  }

  tick(deltaMs = 16.6667) {
    this.frameIndex += 1;
    this.syncFromGame();

    const processors = this.registry.getAll ? this.registry.getAll() : Array.from(this.registry.processors.values());
    this.quantum.tick(deltaMs);

    const collision = this.collision.detect(processors.length ? processors : Array.from(this.quantum.processors.values()));
    const snapshot = this.state.createSnapshot(this.frameIndex, Date.now(), this.registry, this.entityMetadata);

    const frame = this.serializer.serialize(this.gameState, snapshot, collision, this.hfbtRuntime);
    this.frameHistory.push(frame);

    if (this.frameHistory.length > 256) {
      this.frameHistory.shift();
    }

    return frame;
  }

  getStatus() {
    return {
      frameIndex: this.frameIndex,
      quantum: this.quantum.getStatus(),
      processor: this.registry.getStatus(),
      collision: this.collision.getStatus(),
      state: this.state.getStatus(),
      serializer: this.serializer.getStatus(),
      frameHistorySize: this.frameHistory.length
    };
  }
}

module.exports = { RuntimeCoordinator };
