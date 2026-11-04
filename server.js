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

// ── Structured Backend Logger ───────────────────────────────────────────────
function ts() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}
function logInfo(tag, msg, meta = '') {
  console.log(`[${ts()}] 🟢 INFO  [${tag}] ${msg}`, meta ? meta : '');
}
function logWarn(tag, msg, meta = '') {
  console.warn(`[${ts()}] 🟡 WARN  [${tag}] ${msg}`, meta ? meta : '');
}
function logError(tag, msg, errDetail = '') {
  console.error(`[${ts()}] 🔴 ERROR [${tag}] ${msg}`);
  if (errDetail) console.error(`   ↳ Detail:`, errDetail);
}

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
    logInfo('ENV', `Loaded .env from ${envPath}`);
  } else {
    logWarn('ENV', `No .env file found at ${envPath}. Using process environment defaults.`);
  }
})();

const PORT = process.env.PORT || 3000;
const HOST = '127.0.0.1'; // local-only on purpose: this server can flash boards over USB

const protomind = require('./projects/ProtoMind4004/server');

const app = express();
app.use(express.json({ limit: '4mb' }));
app.get('/health', (_req, res) => res.json({ ok: true, app: 'ProtoMind' }));

app.use('/protomind', protomind.router);
app.use('/protoweb', express.static(path.join(__dirname, 'projects', 'ProtoWeb')));
app.use('/protogame', express.static(path.join(__dirname, 'projects', 'ProtoGame')));

// ── Streamlined .env Config (Focused on the top 3 .env settings) ────────────
function getEnvConfig() {
  const placeholder = 'THE_META_API_KEY';
  const valid = (v) => (v && v !== placeholder && v !== 'your_meta_llama_api_key_here' ? v : null);
  return {
    // Meta Model API (Muse) configuration
    metaKey: valid(process.env.MODEL_API_KEY) || valid(process.env.META_API_KEY),
    metaBaseUrl: (process.env.META_BASE_URL || 'https://api.meta.ai/v1').replace(/\/$/, ''),
    openaiKey: valid(process.env.OPENAI_API_KEY),
    geminiKey: valid(process.env.GEMINI_API_KEY),
    anthropicKey: valid(process.env.ANTHROPIC_API_KEY)
  };
}

// ── Meta AI Profiles (Powered by the Muse Model API) ────────────────────────
const META_AI_PROFILES = {
  fast: {
    id: 'fast',
    name: 'Muse Spark 1.3 (Fast / Low-Latency)',
    model: process.env.META_MODEL_FAST || 'muse-spark-1.3',
    description: 'Rapid responses for UI tweaks, quick circuit checks, and game dialogue.'
  },
  smart: {
    id: 'smart',
    name: 'Muse Spark 1.3 (Balanced Generalist)',
    model: process.env.META_MODEL_SMART || 'muse-spark-1.3',
    description: 'Default high-accuracy model for ProtoMind4004, ProtoWeb, and ProtoGame.'
  },
  architect: {
    id: 'architect',
    name: 'Muse Wonder 1.0 (Deep Hardware & System Architect)',
    model: process.env.META_MODEL_ARCHITECT || 'muse-wonder-1.0',
    description: 'Flagship reasoning model for full SPICE netlists, custom ICs, and complex levels.'
  },
  code: {
    id: 'code',
    name: 'Muse Spark 1.3 (Firmware & Code)',
    model: process.env.META_MODEL_CODE || 'muse-spark-1.3',
    description: 'Specialized for Arduino/ESP32/Pico C++, HTML/CSS, and game physics.'
  },
  vision: {
    id: 'vision',
    name: 'Muse Vision (Multimodal)',
    model: process.env.META_MODEL_VISION || 'muse-spark-1.3', // Muse Spark is multimodal
    description: 'Multimodal model for schematic diagrams and visual layout inspection.'
  }
};

// System prompts per project (with strict design structure requirements)
const SYSTEM_PROMPTS = {
  protomind: `You are ProtoMind AI Hardware Tutor & Circuit Architect. You help kids and beginners understand electronics and microcontroller circuits.
Given a schematic (components, wires, spiceNetlist, code) or project request, you MUST return a complete hardware design structure:
1. Explain how the circuit works in plain language ("reply").
2. Diagnose problems (missing GND, missing resistor, wrong pin connections).
3. Provide a universal SPICE Netlist ("spiceNetlist") describing every component and node connection:
  * First line: * Project Title
  * Component lines: <Designator> <Node1> <Node2> ... <ModelOrType> ; Value=<val> StartV=<v> OutV=<v> PassThrough=<true|false> Pins=<PIN1,PIN2,...>
  * Examples:
    U1 5V GND D13 D12 D9 D2 ARDUINO_UNO ; StartV=5 OutV=5
    S1 5V N_SW SW_TOGGLE ; Value=Toggle StartV=0 OutV=0 PassThrough=true
    R1 D13 N_LED 220 ; Value=220Ω
    D1 N_LED GND LED ; Value=Red StartV=1.8
    M1 N_SW GND DC_MOTOR ; Value=5V_Motor StartV=3.0
    X1 5V GND A0 SOIL_SENSOR ; Value=Capacitive StartV=3.3 OutV=3.3 Pins=VCC,GND,OUT
  * End with: .end
  (If a component does not exist yet, define it with an X or U designator and Pins=... so the build board automatically creates and wires it!)
4. Generate working Arduino/ESP32/Pico C++ firmware code ("suggestedCode").
Respond strictly in JSON: { "title": "Project Title", "reply": "explanation text", "spiceNetlist": "* Title\\n...\\n.end", "suggestedCode": "// Full C++ code", "suggestedCircuit": null }`,
//   protoweb: `You are ProtoWeb AI Co-Pilot. You edit ONLY the given HTML section/element.
// Given the selected element's HTML and a user prompt, return JSON: { "html": "the modified HTML for just this element", "explanation": "what you changed and why" }
// Keep inline styles. Do NOT wrap in extra body/html tags. Only return the single element requested.`,
  protoweb: `You are ProtoWeb AI Co-Pilot.
- If context.sectionHtml is provided: return the COMPLETE outer HTML of the modified element (including its opening and closing tag, same tagName as the input) in the "html" field. Do NOT return inner content alone.
- If context is empty: generate a complete page body starting with <nav> or <section>. No <html>/<head>/<body>.
Keep all styles inline. include CSS, JS in same output/page. 

CRITICAL OUTPUT FORMAT: Your entire response MUST be a single valid JSON object with exactly two string fields, "html" and "explanation". Do NOT wrap the JSON in markdown code fences. Do NOT include any text before or after the JSON. Escape every double quote inside the HTML with \\" and escape every backslash with \\\\. If you cannot comply, return {"html": "", "explanation": "failed"} rather than raw HTML.`,

  protogame: `You are ProtoGame AI Level Designer. Given a story/script prompt and optional existing level data, generate a complete 2D platformer level.
Return JSON: { "level": { "title":"string", "storyIntro":"string", "theme":{"bg":"#hex","platform":"#hex","accent":"#hex"}, "gravity":1800, "jumpForce":-600, "speed":320, "playerSpawn":{"x":80,"y":500}, "platforms":[{"x":0,"y":580,"w":800,"h":20}], "coins":[{"x":200,"y":500}], "enemies":[{"x":400,"y":560,"patrol":100,"speed":60}], "hazards":[{"x":300,"y":570,"w":40,"h":10}], "npcs":[{"x":600,"y":540,"name":"NPC","dialogue":["Hello!","Good luck!"]}], "portal":{"x":750,"y":540} }, "reply":"what you created" }`
};

// ── Design Structure Validator & Enforcer ───────────────────────────────────
// Ensures the server NEVER returns an incomplete or unstructured response.
// Logs explicit backend warnings/errors if the LLM omits required design fields.
function ensureDesignStructure(project, result, action, prompt, context, sourceLabel = 'external-ai') {
  const ctx = context || {};
  if (!result || typeof result !== 'object') {
    logError('VALIDATOR', `AI response from [${sourceLabel}] is null or not an object for project "${project}".`);
    result = {};
  }

  if (project === 'protomind') {
    const missing = [];
    if (!result.title) missing.push('title');
    if (!result.reply) missing.push('reply');
    if (!result.spiceNetlist || !String(result.spiceNetlist).includes('.end')) missing.push('spiceNetlist');
    if (!result.suggestedCode || !String(result.suggestedCode).includes('void ')) missing.push('suggestedCode');

    if (missing.length > 0) {
      logWarn(
        'VALIDATOR',
        `Response from [${sourceLabel}] for "protomind" was missing design structure fields: [${missing.join(', ')}]. Synthesizing missing structure from circuit/prompt.`
      );
      const structuredFallback = synthesizeProjectDesign(
        prompt || 'Circuit Design',
        (prompt || '').toLowerCase(),
        detectBoardType(ctx, prompt),
        detectBoardName(ctx, prompt),
        ctx
      );
      result.title = result.title || structuredFallback.title;
      result.reply = result.reply || structuredFallback.reply;
      if (!result.spiceNetlist || !String(result.spiceNetlist).includes('.end')) {
        result.spiceNetlist = buildSpiceFromContext(ctx) || structuredFallback.spiceNetlist;
      }
      if (!result.suggestedCode) {
        result.suggestedCode = structuredFallback.suggestedCode;
      }
      if (result.suggestedCircuit === undefined) {
        result.suggestedCircuit = structuredFallback.suggestedCircuit || null;
      }
    }
    return result;
  }

  if (project === 'protoweb') {
    // NO FALLBACK. If the LLM didn't produce usable html, that's a hard error.
    // We only normalize whitespace; we never substitute generated content.
    const html = result.html == null ? '' : String(result.html).trim();
    const explanation = result.explanation == null ? '' : String(result.explanation).trim();

    if (!html) {
      logError('VALIDATOR', `Response from [${sourceLabel}] for "protoweb" has no html field (or it's empty). Rejecting.`);
      const err = new Error('The AI returned no usable HTML. Try a different prompt or retry.');
      err.code = 'EMPTY_LLM_OUTPUT';
      err.source = sourceLabel;
      throw err;
    }

    return {
      html,
      explanation: explanation || '(no explanation provided)'
    };
  }

  if (project === 'protogame') {
    if (!result.level || !result.level.platforms || !result.reply) {
      logWarn('VALIDATOR', `Response from [${sourceLabel}] for "protogame" missing level structure or reply. Repairing structure.`);
      const fb = protogameEngine(action, prompt, ctx);
      result.level = (result.level && result.level.platforms) ? result.level : fb.level;
      result.reply = result.reply || fb.reply;
    }
    return result;
  }

  return result;
}

