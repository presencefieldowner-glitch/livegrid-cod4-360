'use strict';

/*
 * ============================================================
 * CYBERGAME // HFBT ARENA
 * RCOREX-HF/1.1 MASSIVE GAME STATE RUNTIME
 *
 * Runtime:
 *   RCOREX-HF/1.1
 *   VIRTUAL_SIMULATION
 *
 * Physical emitter:
 *   DISABLED / UNAVAILABLE unless an external hardware runtime
 *   explicitly attaches one.
 *
 * Responsibilities:
 *   - authoritative game state
 *   - player input
 *   - enemy simulation
 *   - projectile simulation
 *   - objective/wave state
 *   - HFBT projection state
 *   - ray/vector telemetry
 *   - layered audio telemetry
 *   - runtime journal/events
 *   - deterministic snapshots
 *   - frame hashing
 *   - natural-language command interpretation
 * ============================================================
 */

const crypto = require('crypto');

const PROTOCOL = 'RCOREX-HF/1.1';
const RUNTIME_MODE = 'VIRTUAL_SIMULATION';

const PHYSICAL_EMITTER_AVAILABLE = false;
const PHYSICAL_LASER_CONTROL = false;
const PHYSICAL_OPTICAL_EMITTER = false;

const CONFIG = {
  tickRate: 30,

  rays: 16384,

  world: {
    minX: -45,
    maxX: 45,

    minY: -20,
    maxY: 20,

    minZ: -45,
    maxZ: 45
  },

  player: {
    health: 100,
    armor: 50,
    energy: 100,
    stamina: 100,

    maxAmmo: 30,
    reserveAmmo: 120,

    moveSpeed: 1.2,
    turnSpeed: 0.18,

    dashDistance: 4,
    dashCost: 18,

    abilityCost: 30
  },

  weapon: {
    name: 'DG-9',
    damage: 22,
    projectileSpeed: 1,
    projectileTTL: 120,
    fireCooldown: 6
  },

  objective: {
    requiredProgress: 100,
    progressRate: 0.75
  }
};

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function now() {
  return Date.now();
}

function randomHex(bytes = 6) {
  return crypto.randomBytes(bytes).toString('hex');
}

function uuid() {
  return crypto.randomUUID();
}

function distance2D(a, b) {
  return Math.hypot(
    finite(a.x) - finite(b.x),
    finite(a.z) - finite(b.z)
  );
}

function normalizeVector(x, y, z) {
  const length = Math.hypot(x, y, z);

  if (!length || !Number.isFinite(length)) {
    return {
      x: 0,
      y: 0,
      z: 1
    };
  }

  return {
    x: x / length,
    y: y / length,
    z: z / length
  };
}

function sha256(value) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(value))
    .digest('hex');
}

/* ============================================================
   GAME STATE
   ============================================================ */

class GameState {
  constructor() {
    this.createdAt = now();

    this.frame = 0;
    this.tick = 0;

    this.players = new Map();
    this.projectiles = [];

    this.events = [];
    this.frameJournal = [];

    this.lastSnapshotHash = null;

    this.runtime = {
      protocol: PROTOCOL,

      mode: RUNTIME_MODE,

      physicalEmitter: PHYSICAL_EMITTER_AVAILABLE,
      physicalLaserControl: PHYSICAL_LASER_CONTROL,
      physicalOpticalEmitter: PHYSICAL_OPTICAL_EMITTER,

      emitterStatus: 'DISABLED',
      fieldStatus: 'VIRTUAL',
      projectionState: 'SIMULATION',

      rays: CONFIG.rays,
      rayState: 'READY',

      matrixState: 'MORPHMATRIX_READY',

      coherence: 0.7076129521834406,
      resonance: 0.4467788645683021,

      projectionStrength: 0.82,

      audio: {
        enabled: true,

        layer1: {
          name: 'WORLD_AUDIO',
          enabled: true,
          gain: 0.72
        },

        layer2: {
          name: 'HFBT_OVERLAY',
          enabled: true,
          gain: 0.48
        },

        left: 0,
        right: 0,
        resonance: 0.4467788645683021
      },

      vector: {
        x: 0,
        y: 1.6,
        z: 26,

        rx: 0,
        ry: 0,
        rz: 0
      },

      telemetry: {
        fps: CONFIG.tickRate,
        latency: 0,
        frameTime: Math.round(1000 / CONFIG.tickRate),
        queue: 0,

        receivedFrames: 0,
        renderedFrames: 0,
        events: 0,
        inputs: 0,
        droppedFrames: 0
      },

      startedAt: now(),

      status: 'ONLINE'
    };

    this.world = {
      id: 'CYBERGRID-ALPHA',

      name: 'CyberGrid',

      seed: randomHex(6),

      gravity: 0,

      bounds: clone(CONFIG.world),

      environment: {
        atmosphere: 'DIGITAL_VOID',

        lighting: 'HOLOGRAPHIC',

        weather: 'NONE',

        visibility: 100,

        fieldDensity: 0.82,

        resonanceField: true
      }
    };

    this.enemies = new Map();

    this.spawnInitialWave();

    this.objective = {
      id: 'data-core',

      name: 'Data Core',

      x: 0,
      y: 0,
      z: 0,

      progress: 0,

      secured: false,

      round: 1,

      wave: 1,

      state: 'ACTIVE',

      radius: 7
    };

    this.match = {
      id: `MATCH-${randomHex(4).toUpperCase()}`,

      startedAt: now(),

      roundTime: 0,

      phase: 'LIVE',

      status: 'ACTIVE',

      round: 1,

      wave: 1,

      score: 0
    };

    this.event(
      'RUNTIME_INITIALIZED',
      {
        protocol: PROTOCOL,
        mode: RUNTIME_MODE,
        rays: CONFIG.rays,
        physicalEmitter: PHYSICAL_EMITTER_AVAILABLE
      }
    );
  }

