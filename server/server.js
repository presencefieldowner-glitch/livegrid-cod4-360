'use strict';

/**
 * ================================================================
 * CYBERGAME // LIVEGRID SERVER
 * RCOREX-HF/1.1
 * HOLOGRAPHICFRAMESBYTETRANSPORT
 * ================================================================
 *
 * Runtime pipeline:
 *
 *   HTTP / SSE
 *       |
 *       v
 *   GameState
 *       |
 *       v
 *   RuntimeCoordinator
 *       |
 *       +--> ProcessorRegistry
 *       +--> QuantumTickEngine
 *       +--> MorphMatrix 16D
 *       +--> WavefrontCollisionDetector
 *       +--> StateLayer
 *       +--> HFBTSerializer
 *       |
 *       v
 *   HFBTRuntime
 *       |
 *       v
 *   RCOREX-HF/1.1 frame
 *
 * Runtime mode:
 *   VIRTUAL_SIMULATION
 *
 * Physical optical emission is NOT claimed by this server.
 *
 * ================================================================
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { GameState } =
  require('./game');

const { HFBTRuntime } =
  require('./hfbt');

const {
  QuantumTickEngine
} = require('./quantum-tick');

const {
  RuntimeCoordinator
} = require('./runtime-coordinator');

/**
 * ================================================================
 * CONFIGURATION
 * ================================================================
 */

const ROOT =
  path.resolve(
    __dirname,
    '..'
  );

const STATIC_DIR =
  path.join(
    ROOT,
    'public'
  );

const HOST =
  process.env.HOST ||
  '0.0.0.0';

const PORT =
  Number(
    process.env.PORT ||
    8787
  );

const TICK_RATE =
  Number(
    process.env.GAME_TICK_RATE ||
    30
  );

const TICK_INTERVAL =
  1000 /
  Math.max(
    1,
    TICK_RATE
  );

const MAX_BODY_BYTES =
  512 * 1024;

const SSE_HEARTBEAT_MS =
  15000;

const MAX_FRAME_HISTORY =
  256;

/**
 * ================================================================
 * RUNTIME INITIALIZATION
 * ================================================================
 */

const game =
  new GameState();

const hfbt =
  new HFBTRuntime();

const runtime =
  new RuntimeCoordinator(
    game,
    hfbt,
    {
      quantum:
        new QuantumTickEngine({
          tickRateHz:
            8000,

          quantizationMs:
            0.125,

          collisionRadius:
            2.5
        })
    }
  );

const clients =
  new Map();

const serverStarted =
  Date.now();

let gameTimer =
  null;

let heartbeatTimer =
  null;

let shuttingDown =
  false;

/**
 * ================================================================
 * UTILITY FUNCTIONS
 * ================================================================
 */

function safeNumber(
  value,
  fallback = 0
) {
  const number =
    Number(value);

  return Number.isFinite(number)
    ? number
    : fallback;
}

function safeJson(
  value
) {
  try {
    return JSON.stringify(
      value
    );
  } catch {
    return JSON.stringify({
      error:
        'SERIALIZATION_FAILED'
    });
  }
}

function requestId() {
  if (
    typeof crypto.randomUUID ===
    'function'
  ) {
    return crypto.randomUUID();
  }

  return crypto
    .createHash('sha256')
    .update(
      `${Date.now()}-${Math.random()}`
    )
    .digest('hex')
    .slice(
      0,
      32
    );
}

function contentType(
  filePath
) {
  const ext =
    path.extname(
      filePath
    ).toLowerCase();

  const types = {
    '.html':
      'text/html; charset=utf-8',

    '.js':
      'application/javascript; charset=utf-8',

    '.cjs':
      'application/javascript; charset=utf-8',

    '.mjs':
      'application/javascript; charset=utf-8',

    '.css':
      'text/css; charset=utf-8',

    '.json':
      'application/json; charset=utf-8',

    '.svg':
      'image/svg+xml',

    '.png':
      'image/png',

    '.jpg':
      'image/jpeg',

    '.jpeg':
      'image/jpeg',

    '.webp':
      'image/webp',

    '.ico':
      'image/x-icon',

    '.txt':
      'text/plain; charset=utf-8'
  };

  return (
    types[ext] ||
    'application/octet-stream'
  );
}

