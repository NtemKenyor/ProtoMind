# ProtoMind

One local server, one `npm start`. A unified creative coding and maker hub that links three complete projects:

| Path | Project | Description | Status |
|---|---|---|---|
| `/` | **Hub** | Unified launchpad dashboard with live health detection | Ready |
| `/protomind` | **ProtoMind4004** | Interactive schematic canvas (Arduino Uno, ESP32, Pi Pico), circuit simulator, C++ uploader & AI hardware tutor | Ready |
| `/protoweb` | **ProtoWeb** | Visual drag-and-drop website builder with section-scoped AI prompting, Code & View modes | Ready |
| `/protogame` | **ProtoGame** | Story-driven 2D platformer game studio with visual level editor, 60FPS physics engine, AI co-pilot & standalone export | Ready |

Works on Windows, macOS, and Linux with Node 18+ (tested on Node 22).

---

## Architecture & Layout

```
ProtoMind/
├── package.json            # Root package, one `npm start`
├── server.js               # Launcher: hub, sub-projects, WebSocket & unified POST /api/ai
├── README.md
├── .env_sample             # Sample environment variables (META_API_KEY, AI_MODEL, etc.)
├── public/
│   └── index.html          # The Hub dashboard (served at /)
└── projects/
    ├── ProtoMind4004/
    │   ├── server.js       # Arduino CLI compile/upload router & WebSocket
    │   ├── toolchain.js    # Automatic zero-admin toolchain manager
    │   └── public/index.html # Schematic editor, circuit simulator, & AI tutor (served at /protomind)
    ├── ProtoWeb/
    │   └── index.html      # Visual builder + Section-Targeted AI Co-Pilot (served at /protoweb)
    └── ProtoGame/
        └── index.html      # Story-Driven 2D Platformer Studio (served at /protogame)
```

---

## Quick Start

1. Install Node 18+ (Node 22 recommended)
2. Run:
   ```bash
   npm install
   npm start
   ```
3. Open [http://localhost:3000](http://localhost:3000)

---

## Unified AI Communication Layer (`POST /api/ai`)

`server.js` exposes a single, unified endpoint `POST /api/ai` used by all three applications:

```json
{
  "project": "protomind" | "protoweb" | "protogame",
  "action": "check-wiring" | "edit-section" | "generate-story",
  "prompt": "User's request or story prompt",
  "context": { ... }
}
```

### External LLM Support (Meta, OpenAI, Gemini, Anthropic)
Create a `.env` file in the root folder (or copy `.env_sample`):
```bash
# Meta Llama API (or OpenAI-compatible endpoint)
META_API_KEY=your_key_here
AI_BASE_URL=https://api.llama-api.com
AI_MODEL=llama3.1-70b

# Or OpenAI
# OPENAI_API_KEY=sk-...
# AI_MODEL=gpt-4o-mini

# Or Google Gemini
# GEMINI_API_KEY=AIza...
# AI_MODEL=gemini-2.0-flash
```

The server automatically loads `.env` on startup without requiring any third-party dependencies.

### Built-in Smart Engine Fallback (100% Offline Out-of-the-Box)
If no external API key is configured (or if the network is unavailable), `server.js` automatically activates its rich built-in synthesis engine:
- **ProtoMind4004**: Analyzes component topology and wires across Arduino Uno, ESP32, and Raspberry Pi Pico; diagnoses missing GND/resistors; generates C++ sketches; and provides step-by-step wiring guides with loadable circuit diagrams.
- **ProtoWeb**: Modifies *only* the user's selected HTML section/element (e.g., dark glassmorphism, responsive 3-column cards, pricing tables, typography polish) while leaving the rest of the canvas completely untouched.
- **ProtoGame**: Synthesizes complete 2D platformer levels (theme colors, gravity, jump force, platforms, hazards, collectibles, enemies, and NPC story dialogue) from narrative stories or targeted physics adjustments ("make gravity lower like the moon").

---

## Project Features

### 🔌 ProtoMind4004
- **Multi-Board Schematic Library**: Arduino Uno, ESP32 DevKit, Raspberry Pi Pico RP2040, LEDs, Resistors, Pushbuttons, Micro Servos, HC-SR04 Ultrasonic sensors, and Piezo Buzzers.
- **Interactive Circuit Simulation**: Click **⚡ Simulate Circuit** to test circuits live. Pushbuttons toggle inputs, LEDs glow with SVG Gaussian blur drop-shadows, buzzers display sound wave ripples, and servos sweep their horn.
- **AI Hardware Tutor**: Diagnoses wiring issues, provides pinout guides, and generates matching C++ firmware with 1-click apply and loadable circuit schematics.
- **Real Hardware Upload**: Integrated `arduino-cli` compilation, USB upload, and real-time Serial Monitor over WebSockets.

### 🌐 ProtoWeb
- **Visual Drag-and-Drop Builder**: Complete drag-and-drop HTML & CSS website builder with interactive canvas guides and visual element tree.
- **Section-Targeted AI Co-Pilot**: Prompt specifically on any selected `<section>` or container. Changes apply only to that element, keeping the rest of the page safe.
- **Code & View Modes**: Live HTML/CSS source editing, responsive device viewport toggling, undo/redo history, and standalone HTML export.

### 🎮 ProtoGame Studio
- **Story-to-Game AI Co-Pilot**: Turn stories and scripts into playable 2D levels with custom themes, physics, and NPC dialogue.
- **Visual Level Editor**: Drag-and-drop palette (Player Spawn, Solid/Moving Platforms, Bouncy Pads, Coins, Hazards, Patrol Enemies, Story NPCs, Goal Portal) with real-time property inspector and grid snapping.
- **60FPS Playable Platformer**: Smooth camera follow, variable jump height, coyote time, moving platform physics, enemy stomp, and interactive NPC story dialogue modals.
- **Standalone Game Export**: Click **📦 Export Standalone HTML Game** to download a single, zero-dependency `.html` file that plays anywhere offline.