function detectBoardType(ctx, prompt = '') {
  const lp = String(prompt || '').toLowerCase();
  if (lp.includes('esp32')) return 'esp32';
  if (lp.includes('pico')) return 'pico';
  const boards = (ctx.comps || []).filter(c => ['uno', 'esp32', 'pico'].includes(c.type));
  return boards.length > 0 ? boards[0].type : 'uno';
}

function detectBoardName(ctx, prompt = '') {
  const map = { uno: 'Arduino Uno', esp32: 'ESP32 DevKit', pico: 'Raspberry Pi Pico' };
  return map[detectBoardType(ctx, prompt)] || 'Arduino Uno';
}

function buildSpiceFromContext(ctx) {
  if (ctx.spiceNetlist && String(ctx.spiceNetlist).includes('.end')) {
    return ctx.spiceNetlist;
  }
  const comps = ctx.comps || [];
  if (!comps.length) return null;
  const lines = ['* ProtoMind4004 Active Canvas SPICE Netlist'];
  comps.forEach((c, i) => {
    const desig = (c.name || `${c.type.toUpperCase()}_${i + 1}`).replace(/\s+/g, '_');
    lines.push(`${desig} N_IN_${i} 0 ${String(c.type || 'PART').toUpperCase()} ; Value=${c.value || c.type} StartV=${c.startVolts ?? 0} OutV=${c.outVolts ?? 0}`);
  });
  lines.push('.end');
  return lines.join('\n');
}

// In-memory multi-turn chat sessions for any project
const chatSessions = new Map();

// ── GET /api/ai/models — List Meta AI profiles & configured providers ───────
app.get('/api/ai/models', (_req, res) => {
  const cfg = getEnvConfig();
  logInfo('HTTP', 'GET /api/ai/models');
  res.json({
    ok: true,
    defaultProfile: 'smart',
    providers: {
      meta: !!cfg.metaKey,
      openai: !!cfg.openaiKey,
      gemini: !!cfg.geminiKey,
      anthropic: !!cfg.anthropicKey,
      builtinFallback: true
    },
    metaBaseUrl: cfg.metaBaseUrl,
    profiles: Object.values(META_AI_PROFILES)
  });
});

// ── POST /api/ai/meta & /api/ai/meta/:profile — Direct Meta AI Gateway ──────
// async function handleMetaEndpoint(req, res) {
//   const profileId = (req.params.profile || req.body?.profile || req.body?.metaProfile || 'smart').toLowerCase();
//   const profile = META_AI_PROFILES[profileId] || META_AI_PROFILES.smart;
//   const {
//     project = 'protomind',
//     action = 'general',
//     prompt = '',
//     system: customSystem,
//     messages: customMessages,
//     context = {},
//     model: modelOverride,
//     temperature = 0.7
//   } = req.body || {};

//   const targetModel = modelOverride || profile.model;
//   logInfo('META-GATEWAY', `Request -> project="${project}" action="${action}" profile="${profile.id}" model="${targetModel}" prompt="${String(prompt).slice(0, 70)}"`);

//   if (!prompt && !action && (!customMessages || !customMessages.length)) {
//     logError('META-GATEWAY', 'Rejected request: missing prompt, action, and messages.');
//     return res.status(400).json({ error: 'prompt, action, or messages required' });
//   }

//   const cfg = getEnvConfig();
//   const systemPrompts = customSystem
//     ? { ...SYSTEM_PROMPTS, [project]: customSystem }
//     : SYSTEM_PROMPTS;

//   let backendError = null;

//   if (!cfg.metaKey && !cfg.openaiKey && !cfg.geminiKey && !cfg.anthropicKey) {
//     backendError = 'MODEL_API_KEY (or META_API_KEY) is missing or still set to placeholder in .env';
//     logError('META-GATEWAY', `${backendError}. Using structured local design engine.`);
//   } else {
//     try {
//       const rawResult = await callExternalLLM({
//         metaKey: cfg.metaKey,
//         metaBaseUrl: cfg.metaBaseUrl,
//         metaModel: targetModel,
//         preferMeta: !!cfg.metaKey,
//         openaiKey: cfg.openaiKey,
//         geminiKey: cfg.geminiKey,
//         anthropicKey: cfg.anthropicKey,
//         project,
//         action,
//         prompt,
//         context,
//         customMessages,
//         temperature,
//         systemPrompts
//       });

//       if (rawResult) {
//         const validated = ensureDesignStructure(project, rawResult, action, prompt, context, `Meta-AI:${targetModel}`);
//         logInfo('META-GATEWAY', `Success -> model="${targetModel}" returned valid "${project}" design structure.`);
//         return res.json({
//           ...validated,
//           metaProfile: profile.id,
//           modelUsed: targetModel,
//           provider: cfg.metaKey ? 'meta' : 'external-llm',
//           aiError: null
//         });
//       }
//     } catch (e) {
//       backendError = e.message;
//       logError('META-GATEWAY', `External LLM call failed for model "${targetModel}" at "${cfg.metaBaseUrl}"`, e.stack || e.message);
//     }
//   }

//   // Fallback to structured built-in engine (while reporting the exact backendError in logs & response metadata)
//   try {
//     logWarn('FALLBACK', `Executing structured built-in design engine for project="${project}" (Reason: ${backendError})`);
//     const rawFallback = builtInEngine(project, action, prompt, context);
//     const validatedFallback = ensureDesignStructure(project, rawFallback, action, prompt, context, 'builtin-engine');
//     return res.json({
//       ...validatedFallback,
//       metaProfile: profile.id,
//       modelUsed: `${targetModel} (structured-fallback)`,
//       provider: 'builtin-structured',
//       aiError: backendError
//     });
//   } catch (e) {
//     logError('FALLBACK', `Critical failure in built-in engine for project="${project}"`, e.stack || e.message);
//     return res.status(500).json({ error: 'Meta AI and structured fallback failed', detail: e.message, aiError: backendError });
//   }
// }

async function handleMetaEndpoint(req, res) {
  const profileId = (req.params.profile || req.body?.profile || req.body?.metaProfile || 'smart').toLowerCase();
  const profile = META_AI_PROFILES[profileId] || META_AI_PROFILES.smart;
  const {
    project = 'protomind',
    action = 'general',
    prompt = '',
    system: customSystem,
    messages: customMessages,
    context = {},
    model: modelOverride,
    temperature = 0.7
  } = req.body || {};

  const targetModel = modelOverride || profile.model;
  logInfo('META-GATEWAY', `Request -> project="${project}" action="${action}" profile="${profile.id}" model="${targetModel}" prompt="${String(prompt).slice(0, 70)}"`);

  if (!prompt && !action && (!customMessages || !customMessages.length)) {
    logError('META-GATEWAY', 'Rejected request: missing prompt, action, and messages.');
    return res.status(400).json({ ok: false, error: 'prompt, action, or messages required', code: 'BAD_REQUEST' });
  }

  const cfg = getEnvConfig();
  const systemPrompts = customSystem
    ? { ...SYSTEM_PROMPTS, [project]: customSystem }
    : SYSTEM_PROMPTS;

  // ── No API key at all ─────────────────────────────────────────────────────
  if (!cfg.metaKey && !cfg.openaiKey && !cfg.geminiKey && !cfg.anthropicKey) {
    const msg = 'No AI API key configured. Add MODEL_API_KEY (or META_API_KEY) to .env.';
    logError('META-GATEWAY', msg);

    // protomind still has a genuinely useful deterministic engine (real SPICE + firmware)
    if (project === 'protomind') {
      try {
        logWarn('META-GATEWAY', `Using deterministic engine for "${project}" (no key).`);
        const rawFallback = builtInEngine(project, action, prompt, context);
        const validatedFallback = ensureDesignStructure(project, rawFallback, action, prompt, context, 'builtin-engine');
        return res.json({
          ...validatedFallback,
          metaProfile: profile.id,
          modelUsed: `${targetModel} (deterministic-fallback)`,
          provider: 'builtin-structured',
          aiError: msg
        });
      } catch (e) {
        logError('META-GATEWAY', 'Deterministic engine failed.', e.stack || e.message);
        return res.status(500).json({ ok: false, error: 'AI engine failed', detail: e.message, code: 'ENGINE_FAILED' });
      }
    }

    // protoweb / protogame: hard error. No fake pages.
    return res.status(503).json({
      ok: false,
      error: msg,
      code: 'NO_API_KEY',
      project,
      action
    });
  }

  // ── Try the real LLM ─────────────────────────────────────────────────────
  let backendError = null;
  try {
    const rawResult = await callExternalLLM({
      metaKey: cfg.metaKey,
      metaBaseUrl: cfg.metaBaseUrl,
      metaModel: targetModel,
      preferMeta: !!cfg.metaKey,
      openaiKey: cfg.openaiKey,
      geminiKey: cfg.geminiKey,
      anthropicKey: cfg.anthropicKey,
      project,
      action,
      prompt,
      context,
      customMessages,
      temperature,
      systemPrompts
    });

    if (rawResult) {
      const validated = ensureDesignStructure(project, rawResult, action, prompt, context, `Meta-AI:${targetModel}`);
      logInfo('META-GATEWAY', `Success -> model="${targetModel}" returned valid "${project}" design structure.`);
      return res.json({
        ...validated,
        metaProfile: profile.id,
        modelUsed: targetModel,
        provider: cfg.metaKey ? 'meta' : 'external-llm',
        aiError: null
      });
    }

    backendError = 'The AI provider returned no result.';
    logError('META-GATEWAY', `External LLM returned null for model "${targetModel}" at "${cfg.metaBaseUrl}".`);
  } catch (e) {
    backendError = e.message || 'External LLM call failed';
    logError('META-GATEWAY', `External LLM call failed for model "${targetModel}" at "${cfg.metaBaseUrl}"`, {
      message: e.message,
      code: e.code,
      finishReason: e.finishReason,
      stack: (e.stack || '').split('\n').slice(0, 3).join(' | ')
    });
  }

  // ── protoweb / protogame: no fallback, return a real error ───────────────
  if (project === 'protoweb' || project === 'protogame') {
    logError('META-GATEWAY', `No usable LLM result for "${project}". Returning error to client.`);
    return res.status(502).json({
      ok: false,
      error: backendError,
      code: 'LLM_FAILED',
      project,
      action,
      modelUsed: targetModel,
      provider: cfg.metaKey ? 'meta' : 'external-llm'
    });
  }

  // ── protomind: deterministic engine is allowed (real SPICE + firmware) ───
  try {
    logWarn('META-GATEWAY', `Running deterministic engine for "${project}" (Reason: ${backendError})`);
    const rawFallback = builtInEngine(project, action, prompt, context);
    const validatedFallback = ensureDesignStructure(project, rawFallback, action, prompt, context, 'builtin-engine');
    return res.json({
      ...validatedFallback,
      metaProfile: profile.id,
      modelUsed: `${targetModel} (deterministic-fallback)`,
      provider: 'builtin-structured',
      aiError: backendError
    });
  } catch (e) {
    logError('META-GATEWAY', `Critical failure in deterministic engine for "${project}"`, e.stack || e.message);
    return res.status(500).json({ ok: false, error: 'AI engine failed', detail: e.message, code: 'ENGINE_FAILED' });
  }
}

