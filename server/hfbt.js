'use strict';

const crypto = require('crypto');

class HFBTRuntime {
  constructor() {
    this.protocol = 'RCOREX-HF/1.1';
    this.transport = 'HolographicFramesByteTransport';
    this.mode = 'VIRTUAL';
    this.rays = 16384;
    this.frames = 0;
    this.startedAt = Date.now();
  }

  getStatus() {
    return {
      available: true,
      protocol: this.protocol,
      transport: this.transport,
      mode: this.mode,
      rays: this.rays,
      frames: this.frames,
      uptimeMs: Date.now() - this.startedAt,
      physicalLaserControl: false,
      physicalOpticalEmitter: false
    };
  }

  buildFrame(gameState) {
    this.frames += 1;

    const payload = {
      protocol: this.protocol,
      transport: this.transport,
      mode: this.mode,
      frameId: this.frames,
      timestamp: Date.now(),
      rays: this.rays,
      state: gameState
    };

    const serialized = JSON.stringify(payload);
    const hash = crypto
      .createHash('sha256')
      .update(serialized)
      .digest('hex');

    return {
      protocol: this.protocol,
      transport: this.transport,
      mode: this.mode,
      frame: this.frames,
      rays: this.rays,
      hash,
      generatedAt: Date.now(),
      state: gameState
    };
  }
}

module.exports = { HFBTRuntime };
