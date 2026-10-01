'use strict';

const crypto = require('crypto');

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

class GameState {
  constructor() {
    this.createdAt = Date.now();
    this.frame = 0;
    this.tick = 0;
    this.world = {
      id: 'CYBERGRID-ALPHA',
      name: 'CyberGrid',
      seed: crypto.randomBytes(6).toString('hex'),
      gravity: 0,
      bounds: { minX: -45, maxX: 45, minY: -20, maxY: 20, minZ: -45, maxZ: 45 }
    };

    this.players = new Map();
    this.enemies = new Map([
      ['drone-1', { id: 'drone-1', name: 'Warden', type: 'drone', x: 18, y: 0, z: 10, health: 100, speed: 0.8, state: 'PATROL', fireCooldown: 0 }],
      ['drone-2', { id: 'drone-2', name: 'Stygian', type: 'drone', x: -20, y: 0, z: -12, health: 100, speed: 0.7, state: 'TRACK', fireCooldown: 0 }],
      ['drone-3', { id: 'drone-3', name: 'Null', type: 'drone', x: 8, y: 0, z: -23, health: 100, speed: 0.9, state: 'PATROL', fireCooldown: 0 }]
    ]);

    this.projectiles = [];
    this.objective = {
      id: 'data-core',
      name: 'Data Core',
      x: 0,
      y: 0,
      z: 0,
      progress: 0,
      secured: false
    };

    this.events = [];
  }

  event(type, data = {}) {
    const entry = {
      id: crypto.randomUUID(),
      type,
      timestamp: Date.now(),
      data
    };

    this.events.push(entry);
    if (this.events.length > 200) this.events.shift();
    return entry;
  }

  addPlayer(id) {
    const player = {
      id,
      name: `Operator-${id.slice(0, 6)}`,
      x: 0,
      y: 1.6,
      z: 26,
      yaw: 0,
      pitch: 0,
      health: 100,
      armor: 50,
      energy: 100,
      stamina: 100,
      weapon: 'DG-9',
      ammo: 30,
      reserve: 120,
      score: 0,
      state: 'READY',
      connectedAt: Date.now(),
      fireCooldown: 0
    };

    this.players.set(id, player);
    this.event('PLAYER_CONNECTED', { playerId: id });
    return clone(player);
  }

  removePlayer(id) {
    if (!this.players.has(id)) return;
    this.players.delete(id);
    this.event('PLAYER_DISCONNECTED', { playerId: id });
  }

  getPlayer(id) {
    return this.players.get(id) || null;
  }

  clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  processInput(playerId, input = {}) {
    const player = this.players.get(playerId);
    if (!player) {
      return { ok: false, error: 'PLAYER_NOT_FOUND' };
    }

    const action = String(input.action || '').toLowerCase();
    const speed = Number.isFinite(input.speed) ? input.speed : 1;

    if (player.fireCooldown > 0) {
      player.fireCooldown = Math.max(0, player.fireCooldown - 1);
    }

    switch (action) {
      case 'forward':
      case 'move_forward':
      case 'w':
        player.z -= speed;
        break;
      case 'back':
      case 'move_back':
      case 's':
        player.z += speed;
        break;
      case 'strafe_left':
      case 'a':
        player.x -= speed;
        break;
      case 'strafe_right':
      case 'd':
        player.x += speed;
        break;
      case 'turn_left':
        player.yaw -= 0.18;
        break;
      case 'turn_right':
        player.yaw += 0.18;
        break;
      case 'jump':
        player.y = 2.5;
        player.state = 'AIRBORNE';
        break;
      case 'dash':
        player.stamina = Math.max(0, player.stamina - 18);
        player.x += Math.sin(player.yaw) * 4;
        player.z += Math.cos(player.yaw) * 4;
        this.event('PLAYER_DASH', { playerId, stamina: player.stamina });
        break;
      case 'fire':
        if (player.fireCooldown > 0) {
          return { ok: true, player: clone(player), fired: false, cooldown: player.fireCooldown };
        }

        if (player.ammo > 0) {
          player.ammo -= 1;
          player.fireCooldown = 6;
          const aimX = player.x + Math.sin(player.yaw) * 8;
          const aimY = player.y + Math.sin(player.pitch) * 4;
          const aimZ = player.z + Math.cos(player.yaw) * 8;
          this.projectiles.push({
            id: crypto.randomUUID(),
            owner: playerId,
            x: player.x,
            y: player.y + 1.2,
            z: player.z,
            dx: aimX - player.x,
            dy: aimY - player.y,
            dz: aimZ - player.z,
            ttl: 120,
            speed: 0.8,
            damage: 22
          });
          this.event('PLAYER_FIRE', { playerId, weapon: player.weapon, ammo: player.ammo });
        } else {
          this.event('PLAYER_RELOAD', { playerId });
        }
        break;
      case 'reload':
        if (player.reserve > 0) {
          const needed = 30 - player.ammo;
          const loaded = Math.min(needed, player.reserve);
          player.ammo += loaded;
          player.reserve -= loaded;
        }
        this.event('PLAYER_RELOAD', { playerId, ammo: player.ammo, reserve: player.reserve });
        break;
      case 'ability':
        player.energy = Math.max(0, player.energy - 30);
        player.state = 'OVERCLOCK';
        this.event('PLAYER_ABILITY', { playerId, energy: player.energy });
        break;
      default:
        return { ok: false, error: 'UNKNOWN_INPUT', action };
    }

    player.x = this.clamp(player.x, this.world.bounds.minX, this.world.bounds.maxX);
    player.y = this.clamp(player.y, this.world.bounds.minY, this.world.bounds.maxY);
    player.z = this.clamp(player.z, this.world.bounds.minZ, this.world.bounds.maxZ);
    player.stamina = this.clamp(player.stamina + 1.25, 0, 100);
    player.energy = this.clamp(player.energy + 0.8, 0, 100);

    return { ok: true, player: clone(player) };
  }