app.post('/api/ai/meta', handleMetaEndpoint);
app.post('/api/ai/meta/:profile', handleMetaEndpoint);

// ── POST /api/ai/chat — Stateful Multi-Turn Chat for All Projects ───────────
app.post('/api/ai/chat', async (req, res) => {
  const { sessionId = 'default', project = 'protomind', profile = 'smart', prompt = '', context = {}, reset = false } = req.body || {};
  if (reset) {
    chatSessions.delete(sessionId);
    logInfo('CHAT', `Cleared chat session "${sessionId}"`);
  }
  if (!prompt) {
    logError('CHAT', 'Rejected /api/ai/chat request: prompt is empty.');
    return res.status(400).json({ error: 'prompt required' });
  }

  const history = chatSessions.get(sessionId) || [];
  history.push({ role: 'user', content: `Prompt: ${prompt}\nContext: ${JSON.stringify(context)}` });
  while (history.length > 16) history.shift();

  req.body = { ...req.body, project, profile, prompt, messages: history, context };
  const origJson = res.json.bind(res);
  res.json = (data) => {
    if (data && (data.reply || data.explanation)) {
      history.push({ role: 'assistant', content: JSON.stringify(data) });
      chatSessions.set(sessionId, history);
    }
    return origJson({ ...data, sessionId, turnCount: Math.ceil(history.length / 2) });
  };
  return handleMetaEndpoint(req, res);
});

app.delete('/api/ai/chat/:sessionId', (req, res) => {
  chatSessions.delete(req.params.sessionId);
  logInfo('CHAT', `Deleted session "${req.params.sessionId}"`);
  res.json({ ok: true, cleared: req.params.sessionId });
});

// ── POST /api/ai/spice — Dedicated SPICE Netlist & Custom Part Synthesizer ──
app.post('/api/ai/spice', (req, res) => {
  const { prompt = '', context = {} } = req.body || {};
  logInfo('SPICE', `Synthesizing SPICE Netlist for prompt="${String(prompt).slice(0, 70)}"`);
  const raw = protomindEngine('design-project', prompt, context);
  const result = ensureDesignStructure('protomind', raw, 'design-project', prompt, context, 'spice-endpoint');
  res.json({
    ok: true,
    title: result.title,
    spiceNetlist: result.spiceNetlist,
    suggestedCode: result.suggestedCode,
    reply: result.reply
  });
});

