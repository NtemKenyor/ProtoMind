### API & WebSocket Reference for `ProtoMind` (`server.js`)

Base URL: `http://localhost:3000` (or the `PORT` defined in `.env`).

| Endpoint | Method | Description |
| --- | --- | --- |
| `/health` | `GET` | Root hub health check

 |
| `/protomind/health` | `GET` | ProtoMind4004 sub-app health check

 |
| `/api/ai/models` | `GET` | Lists Meta AI profiles, active models, and provider status

 |
| `/api/ai` | `POST` | Unified AI bridge for `protomind`, `protoweb`, and `protogame`

 |
| `/api/ai/meta` | `POST` | Direct Meta AI gateway (profile specified in JSON body)

 |
| `/api/ai/meta/:profile` | `POST` | Direct Meta AI gateway by profile (`fast`, `smart`, `architect`, `code`, `vision`)

 |
| `/api/ai/chat` | `POST` | Stateful multi-turn chat with server-side `sessionId` memory

 |
| `/api/ai/chat/:sessionId` | `DELETE` | Clears server-side chat history for a `sessionId`

 |
| `/api/ai/spice` | `POST` | Dedicated SPICE Netlist & C++ code synthesizer for `ProtoMind4004`

 |
| `/api/ai/image` | `POST` | Generates a visual circuit blueprint image (`data:image/svg+xml;base64,...`)

 |
| `/protomind/ws` | `WS` | WebSocket for `arduino-cli` setup, board detection, flashing, and serial monitor

 |

---

## 1. `GET /api/ai/models`

Returns available Meta AI model profiles and whether `.env` API keys are active.

**Response JSON:**

```json
{
  "ok": true,
  "defaultProfile": "smart",
  "providers": {
    "meta": true,
    "openai": false,
    "gemini": false,
    "anthropic": false,
    "builtinFallback": true
  },
  "metaBaseUrl": "https://api.llama-api.com",
  "profiles": [
    {
      "id": "fast",
      "name": "Meta Llama 3.1 8B (Fast / Low-Latency)",
      "model": "llama3.1-8b",
      "description": "Rapid responses for UI tweaks, quick circuit checks, and game dialogue."
    },
    {
      "id": "smart",
      "name": "Meta Llama 3.3 / 3.1 70B (Balanced Generalist)",
      "model": "llama3.1-70b",
      "description": "Default high-accuracy model for ProtoMind4004, ProtoWeb, and ProtoGame."
    },
    {
      "id": "architect",
      "name": "Meta Llama 3.1 405B (Deep Hardware & System Architect)",
      "model": "llama3.1-405b",
      "description": "Flagship reasoning model for full SPICE netlists, custom ICs, and complex levels."
    },
    {
      "id": "code",
      "name": "Meta CodeLlama / Llama Instruct (Firmware & Code)",
      "model": "codellama-70b-instruct",
      "description": "Specialized for Arduino/ESP32/Pico C++, HTML/CSS, and game physics."
    },
    {
      "id": "vision",
      "name": "Meta Llama 3.2 90B Vision (Multimodal)",
      "model": "llama3.2-90b-vision",
      "description": "Multimodal model for schematic diagrams and visual layout inspection."
    }
  ]
}

```

---

## 2. `POST /api/ai` (Unified Project Bridge)

Main AI endpoint used by all three projects (`protomind`, `protoweb`, `protogame`). Guarantees a validated design structure even if the external API fails.

### Request Body Parameters

* **`project`** (`string`, optional, default: `"protomind"`): `"protomind"` | `"protoweb"` | `"protogame"`.


* **`action`** (`string`, required if `prompt` is empty):
* For `protomind`: `"general"` | `"check-wiring"` | `"generate-code"` | `"design-project"`.


* For `protoweb` / `protogame`: `"general"`.




* **`prompt`** (`string`, required if `action` is empty): User's natural language instruction.


* **`context`** (`object`, optional): Current state of the board/canvas (see Project Context Schemas below).