  command(playerId, text) {
    const command = String(text || '').trim().toLowerCase();
    if (!command) return { ok: false, error: 'EMPTY_COMMAND' };

    if (command.includes('move forward') || command === 'forward') return this.processInput(playerId, { action: 'forward' });
    if (command.includes('move back') || command === 'back') return this.processInput(playerId, { action: 'back' });
    if (command.includes('turn left') || command === 'left') return this.processInput(playerId, { action: 'turn_left' });
    if (command.includes('turn right') || command === 'right') return this.processInput(playerId, { action: 'turn_right' });
    if (command.includes('strafe left') || command === 'strafe left') return this.processInput(playerId, { action: 'strafe_left' });
    if (command.includes('strafe right') || command === 'strafe right') return this.processInput(playerId, { action: 'strafe_right' });
    if (command.includes('fire') || command.includes('shoot')) return this.processInput(playerId, { action: 'fire' });
    if (command.includes('reload')) return this.processInput(playerId, { action: 'reload' });
    if (command.includes('dash')) return this.processInput(playerId, { action: 'dash' });
    if (command.includes('ability') || command.includes('overclock')) return this.processInput(playerId, { action: 'ability' });

    this.event('NATURAL_LANGUAGE_COMMAND', { playerId, command });
    return { ok: true, accepted: true, interpretation: 'COMMAND_RECORDED', command };
  }

  tickUpdate() {
    this.tick += 1;
    this.frame += 1;

    for (const player of this.players.values()) {
      if (player.fireCooldown > 0) {
        player.fireCooldown = Math.max(0, player.fireCooldown - 1);
      }
    }

    for (const enemy of this.enemies.values()) {
      enemy.fireCooldown = Math.max(0, (enemy.fireCooldown || 0) - 1);

      const nearest = Array.from(this.players.values()).sort((a, b) => {
        const da = Math.hypot(enemy.x - a.x, enemy.z - a.z);
        const db = Math.hypot(enemy.x - b.x, enemy.z - b.z);
        return da - db;
      })[0];

      if (nearest) {
        const dx = nearest.x - enemy.x;
        const dz = nearest.z - enemy.z;
        const dist = Math.hypot(dx, dz);

        if (dist > 0.5) {
          enemy.x += Math.sign(dx) * enemy.speed * 0.35;
          enemy.z += Math.sign(dz) * enemy.speed * 0.35;
        }

        if (dist < 3.5 && enemy.fireCooldown === 0) {
          nearest.health = Math.max(0, nearest.health - 8);
          enemy.fireCooldown = 30;
          this.event('ENEMY_HIT', { enemyId: enemy.id, playerId: nearest.id, damage: 8 });
        }
      }

      enemy.x = this.clamp(enemy.x, this.world.bounds.minX, this.world.bounds.maxX);
      enemy.z = this.clamp(enemy.z, this.world.bounds.minZ, this.world.bounds.maxZ);
    }

    for (const player of this.players.values()) {
      if (player.health <= 0) {
        player.health = 100;
        player.x = 0;
        player.z = 26;
        this.event('PLAYER_RESPAWN', { playerId: player.id });
      }
    }

    for (const projectile of this.projectiles) {
      projectile.x += projectile.dx * projectile.speed * 0.25;
      projectile.y += projectile.dy * projectile.speed * 0.25;
      projectile.z += projectile.dz * projectile.speed * 0.25;
      projectile.ttl -= 1;
    }

    this.projectiles = this.projectiles.filter(p => p.ttl > 0);

    for (const projectile of this.projectiles) {
      for (const enemy of this.enemies.values()) {
        const distance = Math.hypot(projectile.x - enemy.x, projectile.z - enemy.z);
        if (distance < 2.2) {
          enemy.health -= projectile.damage || 22;
          if (enemy.health <= 0) {
            const shooter = this.players.get(projectile.owner);
            if (shooter) shooter.score += 100;
            this.event('ENEMY_ELIMINATED', { enemyId: enemy.id, shooterId: projectile.owner });
            this.enemies.delete(enemy.id);
          }
          projectile.ttl = 0;
          break;
        }
      }
    }

    this.projectiles = this.projectiles.filter(p => p.ttl > 0);

    for (const player of this.players.values()) {
      if (player.health <= 0) {
        player.health = 100;
      }
    }

    if (this.enemies.size === 0) {
      this.objective.progress = Math.min(100, this.objective.progress + 0.75);
      if (this.objective.progress >= 100) {
        this.objective.secured = true;
        this.event('OBJECTIVE_SECURED', { objectiveId: this.objective.id });
      }
    }
  }

  snapshot() {
    return {
      frame: this.frame,
      tick: this.tick,
      timestamp: Date.now(),
      world: clone(this.world),
      objective: clone(this.objective),
      players: Array.from(this.players.values()).map(clone),
      enemies: Array.from(this.enemies.values()).map(clone),
      projectiles: clone(this.projectiles),
      events: this.events.slice(-20)
    };
  }
}

module.exports = { GameState };
