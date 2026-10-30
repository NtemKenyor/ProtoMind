// ProtoMind - tiny launcher.
// Serves the hub at /, and mounts each sub-project under its own path:
//   /            -> public/index.html            (hub)
//   /protomind   -> projects/ProtoMind4004       (router + WebSocket at /protomind/ws)
//   /protoweb    -> projects/ProtoWeb            (static)
//   /protogame   -> projects/ProtoGame           (static)
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');

// ── Lightweight .env loader (no dotenv dependency) ──────────────────────────
(function loadEnv() {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const raw of lines) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      // strip surrounding quotes
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
        val = val.slice(1, -1);
      if (!process.env[key]) process.env[key] = val;
    }
  }
})();

const PORT = process.env.PORT || 3000;
const HOST = '127.0.0.1'; // local-only on purpose: this server can flash boards over USB

const protomind = require('./projects/ProtoMind4004/server');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.get('/health', (_req, res) => res.json({ ok: true, app: 'ProtoMind' }));

app.use('/protomind', protomind.router);
app.use('/protoweb', express.static(path.join(__dirname, 'projects', 'ProtoWeb')));
app.use('/protogame', express.static(path.join(__dirname, 'projects', 'ProtoGame')));

// ── POST /api/ai  — Unified AI bridge for all 3 projects ───────────────────
app.post('/api/ai', async (req, res) => {
  const { project, action, prompt, context } = req.body || {};
  if (!prompt && !action) return res.status(400).json({ error: 'prompt or action required' });

  // Determine which external API key is available
  const metaKey = process.env.META_API_KEY;
  const openaiKey = process.env.OPENAI_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY;
  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  const placeholder = 'THE_META_API_KEY';

  const hasExternalKey =
    (metaKey && metaKey !== placeholder) ||
    (openaiKey && openaiKey !== placeholder) ||
    (geminiKey && geminiKey !== placeholder) ||
    (anthropicKey && anthropicKey !== placeholder);

  // System prompts per project
  const systemPrompts = {
    protomind: `You are ProtoMind AI Hardware Tutor. You help kids and beginners understand electronics and microcontroller circuits. 
Given a schematic (components, wires, code), you:
- Explain how the circuit works in plain language
- Diagnose problems (missing GND, missing resistor, wrong pin connections)
- Generate working Arduino/ESP32/Pico C++ firmware code
Respond in JSON: { "reply": "explanation text", "suggestedCode": "C++ code or null", "suggestedCircuit": null }`,
    protoweb: `You are ProtoWeb AI Co-Pilot. You edit ONLY the given HTML section/element.
Given the selected element's HTML and a user prompt, return JSON: { "html": "the modified HTML for just this element", "explanation": "what you changed and why" }
Keep inline styles. Do NOT wrap in extra body/html tags. Only return the single element requested.`,
    protogame: `You are ProtoGame AI Level Designer. Given a story/script prompt and optional existing level data, generate a complete 2D platformer level.
Return JSON: { "level": { "title":"string", "storyIntro":"string", "theme":{"bg":"#hex","platform":"#hex","accent":"#hex"}, "gravity":1800, "jumpForce":-600, "speed":320, "playerSpawn":{"x":80,"y":500}, "platforms":[{"x":0,"y":580,"w":800,"h":20}], "coins":[{"x":200,"y":500}], "enemies":[{"x":400,"y":560,"patrol":100,"speed":60}], "hazards":[{"x":300,"y":570,"w":40,"h":10}], "npcs":[{"x":600,"y":540,"name":"NPC","dialogue":["Hello!","Good luck!"]}], "portal":{"x":750,"y":540} }, "reply":"what you created" }`
  };

  // Try external LLM call
  if (hasExternalKey) {
    try {
      const result = await callExternalLLM({ metaKey, openaiKey, geminiKey, anthropicKey, project, action, prompt, context, systemPrompts });
      if (result) return res.json(result);
    } catch (e) {
      console.error('[AI] External LLM call failed, falling back to built-in engine:', e.message);
    }
  }

  // ── Built-in smart fallback engine ────────────────────────────────────────
  try {
    const result = builtInEngine(project, action, prompt, context);
    return res.json(result);
  } catch (e) {
    console.error('[AI] Built-in engine error:', e);
    return res.status(500).json({ error: 'AI engine failed', detail: e.message });
  }
});