  /* ==========================================================
     ENEMY SPAWNING
     ========================================================== */

  createEnemy(index, wave = 1) {
    const names = [
      'Warden',
      'Stygian',
      'Null',
      'Specter',
      'Aegis',
      'Vector',
      'Cipher',
      'Oblivion'
    ];

    const spawnPoints = [
      { x: 18, z: 10 },
      { x: -20, z: -12 },
      { x: 8, z: -23 },
      { x: -26, z: 18 },
      { x: 27, z: -22 },
      { x: -8, z: 32 },
      { x: 32, z: 8 },
      { x: -34, z: -25 }
    ];

    const point =
      spawnPoints[index % spawnPoints.length];

    const health =
      100 +
      Math.max(0, wave - 1) * 15;

    const speed =
      0.65 +
      Math.min(0.65, wave * 0.035);

    return {
      id: `drone-${wave}-${index + 1}`,

      name:
        names[index % names.length],

      type: 'drone',

      x: point.x,
      y: 0,
      z: point.z,

      health,

      maxHealth: health,

      speed,

      state:
        index % 3 === 1
          ? 'TRACK'
          : 'PATROL',

      fireCooldown: 0,

      attackDamage:
        6 + Math.min(10, wave),

      wave,

      spawnedAt: now(),

      targetId: null
    };
  }

  spawnWave(wave = 1) {
    const count = Math.min(
      3 + wave,
      12
    );

    this.enemies.clear();

    for (let i = 0; i < count; i += 1) {
      const enemy =
        this.createEnemy(i, wave);

      this.enemies.set(
        enemy.id,
        enemy
      );
    }

    this.objective.wave = wave;

    this.match.wave = wave;

    this.objective.progress = 0;

    this.objective.secured = false;

    this.objective.state = 'ACTIVE';

    this.match.phase = 'LIVE';

    this.event(
      'WAVE_SPAWNED',
      {
        wave,
        count
      }
    );
  }

  spawnInitialWave() {
    this.spawnWave(1);
  }

  /* ==========================================================
     EVENT JOURNAL
     ========================================================== */

  event(type, data = {}) {
    const entry = {
      id: uuid(),

      type,

      timestamp: now(),

      frame: this.frame,

      tick: this.tick,

      data: clone(data)
    };

    this.events.push(entry);

    if (this.events.length > 300) {
      this.events.shift();
    }

    this.runtime.telemetry.events += 1;

    return entry;
  }

  journal(type, data = {}) {
    const entry = {
      id: uuid(),

      timestamp: now(),

      frame: this.frame,

      type,

      data: clone(data)
    };

    this.frameJournal.push(entry);

    if (this.frameJournal.length > 100) {
      this.frameJournal.shift();
    }

    return entry;
  }

  /* ==========================================================
     PLAYER MANAGEMENT
     ========================================================== */