/**
 * ================================================================
 * HTTP RESPONSE
 * ================================================================
 */

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin':
      '*',

    'Access-Control-Allow-Headers':
      'Content-Type, Authorization, X-Request-ID',

    'Access-Control-Allow-Methods':
      'GET,POST,OPTIONS',

    'Access-Control-Expose-Headers':
      'X-Request-ID'
  };
}

function sendJson(
  res,
  statusCode,
  payload,
  requestIdValue = null
) {
  const body =
    safeJson(
      payload
    );

  const headers = {
    ...corsHeaders(),

    'Content-Type':
      'application/json; charset=utf-8',

    'Content-Length':
      Buffer.byteLength(
        body
      ),

    'Cache-Control':
      'no-store'
  };

  if (requestIdValue) {
    headers[
      'X-Request-ID'
    ] = requestIdValue;
  }

  res.writeHead(
    statusCode,
    headers
  );

  res.end(
    body
  );
}

/**
 * ================================================================
 * REQUEST BODY
 * ================================================================
 */

function parseBody(
  req
) {
  return new Promise(
    (resolve, reject) => {
      let body =
        '';

      let settled =
        false;

      req.on(
        'data',
        chunk => {
          if (settled) {
            return;
          }

          body +=
            chunk.toString(
              'utf8'
            );

          if (
            Buffer.byteLength(
              body,
              'utf8'
            ) >
            MAX_BODY_BYTES
          ) {
            settled = true;

            reject(
              new Error(
                'REQUEST_TOO_LARGE'
              )
            );

            req.destroy();
          }
        }
      );

      req.on(
        'end',
        () => {
          if (settled) {
            return;
          }

          settled = true;

          if (
            !body.trim()
          ) {
            resolve({});
            return;
          }

          try {
            resolve(
              JSON.parse(
                body
              )
            );
          } catch {
            reject(
              new Error(
                'INVALID_JSON'
              )
            );
          }
        }
      );

      req.on(
        'error',
        error => {
          if (
            settled
          ) {
            return;
          }

          settled = true;

          reject(
            error
          );
        }
      );
    }
  );
}

/**
 * ================================================================
 * STATIC FILE SERVER
 * ================================================================
 */

function serveFile(
  res,
  filePath,
  requestIdValue
) {
  /*
   * Prevent traversal outside public/.
   */
  const resolved =
    path.resolve(
      filePath
    );

  const publicRoot =
    path.resolve(
      STATIC_DIR
    );

  if (
    resolved !== publicRoot &&
    !resolved.startsWith(
      `${publicRoot}${path.sep}`
    )
  ) {
    sendJson(
      res,
      403,
      {
        error:
          'FORBIDDEN_PATH'
      },
      requestIdValue
    );

    return;
  }

  fs.stat(
    resolved,
    (statError, stats) => {
      if (
        statError ||
        !stats.isFile()
      ) {
        sendJson(
          res,
          404,
          {
            error:
              'FILE_NOT_FOUND'
          },
          requestIdValue
        );

        return;
      }

      fs.readFile(
        resolved,
        (error, data) => {
          if (error) {
            sendJson(
              res,
              500,
              {
                error:
                  'FILE_READ_FAILED'
              },
              requestIdValue
            );

            return;
          }

          res.writeHead(
            200,
            {
              ...corsHeaders(),

              'Content-Type':
                contentType(
                  resolved
                ),

              'Content-Length':
                data.length,

              'Cache-Control':
                'no-cache'
            }
          );

          res.end(
            data
          );
        }
      );
    }
  );
}

/**
 * ================================================================
 * GAME / RUNTIME ENTITY REGISTRATION
 * ================================================================
 */

