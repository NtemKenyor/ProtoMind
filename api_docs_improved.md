
---

## ProtoMind API Reference

**Base URL:** `http://localhost:3000`

All endpoints accept and return JSON. No auth is required on the local server itself.

---

### 1. `GET /health`

Basic liveness check.

```bash
curl http://localhost:3000/health
```

**Response:**
```json
{ "ok": true, "app": "ProtoMind" }
```

---

### 2. `GET /api/ai/models`

Lists all Muse AI profiles and which provider keys are configured.

```bash
curl http://localhost:3000/api/ai/models
```

**Response (abridged):**
```json
{
  "ok": true,
  "defaultProfile": "smart",
  "providers": { "meta": true, "openai": false, "gemini": false, "anthropic": false, "builtinFallback": true },
  "metaBaseUrl": "https://api.meta.ai/v1",
  "profiles": [
    { "id": "fast", "name": "Muse Spark 1.3 (Fast / Low-Latency)", "model": "muse-spark-1.3", "description": "..." },
    { "id": "smart", "name": "Muse Spark 1.3 (Balanced Generalist)", "model": "muse-spark-1.3", "description": "..." },
    { "id": "architect", "name": "Muse Wonder 1.0 (Deep Hardware & System Architect)", "model": "muse-wonder-1.0", "description": "..." },
    { "id": "code", "name": "Muse Spark 1.3 (Firmware & Code)", "model": "muse-spark-1.3", "description": "..." },
    { "id": "vision", "name": "Muse Vision (Multimodal)", "model": "muse-spark-1.3", "description": "..." }
  ]
}
```

---

### 3. `POST /api/ai`

The main unified AI bridge. Works for all three projects.

**Body fields:**

| Field | Type | Required | Description |
|---|---|---|---|
| `project` | string | yes | `protomind`, `protoweb`, or `protogame` |
| `action` | string | yes* | e.g. `design-project`, `check-wiring`, `general` |
| `prompt` | string | yes* | The user request |
| `context` | object | no | Circuit, HTML section, or existing level |
| `metaProfile` | string | no | `fast`, `smart`, `architect`, `code`, `vision` (default `smart`) |
| `model` | string | no | Override the profile's model ID |

\*At least one of `prompt` or `action` is required.

#### 3a. ProtoMind — design a circuit

```bash
curl -X POST http://localhost:3000/api/ai \
  -H "Content-Type: application/json" \
  -d '{
    "project": "protomind",
    "action": "design-project",
    "prompt": "simple LED blink"
  }'
```

**Response shape:**
```json
{
  "title": "simple LED blink",
  "reply": "⚡ ...",
  "spiceNetlist": "* simple LED blink\nU1 ...\n.end",
  "suggestedCode": "// ...",
  "suggestedCircuit": null,
  "provider": "meta" | "builtin-structured",
  "modelUsed": "muse-spark-1.3",
  "aiError": null | "fetch failed"
}
```

#### 3b. ProtoMind — check an existing circuit's wiring

```bash
curl -X POST http://localhost:3000/api/ai \
  -H "Content-Type: application/json" \
  -d '{
    "project": "protomind",
    "action": "check-wiring",
    "prompt": "check my wiring",
    "context": {
      "comps": [
        { "type": "uno", "x": 60, "y": 120 },
        { "type": "led", "x": 300, "y": 150 }
      ],
      "wires": [
        { "from": { "compIndex": 0, "pin": "D13" }, "to": { "compIndex": 1, "pin": "A" } },
        { "from": { "compIndex": 1, "pin": "K" }, "to": { "compIndex": 0, "pin": "GND" } }
      ]
    }
  }'
```

The reply will flag missing resistors, missing GND, etc.

#### 3c. ProtoWeb — edit an HTML section

```bash
curl -X POST http://localhost:3000/api/ai \
  -H "Content-Type: application/json" \
  -d '{
    "project": "protoweb",
    "action": "edit-section",
    "prompt": "make this dark with glassmorphism",
    "context": {
      "sectionHtml": "<section style=\"padding:40px;background:#fff;\"><h2>Hello</h2></section>",
      "tagName": "SECTION"
    }
  }'
```

**Response:** `{ "html": "...", "explanation": "🌙 Applied dark glassmorphism theme..." }`

#### 3d. ProtoGame — generate a level

```bash
curl -X POST http://localhost:3000/api/ai \
  -H "Content-Type: application/json" \
  -d '{
    "project": "protogame",
    "action": "generate-level",
    "prompt": "cyber ninja escape from a megacorp tower"
  }'
```

**Response:** `{ "level": { "title": "...", "platforms": [...], "coins": [...], ... }, "reply": "🎮 Generated..." }`

#### 3e. Force a specific profile (e.g. Muse Wonder for deep reasoning)

```bash
curl -X POST http://localhost:3000/api/ai \
  -H "Content-Type: application/json" \
  -d '{
    "project": "protomind",
    "action": "design-project",
    "prompt": "design a weather station with DHT22, LCD, and ESP32",
    "metaProfile": "architect"
  }'
```

---

### 4. `POST /api/ai/meta` and `POST /api/ai/meta/:profile`

Direct access to the Meta gateway. Same body as `/api/ai`, but the profile can be set in the URL path.

```bash
# Profile via URL
curl -X POST http://localhost:3000/api/ai/meta/architect \
  -H "Content-Type: application/json" \
  -d '{
    "project": "protomind",
    "action": "design-project",
    "prompt": "smart plant watering system"
  }'
```