* **`metaProfile`** (`string`, optional): `"fast"` | `"smart"` | `"architect"` | `"code"` | `"vision"`.


* **`model`** (`string`, optional): Explicit model override (e.g., `"llama3.1-405b"`).



### Project Context & Response Schemas

#### A. When `project: "protomind"` (`ProtoMind4004`)

**Request Example:**

```javascript
const res = await fetch('/api/ai', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    project: 'protomind',
    action: 'design-project', // or 'check-wiring', 'generate-code', 'general'
    prompt: 'Design a smart plant watering system with moisture sensor, relay, and pump on Arduino Uno',
    metaProfile: 'architect',
    context: {
      comps: [
        { uid: 1, type: 'uno', name: 'U1', value: 'ATmega328P', startVolts: 5.0, outVolts: 5.0 },
        { uid: 2, type: 'res', name: 'R1', value: '220Ω', startVolts: 0, outVolts: 0 },
        { uid: 3, type: 'led', name: 'D1', value: 'Red', startVolts: 1.8, outVolts: 0 }
      ],
      wires: [
        { from: { uid: 1, pin: 'D13' }, to: { uid: 2, pin: 'a' } },
        { from: { uid: 2, pin: 'b' }, to: { uid: 3, pin: 'anode' } },
        { from: { uid: 3, pin: 'cathode' }, to: { uid: 1, pin: 'GND' } }
      ],
      spiceNetlist: '* Optional current SPICE netlist\nU1 5V GND D13 ARDUINO_UNO\n.end',
      code: 'void setup() {}\nvoid loop() {}'
    }
  })
});
const data = await res.json();

```

**Response JSON (`protomind`):**

```json
{
  "title": "Smart Plant Watering System",
  "reply": "🌱 **Smart Plant Watering System**\n\nExplanation of how the circuit and pins work...",
  "spiceNetlist": "* Smart Plant Watering System (Arduino Uno)\nU1 5V GND D13 D4 A0 ARDUINO_UNO ; Value=ATmega328P StartV=5.0 OutV=5.0\nX1 5V GND A0 SOIL_MOISTURE_SENSOR ; Value=Capacitive StartV=3.3 OutV=3.3 Pins=VCC,GND,SIG\nS1 5V N_EN SW_TOGGLE ; Value=Manual_Override StartV=0 OutV=0 PassThrough=true\nX2 N_EN D4 N_PUMP GND RELAY_MODULE_5V ; Value=1ch_Relay StartV=3.3 OutV=5.0 PassThrough=true Pins=VCC,IN,NO,GND\nM1 N_PUMP 0 DC_MOTOR ; Value=Submersible_Pump StartV=3.0\nR1 D13 N_LED 220 ; Value=220Ω\nD1 N_LED 0 LED ; Value=Status_LED StartV=1.8\n.end",
  "suggestedCode": "// Full compilable Arduino C++ code with void setup() and void loop()...",
  "suggestedCircuit": null,
  "provider": "external-llm",
  "modelUsed": "llama3.1-405b",
  "aiError": null
}

```

(Note: For `"how to wire esp32 ultrasonic"` or `"how to wire pico servo"`, `suggestedCircuit` also returns `{ comps: [{ type, x, y }], wires: [{ from: { compIndex, pin }, to: { compIndex, pin } }] }`.)

#### B. When `project: "protoweb"` (`ProtoWeb`)

* **`context`**: `{ sectionHtml: "<section>...</section>", tagName: "SECTION" }`


* **Response JSON**: `{ "html": "<section>...</section>", "explanation": "What changed...", "provider": "...", "aiError": null }`



#### C. When `project: "protogame"` (`ProtoGame`)

* **`context`**: `{ level: { ...optional existing level object... } }`


* **Response JSON**: `{ "level": { "title", "storyIntro", "theme", "gravity", "jumpForce", "speed", "playerSpawn", "platforms", "coins", "enemies", "hazards", "npcs", "portal" }, "reply": "...", "provider": "...", "aiError": null }`