  addPlayer(id) {
    const playerId =
      String(id || uuid());

    const player = {
      id: playerId,

      name:
        `Operator-${playerId.slice(0, 6)}`,

      x: 0,

      y: 1.6,

      z: 26,

      yaw: 0,

      pitch: 0,

      roll: 0,

      health: CONFIG.player.health,

      maxHealth: CONFIG.player.health,

      armor: CONFIG.player.armor,

      maxArmor: CONFIG.player.armor,

      energy: CONFIG.player.energy,

      maxEnergy: CONFIG.player.energy,

      stamina: CONFIG.player.stamina,

      maxStamina: CONFIG.player.stamina,

      weapon: CONFIG.weapon.name,

      ammo: CONFIG.player.maxAmmo,

      reserve: CONFIG.player.reserveAmmo,

      score: 0,

      kills: 0,

      state: 'READY',

      connectedAt: now(),

      lastInputAt: now(),

      fireCooldown: 0,

      reloadCooldown: 0,

      abilityCooldown: 0,

      dashCooldown: 0,

      killFeed: [],

      inputCount: 0
    };

    this.players.set(
      playerId,
      player
    );

    this.event(
      'PLAYER_CONNECTED',
      {
        playerId: playerId
      }
    );

    return clone(player);
  }

  removePlayer(id) {
    const playerId = String(id);

    if (!this.players.has(playerId)) {
      return;
    }

    this.players.delete(playerId);

    this.event(
      'PLAYER_DISCONNECTED',
      {
        playerId
      }
    );
  }

  getPlayer(id) {
    return (
      this.players.get(String(id)) ||
      null
    );
  }

  /* ==========================================================
     POSITION / WORLD
     ========================================================== */

  clampPlayer(player) {
    player.x = clamp(
      player.x,
      this.world.bounds.minX,
      this.world.bounds.maxX
    );

    player.y = clamp(
      player.y,
      this.world.bounds.minY,
      this.world.bounds.maxY
    );

    player.z = clamp(
      player.z,
      this.world.bounds.minZ,
      this.world.bounds.maxZ
    );
  }

  /* ==========================================================
     INPUT PROCESSOR
     ========================================================== */

  processInput(playerId, input = {}) {
    const player =
      this.players.get(String(playerId));

    if (!player) {
      return {
        ok: false,
        error: 'PLAYER_NOT_FOUND'
      };
    }

    const action =
      String(
        input.action || ''
      )
        .trim()
        .toLowerCase();

    const speed =
      clamp(
        finite(
          input.speed,
          CONFIG.player.moveSpeed
        ),
        0,
        5
      );

    player.lastInputAt = now();

    player.inputCount += 1;

    this.runtime.telemetry.inputs += 1;

    if (player.fireCooldown > 0) {
      player.fireCooldown -= 1;
    }

    if (player.reloadCooldown > 0) {
      player.reloadCooldown -= 1;
    }

    if (player.abilityCooldown > 0) {
      player.abilityCooldown -= 1;
    }

    if (player.dashCooldown > 0) {
      player.dashCooldown -= 1;
    }

    switch (action) {
      case 'forward':
      case 'move_forward':
      case 'w':

        player.x +=
          Math.sin(player.yaw) * speed;

        player.z +=
          Math.cos(player.yaw) * -speed;

        player.state = 'MOVING';

        break;

      case 'back':
      case 'move_back':
      case 's':

        player.x -=
          Math.sin(player.yaw) * speed;

        player.z -=
          Math.cos(player.yaw) * -speed;

        player.state = 'MOVING';

        break;

      case 'strafe_left':
      case 'a':

        player.x -=
          Math.cos(player.yaw) * speed;

        player.z -=
          Math.sin(player.yaw) * speed;

        player.state = 'STRAFE_LEFT';

        break;

      case 'strafe_right':
      case 'd':

        player.x +=
          Math.cos(player.yaw) * speed;

        player.z +=
          Math.sin(player.yaw) * speed;

        player.state = 'STRAFE_RIGHT';

        break;

      case 'turn_left':

        player.yaw -=
          CONFIG.player.turnSpeed;

        player.state = 'TURNING';

        break;

      case 'turn_right':

        player.yaw +=
          CONFIG.player.turnSpeed;

        player.state = 'TURNING';

        break;

      case 'look_up':

        player.pitch =
          clamp(
            player.pitch - 0.08,
            -1.45,
            1.45
          );

        break;

      case 'look_down':

        player.pitch =
          clamp(
            player.pitch + 0.08,
            -1.45,
            1.45
          );

        break;

      case 'jump':

        player.y = 2.5;

        player.state = 'AIRBORNE';

        this.event(
          'PLAYER_JUMP',
          {
            playerId: player.id
          }
        );

        break;

      case 'dash':

        if (
          player.dashCooldown > 0 ||
          player.stamina < CONFIG.player.dashCost
        ) {
          return {
            ok: true,
            player: clone(player),
            dashed: false,
            cooldown: player.dashCooldown
          };
        }

        player.stamina -=
          CONFIG.player.dashCost;

        player.x +=
          Math.sin(player.yaw) *
          CONFIG.player.dashDistance;

        player.z +=
          Math.cos(player.yaw) *
          CONFIG.player.dashDistance;

        player.dashCooldown = 20;

        player.state = 'DASH';

        this.clampPlayer(player);

        this.event(
          'PLAYER_DASH',
          {
            playerId: player.id,

            stamina:
              player.stamina,

            x: player.x,

            z: player.z
          }
        );

        break;

      case 'fire':

        return this.fireWeapon(player);

      case 'reload':

        return this.reloadWeapon(player);

      case 'ability':
      case 'overclock':

        return this.activateAbility(player);

      default:

        return {
          ok: false,

          error: 'UNKNOWN_INPUT',

          action
        };
    }

    this.clampPlayer(player);

    this.regeneratePlayer(player);

    this.updateRuntimeVector(player);

    this.journal(
      'INPUT_PROCESSED',
      {
        playerId: player.id,
        action
      }
    );

    return {
      ok: true,

      player: clone(player),

      action
    };
  }