```bash
# Profile via body
curl -X POST http://localhost:3000/api/ai/meta \
  -H "Content-Type: application/json" \
  -d '{
    "project": "protomind",
    "profile": "fast",
    "prompt": "blink an LED"
  }'
```

---

### 5. `POST /api/ai/chat`

Stateful multi-turn chat. The server keeps history per `sessionId` (up to 16 turns).

```bash
curl -X POST http://localhost:3000/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "user-1",
    "project": "protomind",
    "profile": "smart",
    "prompt": "design a traffic light controller",
    "context": {}
  }'
```

Follow-up (same session — keeps context):

```bash
curl -X POST http://localhost:3000/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{
    "sessionId": "user-1",
    "project": "protomind",
    "prompt": "now add a pedestrian button"
  }'
```

**Response includes** `sessionId` and `turnCount` in addition to the normal design fields.

**Reset the session:**

```bash
curl -X POST http://localhost:3000/api/ai/chat \
  -H "Content-Type: application/json" \
  -d '{ "sessionId": "user-1", "reset": true, "prompt": "start over" }'
```

---

### 6. `DELETE /api/ai/chat/:sessionId`

Forget a chat session entirely.

```bash
curl -X DELETE http://localhost:3000/api/ai/chat/user-1
```

**Response:** `{ "ok": true, "cleared": "user-1" }`

---

### 7. `POST /api/ai/spice`

Dedicated SPICE netlist + firmware synthesizer. Always returns a valid design structure.

```bash
curl -X POST http://localhost:3000/api/ai/spice \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "temperature-controlled fan with DHT22",
    "context": {}
  }'
```

**Response:**
```json
{ "ok": true, "title": "...", "spiceNetlist": "* ...\n.end", "suggestedCode": "// ...", "reply": "..." }
```

---

### 8. `POST /api/ai/image`

Generate a schematic blueprint. Tries **Muse Image** first (if `MODEL_API_KEY` is set), falls back to OpenAI (if `ENABLE_EXTERNAL_IMAGE_API=true`), then a built-in SVG.

```bash
curl -X POST http://localhost:3000/api/ai/image \
  -H "Content-Type: application/json" \
  -d '{
    "title": "Smart Plant Watering System",
    "description": "Arduino Uno with soil moisture sensor and relay-driven pump",
    "code": "void setup(){ Serial.begin(9600); }",
    "spiceNetlist": "* Plant Waterer\nU1 5V GND D4 A0 ARDUINO_UNO\nX1 5V GND A0 SOIL_MOISTURE\n.end"
  }'
```

**Response:**
```json
{ "imageUrl": "data:image/svg+xml;base64,..." | "https://...", "source": "muse-image" | "openai-image" | "blueprint-svg" }
```

To open the returned data URL in a browser, save it to a file:

```bash
curl -s -X POST http://localhost:3000/api/ai/image \
  -H "Content-Type: application/json" \
  -d '{ "title": "Test", "spiceNetlist": "* Test\nU1 5V GND ARDUINO_UNO\n.end" }' \
  | python3 -c "import sys,json,base64; d=json.load(sys.stdin)['imageUrl']; print('Saving...'); open('blueprint.svg','wb').write(base64.b64decode(d.split(',')[1]))"
```

---

## Quick self-test script

Save as `test-api.sh` and run `bash test-api.sh` to verify everything in sequence:

```bash
#!/usr/bin/env bash
BASE=http://localhost:3000
H='Content-Type: application/json'

echo "1. health"; curl -s $BASE/health; echo
echo "2. models"; curl -s $BASE/api/ai/models | head -c 200; echo
echo "3. design"; curl -s -X POST $BASE/api/ai -H "$H" \
  -d '{"project":"protomind","action":"design-project","prompt":"simple LED blink"}' | head -c 200; echo
echo "4. wiring check"; curl -s -X POST $BASE/api/ai -H "$H" \
  -d '{"project":"protomind","action":"check-wiring","prompt":"check","context":{"comps":[{"type":"uno"}],"wires":[]}}' | head -c 200; echo
echo "5. web"; curl -s -X POST $BASE/api/ai -H "$H" \
  -d '{"project":"protoweb","action":"edit-section","prompt":"make dark","context":{"sectionHtml":"<section><h2>Hi</h2></section>","tagName":"SECTION"}}' | head -c 200; echo
echo "6. game"; curl -s -X POST $BASE/api/ai -H "$H" \
  -d '{"project":"protogame","action":"generate-level","prompt":"forest spirit quest"}' | head -c 200; echo
echo "7. chat"; curl -s -X POST $BASE/api/ai/chat -H "$H" \
  -d '{"sessionId":"t1","project":"protomind","prompt":"traffic light"}' | head -c 200; echo
echo "8. spice"; curl -s -X POST $BASE/api/ai/spice -H "$H" \
  -d '{"prompt":"temperature fan"}' | head -c 200; echo
echo "9. image"; curl -s -X POST $BASE/api/ai/image -H "$H" \
  -d '{"title":"Test","spiceNetlist":"* Test\nU1 5V GND ARDUINO_UNO\n.end"}' | head -c 120; echo
echo "10. delete chat"; curl -s -X DELETE $BASE/api/ai/chat/t1; echo
```

---