function registerRuntimeEntities() {
  /*
   * Players.
   */
  if (
    game.players &&
    typeof game.players.values ===
      'function'
  ) {
    for (
      const player
      of game.players.values()
    ) {
      if (!player?.id) {
        continue;
      }

      if (
        !runtime.quantum.getProcessor(
          player.id
        )
      ) {
        runtime.registerEntity(
          player.id,
          'PLAYER',
          {
            x:
              safeNumber(
                player.x
              ),

            y:
              safeNumber(
                player.y
              ),

            z:
              safeNumber(
                player.z
              ),

            health:
              safeNumber(
                player.health
              ),

            energy:
              safeNumber(
                player.energy
              ),

            stamina:
              safeNumber(
                player.stamina
              ),

            score:
              safeNumber(
                player.score
              ),

            state:
              player.state ||
              'ACTIVE'
          }
        );
      }
    }
  }

  /*
   * Enemies.
   */
  if (
    game.enemies &&
    typeof game.enemies.values ===
      'function'
  ) {
    for (
      const enemy
      of game.enemies.values()
    ) {
      if (!enemy?.id) {
        continue;
      }

      if (
        !runtime.quantum.getProcessor(
          enemy.id
        )
      ) {
        runtime.registerEntity(
          enemy.id,
          'ENEMY',
          {
            x:
              safeNumber(
                enemy.x
              ),

            y:
              safeNumber(
                enemy.y
              ),

            z:
              safeNumber(
                enemy.z
              ),

            health:
              safeNumber(
                enemy.health
              ),

            energy:
              safeNumber(
                enemy.speed
              ),

            stamina:
              enemy.state ===
              'TRACK'
                ? 1
                : 0,

            state:
              enemy.state ||
              'ACTIVE'
          }
        );
      }
    }
  }
}

/**
 * ================================================================
 * RUNTIME SYNCHRONIZATION
 * ================================================================
 *
 * RuntimeCoordinator.syncFromGame() is authoritative.
 * This wrapper exists for compatibility with older callers.
 */

function syncRuntimeFromGame() {
  try {
    runtime.syncFromGame();

    return true;
  } catch (error) {
    console.error(
      '[RUNTIME SYNC]',
      error.message
    );

    return false;
  }
}

/**
 * ================================================================
 * PLAYER CREATION
 * ================================================================
 */

function createPlayer() {
  const id =
    requestId();

  const player =
    game.addPlayer(
      id
    );

  /*
   * Immediately register the newly created
   * entity rather than waiting for the next
   * 30 Hz frame.
   */
  runtime.registerEntity(
    id,
    'PLAYER',
    player
  );

  syncRuntimeFromGame();

  return {
    ok: true,

    id,

    player,

    runtime:
      runtime.getEntityState(
        id
      )
  };
}

/**
 * ================================================================
 * SSE TRANSPORT
 * ================================================================
 */

function writeSSE(
  client,
  message
) {
  if (
    !client ||
    client.destroyed
  ) {
    return false;
  }

  try {
    const payload =
      safeJson(
        message
      );

    client.write(
      `data: ${payload}\n\n`
    );

    return true;
  } catch {
    return false;
  }
}

function broadcastMessage(
  message
) {
  for (
    const [
      id,
      client
    ]
    of clients.entries()
  ) {
    const success =
      writeSSE(
        client,
        message
      );

    if (!success) {
      clients.delete(
        id
      );
    }
  }
}

function broadcastFrame(
  frame
) {
  broadcastMessage({
    type:
      'FRAME',

    protocol:
      hfbt.protocol,

    transport:
      hfbt.transport,

    frame,

    runtime:
      runtime.getStatus(),

    quantum:
      runtime.quantum.getStatus(),

    hfbt:
      hfbt.getStatus(),

    timestamp:
      Date.now()
  });
}

/**
 * ================================================================
 * SERVER STATUS
 * ================================================================
 */

function getStatus() {
  return {
    service:
      'CyberGame',

    application:
      'LiveGrid',

    status:
      shuttingDown
        ? 'SHUTTING_DOWN'
        : 'ONLINE',

    protocol:
      hfbt.protocol,

    transport:
      hfbt.transport,

    server: {
      host:
        HOST,

      port:
        PORT,

      pid:
        process.pid,

      node:
        process.version,

      platform:
        process.platform,

      architecture:
        process.arch,

      uptimeMs:
        Date.now() -
        serverStarted
    },

    runtime: {
      hfbt:
        hfbt.getStatus(),

      coordinator:
        runtime.getStatus(),

      quantum:
        runtime.quantum.getStatus()
    },

    game: {
      frame:
        game.frame,

      tick:
        game.tick,

      playerCount:
        game.players.size,

      enemyCount:
        game.enemies.size,

      objective:
        game.objective
    },

    transportState: {
      sseClients:
        clients.size,

      frameHistory:
        runtime.frameHistory.length
    }
  };
}