// ── External LLM caller ────────────────────────────────────────────────────
async function callExternalLLM({ metaKey, openaiKey, geminiKey, anthropicKey, project, action, prompt, context, systemPrompts }) {
  const placeholder = 'THE_META_API_KEY';
  const system = systemPrompts[project] || systemPrompts.protomind;
  const userMsg = `Action: ${action || 'general'}\nPrompt: ${prompt}\nContext: ${JSON.stringify(context || {})}`;

  // OpenAI-compatible
  if (openaiKey && openaiKey !== placeholder) {
    const baseUrl = process.env.AI_BASE_URL || 'https://api.openai.com/v1';
    const model = process.env.AI_MODEL || 'gpt-4o-mini';
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: userMsg }], temperature: 0.7 })
    });
    if (!resp.ok) throw new Error(`OpenAI ${resp.status}`);
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || '';
    return parseAIResponse(text);
  }

  // Gemini
  if (geminiKey && geminiKey !== placeholder) {
    const model = process.env.AI_MODEL || 'gemini-2.0-flash';
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: `${system}\n\n${userMsg}` }] }] })
    });
    if (!resp.ok) throw new Error(`Gemini ${resp.status}`);
    const data = await resp.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return parseAIResponse(text);
  }

  // Meta (Llama via OpenAI-compatible endpoint)
  if (metaKey && metaKey !== placeholder) {
    const baseUrl = process.env.AI_BASE_URL || 'https://api.llama-api.com';
    const model = process.env.AI_MODEL || 'llama3.1-70b';
    const resp = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${metaKey}` },
      body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content: userMsg }], temperature: 0.7 })
    });
    if (!resp.ok) throw new Error(`Meta ${resp.status}`);
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || '';
    return parseAIResponse(text);
  }

  // Anthropic
  if (anthropicKey && anthropicKey !== placeholder) {
    const model = process.env.AI_MODEL || 'claude-sonnet-4-20250514';
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 4096, system, messages: [{ role: 'user', content: userMsg }] })
    });
    if (!resp.ok) throw new Error(`Anthropic ${resp.status}`);
    const data = await resp.json();
    const text = data.content?.[0]?.text || '';
    return parseAIResponse(text);
  }

  return null;
}

function parseAIResponse(text) {
  // Try to extract JSON from the response
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try { return JSON.parse(jsonMatch[0]); } catch {}
  }
  return { reply: text };
}

// ── Built-in deterministic AI synthesis engine ──────────────────────────────
function builtInEngine(project, action, prompt, context) {
  if (project === 'protomind') return protomindEngine(action, prompt, context || {});
  if (project === 'protoweb') return protowebEngine(action, prompt, context || {});
  if (project === 'protogame') return protogameEngine(action, prompt, context || {});
  return { reply: 'Unknown project. Choose protomind, protoweb, or protogame.' };
}

// ── ProtoMind built-in engine ───────────────────────────────────────────────
function protomindEngine(action, prompt, ctx) {
  const comps = ctx.comps || [];
  const wires = ctx.wires || [];
  const code = ctx.code || '';
  const lowerPrompt = (prompt || '').toLowerCase();

  // Detect board type
  const boards = comps.filter(c => ['uno','esp32','pico'].includes(c.type));
  const boardType = boards.length > 0 ? boards[0].type : 'uno';
  const boardNames = { uno: 'Arduino Uno', esp32: 'ESP32 DevKit', pico: 'Raspberry Pi Pico' };
  const boardName = boardNames[boardType] || 'Arduino Uno';

  // Detect components
  const leds = comps.filter(c => c.type === 'led');
  const buttons = comps.filter(c => c.type === 'btn');
  const resistors = comps.filter(c => c.type === 'res');
  const servos = comps.filter(c => c.type === 'servo');
  const ultrasonics = comps.filter(c => c.type === 'ultrasonic');
  const buzzers = comps.filter(c => c.type === 'buzzer');

  // Wiring check
  const issues = [];
  if (leds.length > 0 && resistors.length === 0) {
    issues.push('⚠️ You have LED(s) without a current-limiting resistor. Always place a 220Ω–330Ω resistor in series with an LED to prevent damage.');
  }
  const gndWires = wires.filter(w => w.from?.pin === 'GND' || w.to?.pin === 'GND');
  if (comps.length > 1 && gndWires.length === 0) {
    issues.push('⚠️ No GND connections found. Every component needs a path to ground to complete the circuit.');
  }
  if (ultrasonics.length > 0 && !wires.some(w => (w.from?.pin === 'TRIG' || w.to?.pin === 'TRIG'))) {
    issues.push('⚠️ Ultrasonic sensor TRIG pin is not wired. Connect it to a digital output pin.');
  }
  if (ultrasonics.length > 0 && !wires.some(w => (w.from?.pin === 'ECHO' || w.to?.pin === 'ECHO'))) {
    issues.push('⚠️ Ultrasonic sensor ECHO pin is not wired. Connect it to a digital input pin.');
  }

  // Generate suggested code based on components
  let suggestedCode = null;
  if (lowerPrompt.includes('generate code') || lowerPrompt.includes('code for this') || action === 'generate-code') {
    if (boardType === 'esp32') {
      suggestedCode = generateESP32Code(leds, buttons, servos, ultrasonics, buzzers);
    } else if (boardType === 'pico') {
      suggestedCode = generatePicoCode(leds, buttons, servos, ultrasonics, buzzers);
    } else {
      suggestedCode = generateArduinoCode(leds, buttons, servos, ultrasonics, buzzers);
    }
  }

  // Check wiring prompt
  if (lowerPrompt.includes('check') || lowerPrompt.includes('wiring') || action === 'check-wiring') {
    const summary = [];
    summary.push(`📋 **Circuit Summary for ${boardName}:**`);
    summary.push(`• ${boards.length} board(s), ${leds.length} LED(s), ${resistors.length} resistor(s), ${buttons.length} button(s)`);
    if (servos.length) summary.push(`• ${servos.length} servo(s)`);
    if (ultrasonics.length) summary.push(`• ${ultrasonics.length} ultrasonic sensor(s)`);
    if (buzzers.length) summary.push(`• ${buzzers.length} buzzer(s)`);
    summary.push(`• ${wires.length} wire connection(s)`);
    if (issues.length === 0) {
      summary.push('\n✅ No obvious wiring issues detected! Your circuit looks good.');
    } else {
      summary.push('\n🔍 **Issues Found:**');
      issues.forEach(i => summary.push(i));
    }
    return { reply: summary.join('\n'), suggestedCode, suggestedCircuit: null };
  }

  // How-to guides
  if (lowerPrompt.includes('how to wire') || lowerPrompt.includes('how to connect')) {
    if (lowerPrompt.includes('esp32') && lowerPrompt.includes('ultrasonic')) {
      return {
        reply: howToWireESP32Ultrasonic(),
        suggestedCode: generateESP32Code([], [], [], [{ type: 'ultrasonic' }], []),
        suggestedCircuit: {
          comps: [
            { type: 'esp32', x: 60, y: 150 },
            { type: 'ultrasonic', x: 340, y: 180 }
          ],
          wires: [
            { from: { compIndex: 0, pin: '3V3' }, to: { compIndex: 1, pin: 'VCC' } },
            { from: { compIndex: 0, pin: 'GND' }, to: { compIndex: 1, pin: 'GND' } },
            { from: { compIndex: 0, pin: 'D5' }, to: { compIndex: 1, pin: 'TRIG' } },
            { from: { compIndex: 0, pin: 'D12' }, to: { compIndex: 1, pin: 'ECHO' } }
          ]
        }
      };
    }
    if (lowerPrompt.includes('pico') && lowerPrompt.includes('servo')) {
      return {
        reply: howToWirePicoServo(),
        suggestedCode: generatePicoCode([], [], [{ type: 'servo' }], [], []),
        suggestedCircuit: {
          comps: [
            { type: 'pico', x: 60, y: 150 },
            { type: 'servo', x: 340, y: 180 }
          ],
          wires: [
            { from: { compIndex: 0, pin: 'GP0' }, to: { compIndex: 1, pin: 'PWM' } },
            { from: { compIndex: 0, pin: '3V3' }, to: { compIndex: 1, pin: 'VCC' } },
            { from: { compIndex: 0, pin: 'GND' }, to: { compIndex: 1, pin: 'GND' } }
          ]
        }
      };
    }
    if (lowerPrompt.includes('esp32')) {
      return { reply: `🔌 **Wiring Guide for ESP32:**\n\n1. **Power:** ESP32 runs on 3.3V logic. Use the 3V3 pin for sensors, VIN for 5V components.\n2. **LEDs:** Connect LED anode → resistor → GPIO pin (e.g., D2). LED cathode → GND.\n3. **Buttons:** One side to GPIO (e.g., D4), other to GND. Use INPUT_PULLUP in code.\n4. **Servos:** Signal → GPIO (e.g., D13), VCC → 5V (external), GND → GND.\n5. **Ultrasonic:** VCC → 5V, TRIG → GPIO, ECHO → GPIO (use voltage divider!), GND → GND.`, suggestedCode: null, suggestedCircuit: null };
    }
    if (lowerPrompt.includes('pico')) {
      return { reply: `🔌 **Wiring Guide for Raspberry Pi Pico:**\n\n1. **Power:** Pico runs on 3.3V logic. Use the 3V3(OUT) pin.\n2. **LEDs:** Connect LED anode → resistor → GP pin (e.g., GP15). LED cathode → GND.\n3. **Buttons:** One side to GP pin (e.g., GP14), other to GND. Use INPUT_PULLUP.\n4. **Servos:** Signal → GP pin with PWM (e.g., GP0), VCC → VBUS (5V), GND → GND.\n5. **Built-in LED:** GP25 controls the onboard LED.`, suggestedCode: null, suggestedCircuit: null };
    }
  }

  // Default: describe the circuit
  const parts = [];
  parts.push(`🤖 **Your ${boardName} Circuit:**`);
  parts.push(`You have ${comps.length} component(s) connected with ${wires.length} wire(s).`);
  if (leds.length) parts.push(`💡 ${leds.length} LED(s) — light-emitting diodes that glow when current flows through them.`);
  if (buttons.length) parts.push(`🔘 ${buttons.length} button(s) — push switches that connect/disconnect the circuit.`);
  if (resistors.length) parts.push(`⚡ ${resistors.length} resistor(s) — limit current to protect components like LEDs.`);
  if (servos.length) parts.push(`🔄 ${servos.length} servo(s) — motors that rotate to a specific angle.`);
  if (ultrasonics.length) parts.push(`📏 ${ultrasonics.length} ultrasonic sensor(s) — measure distance using sound waves.`);
  if (buzzers.length) parts.push(`🔊 ${buzzers.length} buzzer(s) — make sound when powered.`);
  if (issues.length) { parts.push('\n🔍 **Tips:**'); issues.forEach(i => parts.push(i)); }
  parts.push('\n💡 Try clicking "Generate Code for This Circuit" to get starter firmware!');
  return { reply: parts.join('\n'), suggestedCode, suggestedCircuit: null };
}

function generateArduinoCode(leds, buttons, servos, ultrasonics, buzzers) {
  let code = '// ProtoMind4004 - Auto-generated Arduino sketch\n';
  if (servos.length) code += '#include <Servo.h>\n';
  code += '\n';
  const ledPin = 13, btnPin = 2, servoPin = 9, trigPin = 7, echoPin = 6, buzzPin = 5;
  if (leds.length) code += `const int LED_PIN = ${ledPin};\n`;
  if (buttons.length) code += `const int BTN_PIN = ${btnPin};\n`;
  if (servos.length) code += `Servo myServo;\nconst int SERVO_PIN = ${servoPin};\n`;
  if (ultrasonics.length) code += `const int TRIG_PIN = ${trigPin};\nconst int ECHO_PIN = ${echoPin};\n`;
  if (buzzers.length) code += `const int BUZZ_PIN = ${buzzPin};\n`;
  code += '\nvoid setup() {\n  Serial.begin(9600);\n';
  if (leds.length) code += '  pinMode(LED_PIN, OUTPUT);\n';
  if (buttons.length) code += '  pinMode(BTN_PIN, INPUT_PULLUP);\n';
  if (servos.length) code += '  myServo.attach(SERVO_PIN);\n';
  if (ultrasonics.length) code += '  pinMode(TRIG_PIN, OUTPUT);\n  pinMode(ECHO_PIN, INPUT);\n';
  if (buzzers.length) code += '  pinMode(BUZZ_PIN, OUTPUT);\n';
  code += '}\n\nvoid loop() {\n';
  if (buttons.length && leds.length) {
    code += '  // Button controls LED\n  if (digitalRead(BTN_PIN) == LOW) {\n    digitalWrite(LED_PIN, HIGH);\n  } else {\n    digitalWrite(LED_PIN, LOW);\n  }\n';
  } else if (leds.length) {
    code += '  // Blink LED\n  digitalWrite(LED_PIN, HIGH);\n  delay(500);\n  digitalWrite(LED_PIN, LOW);\n  delay(500);\n';
  }
  if (ultrasonics.length) {
    code += '\n  // Measure distance\n  digitalWrite(TRIG_PIN, LOW);\n  delayMicroseconds(2);\n  digitalWrite(TRIG_PIN, HIGH);\n  delayMicroseconds(10);\n  digitalWrite(TRIG_PIN, LOW);\n  long duration = pulseIn(ECHO_PIN, HIGH);\n  float distance = duration * 0.034 / 2;\n  Serial.print("Distance: ");\n  Serial.print(distance);\n  Serial.println(" cm");\n';
  }
  if (servos.length) {
    code += '\n  // Sweep servo\n  for (int angle = 0; angle <= 180; angle += 10) {\n    myServo.write(angle);\n    delay(50);\n  }\n  for (int angle = 180; angle >= 0; angle -= 10) {\n    myServo.write(angle);\n    delay(50);\n  }\n';
  }
  if (buzzers.length) {
    code += '\n  // Beep buzzer\n  tone(BUZZ_PIN, 1000, 200);\n  delay(400);\n';
  }
  code += '  delay(100);\n}\n';
  return code;
}

function generateESP32Code(leds, buttons, servos, ultrasonics, buzzers) {
  let code = '// ProtoMind4004 - Auto-generated ESP32 sketch\n';
  if (servos.length) code += '#include <ESP32Servo.h>\n';
  code += '\n';
  if (leds.length) code += 'const int LED_PIN = 2;\n';
  if (buttons.length) code += 'const int BTN_PIN = 4;\n';
  if (servos.length) code += 'Servo myServo;\nconst int SERVO_PIN = 13;\n';
  if (ultrasonics.length) code += 'const int TRIG_PIN = 5;\nconst int ECHO_PIN = 18;\n';
  if (buzzers.length) code += 'const int BUZZ_PIN = 15;\n';
  code += '\nvoid setup() {\n  Serial.begin(115200);\n';
  if (leds.length) code += '  pinMode(LED_PIN, OUTPUT);\n';
  if (buttons.length) code += '  pinMode(BTN_PIN, INPUT_PULLUP);\n';
  if (servos.length) code += '  myServo.attach(SERVO_PIN);\n';
  if (ultrasonics.length) code += '  pinMode(TRIG_PIN, OUTPUT);\n  pinMode(ECHO_PIN, INPUT);\n';
  if (buzzers.length) code += '  pinMode(BUZZ_PIN, OUTPUT);\n';
  code += '}\n\nvoid loop() {\n';
  if (leds.length) code += '  digitalWrite(LED_PIN, HIGH);\n  delay(500);\n  digitalWrite(LED_PIN, LOW);\n  delay(500);\n';
  if (ultrasonics.length) code += '\n  digitalWrite(TRIG_PIN, LOW);\n  delayMicroseconds(2);\n  digitalWrite(TRIG_PIN, HIGH);\n  delayMicroseconds(10);\n  digitalWrite(TRIG_PIN, LOW);\n  long dur = pulseIn(ECHO_PIN, HIGH);\n  Serial.printf("Distance: %.1f cm\\n", dur * 0.034 / 2);\n';
  if (servos.length) code += '\n  myServo.write(0);\n  delay(1000);\n  myServo.write(90);\n  delay(1000);\n  myServo.write(180);\n  delay(1000);\n';
  if (buzzers.length) code += '\n  tone(BUZZ_PIN, 1000, 200);\n  delay(400);\n';
  code += '  delay(100);\n}\n';
  return code;
}

function generatePicoCode(leds, buttons, servos, ultrasonics, buzzers) {
  let code = '// ProtoMind4004 - Auto-generated Raspberry Pi Pico (Arduino core) sketch\n';
  if (servos.length) code += '#include <Servo.h>\n';
  code += '\n';
  if (leds.length) code += 'const int LED_PIN = 25; // onboard LED\n';
  if (buttons.length) code += 'const int BTN_PIN = 14;\n';
  if (servos.length) code += 'Servo myServo;\nconst int SERVO_PIN = 0;\n';
  if (ultrasonics.length) code += 'const int TRIG_PIN = 2;\nconst int ECHO_PIN = 3;\n';
  if (buzzers.length) code += 'const int BUZZ_PIN = 15;\n';
  code += '\nvoid setup() {\n  Serial.begin(115200);\n';
  if (leds.length) code += '  pinMode(LED_PIN, OUTPUT);\n';
  if (buttons.length) code += '  pinMode(BTN_PIN, INPUT_PULLUP);\n';
  if (servos.length) code += '  myServo.attach(SERVO_PIN);\n';
  if (ultrasonics.length) code += '  pinMode(TRIG_PIN, OUTPUT);\n  pinMode(ECHO_PIN, INPUT);\n';
  if (buzzers.length) code += '  pinMode(BUZZ_PIN, OUTPUT);\n';
  code += '}\n\nvoid loop() {\n';
  if (leds.length) code += '  digitalWrite(LED_PIN, HIGH);\n  delay(500);\n  digitalWrite(LED_PIN, LOW);\n  delay(500);\n';
  if (ultrasonics.length) code += '\n  digitalWrite(TRIG_PIN, LOW);\n  delayMicroseconds(2);\n  digitalWrite(TRIG_PIN, HIGH);\n  delayMicroseconds(10);\n  digitalWrite(TRIG_PIN, LOW);\n  long dur = pulseIn(ECHO_PIN, HIGH);\n  float dist = dur * 0.034 / 2;\n  Serial.print("Distance: ");\n  Serial.print(dist);\n  Serial.println(" cm");\n';
  if (servos.length) code += '\n  for (int a = 0; a <= 180; a += 10) { myServo.write(a); delay(50); }\n  for (int a = 180; a >= 0; a -= 10) { myServo.write(a); delay(50); }\n';
  if (buzzers.length) code += '\n  tone(BUZZ_PIN, 1000, 200);\n  delay(400);\n';
  code += '  delay(100);\n}\n';
  return code;
}

function howToWireESP32Ultrasonic() {
  return `🔌 **How to Wire ESP32 + HC-SR04 Ultrasonic Sensor:**

**Components needed:** ESP32 DevKit, HC-SR04, breadboard, jumper wires

**Connections:**
1. **VCC** (HC-SR04) → **5V / VIN** (ESP32) — the sensor needs 5V
2. **TRIG** (HC-SR04) → **D5** (ESP32) — trigger pin, digital output
3. **ECHO** (HC-SR04) → **Voltage Divider** → **D18** (ESP32) 
   ⚠️ The ECHO pin outputs 5V but ESP32 is 3.3V! Use a voltage divider:
   ECHO → 1kΩ resistor → D18 → 2kΩ resistor → GND
4. **GND** (HC-SR04) → **GND** (ESP32)

**How it works:**
• Send a 10µs HIGH pulse on TRIG
• HC-SR04 sends ultrasonic burst and waits for echo
• ECHO pin goes HIGH for duration proportional to distance
• Distance = (duration × speed_of_sound) / 2`;
}

function howToWirePicoServo() {
  return `🔌 **How to Wire Raspberry Pi Pico + Servo Motor:**

**Components needed:** Pi Pico, SG90 Micro Servo, breadboard, jumper wires

**Connections:**
1. **Signal** (Orange/Yellow wire) → **GP0** (Pico) — PWM control
2. **VCC** (Red wire) → **VBUS** (Pico pin 40, 5V from USB) — servo needs 5V
3. **GND** (Brown/Black wire) → **GND** (Pico)

⚠️ **Important:** If using multiple servos, use an external 5V power supply 
   instead of VBUS to avoid overloading the USB power.

**How it works:**
• Servos use PWM (Pulse Width Modulation) to set angle
• 1ms pulse = 0°, 1.5ms pulse = 90°, 2ms pulse = 180°
• The Servo library handles this — just call myServo.write(angle)`;
}

// ── ProtoWeb built-in engine ────────────────────────────────────────────────
function protowebEngine(action, prompt, ctx) {
  const html = ctx.sectionHtml || ctx.html || '<div>Empty</div>';
  const tagName = (ctx.tagName || 'SECTION').toLowerCase();
  const lp = (prompt || '').toLowerCase();

  if (lp.includes('dark') || lp.includes('glassmorphism')) {
    const modified = html
      .replace(/background-color:\s*[^;]+/gi, 'background-color: #0f172a')
      .replace(/background:\s*[^;]+/gi, 'background: linear-gradient(135deg, rgba(15,23,42,0.95), rgba(30,41,59,0.9))')
      .replace(/color:\s*#[0-9a-fA-F]{3,8}/gi, 'color: #e2e8f0')
      .replace(/border:\s*[^;]+/gi, 'border: 1px solid rgba(148,163,184,0.2)')
      .replace(/border-radius:\s*[^;]+/gi, 'border-radius: 16px');
    const withGlass = modified.replace(
      new RegExp(`<${tagName}`, 'i'),
      `<${tagName} style="backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);"`
    );
    return {
      html: withGlass.includes('backdrop-filter') ? withGlass : modified,
      explanation: '🌙 Applied dark glassmorphism theme: dark slate background with blur effect, light text, subtle borders, and rounded corners.'
    };
  }

  if (lp.includes('card') || lp.includes('feature') || lp.includes('3-column') || lp.includes('three column')) {
    return {
      html: `<section style="padding: 64px 32px; background-color: #f8fafc;">
  <h2 style="text-align: center; font-size: 28px; font-weight: 800; color: #0f172a; margin: 0 0 12px 0;">Features</h2>
  <p style="text-align: center; font-size: 16px; color: #64748b; margin: 0 0 40px 0;">Everything you need to build amazing things</p>
  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 24px; max-width: 960px; margin: 0 auto;">
    <div style="padding: 28px; background: white; border-radius: 16px; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(15,23,42,0.06);">
      <div style="width: 48px; height: 48px; border-radius: 12px; background: linear-gradient(135deg, #6366f1, #8b5cf6); display: flex; align-items: center; justify-content: center; font-size: 24px; margin-bottom: 16px;">⚡</div>
      <h3 style="font-size: 18px; font-weight: 700; color: #0f172a; margin: 0 0 8px 0;">Lightning Fast</h3>
      <p style="font-size: 14px; color: #64748b; margin: 0; line-height: 1.6;">Optimized performance that loads in milliseconds. Your users won't wait.</p>
    </div>
    <div style="padding: 28px; background: white; border-radius: 16px; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(15,23,42,0.06);">
      <div style="width: 48px; height: 48px; border-radius: 12px; background: linear-gradient(135deg, #06b6d4, #0ea5e9); display: flex; align-items: center; justify-content: center; font-size: 24px; margin-bottom: 16px;">🎨</div>
      <h3 style="font-size: 18px; font-weight: 700; color: #0f172a; margin: 0 0 8px 0;">Beautiful Design</h3>
      <p style="font-size: 14px; color: #64748b; margin: 0; line-height: 1.6;">Crafted with attention to every pixel. Modern, clean, and professional.</p>
    </div>
    <div style="padding: 28px; background: white; border-radius: 16px; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(15,23,42,0.06);">
      <div style="width: 48px; height: 48px; border-radius: 12px; background: linear-gradient(135deg, #f59e0b, #ef4444); display: flex; align-items: center; justify-content: center; font-size: 24px; margin-bottom: 16px;">🔒</div>
      <h3 style="font-size: 18px; font-weight: 700; color: #0f172a; margin: 0 0 8px 0;">Secure & Reliable</h3>
      <p style="font-size: 14px; color: #64748b; margin: 0; line-height: 1.6;">Enterprise-grade security and 99.9% uptime. Built to scale.</p>
    </div>
  </div>
</section>`,
      explanation: '🃏 Created a 3-column feature cards section with gradient icons, clean typography, and subtle shadows.'
    };
  }

  if (lp.includes('pricing')) {
    return {
      html: `<section style="padding: 64px 32px; background: linear-gradient(180deg, #f8fafc, #eef2ff);">
  <h2 style="text-align: center; font-size: 32px; font-weight: 800; color: #0f172a; margin: 0 0 8px 0;">Simple Pricing</h2>
  <p style="text-align: center; color: #64748b; margin: 0 0 40px 0;">No hidden fees. Cancel anytime.</p>
  <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 24px; max-width: 800px; margin: 0 auto;">
    <div style="padding: 32px; background: white; border-radius: 16px; border: 1px solid #e2e8f0; text-align: center;">
      <h3 style="font-size: 18px; font-weight: 600; color: #64748b; margin: 0 0 8px;">Starter</h3>
      <div style="font-size: 48px; font-weight: 800; color: #0f172a; margin: 0 0 4px;">$9<span style="font-size: 16px; font-weight: 400; color: #94a3b8;">/mo</span></div>
      <p style="font-size: 14px; color: #94a3b8; margin: 0 0 24px;">For individuals</p>
      <button style="width: 100%; padding: 12px; background: #0f172a; color: white; border: none; border-radius: 10px; font-weight: 600; cursor: pointer;">Get Started</button>
    </div>
    <div style="padding: 32px; background: linear-gradient(135deg, #4f46e5, #6366f1); border-radius: 16px; text-align: center; position: relative; box-shadow: 0 20px 40px rgba(79,70,229,0.3);">
      <div style="position: absolute; top: -12px; left: 50%; transform: translateX(-50%); background: #fbbf24; color: #0f172a; font-size: 11px; font-weight: 700; padding: 4px 14px; border-radius: 99px;">POPULAR</div>
      <h3 style="font-size: 18px; font-weight: 600; color: #c7d2fe; margin: 0 0 8px;">Pro</h3>
      <div style="font-size: 48px; font-weight: 800; color: white; margin: 0 0 4px;">$29<span style="font-size: 16px; font-weight: 400; color: #c7d2fe;">/mo</span></div>
      <p style="font-size: 14px; color: #c7d2fe; margin: 0 0 24px;">For teams</p>
      <button style="width: 100%; padding: 12px; background: white; color: #4f46e5; border: none; border-radius: 10px; font-weight: 600; cursor: pointer;">Get Started</button>
    </div>
  </div>
</section>`,
      explanation: '💰 Created a pricing section with Starter and Pro tiers, highlighted popular plan, and call-to-action buttons.'
    };
  }

  if (lp.includes('mobile') || lp.includes('responsive') || lp.includes('flex')) {
    const modified = html
      .replace(/display:\s*(block|inline-block|grid)/gi, 'display: flex')
      .replace(/(style=")/i, '$1display: flex; flex-wrap: wrap; gap: 16px; ');
    return {
      html: modified,
      explanation: '📱 Converted layout to flex with wrap for mobile-friendly responsiveness. Elements will stack on smaller screens.'
    };
  }

  if (lp.includes('typography') || lp.includes('polish') || lp.includes('cta')) {
    const modified = html
      .replace(/font-size:\s*\d+px/gi, (m) => {
        const size = parseInt(m.match(/\d+/)[0]);
        return `font-size: ${Math.round(size * 1.1)}px`;
      })
      .replace(/font-weight:\s*\d+/gi, (m) => {
        const w = parseInt(m.match(/\d+/)[0]);
        return `font-weight: ${Math.min(w + 100, 900)}`;
      });
    return {
      html: modified,
      explanation: '✨ Polished typography: increased font sizes by 10% and bumped font weights for stronger visual hierarchy.'
    };
  }

  // Default: generic improvement
  const improved = html
    .replace(/border-radius:\s*\d+px/gi, 'border-radius: 12px')
    .replace(/padding:\s*\d+px/gi, 'padding: 24px');
  return {
    html: improved,
    explanation: `✏️ Applied general improvements based on your prompt: "${prompt}". Updated spacing and border radius for a cleaner look.`
  };
}

// ── ProtoGame built-in engine ───────────────────────────────────────────────
function protogameEngine(action, prompt, ctx) {
  const lp = (prompt || '').toLowerCase();
  const existingLevel = ctx.level || null;

  // Theme detection from prompt
  let theme = { bg: '#1a1a2e', platform: '#4a9eff', accent: '#ffd700' };
  let gravity = 1800, jumpForce = -600, speed = 320;

  if (lp.includes('space') || lp.includes('star') || lp.includes('galaxy')) {
    theme = { bg: '#0a0a23', platform: '#2d3a8c', accent: '#00e5ff' };
    gravity = 1200; jumpForce = -500;
  } else if (lp.includes('forest') || lp.includes('spirit') || lp.includes('nature') || lp.includes('tree')) {
    theme = { bg: '#1a2f1a', platform: '#4a7c3f', accent: '#7cfc00' };
  } else if (lp.includes('lava') || lp.includes('fire') || lp.includes('volcano') || lp.includes('neon') || lp.includes('factory') || lp.includes('cyber')) {
    theme = { bg: '#1a0a0a', platform: '#c0392b', accent: '#ff6b35' };
  } else if (lp.includes('ice') || lp.includes('snow') || lp.includes('frost')) {
    theme = { bg: '#e8f4f8', platform: '#5bc0de', accent: '#fff' };
  } else if (lp.includes('desert') || lp.includes('sand')) {
    theme = { bg: '#f4e4c1', platform: '#d4a574', accent: '#ff8c42' };
  } else if (lp.includes('ocean') || lp.includes('underwater') || lp.includes('sea')) {
    theme = { bg: '#0a1628', platform: '#1e6091', accent: '#48dbfb' };
    gravity = 1000; jumpForce = -450;
  } else if (lp.includes('moon') || lp.includes('low gravity')) {
    gravity = 800; jumpForce = -400;
    theme = { bg: '#1c1c3a', platform: '#5a5a7a', accent: '#c0c0ff' };
  }

  // Adjustments to existing level
  if (existingLevel && (lp.includes('lower gravity') || lp.includes('moon') || lp.includes('low gravity'))) {
    const updated = { ...existingLevel, gravity: Math.round(existingLevel.gravity * 0.6), jumpForce: Math.round(existingLevel.jumpForce * 0.75) };
    return { level: updated, reply: `🌙 Gravity reduced to ${updated.gravity} (was ${existingLevel.gravity}). Jump force adjusted to ${updated.jumpForce}. It'll feel floaty like the moon!` };
  }

  if (existingLevel && lp.includes('moving platform')) {
    const count = parseInt(lp.match(/(\d+)/)?.[1]) || 3;
    const updated = { ...existingLevel };
    if (!updated.platforms) updated.platforms = [];
    for (let i = 0; i < count; i++) {
      updated.platforms.push({ x: 200 + i * 200, y: 400 - i * 40, w: 100, h: 16, moving: true, range: 120, speed: 40 + i * 10 });
    }
    return { level: updated, reply: `🔄 Added ${count} moving platforms across the gap! They oscillate horizontally.` };
  }

  if (existingLevel && (lp.includes('npc') || lp.includes('dialogue') || lp.includes('funnier'))) {
    const updated = { ...existingLevel };
    if (updated.npcs && updated.npcs.length > 0) {
      updated.npcs = updated.npcs.map(npc => ({
        ...npc,
        dialogue: [
          "Hey there, brave adventurer! Nice hat... oh wait, you don't have one. 😄",
          "I've been standing here for AGES. My legs are just painted on though, so it's fine.",
          "The goal portal is that way → but watch out for the spiky things. They're not friendly.",
          "Pro tip: jumping helps. I know, I'm a genius."
        ]
      }));
    }
    return { level: updated, reply: '😂 Rewrote all NPC dialogue to be funnier and more playful!' };
  }

  // Extract story elements for title
  let title = 'Untitled Level';
  let storyIntro = 'A brave hero embarks on an adventure!';

  if (lp.includes('cyber ninja') || lp.includes('ninja')) {
    title = 'Cyber Ninja Escape';
    storyIntro = 'In the neon-lit towers of Neo Tokyo, a rogue ninja must escape the megacorp fortress. Dodge laser grids, leap across hovering platforms, and find the exit portal before the security drones catch up!';
    theme = { bg: '#0a0015', platform: '#6c3483', accent: '#00ff88' };
  } else if (lp.includes('forest spirit') || lp.includes('spirit quest')) {
    title = 'Forest Spirit Quest';
    storyIntro = 'The ancient forest is fading. As the last spirit guardian, you must collect the scattered life crystals and speak to the Elder Oak to restore the magic before winter arrives.';
    theme = { bg: '#0d1f0d', platform: '#2d5a1e', accent: '#7cfc00' };
  } else if (lp.includes('space station') || lp.includes('station repair')) {
    title = 'Space Station Repair';
    storyIntro = 'Gravity generators are failing on Space Station Kepler-7. Float through zero-G corridors, collect energy cells, and reach the control room before life support shuts down!';
    theme = { bg: '#050510', platform: '#1a237e', accent: '#64ffda' };
    gravity = 900; jumpForce = -420;
  } else if (lp.includes('robot') || lp.includes('lava') || lp.includes('factory')) {
    title = 'Robot Factory Escape';
    storyIntro = 'A brave robot must jump across lava platforms in a neon factory to talk to the Elder Core and collect energy cells!';
    theme = { bg: '#1a0505', platform: '#b71c1c', accent: '#ff9800' };
  } else if (prompt) {
    title = prompt.slice(0, 40).replace(/[^a-zA-Z0-9 ]/g, '').trim() || 'Custom Level';
    storyIntro = prompt;
  }

  // Generate level layout
  const canvasW = 1600, canvasH = 600;
  const groundY = canvasH - 20;
  const platforms = [
    { x: 0, y: groundY, w: 300, h: 20 },
    { x: 350, y: groundY - 60, w: 120, h: 16 },
    { x: 520, y: groundY - 130, w: 140, h: 16 },
    { x: 720, y: groundY - 80, w: 160, h: 16 },
    { x: 940, y: groundY - 150, w: 120, h: 16 },
    { x: 1100, y: groundY - 60, w: 200, h: 16 },
    { x: 1360, y: groundY, w: 240, h: 20 },
    { x: 400, y: groundY - 200, w: 80, h: 16, moving: true, range: 100, speed: 50 },
  ];

  const coins = [
    { x: 200, y: groundY - 30 },
    { x: 410, y: groundY - 90 },
    { x: 590, y: groundY - 160 },
    { x: 800, y: groundY - 110 },
    { x: 1000, y: groundY - 180 },
    { x: 1200, y: groundY - 90 },
    { x: 1440, y: groundY - 30 },
  ];

  const enemies = [
    { x: 150, y: groundY - 20, patrol: 80, speed: 50 },
    { x: 780, y: groundY - 100, patrol: 60, speed: 70 },
    { x: 1150, y: groundY - 80, patrol: 100, speed: 40 },
  ];

  const hazards = [
    { x: 300, y: groundY - 10, w: 50, h: 10 },
    { x: 880, y: groundY - 10, w: 60, h: 10 },
  ];

  const npcs = [
    { x: 100, y: groundY - 40, name: 'Guide', dialogue: ['Welcome, adventurer!', 'Jump across the platforms and collect coins.', 'Avoid the red enemies and spikes!', 'Reach the portal at the end to win!'] },
    { x: 1400, y: groundY - 40, name: 'Elder', dialogue: ['You made it! Incredible!', storyIntro, 'The portal awaits you. Step through to complete your quest!'] },
  ];

  const level = {
    title,
    storyIntro,
    theme,
    gravity,
    jumpForce,
    speed,
    playerSpawn: { x: 60, y: groundY - 40 },
    platforms,
    coins,
    enemies,
    hazards,
    npcs,
    portal: { x: 1520, y: groundY - 40 },
  };

  return {
    level,
    reply: `🎮 Generated "${title}"!\n\n${storyIntro}\n\n📊 Level stats: ${platforms.length} platforms, ${coins.length} coins, ${enemies.length} enemies, ${hazards.length} hazards, ${npcs.length} NPCs.\nSwitch to Play Mode to try it out!`
  };
}

app.use(express.static(path.join(__dirname, 'public'))); // hub, last so it never shadows a project

const server = http.createServer(app);

// One HTTP server, one upgrade handler: route WebSockets to the right project by path.
server.on('upgrade', (req, socket, head) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === protomind.WS_PATH) return protomind.handleUpgrade(req, socket, head);
  socket.destroy();
});

server.listen(PORT, HOST, () => {
  console.log(`ProtoMind hub        http://localhost:${PORT}/`);
  console.log(`  ProtoMind4004      http://localhost:${PORT}/protomind`);
  console.log(`  ProtoWeb           http://localhost:${PORT}/protoweb`);
  console.log(`  ProtoGame          http://localhost:${PORT}/protogame`);
  console.log(`  AI endpoint        POST http://localhost:${PORT}/api/ai`);
  console.log(`Toolchain folder:    ${protomind.toolchain.appHome()}`);
});
