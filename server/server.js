'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { GameState } = require('./game');
const { HFBTRuntime } = require('./hfbt');
const { QuantumTickEngine, MorphVector } = require('./quantum-tick');
const { RuntimeCoordinator } = require('./runtime-coordinator');

const ROOT = path.resolve(__dirname, '..');
const STATIC_DIR = path.join(ROOT, 'public');
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8787);

const game = new GameState();
const hfbt = new HFBTRuntime();
const runtime = new RuntimeCoordinator(game, hfbt);
const clients = new Map();
const serverStarted = Date.now();

function registerRuntimeEntities() {
  for (const player of game.players.values()) {
    runtime.registerEntity(player.id, 'player', {
      x: player.x,
      y: player.y,
      z: player.z,
      health: player.health,
      energy: player.energy,
      stamina: player.stamina,
      score: player.score,
      state: player.state
    });
  }

  for (const enemy of game.enemies.values()) {
    runtime.registerEntity(enemy.id, 'enemy', {
      x: enemy.x,
      y: enemy.y,
      z: enemy.z,
      health: enemy.health,
      speed: enemy.speed,
      state: enemy.state
    });
  }
}

function syncRuntimeFromGame() {
  for (const player of game.players.values()) {
    const processor = runtime.quantum.getProcessor(player.id);
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

  for (const enemy of game.enemies.values()) {
    const processor = runtime.quantum.getProcessor(enemy.id);
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

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  });
  res.end(body);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 512) {
        reject(new Error('REQUEST_TOO_LARGE'));
        req.destroy();
      }
    });

    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('INVALID_JSON'));
      }
    });

    req.on('error', reject);
  });
}

function serveFile(res, filePath) {
  fs.readFile(filePath, (error, data) => {
    if (error) {
      sendJson(res, 404, { error: 'FILE_NOT_FOUND', path: filePath });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const typeMap = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'application/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.json': 'application/json; charset=utf-8',
      '.svg': 'image/svg+xml'
    };

    res.writeHead(200, {
      'Content-Type': typeMap[ext] || 'application/octet-stream',
      'Content-Length': data.length
    });
    res.end(data);
  });
}

function status() {
  return {
    service: 'CyberGame',
    status: 'ONLINE',
    runtime: {
      hfbt: hfbt.getStatus(),
      quantum: runtime.getStatus(),
    },
    server: {
      host: HOST,
      port: PORT,
      pid: process.pid,
      node: process.version,
      platform: process.platform
    },
    game: {
      frame: game.frame,
      tick: game.tick,
      playerCount: game.players.size,
      enemyCount: game.enemies.size,
      objective: game.objective
    },
    uptimeMs: Date.now() - serverStarted
  };
}

function createPlayer() {
  const id = crypto.randomUUID();
  const player = game.addPlayer(id);
  registerRuntimeEntities();
  return { id, player };
}

function broadcastMessage(message) {
  const payload = JSON.stringify(message);
  for (const client of clients.values()) {
    try {
      client.write(`data: ${payload.replace(/\n/g, '\\n')}\n\n`);
    } catch (_) {}
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
    });
    res.end();
    return;
  }

  try {
    if (req.method === 'GET' && url.pathname === '/health') {
      sendJson(res, 200, { service: 'CyberGame', status: 'HEALTHY', timestamp: Date.now() });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/status') {
      sendJson(res, 200, status());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/runtime') {
      sendJson(res, 200, {
        hfbt: hfbt.getStatus(),
        quantum: runtime.getStatus()
      });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/game') {
      sendJson(res, 200, game.snapshot());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/player/create') {
      sendJson(res, 200, createPlayer());
      return;
    }

    if (req.method === 'GET' && url.pathname === '/events') {
      sendJson(res, 200, { events: game.events });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/stream') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'Access-Control-Allow-Origin': '*'
      });

      const id = crypto.randomUUID();
      clients.set(id, res);
      res.write(`data: ${JSON.stringify({ type: 'CONNECTED', clientId: id, service: 'CyberGame' })}\n\n`);

      req.on('close', () => {
        clients.delete(id);
      });
      return;
    }

    if (req.method === 'POST' && url.pathname === '/input') {
      const body = await parseBody(req);
      const result = game.processInput(String(body.playerId || ''), body);
      if (!result.ok) {
        sendJson(res, 400, result);
        return;
      }

      syncRuntimeFromGame();
      game.event('INPUT', { playerId: body.playerId, action: body.action });
      sendJson(res, 200, result);
      return;
    }

    if (req.method === 'POST' && url.pathname === '/command') {
      const body = await parseBody(req);
      const result = game.command(String(body.playerId || ''), body.command);
      syncRuntimeFromGame();
      sendJson(res, result.ok === false ? 400 : 200, result);
      return;
    }

    if (req.method === 'GET' && url.pathname === '/') {
      serveFile(res, path.join(STATIC_DIR, 'index.html'));
      return;
    }

    if (req.method === 'GET') {
      const filePath = path.join(STATIC_DIR, url.pathname.replace(/^\/+/, ''));
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        serveFile(res, filePath);
        return;
      }
    }

    sendJson(res, 404, { error: 'NOT_FOUND', path: url.pathname });
  } catch (error) {
    sendJson(res, 500, { error: 'SERVER_ERROR', message: error.message });
  }
});

setInterval(() => {
  registerRuntimeEntities();
  syncRuntimeFromGame();
  const frame = runtime.tick(16.6667);
  const payload = {
    type: 'FRAME',
    frame,
    runtime: runtime.getStatus(),
    quantum: runtime.quantum.getStatus()
  };

  broadcastMessage(payload);
}, 1000 / 30);

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('==============================================================');
  console.log(' CYBERGAME RUNTIME ONLINE');
  console.log('==============================================================');
  console.log(` LOCAL: http://127.0.0.1:${PORT}`);
  console.log(` HEALTH: http://127.0.0.1:${PORT}/health`);
  console.log(` STATUS: http://127.0.0.1:${PORT}/status`);
  console.log(` RUNTIME: http://127.0.0.1:${PORT}/runtime`);
  console.log(` STREAM: http://127.0.0.1:${PORT}/stream`);
  console.log(` PROTOCOL: ${hfbt.protocol}`);
  console.log(` TRANSPORT: ${hfbt.transport}`);
  console.log(` RAYS: ${hfbt.rays}`);
  console.log('==============================================================');
});

process.on('SIGINT', () => {
  console.log('\nCYBERGAME: shutdown...');
  server.close(() => process.exit(0));
});