---

## 3. `POST /api/ai/meta` & `POST /api/ai/meta/:profile`

Direct gateway to a specific Meta AI profile (`fast`, `smart`, `architect`, `code`, `vision`) with custom system prompt and message array support.

### Request Body Parameters

* **`profile`** or URL param **`:profile`** (`string`, optional, default: `"smart"`): `"fast"` | `"smart"` | `"architect"` | `"code"` | `"vision"`.


* **`project`** (`string`, optional, default: `"protomind"`): `"protomind"` | `"protoweb"` | `"protogame"`.


* **`action`** (`string`, optional, default: `"general"`): Action identifier.


* **`prompt`** (`string`, required unless `messages` is provided): User prompt.


* **`context`** (`object`, optional): Project state object.


* **`system`** (`string`, optional): Custom system prompt override.


* **`messages`** (`array`, optional): Raw OpenAI/Meta-formatted messages `[{ role: "user", content: "..." }]`.


* **`model`** (`string`, optional): Explicit model string override.


* **`temperature`** (`number`, optional, default: `0.7`): Sampling temperature.



**Example Call:**

```javascript
const res = await fetch('/api/ai/meta/architect', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    project: 'protomind',
    action: 'design-project',
    prompt: 'Design an ESP32 ultrasonic radar with servo and buzzer',
    context: { comps: [{ type: 'esp32' }], wires: [] },
    temperature: 0.5
  })
});
const data = await res.json();
// Returns: { title, reply, spiceNetlist, suggestedCode, suggestedCircuit, metaProfile: "architect", modelUsed: "llama3.1-405b", provider: "meta", aiError: null }

```

---

## 4. `POST /api/ai/chat` & `DELETE /api/ai/chat/:sessionId`

Stateful multi-turn conversation endpoint. The server stores up to 16 messages (8 turns) in memory per `sessionId`.

### `POST /api/ai/chat` Request Body

* **`sessionId`** (`string`, optional, default: `"default"`): Unique ID for the conversation thread.


* **`project`** (`string`, optional, default: `"protomind"`): Project name.


* **`profile`** (`string`, optional, default: `"smart"`): Meta AI profile.


* **`prompt`** (`string`, required): User's message for this turn.


* **`context`** (`object`, optional): Current board/app context.


* **`reset`** (`boolean`, optional, default: `false`): If `true`, clears previous history for `sessionId` before running.



**Example Call:**

```javascript
const res = await fetch('/api/ai/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    sessionId: 'user-board-1',
    project: 'protomind',
    profile: 'smart',
    prompt: 'Now add a status LED on pin D13 to that circuit',
    context: { comps: [], wires: [] }
  })
});
const data = await res.json();
// Includes all standard project fields plus: { sessionId: "user-board-1", turnCount: 2 }

```

To clear a chat session:

```javascript
await fetch('/api/ai/chat/user-board-1', { method: 'DELETE' });
// Returns: { "ok": true, "cleared": "user-board-1" }

```

---

## 5. `POST /api/ai/spice`

Fast, deterministic SPICE Netlist and C++ code synthesizer for `ProtoMind4004`.

### Request Body Parameters

* **`prompt`** (`string`, required): Description of the circuit to synthesize.


* **`context`** (`object`, optional): `{ comps, wires, spiceNetlist, code }`.



**Response JSON:**

```json
{
  "ok": true,
  "title": "Smart Temperature Fan Controller",
  "spiceNetlist": "* Smart Temperature Fan Controller (Arduino Uno)\nU1 5V GND D13 D9 D2 ARDUINO_UNO ; Value=ATmega328P StartV=5.0 OutV=5.0\n...\n.end",
  "suggestedCode": "// Smart Temperature Fan Controller - Auto-generated...",
  "reply": "🌡️ **Smart Temperature Fan Controller**..."
}

```