/**
 * ================================================================
 * HTTP SERVER
 * ================================================================
 */

const server =
  http.createServer(
    async (
      req,
      res
    ) => {
      const requestIdValue =
        req.headers[
          'x-request-id'
        ] ||
        requestId();

      res.setHeader(
        'X-Request-ID',
        requestIdValue
      );

      let url;

      try {
        url =
          new URL(
            req.url,
            `http://${
              req.headers.host ||
              'localhost'
            }`
          );
      } catch {
        sendJson(
          res,
          400,
          {
            error:
              'INVALID_URL'
          },
          requestIdValue
        );

        return;
      }

      /**
       * ------------------------------------------------------------
       * CORS PREFLIGHT
       * ------------------------------------------------------------
       */

      if (
        req.method ===
        'OPTIONS'
      ) {
        res.writeHead(
          204,
          corsHeaders()
        );

        res.end();

        return;
      }

      try {
        /**
         * ----------------------------------------------------------
         * HEALTH
         * ----------------------------------------------------------
         */

        if (
          req.method ===
            'GET' &&
          url.pathname ===
            '/health'
        ) {
          sendJson(
            res,
            200,
            {
              service:
                'CyberGame',

              application:
                'LiveGrid',

              status:
                'HEALTHY',

              protocol:
                hfbt.protocol,

              transport:
                hfbt.transport,

              timestamp:
                Date.now()
            },
            requestIdValue
          );

          return;
        }

        /**
         * ----------------------------------------------------------
         * STATUS
         * ----------------------------------------------------------
         */

        if (
          req.method ===
            'GET' &&
          url.pathname ===
            '/status'
        ) {
          sendJson(
            res,
            200,
            getStatus(),
            requestIdValue
          );

          return;
        }

        /**
         * ----------------------------------------------------------
         * RUNTIME
         * ----------------------------------------------------------
         */

        if (
          req.method ===
            'GET' &&
          url.pathname ===
            '/runtime'
        ) {
          sendJson(
            res,
            200,
            {
              protocol:
                hfbt.protocol,

              transport:
                hfbt.transport,

              hfbt:
                hfbt.getStatus(),

              coordinator:
                runtime.getStatus(),

              quantum:
                runtime.quantum.getStatus(),

              lastFrame:
                runtime.getLastFrame()
            },
            requestIdValue
          );

          return;
        }

        /**
         * ----------------------------------------------------------
         * QUANTUM
         * ----------------------------------------------------------
         */

        if (
          req.method ===
            'GET' &&
          url.pathname ===
            '/quantum'
        ) {
          sendJson(
            res,
            200,
            {
              status:
                runtime.quantum.getStatus(),

              snapshot:
                runtime.quantum.getSnapshot
                  ? runtime.quantum.getSnapshot()
                  : null
            },
            requestIdValue
          );

          return;
        }

        /**
         * ----------------------------------------------------------
         * QUANTUM HISTORY
         * ----------------------------------------------------------
         */

        if (
          req.method ===
            'GET' &&
          url.pathname ===
            '/quantum/history'
        ) {
          const limit =
            safeNumber(
              url.searchParams.get(
                'limit'
              ),
              32
            );

          sendJson(
            res,
            200,
            {
              history:
                runtime.quantum.getTickHistory
                  ? runtime.quantum.getTickHistory(
                      limit
                    )
                  : []
            },
            requestIdValue
          );

          return;
        }

        /**
         * ----------------------------------------------------------
         * HFBT STATUS
         * ----------------------------------------------------------
         */

        if (
          req.method ===
            'GET' &&
          url.pathname ===
            '/hfbt'
        ) {
          sendJson(
            res,
            200,
            hfbt.getStatus(),
            requestIdValue
          );

          return;
        }

        /**
         * ----------------------------------------------------------
         * HFBT FRAME
         * ----------------------------------------------------------
         */

        if (
          req.method ===
            'GET' &&
          url.pathname ===
            '/hfbt/frame'
        ) {
          const frame =
            runtime.buildHFBTFrame();

          if (!frame) {
            sendJson(
              res,
              503,
              {
                error:
                  'HFBT_FRAME_UNAVAILABLE'
              },
              requestIdValue
            );

            return;
          }

          sendJson(
            res,
            200,
            frame,
            requestIdValue
          );

          return;
        }

        /**
         * ----------------------------------------------------------
         * FRAME HISTORY
         * ----------------------------------------------------------
         */

        if (
          req.method ===
            'GET' &&
          url.pathname ===
            '/frames'
        ) {
          const limit =
            safeNumber(
              url.searchParams.get(
                'limit'
              ),
              32
            );

          sendJson(
            res,
            200,
            {
              frames:
                runtime.getFrameHistory(
                  limit
                )
            },
            requestIdValue
          );

          return;
        }

        /**
         * ----------------------------------------------------------
         * GAME
         * ----------------------------------------------------------
         */

        if (
          req.method ===
            'GET' &&
          url.pathname ===
            '/game'
        ) {
          sendJson(
            res,
            200,
            game.snapshot(),
            requestIdValue
          );

          return;
        }

        /**
         * ----------------------------------------------------------
         * GAME EVENTS
         * ----------------------------------------------------------
         */

        if (
          req.method ===
            'GET' &&
          url.pathname ===
            '/events'
        ) {
          sendJson(
            res,
            200,
            {
              events:
                game.events
            },
            requestIdValue
          );

          return;
        }

        /**
         * ----------------------------------------------------------
         * RUNTIME EVENTS
         * ----------------------------------------------------------
         */

        if (
          req.method ===
            'GET' &&
          url.pathname ===
            '/runtime/events'
        ) {
          const events =
            typeof hfbt.getEvents ===
            'function'
              ? hfbt.getEvents(
                  safeNumber(
                    url.searchParams.get(
                      'limit'
                    ),
                    64
                  )
                )
              : [];

          sendJson(
            res,
            200,
            {
              events
            },
            requestIdValue
          );

          return;
        }

        /**
         * ----------------------------------------------------------
         * PLAYER CREATE
         * ----------------------------------------------------------
         */

        if (
          (
            req.method ===
              'GET' ||
            req.method ===
              'POST'
          ) &&
          url.pathname ===
            '/player/create'
        ) {
          let options = {};

          if (
            req.method ===
            'POST'
          ) {
            options =
              await parseBody(
                req
              );
          }

          const result =
            createPlayer(
              options
            );

          sendJson(
            res,
            200,
            result,
            requestIdValue
          );

          return;
        }

        /**
         * ----------------------------------------------------------
         * PLAYER STATE
         * ----------------------------------------------------------
         */

        if (
          req.method ===
            'GET' &&
          url.pathname ===
            '/player/state'
        ) {
          const playerId =
            url.searchParams.get(
              'playerId'
            );

          if (!playerId) {
            sendJson(
              res,
              400,
              {
                error:
                  'PLAYER_ID_REQUIRED'
              },
              requestIdValue
            );

            return;
          }

          const result =
            runtime.getEntityState(
              playerId
            );

          if (!result) {
            sendJson(
              res,
              404,
              {
                error:
                  'PLAYER_NOT_FOUND'
              },
              requestIdValue
            );

            return;
          }

          sendJson(
            res,
            200,
            result,
            requestIdValue
          );

          return;
        }

        /**
         * ----------------------------------------------------------
         * SERVER-SENT EVENTS
         * ----------------------------------------------------------
         */

        if (
          req.method ===
            'GET' &&
          url.pathname ===
            '/stream'
        ) {
          res.writeHead(
            200,
            {
              ...corsHeaders(),

              'Content-Type':
                'text/event-stream; charset=utf-8',

              'Cache-Control':
                'no-cache, no-transform',

              'Connection':
                'keep-alive',

              'X-Accel-Buffering':
                'no'
            }
          );

          const clientId =
            requestId();

          clients.set(
            clientId,
            res
          );

          /*
           * Initial connection state.
           */
          writeSSE(
            res,
            {
              type:
                'CONNECTED',

              clientId,

              service:
                'CyberGame',

              application:
                'LiveGrid',

              protocol:
                hfbt.protocol,

              transport:
                hfbt.transport,

              runtime:
                runtime.getStatus(),

              timestamp:
                Date.now()
            }
          );

          /*
           * Send current HFBT status.
           */
          writeSSE(
            res,
            {
              type:
                'RUNTIME',

              hfbt:
                hfbt.getStatus(),

              quantum:
                runtime.quantum.getStatus()
            }
          );

          req.on(
            'close',
            () => {
              clients.delete(
                clientId
              );
            }
          );

          return;
        }

        /**
         * ----------------------------------------------------------
         * INPUT
         * ----------------------------------------------------------
         */

        if (
          req.method ===
            'POST' &&
          url.pathname ===
            '/input'
        ) {
          const body =
            await parseBody(
              req
            );

          const playerId =
            String(
              body.playerId ||
              ''
            );

          if (!playerId) {
            sendJson(
              res,
              400,
              {
                ok: false,

                error:
                  'PLAYER_ID_REQUIRED'
              },
              requestIdValue
            );

            return;
          }

          const result =
            game.processInput(
              playerId,
              body
            );

          if (
            !result ||
            result.ok === false
          ) {
            sendJson(
              res,
              400,
              result || {
                ok: false,

                error:
                  'INPUT_REJECTED'
              },
              requestIdValue
            );

            return;
          }

          syncRuntimeFromGame();

          if (
            typeof game.event ===
            'function'
          ) {
            game.event(
              'INPUT',
              {
                playerId,

                action:
                  body.action,

                requestId:
                  requestIdValue
              }
            );
          }

          sendJson(
            res,
            200,
            {
              ...result,

              runtime:
                runtime.getEntityState(
                  playerId
                )
            },
            requestIdValue
          );

          return;
        }

        /**
         * ----------------------------------------------------------
         * NATURAL LANGUAGE / GAME COMMAND
         * ----------------------------------------------------------
         */

        if (
          req.method ===
            'POST' &&
          url.pathname ===
            '/command'
        ) {
          const body =
            await parseBody(
              req
            );

          const playerId =
            String(
              body.playerId ||
              ''
            );

          const command =
            String(
              body.command ||
              ''
            );

          if (!playerId) {
            sendJson(
              res,
              400,
              {
                ok: false,

                error:
                  'PLAYER_ID_REQUIRED'
              },
              requestIdValue
            );

            return;
          }

          if (!command) {
            sendJson(
              res,
              400,
              {
                ok: false,

                error:
                  'COMMAND_REQUIRED'
              },
              requestIdValue
            );

            return;
          }

          if (
            typeof game.command !==
            'function'
          ) {
            sendJson(
              res,
              501,
              {
                ok: false,

                error:
                  'COMMAND_INTERFACE_UNAVAILABLE'
              },
              requestIdValue
            );

            return;
          }

          const result =
            game.command(
              playerId,
              command
            );

          syncRuntimeFromGame();

          sendJson(
            res,
            result?.ok === false
              ? 400
              : 200,
            {
              ...result,

              runtime:
                runtime.getEntityState(
                  playerId
                )
            },
            requestIdValue
          );

          return;
        }

        /**
         * ----------------------------------------------------------
         * ROOT DOCUMENT
         * ----------------------------------------------------------
         */

        if (
          req.method ===
            'GET' &&
          url.pathname ===
            '/'
        ) {
          serveFile(
            res,
            path.join(
              STATIC_DIR,
              'index.html'
            ),
            requestIdValue
          );

          return;
        }

        /**
         * ----------------------------------------------------------
         * STATIC ASSETS
         * ----------------------------------------------------------
         */

        if (
          req.method ===
          'GET'
        ) {
          const requested =
            decodeURIComponent(
              url.pathname
            )
              .replace(
                /^\/+/,
                ''
              );

          const filePath =
            path.join(
              STATIC_DIR,
              requested
            );

          serveFile(
            res,
            filePath,
            requestIdValue
          );

          return;
        }

        /**
         * ----------------------------------------------------------
         * NOT FOUND
         * ----------------------------------------------------------
         */

        sendJson(
          res,
          404,
          {
            error:
              'NOT_FOUND',

            path:
              url.pathname
          },
          requestIdValue
        );
      } catch (error) {
        console.error(
          '[SERVER ERROR]',
          error
        );

        sendJson(
          res,
          error.message ===
            'INVALID_JSON'
            ? 400
            : error.message ===
              'REQUEST_TOO_LARGE'
              ? 413
              : 500,
          {
            error:
              error.message ===
              'INVALID_JSON'
                ? 'INVALID_JSON'
                : error.message ===
                  'REQUEST_TOO_LARGE'
                  ? 'REQUEST_TOO_LARGE'
                  : 'SERVER_ERROR',

            message:
              error.message,

            requestId:
              requestIdValue
          },
          requestIdValue
        );
      }
    }
  );

