# CyberGame HFBT Server

A compact cyberpunk FPS server and browser client built around a strict HolographicFramesByteTransport (HFBT) runtime model.

## Features

- authoritative server-side game state
- player creation and input handling
- movement, aiming, shooting, dashing, and ability actions
- invasive HFBT frame generation for every gameplay tick
- Server-Sent Events streaming for live clients
- browser HUD with canvas battlefield rendering
- gamepad-friendly keyboard mapping for quick testing

## Quick start

```bash
npm install
npm start
```

Then open:

- http://127.0.0.1:8787
- http://127.0.0.1:8787/health
- http://127.0.0.1:8787/status

## Default endpoints

- GET /health
- GET /status
- GET /game
- GET /runtime
- GET /stream
- GET /player/create
- POST /input
- POST /command

## Gameplay style

This project implements a tactical cyber arena with:

- player movement in 3D space
- enemy drone AI
- projectile-based combat
- objective capture progress
- score and health state
- HUD overlays and minimap readouts

All game state moves through HFBT serialization instead of direct native draw or raw runtime side channels.