### SPICE Netlist Line Format Used by `server.js`

Each component line in `spiceNetlist` follows this structure:

```spice
* Project Title
<Designator> <Node1> <Node2> ... <NodeN> <ModelOrType> ; Value=<val> StartV=<num> OutV=<num> PassThrough=<true|false> Pins=<Pin1,Pin2,...>
.end

```

* **Ground Node:** Represented by `0` or `GND`.


* **Unknown/Custom Components:** Prefixed with `X` or `U` and include `Pins=VCC,IN,OUT,GND` in the comment metadata after `;` so the frontend can dynamically create the component and its pins.



---

## 6. `POST /api/ai/image` (Visual Circuit Blueprint Generator)

Takes the AI's circuit title, description, C++ code, and SPICE netlist and returns a visual blueprint diagram (`data:image/svg+xml;base64,...` or an OpenAI DALL-E URL if `ENABLE_EXTERNAL_IMAGE_API="true"` in `.env`).

### Request Body Parameters

* **`title`** (`string`, optional): Blueprint header title.


* **`description`** (`string`, optional): Plain-text or Markdown explanation from the AI.


* **`code`** (`string`, optional): C++ firmware code to preview in the blueprint.


* **`spiceNetlist`** (`string`, optional): SPICE netlist used to draw the hardware topology blocks and node connections.



**Example Call:**

```javascript
const imgRes = await fetch('/api/ai/image', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    title: data.title,
    description: data.reply,
    code: data.suggestedCode,
    spiceNetlist: data.spiceNetlist
  })
});
const { imageUrl, source } = await imgRes.json();
// Set directly on an <img> element:
document.getElementById('blueprintImg').src = imageUrl;

```

**Response JSON:**

```json
{
  "imageUrl": "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmci...",
  "source": "blueprint-svg"
}

```

---

## 7. WebSocket API (`ws://localhost:3000/protomind/ws`)

Handled by `projects/ProtoMind4004/server.js` for hardware communication via `arduino-cli`. All messages are JSON strings (`JSON.stringify(...)`).

### Client → Server Messages (`ws.send(JSON.stringify(msg))`)

| `type` | Additional Parameters | Description |
| --- | --- | --- |
| `"setupStatus"` | *(none)* | Requests current `arduino-cli` toolchain installation status

 |
| `"setupInstall"` | *(none)* | Downloads and installs `arduino-cli` and `arduino:avr` cores

 |
| `"listBoards"` | *(none)* | Scans USB serial ports for connected boards

 |
| `"upload"` | `code` (`string`), `fqbn` (`string`), `port` (`string`) | Compiles `code` for `fqbn` (e.g. `"arduino:avr:uno"`) and uploads to `port` (e.g. `"/dev/ttyACM0"`)

 |
| `"monitorStart"` | `port` (`string`), `baud` (`number`, default `9600`) | Opens the live serial monitor on `port`

 |
| `"monitorStop"` | *(none)* | Closes the active serial monitor

 |

### Server → Client Messages (`ws.onmessage`)

| `type` | Payload Fields | Description |
| --- | --- | --- |
| `"setup"` | `status`: `{ platform, home, supported, cliInstalled, cli, version, cores, ready }`, `installing` (`boolean`) | Toolchain status update (sent automatically on connect and after install)

 |
| `"boards"` | `boards`: `[{ address, protocol, label, boardName, fqbn }]` | List of detected USB serial boards

 |
| `"refreshBoards"` | *(none)* | Instructs client to send `{ type: "listBoards" }`

 |
| `"log"` | `text` (`string`) | Compiler, uploader, or toolchain installer output chunk

 |
| `"serial"` | `text` (`string`) | Incoming serial monitor data from the physical board

 |
| `"busy"` | `busy` (`boolean`) | `true` while compiling/uploading, `false` when finished

 |
| `"monitorState"` | `running` (`boolean`) | `true` when serial monitor is open, `false` when closed

 |