  /* ==========================================================
     PLAYER REGENERATION
     ========================================================== */

  regeneratePlayer(player) {
    player.stamina =
      clamp(
        player.stamina + 1.25,
        0,
        player.maxStamina
      );

    player.energy =
      clamp(
        player.energy + 0.8,
        0,
        player.maxEnergy
      );

    if (
      player.state !== 'AIRBORNE' &&
      player.state !== 'DASH'
    ) {
      player.y +=
        (1.6 - player.y) * 0.25;
    }
  }

  /* ==========================================================
     WEAPON FIRE
     ========================================================== */

  fireWeapon(player) {
    if (player.fireCooldown > 0) {
      return {
        ok: true,

        player: clone(player),

        fired: false,

        cooldown:
          player.fireCooldown
      };
    }

    if (player.ammo <= 0) {
      return this.reloadWeapon(player);
    }

    player.ammo -= 1;

    player.fireCooldown =
      CONFIG.weapon.fireCooldown;

    const direction =
      normalizeVector(
        Math.sin(player.yaw) *
          Math.cos(player.pitch),

        Math.sin(player.pitch),

        Math.cos(player.yaw) *
          Math.cos(player.pitch)
      );

    const projectile = {
      id: uuid(),

      owner: player.id,

      weapon: player.weapon,

      x: player.x,

      y: player.y,

      z: player.z,

      dx: direction.x,

      dy: direction.y,

      dz: direction.z,

      ttl:
        CONFIG.weapon.projectileTTL,

      speed:
        CONFIG.weapon.projectileSpeed,

      damage:
        CONFIG.weapon.damage,

      createdFrame:
        this.frame
    };

    this.projectiles.push(projectile);

    player.state = 'FIRING';

    this.event(
      'PLAYER_FIRE',
      {
        playerId: player.id,

        weapon: player.weapon,

        ammo: player.ammo,

        projectileId: projectile.id
      }
    );

    this.emitAudioEvent(
      'FIRE',
      player
    );

    this.projectProjectionEvent(
      'PROJECTILE',
      projectile
    );

    return {
      ok: true,

      player: clone(player),

      fired: true,

      projectile: clone(projectile)
    };
  }

  /* ==========================================================
     RELOAD
     ========================================================== */

  reloadWeapon(player) {
    if (
      player.reloadCooldown > 0 ||
      player.ammo >= CONFIG.player.maxAmmo
    ) {
      return {
        ok: true,

        player: clone(player),

        reloaded: false
      };
    }

    if (player.reserve <= 0) {
      return {
        ok: true,

        player: clone(player),

        reloaded: false,

        reason: 'NO_RESERVE_AMMO'
      };
    }

    player.reloadCooldown = 20;

    const needed =
      CONFIG.player.maxAmmo -
      player.ammo;

    const loaded =
      Math.min(
        needed,
        player.reserve
      );

    player.ammo += loaded;

    player.reserve -= loaded;

    player.state = 'RELOADING';

    this.event(
      'PLAYER_RELOAD',
      {
        playerId: player.id,

        ammo: player.ammo,

        reserve: player.reserve
      }
    );

    this.emitAudioEvent(
      'RELOAD',
      player
    );

    return {
      ok: true,

      player: clone(player),

      reloaded: true,

      loaded
    };
  }

  /* ==========================================================
     ABILITY / OVERCLOCK
     ========================================================== */