/**
 * ================================================================
 * GAME / QUANTUM RUNTIME LOOP
 * ================================================================
 */

function runtimeTick() {
  if (shuttingDown) {
    return;
  }

  const start =
    process.hrtime.bigint();

  try {
    /*
     * Register anything that appeared since
     * the previous frame.
     */
    registerRuntimeEntities();

    /*
     * Synchronize GameState into the 16D
     * processor representation.
     */
    syncRuntimeFromGame();

    /*
     * Advance coordinator.
     *
     * The coordinator internally subdivides
     * 16.6667 ms into logical quantum steps.
     */
    const frame =
      runtime.tick(
        TICK_INTERVAL
      );

    /*
     * Broadcast complete frame package.
     */
    broadcastFrame(
      frame
    );
  } catch (error) {
    console.error(
      '[RUNTIME TICK ERROR]',
      error
    );

    broadcastMessage({
      type:
        'RUNTIME_ERROR',

      error:
        error.message,

      timestamp:
        Date.now()
    });
  }

  const processingMs =
    Number(
      process.hrtime.bigint() -
      start
    ) / 1e6;

  /*
   * Prevent accidental event-loop overload
   * from silently becoming invisible.
   */
  if (
    processingMs >
    TICK_INTERVAL
  ) {
    console.warn(
      `[RUNTIME] tick processing ${processingMs.toFixed(3)}ms > interval ${TICK_INTERVAL.toFixed(3)}ms`
    );
  }
}