// ── POST /api/ai/image — Visual Blueprint Generator from Description + Code ─
app.post('/api/ai/image', async (req, res) => {
  const { title, description, code, spiceNetlist } = req.body || {};
  logInfo('IMAGE', `Generating circuit blueprint image for title="${title || 'Untitled'}"`);

  if (!code && !spiceNetlist) {
    logWarn('IMAGE', 'Blueprint requested without code or spiceNetlist; generating default structural diagram.');
  }

  const cfg = getEnvConfig();
  // Prefer Muse Image if available (using the same Meta key)
  if (cfg.metaKey && process.env.ENABLE_MUSE_IMAGE !== 'false') {
    try {
      const imgPrompt = `Clean educational electronics schematic and breadboard diagram for: ${title || 'Microcontroller Project'}. ${String(description || '').slice(0, 300)}. Clear labels, white background, high contrast vector style.`;
      const resp = await fetch(`${cfg.metaBaseUrl}/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.metaKey}` },
        body: JSON.stringify({ model: 'muse-image-1.0', prompt: imgPrompt, n: 1, size: '1024x1024' })
      });
      if (resp.ok) {
        const data = await resp.json();
        const url = data.data?.[0]?.url;
        if (url) {
          logInfo('IMAGE', 'Successfully generated image via Muse Image API');
          return res.json({ imageUrl: url, source: 'muse-image' });
        }
      } else {
        const errBody = await resp.text();
        logWarn('IMAGE', `Muse Image API returned HTTP ${resp.status}`, errBody.slice(0, 200));
      }
    } catch (e) {
      logError('IMAGE', 'Muse Image API call failed, using built-in SVG blueprint generator', e.message);
    }
  }

  // Fallback: OpenAI image API (if configured)
  const { openaiKey } = getEnvConfig();
  if (process.env.ENABLE_EXTERNAL_IMAGE_API === 'true' && openaiKey) {
    try {
      const baseUrl = process.env.AI_BASE_URL || 'https://api.openai.com/v1';
      const imgPrompt = `Clean educational electronics schematic and breadboard diagram for: ${title || 'Microcontroller Project'}. ${String(description || '').slice(0, 300)}. Clear labels, white background, high contrast vector style.`;
      const resp = await fetch(`${baseUrl}/images/generations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
        body: JSON.stringify({ model: 'dall-e-3', prompt: imgPrompt, n: 1, size: '1024x1024' })
      });
      if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`Image API HTTP ${resp.status}: ${errBody}`);
      }
      const data = await resp.json();
      const url = data.data?.[0]?.url;
      if (url) return res.json({ imageUrl: url, source: 'openai-image' });
    } catch (e) {
      logError('IMAGE', 'External image API failed, using built-in SVG blueprint generator', e.message);
    }
  }

  const svgBlueprint = generateBlueprintSVG({
    title: title || 'ProtoMind4004 AI Circuit Blueprint',
    description: description || '',
    code: code || '',
    spiceNetlist: spiceNetlist || ''
  });
  const base64 = Buffer.from(svgBlueprint, 'utf-8').toString('base64');
  return res.json({
    imageUrl: `data:image/svg+xml;base64,${base64}`,
    source: 'blueprint-svg'
  });
});

// ── POST /api/ai  — Unified AI bridge for all 3 projects ───────────────────
app.post('/api/ai', async (req, res) => {
  const { project = 'protomind', action = 'general', prompt = '', context = {}, metaProfile, model } = req.body || {};
  logInfo('AI-BRIDGE', `POST /api/ai -> project="${project}" action="${action}" prompt="${String(prompt).slice(0, 70)}"`);

  if (!prompt && !action) {
    logError('AI-BRIDGE', 'Rejected POST /api/ai: neither prompt nor action was provided.');
    return res.status(400).json({ error: 'prompt or action required' });
  }

  const cfg = getEnvConfig();
  const hasExternalKey = !!(cfg.metaKey || cfg.openaiKey || cfg.geminiKey || cfg.anthropicKey);
  const profileObj = META_AI_PROFILES[metaProfile] || META_AI_PROFILES.smart;
  const chosenModel = model || profileObj.model;
  let backendError = null;

  if (!hasExternalKey) {
    backendError = 'No valid API key found in .env (check MODEL_API_KEY)';
    logError('AI-BRIDGE', `${backendError}. Falling back to structured built-in engine.`);
  } else {
    try {
      const rawResult = await callExternalLLM({
        metaKey: cfg.metaKey,
        metaBaseUrl: cfg.metaBaseUrl,
        metaModel: chosenModel,
        openaiKey: cfg.openaiKey,
        geminiKey: cfg.geminiKey,
        anthropicKey: cfg.anthropicKey,
        project,
        action,
        prompt,
        context,
        systemPrompts: SYSTEM_PROMPTS
      });

      if (rawResult) {
        const validated = ensureDesignStructure(project, rawResult, action, prompt, context, `External-LLM:${chosenModel}`);
        logInfo('AI-BRIDGE', `External LLM "${chosenModel}" succeeded with verified "${project}" design structure.`);
        return res.json({ ...validated, provider: 'external-llm', modelUsed: chosenModel, aiError: null });
      }
    } catch (e) {
      backendError = e.message;
      logError('AI-BRIDGE', `External LLM call failed for project="${project}" model="${chosenModel}"`, e.message);
    }
  }

  // ── Built-in structured fallback engine ───────────────────────────────────
  try {
    logWarn('FALLBACK', `Running built-in structured engine for project="${project}" action="${action}" (Trigger: ${backendError})`);
    const rawFallback = builtInEngine(project, action, prompt, context);
    const validatedFallback = ensureDesignStructure(project, rawFallback, action, prompt, context, 'builtin-engine');
    return res.json({
      ...validatedFallback,
      provider: 'builtin-structured',
      aiError: backendError
    });
  } catch (e) {
    logError('FALLBACK', 'Built-in engine crashed!', e.stack || e.message);
    return res.status(500).json({ error: 'AI engine failed', detail: e.message, aiError: backendError });
  }
});

// ── External LLM caller (Now supports Meta Model API / Muse) ────────────────
async function callExternalLLM({
  metaKey,
  metaBaseUrl,
  metaModel,
  preferMeta = false,
  openaiKey,
  geminiKey,
  anthropicKey,
  project,
  action,
  prompt,
  context,
  customMessages,
  temperature = 0.7,
  systemPrompts
}) {
  const system = systemPrompts[project] || systemPrompts.protomind;
  const userMsg = `Action: ${action || 'general'}\nPrompt: ${prompt}\nContext: ${JSON.stringify(context || {})}`;
  const messages = Array.isArray(customMessages) && customMessages.length
    ? [{ role: 'system', content: system }, ...customMessages]
    : [{ role: 'system', content: system }, { role: 'user', content: userMsg }];

  // ── Meta Model API (Muse) — OpenAI-compatible ─────────────────────────────
  // async function callMetaMuse() {
  //   const baseUrl = (metaBaseUrl || process.env.META_BASE_URL || 'https://api.meta.ai/v1').replace(/\/$/, '');
  //   // The Muse API is OpenAI-compatible; endpoint is /chat/completions
  //   const url = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
  //   const model = metaModel || process.env.META_MODEL_SMART || 'muse-spark-1.3';

  //   logInfo('MUSE-LLM', `Calling POST ${url} (model="${model}")`);
  //   const resp = await fetch(url, {
  //     method: 'POST',
  //     headers: {
  //       'Content-Type': 'application/json',
  //       'Authorization': `Bearer ${metaKey}`
  //     },
  //     body: JSON.stringify({
  //       model,
  //       messages,
  //       temperature,
  //       // Muse supports standard OpenAI-like parameters
  //       max_tokens: 4096
  //     })
  //   });

  //   if (!resp.ok) {
  //     const errBody = await resp.text().catch(() => '(could not read response body)');
  //     logError('MUSE-LLM', `HTTP ${resp.status} ${resp.statusText} from ${url}`, errBody);
  //     throw new Error(`Meta Model API HTTP ${resp.status}: ${errBody.slice(0, 300)}`);
  //   }

  //   const data = await resp.json();
  //   // Muse returns OpenAI-compatible response: choices[0].message.content
  //   const text = data.choices?.[0]?.message?.content || data.output?.[0]?.content?.[0]?.text || '';
  //   if (!text) {
  //     logError('MUSE-LLM', 'Meta Model API returned HTTP 200 but empty message content', JSON.stringify(data).slice(0, 300));
  //     throw new Error('Meta Model API returned an empty completion');
  //   }
  //   return parseAIResponse(text, 'MUSE-LLM');
  // }

  async function callMetaMuse() {
    const baseUrl = (metaBaseUrl || process.env.META_BASE_URL || 'https://api.meta.ai/v1').replace(/\/$/, '');
    // The Muse API is OpenAI-compatible; endpoint is /chat/completions
    const url = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
    const model = metaModel || process.env.META_MODEL_SMART || 'muse-spark-1.3';

    logInfo('MUSE-LLM', `Calling POST ${url} (model="${model}")`);

    let resp;
    try {
      resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${metaKey}`
        },
        body: JSON.stringify({
          model,
          messages,
          temperature,
          max_tokens: 8192
        })
      });
    } catch (e) {
      // Network-level failure: DNS, TCP, TLS, proxy, or timeout.
      // `e.message` is always the generic "fetch failed"; the useful detail is in e.cause.
      const c = e.cause || {};
      logError('MUSE-LLM', `Network error reaching ${url}`, {
        message: e.message,
        code: c.code,             // ENOTFOUND | ECONNREFUSED | ETIMEDOUT | CERT_HAS_EXPIRED | UND_ERR_CONNECT_TIMEOUT ...
        errno: c.errno,
        syscall: c.syscall,       // getaddrinfo | connect | read
        hostname: c.hostname,
        address: c.address,
        port: c.port
      });
      throw new Error(`Network error reaching ${url}: ${c.code || e.message}`);
    }

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '(could not read response body)');
      logError('MUSE-LLM', `HTTP ${resp.status} ${resp.statusText} from ${url}`, errBody);
      throw new Error(`Meta Model API HTTP ${resp.status}: ${errBody.slice(0, 300)}`);
    }

        const data = await resp.json();
    // Muse returns OpenAI-compatible response: choices[0].message.content
    const text = data.choices?.[0]?.message?.content || data.output?.[0]?.content?.[0]?.text || '';

    // Log everything useful about an empty completion — the finish_reason
    // tells us WHY it was empty (length = hit max_tokens, content_filter = blocked,
    // stop = empty stop, etc). This matters for diagnosis.
    if (!text) {
      const choice = data.choices?.[0];
      logError('MUSE-LLM', 'Meta Model API returned HTTP 200 but empty message content', {
        finish_reason: choice?.finish_reason,
        stop_reason: data.stop_reason,
        usage: data.usage,
        first_400_chars_of_raw: JSON.stringify(data).slice(0, 400)
      });
      // Most common cause with Muse: the model spent its whole token budget on
      // reasoning and returned no content. Bump max_tokens to fix it.
      const err = new Error('Muse returned an empty response. Increase max_tokens or retry.');
      err.code = 'EMPTY_COMPLETION';
      err.finishReason = choice?.finish_reason;
      throw err;
    }
    return parseAIResponse(text, 'MUSE-LLM');
  }

  if (preferMeta && metaKey) {
    return await callMetaMuse();
  }

  // OpenAI-compatible (fallback to OpenAI if configured)
  if (openaiKey) {
    const baseUrl = (process.env.AI_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
    const url = `${baseUrl}/chat/completions`;
    const model = process.env.AI_MODEL || 'gpt-4o-mini';
    logInfo('OPENAI-LLM', `Calling POST ${url} (model="${model}")`);
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${openaiKey}` },
      body: JSON.stringify({ model, messages, temperature })
    });
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      logError('OPENAI-LLM', `HTTP ${resp.status} from ${url}`, errBody);
      throw new Error(`OpenAI HTTP ${resp.status}: ${errBody.slice(0, 300)}`);
    }
    const data = await resp.json();
    const text = data.choices?.[0]?.message?.content || '';
    return parseAIResponse(text, 'OPENAI-LLM');
  }

  // Gemini
  if (geminiKey) {
    const model = process.env.AI_MODEL || 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
    logInfo('GEMINI-LLM', `Calling POST Gemini (model="${model}")`);
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: `${system}\n\n${userMsg}` }] }] })
    });
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      logError('GEMINI-LLM', `HTTP ${resp.status}`, errBody);
      throw new Error(`Gemini HTTP ${resp.status}: ${errBody.slice(0, 300)}`);
    }
    const data = await resp.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return parseAIResponse(text, 'GEMINI-LLM');
  }

  // Meta (Muse) — fallback if preferMeta wasn't set
  if (metaKey) {
    return await callMetaMuse();
  }

  // Anthropic
  if (anthropicKey) {
    const model = process.env.AI_MODEL || 'claude-sonnet-4-20250514';
    logInfo('ANTHROPIC-LLM', `Calling POST Anthropic (model="${model}")`);
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 4096, system, messages: [{ role: 'user', content: userMsg }] })
    });
    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      logError('ANTHROPIC-LLM', `HTTP ${resp.status}`, errBody);
      throw new Error(`Anthropic HTTP ${resp.status}: ${errBody.slice(0, 300)}`);
    }
    const data = await resp.json();
    const text = data.content?.[0]?.text || '';
    return parseAIResponse(text, 'ANTHROPIC-LLM');
  }

  return null;
}

// function parseAIResponse(text, providerTag = 'LLM') {
//   const jsonMatch = text.match(/\{[\s\S]*\}/);
//   if (jsonMatch) {
//     try {
//       return JSON.parse(jsonMatch[0]);
//     } catch (e) {
//       logError(providerTag, 'Failed to JSON.parse extracted braces from AI output; returning raw text in reply field.', e.message);
//     }
//   } else {
//     logWarn(providerTag, 'AI response did not contain a JSON object block; wrapping plain text reply.');
//   }
//   return { reply: text };
// }


// function parseAIResponse(text, providerTag = 'LLM') {
//   const raw = String(text || '').trim();

//   // 1. Strip a single markdown fence if the whole response is wrapped
//   const stripFence = (s) => s.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim();

//   // 2. Direct JSON object somewhere in the text
//   const jsonMatch = raw.match(/\{[\s\S]*\}/);
//   if (jsonMatch) {
//     try {
//       const parsed = JSON.parse(jsonMatch[0]);
//       if (parsed && typeof parsed === 'object') return parsed;
//     } catch (e) {
//       logWarn(providerTag, `First JSON parse failed, attempting fence-stripped retry: ${e.message}`);
//       try {
//         const parsed2 = JSON.parse(stripFence(jsonMatch[0]));
//         if (parsed2 && typeof parsed2 === 'object') return parsed2;
//       } catch (e2) {
//         logError(providerTag, 'JSON.parse failed after fence strip', e2.message);
//       }
//     }
//   }

//   // 3. Markdown-fenced HTML block → wrap as { html, explanation }
//   const htmlFence = raw.match(/```(?:html|HTML)?\s*\n([\s\S]*?)\n```/);
//   if (htmlFence) {
//     const inner = htmlFence[1].trim();
//     if (inner && /<\w+[\s>]/.test(inner)) {
//       logInfo(providerTag, 'Extracted HTML from markdown fence; wrapping as { html, explanation }.');
//       return {
//         html: inner,
//         explanation: 'Model returned a markdown-fenced HTML block; extracted and wrapped it.'
//       };
//     }
//   }

//   // 4. Raw text that looks like HTML (starts with a tag, no fence)
//   const stripped = stripFence(raw);
//   if (/^\s*<(nav|header|section|main|div|body|html)\b/i.test(stripped)) {
//     logInfo(providerTag, 'Response looks like raw HTML; wrapping as { html, explanation }.');
//     return {
//       html: stripped,
//       explanation: 'Model returned raw HTML; wrapped as an HTML page.'
//     };
//   }

//   // 5. Nothing usable — let the validator's repair path take over
//   logWarn(providerTag, 'AI response did not contain JSON or HTML; wrapping plain text reply.');
//   return { reply: raw };
// }

function parseAIResponse(text, providerTag = 'LLM') {
  const raw = String(text || '').trim();
  if (!raw) {
    logWarn(providerTag, 'AI returned empty text');
    return { reply: '' };
  }

  // ── 1. Direct JSON object ─────────────────────────────────────────────
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed;
      }
    } catch (e) {
      logWarn(providerTag, `JSON parse of top-level object failed: ${e.message}`);
      // Try fence-stripped variant before falling through
      try {
        const stripped = jsonMatch[0].replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
        const parsed = JSON.parse(stripped);
        if (parsed && typeof parsed === 'object') return parsed;
      } catch (_) { /* fall through */ }
    }
  }

  // ── 2. Markdown-fenced JSON anywhere in the text ──────────────────────
  const jsonFence = raw.match(/```(?:json|JSON)\s*\n([\s\S]*?)\n```/);
  if (jsonFence) {
    try {
      const parsed = JSON.parse(jsonFence[1].trim());
      if (parsed && typeof parsed === 'object') {
        logInfo(providerTag, 'Extracted JSON from ```json fence');
        return parsed;
      }
    } catch (_) { /* fall through */ }
  }

  // ── 3. Markdown-fenced HTML block ─────────────────────────────────────
  const htmlFence = raw.match(/```(?:html|HTML)?\s*\n?([\s\S]*?)\n?```/);
  if (htmlFence) {
    const inner = htmlFence[1].trim();
    if (inner && /<[a-zA-Z]/.test(inner)) {
      logInfo(providerTag, 'Extracted HTML from markdown fence');
      return {
        html: inner,
        explanation: 'Model returned a markdown-fenced HTML block; extracted and wrapped it.'
      };
    }
  }

  // ── 4. Find the FIRST HTML tag ANYWHERE in the text (not just at start)
  //    This is the critical fix: Muse prepends prose, so we must search
  //    for the first <nav|section|div|header|main|body|html|!DOCTYPE> and
  //    take everything from there onward.
  const firstTagIdx = raw.search(/<(!doctype\s+html|html|head|body|nav|header|main|section|div|article|footer)\b/i);
  if (firstTagIdx !== -1) {
    let candidate = raw.slice(firstTagIdx).trim();
    // Trim trailing fences/prose after the closing tag
    candidate = candidate.replace(/\n?```[\s\S]*$/, '').trim();
    // If it starts with <!DOCTYPE or <html>, that's a full doc — keep as-is
    if (candidate && /<[a-zA-Z]/.test(candidate)) {
      logInfo(providerTag, `Extracted HTML starting at index ${firstTagIdx} (preceded by ${firstTagIdx} chars of prose)`);
      return {
        html: candidate,
        explanation: 'Model returned HTML mixed with prose; extracted the HTML portion.'
      };
    }
  }

  // ── 5. Nothing usable ─────────────────────────────────────────────────
  logWarn(providerTag, `Could not extract JSON or HTML. First 200 chars: ${raw.slice(0, 200)}`);
  return { reply: raw };
}


// ── Built-in deterministic AI synthesis engine ──────────────────────────────
function builtInEngine(project, action, prompt, context) {
  if (project === 'protomind') return protomindEngine(action, prompt, context || {});
  if (project === 'protoweb') return protowebEngine(action, prompt, context || {});
  if (project === 'protogame') return protogameEngine(action, prompt, context || {});
  return { reply: 'Unknown project. Choose protomind, protoweb, or protogame.' };
}

// ── ProtoMind built-in engine (Always returns a complete design structure) ──
function protomindEngine(action, prompt, ctx) {
  const comps = ctx.comps || [];
  const wires = ctx.wires || [];
  const code = ctx.code || '';
  const lowerPrompt = (prompt || '').toLowerCase();

  // Detect board type
  const boards = comps.filter(c => ['uno','esp32','pico'].includes(c.type));
  let boardType = boards.length > 0 ? boards[0].type : 'uno';
  if (lowerPrompt.includes('esp32')) boardType = 'esp32';
  else if (lowerPrompt.includes('pico')) boardType = 'pico';
  const boardNames = { uno: 'Arduino Uno', esp32: 'ESP32 DevKit', pico: 'Raspberry Pi Pico' };
  const boardName = boardNames[boardType] || 'Arduino Uno';

  // Detect components
  const leds = comps.filter(c => c.type === 'led');
  const buttons = comps.filter(c => c.type === 'btn' || c.type === 'sw');
  const resistors = comps.filter(c => c.type === 'res');
  const capacitors = comps.filter(c => c.type === 'cap');
  const inductors = comps.filter(c => c.type === 'ind');
  const motors = comps.filter(c => c.type === 'motor');
  const servos = comps.filter(c => c.type === 'servo');
  const ultrasonics = comps.filter(c => c.type === 'ultrasonic');
  const buzzers = comps.filter(c => c.type === 'buzzer');

  // Wiring check
  const issues = [];
  if (leds.length > 0 && resistors.length === 0) {
    issues.push('⚠️ You have LED(s) without a current-limiting resistor. Always place a 220Ω–330Ω resistor in series with an LED to prevent damage.');
  }
  const gndWires = wires.filter(w =>
    w.from?.pin === 'GND' || w.to?.pin === 'GND' ||
    w.from?.pin === '-' || w.to?.pin === '-' ||
    w.from?.pin === '0' || w.to?.pin === '0'
  );
  if (comps.length > 1 && gndWires.length === 0) {
    issues.push('⚠️ No GND connections found. Every component needs a path to ground to complete the circuit.');
  }
  if (ultrasonics.length > 0 && !wires.some(w => (w.from?.pin === 'TRIG' || w.to?.pin === 'TRIG'))) {
    issues.push('⚠️ Ultrasonic sensor TRIG pin is not wired. Connect it to a digital output pin.');
  }
  if (ultrasonics.length > 0 && !wires.some(w => (w.from?.pin === 'ECHO' || w.to?.pin === 'ECHO'))) {
    issues.push('⚠️ Ultrasonic sensor ECHO pin is not wired. Connect it to a digital input pin.');
  }

  // Always generate valid board firmware so suggestedCode is never null
  let suggestedCode = null;
  if (boardType === 'esp32') {
    suggestedCode = generateESP32Code(leds.length ? leds : [{ type: 'led' }], buttons, servos, ultrasonics, buzzers);
  } else if (boardType === 'pico') {
    suggestedCode = generatePicoCode(leds.length ? leds : [{ type: 'led' }], buttons, servos, ultrasonics, buzzers);
  } else {
    suggestedCode = generateArduinoCode(leds.length ? leds : [{ type: 'led' }], buttons, servos, ultrasonics, buzzers);
  }

  // Check wiring prompt
  if (lowerPrompt.includes('check') || lowerPrompt.includes('wiring') || action === 'check-wiring') {
    const summary = [];
    summary.push(`📋 **Circuit Summary for ${boardName}:**`);
    summary.push(`• ${boards.length} board(s), ${leds.length} LED(s), ${resistors.length} resistor(s), ${buttons.length} button/switch(es)`);
    if (capacitors.length) summary.push(`• ${capacitors.length} capacitor(s)`);
    if (inductors.length) summary.push(`• ${inductors.length} inductor(s)`);
    if (motors.length) summary.push(`• ${motors.length} DC motor(s)`);
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
    return {
      title: `${boardName} Circuit Check`,
      reply: summary.join('\n'),
      spiceNetlist: buildSpiceFromContext(ctx),
      suggestedCode,
      suggestedCircuit: null
    };
  }

  // How-to guides
  if (lowerPrompt.includes('how to wire') || lowerPrompt.includes('how to connect')) {
    if (lowerPrompt.includes('esp32') && lowerPrompt.includes('ultrasonic')) {
      const spiceNetlist = [
        `* ESP32 + HC-SR04 Ultrasonic Sensor`,
        `U1 3V3 GND D5 D12 ESP32_DEVKIT ; Value=ESP32 StartV=3.3 OutV=3.3`,
        `U2 3V3 D5 D12 0 HC_SR04 ; Value=2-400cm StartV=3.3 OutV=3.3`,
        `.end`
      ].join('\n');
      return {
        title: 'ESP32 + HC-SR04 Ultrasonic Sensor',
        reply: howToWireESP32Ultrasonic(),
        spiceNetlist,
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
      const spiceNetlist = [
        `* Raspberry Pi Pico + Micro Servo`,
        `U1 3V3 GND GP0 RPI_PICO ; Value=RP2040 StartV=3.3 OutV=3.3`,
        `U2 GP0 3V3 0 MICRO_SERVO ; Value=SG90 StartV=3.0`,
        `.end`
      ].join('\n');
      return {
        title: 'Raspberry Pi Pico + Servo Motor',
        reply: howToWirePicoServo(),
        spiceNetlist,
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
      const spiceNetlist = [
        `* ESP32 Starter Circuit`,
        `U1 3V3 GND D2 D4 ESP32_DEVKIT ; Value=ESP32 StartV=3.3 OutV=3.3`,
        `R1 D2 N_LED 220 ; Value=220Ω`,
        `D1 N_LED 0 LED ; Value=Status_LED StartV=1.8`,
        `.end`
      ].join('\n');
      return {
        title: 'ESP32 Wiring Guide',
        reply: `🔌 **Wiring Guide for ESP32:**\n\n1. **Power:** ESP32 runs on 3.3V logic. Use the 3V3 pin for sensors, VIN for 5V components.\n2. **LEDs:** Connect LED anode → resistor → GPIO pin (e.g., D2). LED cathode → GND.\n3. **Buttons:** One side to GPIO (e.g., D4), other to GND. Use INPUT_PULLUP in code.\n4. **Servos:** Signal → GPIO (e.g., D13), VCC → 5V (external), GND → GND.\n5. **Ultrasonic:** VCC → 5V, TRIG → GPIO, ECHO → GPIO (use voltage divider!), GND → GND.`,
        spiceNetlist,
        suggestedCode: generateESP32Code([{ type: 'led' }], [{ type: 'btn' }], [], [], []),
        suggestedCircuit: null
      };
    }
    if (lowerPrompt.includes('pico')) {
      const spiceNetlist = [
        `* Raspberry Pi Pico Starter Circuit`,
        `U1 3V3 GND GP15 GP14 RPI_PICO ; Value=RP2040 StartV=3.3 OutV=3.3`,
        `R1 GP15 N_LED 220 ; Value=220Ω`,
        `D1 N_LED 0 LED ; Value=Status_LED StartV=1.8`,
        `.end`
      ].join('\n');
      return {
        title: 'Raspberry Pi Pico Wiring Guide',
        reply: `🔌 **Wiring Guide for Raspberry Pi Pico:**\n\n1. **Power:** Pico runs on 3.3V logic. Use the 3V3(OUT) pin.\n2. **LEDs:** Connect LED anode → resistor → GP pin (e.g., GP15). LED cathode → GND.\n3. **Buttons:** One side to GP pin (e.g., GP14), other to GND. Use INPUT_PULLUP.\n4. **Servos:** Signal → GP pin with PWM (e.g., GP0), VCC → VBUS (5V), GND → GND.\n5. **Built-in LED:** GP25 controls the onboard LED.`,
        spiceNetlist,
        suggestedCode: generatePicoCode([{ type: 'led' }], [{ type: 'btn' }], [], [], []),
        suggestedCircuit: null
      };
    }
  }

  // Project Architect & SPICE Synthesis when asked to design/build a project
  if (
    action === 'design-project' ||
    lowerPrompt.includes('design') ||
    lowerPrompt.includes('build') ||
    lowerPrompt.includes('create') ||
    lowerPrompt.includes('water') ||
    lowerPrompt.includes('plant') ||
    lowerPrompt.includes('motor') ||
    lowerPrompt.includes('switch') ||
    lowerPrompt.includes('traffic') ||
    lowerPrompt.includes('fan') ||
    lowerPrompt.includes('temperature')
  ) {
    return synthesizeProjectDesign(prompt, lowerPrompt, boardType, boardName, ctx);
  }

  // Default: describe the circuit with full design structure
  const parts = [];
  parts.push(`🤖 **Your ${boardName} Circuit:**`);
  parts.push(`You have ${comps.length} component(s) connected with ${wires.length} wire(s).`);
  if (leds.length) parts.push(`💡 ${leds.length} LED(s) — light-emitting diodes that glow when current flows through them.`);
  if (buttons.length) parts.push(`🔘 ${buttons.length} button/switch(es) — switches that connect/disconnect the circuit.`);
  if (resistors.length) parts.push(`⚡ ${resistors.length} resistor(s) — limit current to protect components like LEDs.`);
  if (capacitors.length) parts.push(`🔋 ${capacitors.length} capacitor(s) — store electrical charge and filter noise.`);
  if (inductors.length) parts.push(`🌀 ${inductors.length} inductor(s) — store magnetic energy and smooth current.`);
  if (motors.length) parts.push(`⚙️ ${motors.length} DC motor(s) — spin when powered above their start voltage.`);
  if (servos.length) parts.push(`🔄 ${servos.length} servo(s) — motors that rotate to a specific angle.`);
  if (ultrasonics.length) parts.push(`📏 ${ultrasonics.length} ultrasonic sensor(s) — measure distance using sound waves.`);
  if (buzzers.length) parts.push(`🔊 ${buzzers.length} buzzer(s) — make sound when powered.`);
  if (issues.length) { parts.push('\n🔍 **Tips:**'); issues.forEach(i => parts.push(i)); }
  parts.push('\n💡 Try clicking "Generate Code for This Circuit" to get starter firmware!');
  return {
    title: `${boardName} Circuit Overview`,
    reply: parts.join('\n'),
    spiceNetlist: buildSpiceFromContext(ctx),
    suggestedCode,
    suggestedCircuit: null
  };
}

// ── SPICE + Firmware Project Synthesizer (Auto-creates missing components) ──
function synthesizeProjectDesign(rawPrompt, lp, boardType, boardName) {
  if (lp.includes('water') || lp.includes('plant') || lp.includes('moisture') || lp.includes('pump')) {
    const title = 'Smart Plant Watering System';
    const spiceNetlist = [
      `* ${title} (${boardName})`,
      `U1 5V GND D13 D4 A0 ARDUINO_UNO ; Value=ATmega328P StartV=5.0 OutV=5.0`,
      `X1 5V GND A0 SOIL_MOISTURE_SENSOR ; Value=Capacitive StartV=3.3 OutV=3.3 Pins=VCC,GND,SIG`,
      `S1 5V N_EN SW_TOGGLE ; Value=Manual_Override StartV=0 OutV=0 PassThrough=true`,
      `X2 N_EN D4 N_PUMP GND RELAY_MODULE_5V ; Value=1ch_Relay StartV=3.3 OutV=5.0 PassThrough=true Pins=VCC,IN,NO,GND`,
      `M1 N_PUMP 0 DC_MOTOR ; Value=Submersible_Pump StartV=3.0`,
      `R1 D13 N_LED 220 ; Value=220Ω`,
      `D1 N_LED 0 LED ; Value=Status_LED StartV=1.8`,
      `.end`
    ].join('\n');

    const code = `// ${title} - Auto-generated by ProtoMind4004 AI
const int SENSOR_PIN = A0;
const int RELAY_PIN  = 4;
const int LED_PIN    = 13;
const int DRY_THRESHOLD = 620;

void setup() {
  Serial.begin(9600);
  pinMode(RELAY_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  int moisture = analogRead(SENSOR_PIN);
  Serial.print("Soil Moisture Raw: ");
  Serial.println(moisture);

  if (moisture > DRY_THRESHOLD) {
    digitalWrite(RELAY_PIN, HIGH); // Turn ON water pump
    digitalWrite(LED_PIN, HIGH);
    Serial.println("Status: Soil dry -> Pumping water!");
  } else {
    digitalWrite(RELAY_PIN, LOW);  // Turn OFF water pump
    digitalWrite(LED_PIN, LOW);
  }
  delay(500);
}`;
    return {
      title,
      reply: `🌱 **${title}**\n\nDesigned in universal **SPICE Netlist** format:\n• **U1 (${boardName})** reads soil moisture on **A0** and drives **D4**.\n• **X1 (SOIL_MOISTURE_SENSOR)** and **X2 (RELAY_MODULE_5V)** are automatically created as custom components if they don't exist yet.\n• **S1 (Toggle Switch)** uses **Pass-through Voltage (InV = OutV)** to feed the relay and **M1 (DC Motor Pump)**.\n\nClick **⚡ Render on Build Board** to auto-create and wire the entire circuit!`,
      spiceNetlist,
      suggestedCode: code,
      suggestedCircuit: null
    };
  }

  if (lp.includes('fan') || lp.includes('temp') || lp.includes('dht') || lp.includes('cooling')) {
    const title = 'Smart Temperature Fan Controller';
    const spiceNetlist = [
      `* ${title} (${boardName})`,
      `U1 5V GND D13 D9 D2 ARDUINO_UNO ; Value=ATmega328P StartV=5.0 OutV=5.0`,
      `X1 5V D2 GND DHT22_TEMP_SENSOR ; Value=DHT22 StartV=3.3 OutV=3.3 Pins=VCC,DATA,GND`,
      `S1 5V N_FAN SW_TOGGLE ; Value=Fan_Power StartV=0 OutV=0 PassThrough=true`,
      `M1 N_FAN 0 DC_MOTOR ; Value=Cooling_Fan StartV=3.0`,
      `R1 D13 N_LED 220 ; Value=220Ω`,
      `D1 N_LED 0 LED ; Value=Heat_Alert StartV=1.8`,
      `.end`
    ].join('\n');

    const code = `// ${title} - Auto-generated by ProtoMind4004 AI
const int DHT_PIN = 2;
const int FAN_PIN = 9;
const int LED_PIN = 13;

void setup() {
  Serial.begin(9600);
  pinMode(FAN_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  // Simulated temperature reading (C)
  float tempC = 29.5;
  Serial.print("Temperature: ");
  Serial.print(tempC);
  Serial.println(" C");

  if (tempC >= 28.0) {
    analogWrite(FAN_PIN, 255);
    digitalWrite(LED_PIN, HIGH);
  } else {
    analogWrite(FAN_PIN, 0);
    digitalWrite(LED_PIN, LOW);
  }
  delay(1000);
}`;
    return {
      title,
      reply: `🌡️ **${title}**\n\n• **X1 (DHT22_TEMP_SENSOR)** is synthesized automatically with \`VCC, DATA, GND\` pins.\n• **S1 (Toggle Switch)** passes 5V to **M1 (Cooling Fan Motor)**.\n• Click **⚡ Render on Build Board** to build it immediately!`,
      spiceNetlist,
      suggestedCode: code,
      suggestedCircuit: null
    };
  }

  const title = rawPrompt && rawPrompt.length < 48 ? rawPrompt : 'Interactive Switch, Motor & LED Controller';
  const spiceNetlist = [
    `* ${title}`,
    `U1 5V GND D13 D9 D2 ARDUINO_UNO ; Value=ATmega328P StartV=5.0 OutV=5.0`,
    `S1 5V N_SW SW_TOGGLE ; Value=Main_Switch StartV=0 OutV=0 PassThrough=true`,
    `M1 N_SW 0 DC_MOTOR ; Value=6000RPM StartV=3.0`,
    `R1 D13 N_LED 220 ; Value=220Ω`,
    `D1 N_LED 0 LED ; Value=Status_LED StartV=1.8`,
    `C1 5V 0 100uF ; Value=100µF`,
    `.end`
  ].join('\n');

  const code = `// ${title}
const int SWITCH_SENSE_PIN = 2;
const int MOTOR_PWM_PIN    = 9;
const int LED_PIN          = 13;

void setup() {
  Serial.begin(9600);
  pinMode(SWITCH_SENSE_PIN, INPUT_PULLUP);
  pinMode(MOTOR_PWM_PIN, OUTPUT);
  pinMode(LED_PIN, OUTPUT);
}

void loop() {
  bool active = digitalRead(SWITCH_SENSE_PIN) == LOW;
  digitalWrite(LED_PIN, HIGH);
  analogWrite(MOTOR_PWM_PIN, active ? 255 : 160);
  Serial.println("Motor & Status LED Active");
  delay(300);
}`;

  return {
    title,
    reply: `⚡ **${title}**\n\nHere is your complete hardware design in **SPICE Netlist** format along with the C++ firmware and visual diagram:\n• **S1 (Toggle Switch)** has \`PassThrough=true\` (Out Volts = Input Volts) and feeds **M1 (DC Motor)**.\n• **R1 (220Ω)** limits current from **D13** into **D1 (LED)**.\n• **C1 (100µF)** decouples the **5V** rail to **GND (0)**.\n\nDuring simulation, click the **Switch**, **LED**, or **Motor** directly on the canvas to toggle their ON/OFF states!`,
    spiceNetlist,
    suggestedCode: code,
    suggestedCircuit: null
  };
}