  activateAbility(player) {
    if (player.abilityCooldown > 0) {
      return {
        ok: true,

        player: clone(player),

        activated: false,

        cooldown:
          player.abilityCooldown
      };
    }

    if (
      player.energy <
      CONFIG.player.abilityCost
    ) {
      return {
        ok: true,

        player: clone(player),

        activated: false,

        reason: 'INSUFFICIENT_ENERGY'
      };
    }

    player.energy -=
      CONFIG.player.abilityCost;

    player.abilityCooldown = 90;

    player.state = 'OVERCLOCK';

    this.runtime.projectionStrength =
      clamp(
        this.runtime.projectionStrength +
          0.05,
        0,
        1
      );

    this.runtime.resonance =
      clamp(
        this.runtime.resonance +
          0.025,
        0,
        1
      );

    this.event(
      'PLAYER_ABILITY',
      {
        playerId: player.id,

        ability: 'OVERCLOCK',

        energy: player.energy,

        resonance:
          this.runtime.resonance
      }
    );

    this.emitAudioEvent(
      'OVERCLOCK',
      player
    );

    this.projectProjectionEvent(
      'OVERCLOCK',
      player
    );

    return {
      ok: true,

      player: clone(player),

      activated: true,

      ability: 'OVERCLOCK'
    };
  }

  /* ==========================================================
     NATURAL LANGUAGE COMMAND INTERFACE
     ========================================================== */

  command(playerId, text) {
    const command =
      String(text || '')
        .trim()
        .toLowerCase();

    if (!command) {
      return {
        ok: false,
        error: 'EMPTY_COMMAND'
      };
    }

    const mappings = [
      [
        ['move forward', 'go forward', 'forward'],
        'forward'
      ],

      [
        ['move back', 'move backward', 'go back', 'back'],
        'back'
      ],

      [
        ['turn left', 'rotate left', 'left'],
        'turn_left'
      ],

      [
        ['turn right', 'rotate right', 'right'],
        'turn_right'
      ],

      [
        ['strafe left'],
        'strafe_left'
      ],

      [
        ['strafe right'],
        'strafe_right'
      ],

      [
        ['jump'],
        'jump'
      ],

      [
        ['fire', 'shoot', 'attack'],
        'fire'
      ],

      [
        ['reload', 'reload weapon'],
        'reload'
      ],

      [
        ['dash', 'boost'],
        'dash'
      ],

      [
        ['ability', 'overclock', 'activate overclock'],
        'ability'
      ]
    ];

    for (const [phrases, action] of mappings) {
      if (
        phrases.some(
          phrase =>
            command === phrase ||
            command.includes(phrase)
        )
      ) {
        this.event(
          'NATURAL_LANGUAGE_COMMAND',
          {
            playerId,
            command,
            action
          }
        );

        return this.processInput(
          playerId,
          {
            action
          }
        );
      }
    }

    this.event(
      'NATURAL_LANGUAGE_COMMAND',
      {
        playerId,
        command,

        interpretation:
          'COMMAND_RECORDED'
      }
    );

    return {
      ok: true,

      accepted: true,

      interpretation:
        'COMMAND_RECORDED',

      command
    };
  }

  /* ==========================================================
     ENEMY AI
     ========================================================== */

  updateEnemies() {
    for (const enemy of this.enemies.values()) {
      enemy.fireCooldown =
        Math.max(
          0,
          finite(enemy.fireCooldown) - 1
        );

      const nearest =
        this.findNearestPlayer(enemy);

      if (!nearest) {
        enemy.state = 'PATROL';
        enemy.targetId = null;
        continue;
      }

      enemy.targetId =
        nearest.id;

      const dx =
        nearest.x - enemy.x;

      const dz =
        nearest.z - enemy.z;

      const distance =
        Math.hypot(dx, dz);

      if (distance > 0.001) {
        const direction =
          normalizeVector(
            dx,
            0,
            dz
          );

        if (distance > 5) {
          enemy.x +=
            direction.x *
            enemy.speed *
            0.35;

          enemy.z +=
            direction.z *
            enemy.speed *
            0.35;

          enemy.state = 'TRACK';
        } else {
          enemy.state = 'ATTACK';
        }
      }

      if (
        distance < 3.5 &&
        enemy.fireCooldown === 0
      ) {
        this.damagePlayer(
          nearest,
          enemy.attackDamage,
          enemy
        );

        enemy.fireCooldown = 30;
      }

      enemy.x =
        clamp(
          enemy.x,
          this.world.bounds.minX,
          this.world.bounds.maxX
        );

      enemy.z =
        clamp(
          enemy.z,
          this.world.bounds.minZ,
          this.world.bounds.maxZ
        );
    }
  }