/**
 * ================================================================
 * SSE HEARTBEAT
 * ================================================================
 */

function heartbeat() {
  for (
    const [
      id,
      client
    ]
    of clients.entries()
  ) {
    if (
      client.destroyed
    ) {
      clients.delete(
        id
      );

      continue;
    }

    try {
      client.write(
        `: heartbeat ${Date.now()}\n\n`
      );
    } catch {
      clients.delete(
        id
      );
    }
  }
}

/**
 * ================================================================
 * SERVER START
 * ================================================================
 */

registerRuntimeEntities();

syncRuntimeFromGame();

server.listen(
  PORT,
  HOST,
  () => {
    console.log('');
    console.log(
      '=============================================================='
    );
    console.log(
      ' CYBERGAME // LIVEGRID RUNTIME ONLINE'
    );
    console.log(
      '=============================================================='
    );
    console.log(
      ` LOCAL:    http://127.0.0.1:${PORT}`
    );
    console.log(
      ` HEALTH:   http://127.0.0.1:${PORT}/health`
    );
    console.log(
      ` STATUS:   http://127.0.0.1:${PORT}/status`
    );
    console.log(
      ` RUNTIME:  http://127.0.0.1:${PORT}/runtime`
    );
    console.log(
      ` QUANTUM:  http://127.0.0.1:${PORT}/quantum`
    );
    console.log(
      ` HFBT:     http://127.0.0.1:${PORT}/hfbt`
    );
    console.log(
      ` FRAME:    http://127.0.0.1:${PORT}/hfbt/frame`
    );
    console.log(
      ` FRAMES:   http://127.0.0.1:${PORT}/frames`
    );
    console.log(
      ` STREAM:   http://127.0.0.1:${PORT}/stream`
    );
    console.log(
      ` GAME:     http://127.0.0.1:${PORT}/game`
    );
    console.log(
      ` INPUT:    POST /input`
    );
    console.log(
      ` COMMAND:  POST /command`
    );
    console.log(
      '--------------------------------------------------------------'
    );
    console.log(
      ` PROTOCOL: ${hfbt.protocol}`
    );
    console.log(
      ` TRANSPORT: ${hfbt.transport}`
    );
    console.log(
      ` MODE: ${hfbt.mode}`
    );
    console.log(
      ` RAYS: ${hfbt.rays}`
    );
    console.log(
      ` QUANTUM: ${runtime.quantum.tickRateHz} Hz logical`
    );
    console.log(
      ` QUANTUM STEP: ${runtime.quantum.quantizationMs} ms`
    );
    console.log(
      ` MORPH MATRIX: ${runtime.quantum.morphMatrixDim}D`
    );
    console.log(
      ` GAME TICK: ${TICK_RATE} Hz`
    );
    console.log(
      ' PHYSICAL LASER CONTROL: FALSE'
    );
    console.log(
      ' PHYSICAL OPTICAL EMITTER: FALSE'
    );
    console.log(
      '=============================================================='
    );
    console.log('');
  }
);