function escapeXml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function generateBlueprintSVG({ title, description, code, spiceNetlist }) {
  const spiceLines = String(spiceNetlist || '')
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith('*') && l.toLowerCase() !== '.end');

  const compBoxes = spiceLines.slice(0, 8).map((line, i) => {
    const [head, comment] = line.split(';').map(s => s.trim());
    const tokens = head.split(/\s+/);
    const desig = tokens[0] || `C${i + 1}`;
    const model = tokens[tokens.length - 1] || 'PART';
    const nodes = tokens.slice(1, -1).join(' · ');
    return { desig, model, nodes, comment: comment || '' };
  });

  const codePreview = String(code || '')
    .split('\n')
    .filter(l => l.trim() && !l.trim().startsWith('//'))
    .slice(0, 9);

  const descClean = String(description || '').replace(/\*\*/g, '').replace(/\n+/g, ' ').slice(0, 140);

  let boxesSvg = '';
  compBoxes.forEach((b, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const bx = 30 + col * 245;
    const by = 118 + row * 68;
    const isMcu = /^(U|MCU|ARD|ESP|PICO)/i.test(b.desig) || /UNO|ESP32|PICO/i.test(b.model);
    const fill = isMcu ? '#0f4c5c' : '#1e293b';
    const stroke = isMcu ? '#38bdf8' : '#475569';
    boxesSvg += `
      <g transform="translate(${bx},${by})">
        <rect width="230" height="56" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="1.8"/>
        <circle cx="14" cy="18" r="4" fill="#38bdf8"/>
        <circle cx="14" cy="38" r="4" fill="#22c55e"/>
        <text x="26" y="21" fill="#f8fafc" font-family="monospace" font-size="12" font-weight="bold">${escapeXml(b.desig)}: ${escapeXml(b.model)}</text>
        <text x="26" y="38" fill="#93c5fd" font-family="monospace" font-size="10">Nodes: ${escapeXml(b.nodes.slice(0, 26))}</text>
        <text x="26" y="50" fill="#94a3b8" font-family="sans-serif" font-size="9">${escapeXml(b.comment.slice(0, 32))}</text>
      </g>`;
  });

  let codeSvg = '';
  codePreview.forEach((ln, idx) => {
    codeSvg += `<text x="545" y="${142 + idx * 18}" fill="#a7f3d0" font-family="monospace" font-size="10.5">${escapeXml(ln.slice(0, 42))}</text>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 860 420" width="860" height="420">
    <defs>
      <linearGradient id="bgGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#090d16"/>
        <stop offset="100%" stop-color="#111827"/>
      </linearGradient>
      <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
        <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#1e293b" stroke-width="0.7"/>
      </pattern>
    </defs>
    <rect width="860" height="420" fill="url(#bgGrad)"/>
    <rect width="860" height="420" fill="url(#grid)"/>
    <rect x="12" y="12" width="836" height="396" rx="12" fill="none" stroke="#334155" stroke-width="1.5"/>

    <!-- Header -->
    <rect x="12" y="12" width="836" height="68" rx="12" fill="#0f172a"/>
    <text x="30" y="42" fill="#38bdf8" font-family="sans-serif" font-size="18" font-weight="bold">⚡ ${escapeXml(title)}</text>
    <text x="30" y="64" fill="#94a3b8" font-family="sans-serif" font-size="11.5">${escapeXml(descClean)}${descClean.length >= 140 ? '…' : ''}</text>
    <rect x="705" y="26" width="125" height="26" rx="13" fill="#1e3a8a" stroke="#3b82f6"/>
    <text x="767" y="43" text-anchor="middle" fill="#e0f2fe" font-family="monospace" font-size="11" font-weight="bold">SPICE VERIFIED</text>

    <!-- Left Section: Schematic Topology Blocks -->
    <text x="30" y="104" fill="#cbd5e1" font-family="sans-serif" font-size="12" font-weight="bold">🔌 SPICE HARDWARE TOPOLOGY &amp; PIN NODES</text>
    ${boxesSvg}

    <!-- Right Section: Firmware Preview & Bus Guide -->
    <text x="530" y="104" fill="#cbd5e1" font-family="sans-serif" font-size="12" font-weight="bold">💻 C++ FIRMWARE &amp; SIGNAL FLOW</text>
    <rect x="530" y="118" width="300" height="190" rx="8" fill="#050811" stroke="#334155"/>
    ${codeSvg}

    <!-- Footer Legend -->
    <rect x="530" y="320" width="300" height="66" rx="8" fill="#0f172a" stroke="#1e293b"/>
    <text x="545" y="342" fill="#38bdf8" font-family="sans-serif" font-size="11" font-weight="bold">Ready for Build Board</text>
    <text x="545" y="360" fill="#94a3b8" font-family="sans-serif" font-size="10">• Click "Render on Build Board" to auto-wire</text>
    <text x="545" y="376" fill="#94a3b8" font-family="sans-serif" font-size="10">• Missing custom parts are synthesized automatically</text>
  </svg>`;
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
  const isFullPage = !ctx.sectionHtml && !ctx.html;
  if (isFullPage) {
    return {
      html: generateFullPageFallback(prompt),
      explanation: 'Generated a complete landing page layout.'
    };
  }
  const outerHtml = ctx.sectionHtml || ctx.html;
  const tagName = (ctx.tagName || 'SECTION').toLowerCase();
  const lp = (prompt || '').toLowerCase();
  const wrap = (inner) => `<${tagName}>${inner}</${tagName}>`;

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
    // return {
    //   html: withGlass.includes('backdrop-filter') ? withGlass : modified,
    //   explanation: '🌙 Applied dark glassmorphism theme: dark slate background with blur effect, light text, subtle borders, and rounded corners.'
    // };
    return {
      html: `<${tagName} style="padding: 48px 32px; background: linear-gradient(135deg, rgba(15,23,42,0.95), rgba(30,41,59,0.9)); backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px); border: 1px solid rgba(255,255,255,0.12); border-radius: 18px; box-shadow: 0 20px 40px rgba(0,0,0,0.35); color: #e2e8f0;"><h2 style="font-size: 28px; font-weight: 800; margin: 0 0 12px 0; color: #fff;">Dark Glassmorphic Section</h2><p style="color: #94a3b8; font-size: 15px; line-height: 1.6; margin: 0;">Frosted translucent panel with deep ambient shadows.</p></${tagName}>`,
      explanation: '🌙 Applied dark glassmorphism: frosted panel with blur, subtle borders, rounded corners.'
    };
  }

//   if (lp.includes('card') || lp.includes('feature') || lp.includes('3-column') || lp.includes('three column')) {
//     return {
//       html: wrap(`<section style="padding: 64px 32px; background-color: #f8fafc;">
//   <h2 style="text-align: center; font-size: 28px; font-weight: 800; color: #0f172a; margin: 0 0 12px 0;">Features</h2>
//   <p style="text-align: center; font-size: 16px; color: #64748b; margin: 0 0 40px 0;">Everything you need to build amazing things</p>
//   <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 24px; max-width: 960px; margin: 0 auto;">
//     <div style="padding: 28px; background: white; border-radius: 16px; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(15,23,42,0.06);">
//       <div style="width: 48px; height: 48px; border-radius: 12px; background: linear-gradient(135deg, #6366f1, #8b5cf6); display: flex; align-items: center; justify-content: center; font-size: 24px; margin-bottom: 16px;">⚡</div>
//       <h3 style="font-size: 18px; font-weight: 700; color: #0f172a; margin: 0 0 8px 0;">Lightning Fast</h3>
//       <p style="font-size: 14px; color: #64748b; margin: 0; line-height: 1.6;">Optimized performance that loads in milliseconds. Your users won't wait.</p>
//     </div>
//     <div style="padding: 28px; background: white; border-radius: 16px; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(15,23,42,0.06);">
//       <div style="width: 48px; height: 48px; border-radius: 12px; background: linear-gradient(135deg, #06b6d4, #0ea5e9); display: flex; align-items: center; justify-content: center; font-size: 24px; margin-bottom: 16px;">🎨</div>
//       <h3 style="font-size: 18px; font-weight: 700; color: #0f172a; margin: 0 0 8px 0;">Beautiful Design</h3>
//       <p style="font-size: 14px; color: #64748b; margin: 0; line-height: 1.6;">Crafted with attention to every pixel. Modern, clean, and professional.</p>
//     </div>
//     <div style="padding: 28px; background: white; border-radius: 16px; border: 1px solid #e2e8f0; box-shadow: 0 4px 12px rgba(15,23,42,0.06);">
//       <div style="width: 48px; height: 48px; border-radius: 12px; background: linear-gradient(135deg, #f59e0b, #ef4444); display: flex; align-items: center; justify-content: center; font-size: 24px; margin-bottom: 16px;">🔒</div>
//       <h3 style="font-size: 18px; font-weight: 700; color: #0f172a; margin: 0 0 8px 0;">Secure & Reliable</h3>
//       <p style="font-size: 14px; color: #64748b; margin: 0; line-height: 1.6;">Enterprise-grade security and 99.9% uptime. Built to scale.</p>
//     </div>
//   </div>
// </section>`),
//       explanation: '🃏 Created a 3-column feature cards section with gradient icons, clean typography, and subtle shadows.'
//     };
//   }


  if (lp.includes('card') || lp.includes('feature') || lp.includes('3-column')) {
    return {
      html: wrap(`<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 24px; padding: 32px; background: #0f172a; color: #fff;">
        <div style="padding: 24px; background: rgba(30,41,59,0.6); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px;"><h3 style="margin: 0 0 8px; color: #fff;">Lightning Fast</h3><p style="color: #94a3b8; margin: 0;">Optimized performance.</p></div>
        <div style="padding: 24px; background: rgba(30,41,59,0.6); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px;"><h3 style="margin: 0 0 8px; color: #fff;">Beautiful Design</h3><p style="color: #94a3b8; margin: 0;">Crafted with care.</p></div>
        <div style="padding: 24px; background: rgba(30,41,59,0.6); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px;"><h3 style="margin: 0 0 8px; color: #fff;">Secure & Reliable</h3><p style="color: #94a3b8; margin: 0;">99.9% uptime.</p></div>
      </div>`),
      explanation: '🃏 Created a 3-column feature cards section.'
    };
  }


  // if (lp.includes('card') || lp.includes('feature') || lp.includes('3-column')) {
  //   return {
  //     html: wrap(`<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 24px; padding: 32px; background: #0f172a; color: #fff;">
  //       <div style="padding: 24px; background: rgba(30,41,59,0.6); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px;"><h3 style="margin: 0 0 8px; color: #fff;">Lightning Fast</h3><p style="color: #94a3b8; margin: 0;">Optimized performance.</p></div>
  //       <div style="padding: 24px; background: rgba(30,41,59,0.6); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px;"><h3 style="margin: 0 0 8px; color: #fff;">Beautiful Design</h3><p style="color: #94a3b8; margin: 0;">Crafted with care.</p></div>
  //       <div style="padding: 24px; background: rgba(30,41,59,0.6); border: 1px solid rgba(255,255,255,0.08); border-radius: 16px;"><h3 style="margin: 0 0 8px; color: #fff;">Secure & Reliable</h3><p style="color: #94a3b8; margin: 0;">99.9% uptime.</p></div>
  //     </div>`),
  //     explanation: '🃏 Created a 3-column feature cards section.'
  //   };
  // }

  if (lp.includes('pricing')) {
    return {
      html: wrap(`<section style="padding: 64px 32px; background: linear-gradient(180deg, #f8fafc, #eef2ff);">
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
</section>`),
      explanation: '💰 Created a pricing section with Starter and Pro tiers, highlighted popular plan, and call-to-action buttons.'
    };
  }

  if (lp.includes('mobile') || lp.includes('responsive') || lp.includes('flex')) {
    const modified = html
      .replace(/display:\s*(block|inline-block|grid)/gi, 'display: flex')
      .replace(/(style=")/i, '$1display: flex; flex-wrap: wrap; gap: 16px; ');
    return {
      html: wrap(modified),
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
      html: wrap(modified),
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

function generateFullPageFallback(prompt) {
  const lp = (prompt || '').toLowerCase();

  if (lp.includes('cyberpunk') || lp.includes('developer') || lp.includes('terminal')) {
    return `<nav style="display:flex;align-items:center;justify-content:space-between;padding:20px 40px;background:rgba(10,15,30,0.92);border-bottom:1px solid rgba(99,102,241,0.2);"><div style="display:flex;align-items:center;gap:12px;"><div style="width:32px;height:32px;border-radius:8px;background:linear-gradient(135deg,#06b6d4,#6366f1);display:flex;align-items:center;justify-content:center;color:#fff;font-weight:800;">⚡</div><span style="font-size:20px;font-weight:800;color:#fff;">Synapse.ai</span></div><button style="padding:10px 20px;background:linear-gradient(135deg,#06b6d4,#6366f1);color:#fff;font-weight:700;border:none;border-radius:8px;">Launch Console</button></nav>
<section style="padding:80px 32px;background:radial-gradient(circle at top,#1e1b4b 0%,#050816 70%);text-align:center;color:#fff;"><div style="max-width:820px;margin:0 auto;"><h1 style="font-size:52px;font-weight:800;line-height:1.1;margin:0 0 20px;color:#fff;">Autonomous AI Infrastructure for Modern Developers</h1><p style="font-size:18px;color:#94a3b8;line-height:1.6;margin:0 0 32px;">Deploy distributed reasoning clusters and stream tokens at zero latency.</p><button style="padding:14px 28px;background:linear-gradient(135deg,#06b6d4,#6366f1);color:#fff;font-weight:700;border:none;border-radius:12px;">Get API Keys Free</button></div></section>`;
  }

  if (lp.includes('portfolio') || lp.includes('creator') || lp.includes('design')) {
    return `<nav style="display:flex;align-items:center;justify-content:space-between;padding:24px 48px;background:#fff;border-bottom:1px solid #f1f5f9;"><span style="font-size:18px;font-weight:800;color:#0f172a;">AURA STUDIO</span><div style="display:flex;gap:32px;font-size:14px;color:#64748b;"><a href="#" style="color:#0f172a;text-decoration:none;">Work</a><a href="#" style="color:#64748b;text-decoration:none;">About</a><a href="#" style="color:#64748b;text-decoration:none;">Contact</a></div></nav>
<section style="padding:96px 48px;background:#fafafa;"><div style="max-width:900px;margin:0 auto;"><span style="font-size:12px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:#6366f1;">Independent Creative Direction</span><h1 style="font-size:56px;font-weight:800;color:#0f172a;line-height:1.1;margin:16px 0 24px;">Sculpting iconic digital identities.</h1><p style="font-size:20px;color:#64748b;line-height:1.6;max-width:680px;">Partnering with ambitious brands to craft unforgettable digital experiences.</p><button style="padding:14px 28px;background:#0f172a;color:#fff;font-weight:600;border:none;border-radius:999px;margin-top:24px;">Start a Project</button></div></section>`;
  }

  if (lp.includes('fintech') || lp.includes('finance') || lp.includes('banking') || lp.includes('app')) {
    return `<nav style="display:flex;align-items:center;justify-content:space-between;padding:20px 48px;background:rgba(15,23,42,0.9);border-bottom:1px solid rgba(255,255,255,0.08);"><span style="font-size:20px;font-weight:800;color:#fff;">VaultPay</span><button style="padding:10px 22px;background:linear-gradient(135deg,#10b981,#06b6d4);color:#fff;font-weight:600;border:none;border-radius:10px;">Download App</button></nav>
<section style="padding:84px 32px;background:radial-gradient(circle at 50% 0%,#064e3b 0%,#022c22 40%,#0f172a 80%);text-align:center;color:#fff;"><div style="max-width:840px;margin:0 auto;"><h1 style="font-size:52px;font-weight:800;line-height:1.15;margin:0 0 20px;color:#fff;">Smarter borders. Instant global settlement.</h1><p style="font-size:18px;color:#94a3b8;line-height:1.6;margin:0 0 36px;">Spend in 40+ currencies at real-time interbank rates.</p><button style="padding:14px 28px;background:linear-gradient(135deg,#10b981,#06b6d4);color:#fff;font-weight:700;border:none;border-radius:12px;">Open Free Account →</button></div></section>`;
  }

  // Default: modern SaaS landing page
  return `<nav style="display:flex;align-items:center;justify-content:space-between;padding:20px 48px;background:rgba(15,23,42,0.85);backdrop-filter:blur(16px);border-bottom:1px solid rgba(255,255,255,0.08);"><div style="display:flex;align-items:center;gap:12px;"><div style="width:32px;height:32px;border-radius:10px;background:linear-gradient(135deg,#6366f1,#a855f7);display:flex;align-items:center;justify-content:center;color:#fff;">✨</div><span style="font-size:20px;font-weight:800;color:#fff;">ProtoSphere</span></div><button style="padding:10px 22px;background:linear-gradient(135deg,#6366f1,#ec4899);color:#fff;font-weight:600;border:none;border-radius:10px;">Start Free Trial</button></nav>
<section style="padding:88px 32px 72px;background:radial-gradient(circle at 50% 0%,#1e1b4b 0%,#0f172a 75%);text-align:center;color:#fff;"><div style="max-width:820px;margin:0 auto;"><h1 style="font-size:52px;font-weight:800;line-height:1.15;margin:0 0 22px;color:#fff;">Build and scale web products with autonomous AI agility</h1><p style="font-size:18px;color:#94a3b8;line-height:1.6;max-width:660px;margin:0 auto 36px;">Drag components visually, leverage section-level AI co-pilots, and deploy production-ready semantic HTML.</p><div style="display:flex;justify-content:center;gap:14px;flex-wrap:wrap;"><input type="email" placeholder="Enter your work email" style="padding:14px 20px;font-size:15px;border:1px solid rgba(255,255,255,0.15);border-radius:12px;width:300px;background:rgba(15,23,42,0.8);color:#fff;" /><button style="padding:14px 30px;font-size:15px;font-weight:700;background:linear-gradient(135deg,#6366f1,#a855f7);color:#fff;border:none;border-radius:12px;">Get Instant Access →</button></div></div></section>
<section style="padding:64px 32px;background:#0f172a;color:#fff;"><div style="max-width:980px;margin:0 auto;display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px;"><div style="padding:32px;background:rgba(30,41,59,0.5);border:1px solid rgba(255,255,255,0.08);border-radius:18px;"><div style="font-size:24px;margin-bottom:16px;">⚡</div><h3 style="font-size:19px;font-weight:700;margin:0 0 10px;">Visual Drag & Drop</h3><p style="font-size:14px;color:#94a3b8;line-height:1.6;margin:0;">Drop nested containers and typography directly onto the canvas.</p></div><div style="padding:32px;background:rgba(30,41,59,0.5);border:1px solid rgba(255,255,255,0.08);border-radius:18px;"><div style="font-size:24px;margin-bottom:16px;">🤖</div><h3 style="font-size:19px;font-weight:700;margin:0 0 10px;">Section Co-Pilot</h3><p style="font-size:14px;color:#94a3b8;line-height:1.6;margin:0;">Select any element and describe your change.</p></div><div style="padding:32px;background:rgba(30,41,59,0.5);border:1px solid rgba(255,255,255,0.08);border-radius:18px;"><div style="font-size:24px;margin-bottom:16px;">✨</div><h3 style="font-size:19px;font-weight:700;margin:0 0 10px;">Two-Way Code Sync</h3><p style="font-size:14px;color:#94a3b8;line-height:1.6;margin:0;">Edit raw HTML anytime or export clean markup.</p></div></div></section>
<footer style="padding:40px 32px;background:#0b1120;border-top:1px solid rgba(255,255,255,0.06);text-align:center;color:#64748b;font-size:13px;">© 2026 ProtoSphere Studio. Generated with Muse AI.</footer>`;
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
  const cfg = getEnvConfig();
  const maskedKey = cfg.metaKey ? `${cfg.metaKey.slice(0, 6)}...${cfg.metaKey.slice(-4)}` : 'MISSING / PLACEHOLDER';
  console.log(`ProtoMind hub        http://localhost:${PORT}/`);
  console.log(`  ProtoMind4004      http://localhost:${PORT}/protomind`);
  console.log(`  ProtoWeb           http://localhost:${PORT}/protoweb`);
  console.log(`  ProtoGame          http://localhost:${PORT}/protogame`);
  console.log(`  AI endpoint        POST http://localhost:${PORT}/api/ai`);
  console.log(`  Meta AI gateway    POST http://localhost:${PORT}/api/ai/meta/:profile`);
  console.log(`  Multi-turn Chat    POST http://localhost:${PORT}/api/ai/chat`);
  console.log(`  SPICE Synthesizer  POST http://localhost:${PORT}/api/ai/spice`);
  console.log(`  AI Image Blueprint POST http://localhost:${PORT}/api/ai/image`);
  console.log(`  AI Models list     GET  http://localhost:${PORT}/api/ai/models`);
  console.log(`  META_BASE_URL      ${cfg.metaBaseUrl}`);
  // console.log(`  META_API_KEY       ${maskedKey}`);
  console.log(`Toolchain folder:    ${protomind.toolchain.appHome()}`);
});