  findNearestPlayer(enemy) {
    let nearest = null;
    let nearestDistance = Infinity;

    for (const player of this.players.values()) {
      const distance =
        distance2D(
          enemy,
          player
        );

      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = player;
      }
    }

    return nearest;
  }

  /* ==========================================================
     DAMAGE / RESPAWN
     ========================================================== */

  damagePlayer(player, damage, source = null) {
    let remaining =
      Math.max(0, finite(damage));

    const armorDamage =
      Math.min(
        player.armor,
        remaining
      );

    player.armor -= armorDamage;

    remaining -= armorDamage;

    if (remaining > 0) {
      player.health =
        Math.max(
          0,
          player.health - remaining
        );
    }

    this.event(
      'PLAYER_DAMAGED',
      {
        playerId: player.id,

        damage,

        armorDamage,

        health:
          player.health,

        armor:
          player.armor,

        sourceId:
          source?.id || null
      }
    );

    if (player.health <= 0) {
      this.respawnPlayer(
        player,
        source
      );
    }
  }

  respawnPlayer(player, source = null) {
    player.health =
      player.maxHealth;

    player.armor =
      player.maxArmor;

    player.energy =
      player.maxEnergy;

    player.stamina =
      player.maxStamina;

    player.ammo =
      CONFIG.player.maxAmmo;

    player.reserve =
      CONFIG.player.reserveAmmo;

    player.x = 0;

    player.y = 1.6;

    player.z = 26;

    player.yaw = 0;

    player.pitch = 0;

    player.state = 'RESPAWNING';

    this.event(
      'PLAYER_RESPAWN',
      {
        playerId: player.id,

        sourceId:
          source?.id || null
      }
    );
  }

  /* ==========================================================
     PROJECTILE ENGINE
     ========================================================== */

  updateProjectiles() {
    for (const projectile of this.projectiles) {
      projectile.x +=
        projectile.dx *
        projectile.speed;

      projectile.y +=
        projectile.dy *
        projectile.speed;

      projectile.z +=
        projectile.dz *
        projectile.speed;

      projectile.ttl -= 1;

      if (
        projectile.x <
          this.world.bounds.minX ||
        projectile.x >
          this.world.bounds.maxX ||
        projectile.z <
          this.world.bounds.minZ ||
        projectile.z >
          this.world.bounds.maxZ
      ) {
        projectile.ttl = 0;
      }
    }

    for (const projectile of this.projectiles) {
      if (projectile.ttl <= 0) {
        continue;
      }

      for (const enemy of this.enemies.values()) {
        const distance =
          Math.hypot(
            projectile.x - enemy.x,
            projectile.y - enemy.y,
            projectile.z - enemy.z
          );

        if (distance < 2.2) {
          this.damageEnemy(
            enemy,
            projectile.damage,
            projectile.owner
          );

          projectile.ttl = 0;

          break;
        }
      }
    }

    this.projectiles =
      this.projectiles.filter(
        projectile =>
          projectile.ttl > 0
      );
  }

  damageEnemy(enemy, damage, shooterId) {
    enemy.health -=
      Math.max(0, finite(damage));

    this.event(
      'ENEMY_DAMAGED',
      {
        enemyId: enemy.id,

        shooterId,

        damage,

        health:
          Math.max(0, enemy.health)
      }
    );

    if (enemy.health <= 0) {
      const shooter =
        this.players.get(
          String(shooterId)
        );

      if (shooter) {
        shooter.score += 100;
        shooter.kills += 1;

        shooter.killFeed.push({
          enemyId: enemy.id,
          timestamp: now()
        });

        if (
          shooter.killFeed.length > 20
        ) {
          shooter.killFeed.shift();
        }
      }

      this.event(
        'ENEMY_ELIMINATED',
        {
          enemyId: enemy.id,

          shooterId,

          score: shooter
            ? shooter.score
            : 0
        }
      );

      this.enemies.delete(
        enemy.id
      );
    }
  }

  /* ==========================================================
     OBJECTIVE ENGINE
     ========================================================== */

  updateObjective() {
    if (
      this.enemies.size > 0
    ) {
      this.objective.state = 'CONTESTED';
      return;
    }

    if (
      this.players.size === 0
    ) {
      return;
    }

    this.objective.state =
      'SECURING';

    this.objective.progress =
      Math.min(
        CONFIG.objective.requiredProgress,

        this.objective.progress +
          CONFIG.objective.progressRate
      );

    if (
      this.objective.progress >=
      CONFIG.objective.requiredProgress
    ) {
      this.objective.progress = 100;

      this.objective.secured = true;

      this.objective.state =
        'SECURED';

      this.match.phase =
        'WAVE_CLEAR';

      this.event(
        'OBJECTIVE_SECURED',
        {
          objectiveId:
            this.objective.id,

          wave:
            this.objective.wave
        }
      );

      this.match.score += 500;
    }
  }

  /* ==========================================================
     WAVE TRANSITION
     ========================================================== */

  updateWave() {
    if (
      !this.objective.secured
    ) {
      return;
    }

    this.objective.wave += 1;

    this.match.wave =
      this.objective.wave;

    this.objective.round =
      Math.max(
        1,
        Math.ceil(
          this.objective.wave / 3
        )
      );

    this.match.round =
      this.objective.round;

    this.objective.progress = 0;

    this.objective.secured = false;

    this.objective.state =
      'ACTIVE';

    this.spawnWave(
      this.objective.wave
    );
  }

  /* ==========================================================
     RUNTIME VECTOR
     ========================================================== */

  updateRuntimeVector(player = null) {
    if (!player) {
      player =
        this.players.values().next().value ||
        null;
    }

    if (!player) {
      return;
    }

    this.runtime.vector = {
      x: player.x,

      y: player.y,

      z: player.z,

      rx: player.pitch,

      ry: player.yaw,

      rz: player.roll
    };
  }

  /* ==========================================================
     HFBT PROJECTION
     ========================================================== */

  projectProjectionEvent(type, data = {}) {
    this.runtime.projectionState =
      'ACTIVE';

    this.runtime.fieldStatus =
      'VIRTUAL';

    this.runtime.rayState =
      'TRANSPORTING';

    this.event(
      'HFBT_PROJECTION_EVENT',
      {
        type,

        protocol: PROTOCOL,

        mode: RUNTIME_MODE,

        rays: CONFIG.rays,

        physicalEmitter:
          PHYSICAL_EMITTER_AVAILABLE,

        data: clone(data)
      }
    );
  }

  /* ==========================================================
     AUDIO OVERLAY
     ========================================================== */

  emitAudioEvent(type, source = null) {
    const intensity =
      type === 'FIRE'
        ? 0.9
        : type === 'OVERCLOCK'
          ? 1
          : type === 'RELOAD'
            ? 0.45
            : 0.25;

    this.runtime.audio.left =
      clamp(
        intensity,
        0,
        1
      );

    this.runtime.audio.right =
      clamp(
        intensity * 0.92,
        0,
        1
      );

    this.runtime.audio.resonance =
      this.runtime.resonance;

    this.event(
      'AUDIO_LAYER_EVENT',
      {
        type,

        layer1:
          this.runtime.audio.layer1.name,

        layer2:
          this.runtime.audio.layer2.name,

        intensity,

        sourceId:
          source?.id || null
      }
    );
  }

  updateAudioRuntime() {
    this.runtime.audio.left *= 0.92;

    this.runtime.audio.right *= 0.92;

    this.runtime.audio.resonance =
      this.runtime.resonance;
  }

  /* ==========================================================
     RUNTIME TELEMETRY
     ========================================================== */

  updateTelemetry() {
    this.runtime.telemetry.fps =
      CONFIG.tickRate;

    this.runtime.telemetry.frameTime =
      Math.round(
        1000 / CONFIG.tickRate
      );

    this.runtime.telemetry.queue =
      this.projectiles.length;

    this.runtime.telemetry.latency = 0;

    this.runtime.telemetry.receivedFrames += 1;

    this.runtime.telemetry.renderedFrames += 1;

    this.runtime.rayState =
      this.runtime.projectionState === 'ACTIVE'
        ? 'TRANSPORTING'
        : 'READY';
  }

  /* ==========================================================
     MAIN TICK
     ========================================================== */

  tickUpdate() {
    const tickStarted =
      now();

    this.tick += 1;

    this.frame += 1;

    this.match.roundTime += 1;

    /* ----------------------------------------
       Player timers
       ---------------------------------------- */

    for (
      const player
      of this.players.values()
    ) {
      if (
        player.fireCooldown > 0
      ) {
        player.fireCooldown -= 1;
      }

      if (
        player.reloadCooldown > 0
      ) {
        player.reloadCooldown -= 1;
      }

      if (
        player.abilityCooldown > 0
      ) {
        player.abilityCooldown -= 1;
      }

      if (
        player.dashCooldown > 0
      ) {
        player.dashCooldown -= 1;
      }

      player.stamina =
        clamp(
          player.stamina + 0.2,
          0,
          player.maxStamina
        );

      player.energy =
        clamp(
          player.energy + 0.1,
          0,
          player.maxEnergy
        );

      if (
        player.state === 'FIRING' &&
        player.fireCooldown === 0
      ) {
        player.state = 'READY';
      }

      if (
        player.state === 'RELOADING' &&
        player.reloadCooldown === 0
      ) {
        player.state = 'READY';
      }

      if (
        player.state === 'OVERCLOCK' &&
        player.abilityCooldown < 60
      ) {
        player.state = 'READY';
      }

      if (
        player.state === 'DASH' &&
        player.dashCooldown < 15
      ) {
        player.state = 'READY';
      }

      this.clampPlayer(player);
    }

    /* ----------------------------------------
       Enemy simulation
       ---------------------------------------- */

    this.updateEnemies();

    /* ----------------------------------------
       Projectile simulation
       ---------------------------------------- */

    this.updateProjectiles();

    /* ----------------------------------------
       Objective
       ---------------------------------------- */

    this.updateObjective();

    /* ----------------------------------------
       Wave transition
       ---------------------------------------- */

    this.updateWave();

    /* ----------------------------------------
       Runtime telemetry
       ---------------------------------------- */

    this.updateRuntimeVector();

    this.updateAudioRuntime();

    this.updateTelemetry();

    const tickDuration =
      now() - tickStarted;

    this.runtime.telemetry.frameTime =
      tickDuration;

    /* ----------------------------------------
       Frame journal
       ---------------------------------------- */

    this.journal(
      'FRAME_COMMITTED',
      {
        frame: this.frame,

        tick: this.tick,

        players:
          this.players.size,

        enemies:
          this.enemies.size,

        projectiles:
          this.projectiles.length
      }
    );

    return this.snapshot();
  }

  /* ==========================================================
     SNAPSHOT
     ========================================================== */

  snapshot() {
    const state = {
      frame: this.frame,

      tick: this.tick,

      timestamp: now(),

      protocol: PROTOCOL,

      rays: CONFIG.rays,

      runtime: clone(
        this.runtime
      ),

      world: clone(
        this.world
      ),

      objective: clone(
        this.objective
      ),

      players:
        Array.from(
          this.players.values()
        ).map(clone),

      enemies:
        Array.from(
          this.enemies.values()
        ).map(clone),

      projectiles:
        clone(
          this.projectiles
        ),

      events:
        this.events.slice(-20),

      match:
        clone(this.match)
    };

    const hashInput =
      clone(state);

    delete hashInput.runtime;

    const frameHash =
      sha256(hashInput);

    this.lastSnapshotHash =
      frameHash;

    return {
      ...state,

      frameHash,

      frameHashPrefix:
        frameHash.slice(0, 16),

      projection: {
        protocol: PROTOCOL,

        mode: RUNTIME_MODE,

        active:
          this.runtime.projectionState ===
          'ACTIVE',

        field:
          this.runtime.fieldStatus,

        coherence:
          this.runtime.coherence,

        resonance:
          this.runtime.resonance,

        strength:
          this.runtime.projectionStrength,

        rays:
          CONFIG.rays
      },

      vector:
        clone(
          this.runtime.vector
        ),

      audio:
        clone(
          this.runtime.audio
        )
    };
  }

  /* ==========================================================
     RUNTIME STATUS
     ========================================================== */

  status() {
    return {
      ok: true,

      protocol: PROTOCOL,

      mode: RUNTIME_MODE,

      status:
        this.runtime.status,

      physicalEmitter:
        PHYSICAL_EMITTER_AVAILABLE,

      physicalLaserControl:
        PHYSICAL_LASER_CONTROL,

      physicalOpticalEmitter:
        PHYSICAL_OPTICAL_EMITTER,

      emitterStatus:
        this.runtime.emitterStatus,

      fieldStatus:
        this.runtime.fieldStatus,

      projectionState:
        this.runtime.projectionState,

      matrixState:
        this.runtime.matrixState,

      rayState:
        this.runtime.rayState,

      rays:
        CONFIG.rays,

      frame:
        this.frame,

      tick:
        this.tick,

      players:
        this.players.size,

      enemies:
        this.enemies.size,

      projectiles:
        this.projectiles.length,

      coherence:
        this.runtime.coherence,

      resonance:
        this.runtime.resonance,

      projectionStrength:
        this.runtime.projectionStrength,

      audio:
        clone(
          this.runtime.audio
        ),

      vector:
        clone(
          this.runtime.vector
        ),

      telemetry:
        clone(
          this.runtime.telemetry
        ),

      frameHash:
        this.lastSnapshotHash
    };
  }
}

module.exports = {
  GameState,

  CONFIG,

  PROTOCOL,

  RUNTIME_MODE
};