/**
 * ================================================================
 * START TIMERS
 * ================================================================
 */

gameTimer =
  setInterval(
    runtimeTick,
    TICK_INTERVAL
  );

heartbeatTimer =
  setInterval(
    heartbeat,
    SSE_HEARTBEAT_MS
  );

/**
 * ================================================================
 * GRACEFUL SHUTDOWN
 * ================================================================
 */

async function shutdown(
  signal
) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  console.log('');
  console.log(
    `CYBERGAME: ${signal} received`
  );

  console.log(
    'CYBERGAME: stopping runtime...'
  );

  if (gameTimer) {
    clearInterval(
      gameTimer
    );

    gameTimer = null;
  }

  if (heartbeatTimer) {
    clearInterval(
      heartbeatTimer
    );

    heartbeatTimer = null;
  }

  try {
    runtime.shutdown();
  } catch (error) {
    console.error(
      '[RUNTIME SHUTDOWN]',
      error.message
    );
  }

  /*
   * Notify SSE clients before closing.
   */
  broadcastMessage({
    type:
      'SHUTDOWN',

    service:
      'CyberGame',

    timestamp:
      Date.now()
  });

  for (
    const client
    of clients.values()
  ) {
    try {
      client.end();
    } catch (_) {}
  }

  clients.clear();

  /*
   * Stop accepting new connections.
   */
  server.close(
    error => {
      if (error) {
        console.error(
          '[SERVER CLOSE]',
          error
        );

        process.exitCode = 1;
      }

      console.log(
        'CYBERGAME: shutdown complete'
      );
    }
  );

  /*
   * Hard safety timeout.
   */
  setTimeout(
    () => {
      process.exit(
        0
      );
    },
    2000
  ).unref();
}

process.on(
  'SIGINT',
  () => {
    shutdown(
      'SIGINT'
    );
  }
);

process.on(
  'SIGTERM',
  () => {
    shutdown(
      'SIGTERM'
    );
  }
);

/**
 * ================================================================
 * UNHANDLED ERROR REPORTING
 * ================================================================
 */

process.on(
  'uncaughtException',
  error => {
    console.error(
      '[UNCAUGHT EXCEPTION]',
      error
    );

    /*
     * Keep the process alive for recoverable
     * runtime exceptions, but expose the failure.
     */
    broadcastMessage({
      type:
        'RUNTIME_ERROR',

      source:
        'uncaughtException',

      error:
        error.message,

      timestamp:
        Date.now()
    });
  }
);

process.on(
  'unhandledRejection',
  reason => {
    console.error(
      '[UNHANDLED REJECTION]',
      reason
    );

    broadcastMessage({
      type:
        'RUNTIME_ERROR',

      source:
        'unhandledRejection',

      error:
        reason?.message ||
        String(reason),

      timestamp:
        Date.now()
    });
  }
);

module.exports = {
  server,
  game,
  hfbt,
  runtime,
  clients,
  getStatus
};