// ST Tracker - Character State Tracker for SillyTavern
// Tracks location, clothing, position, time, weather, topics, present, hair, makeup, state
// for both {{user}} and {{char}}

import { getContext, extension_settings } from "../../../extensions.js";
import { saveSettingsDebounced } from "../../../../script.js";
import { MacrosParser } from "../../../macros.js";
import { SlashCommand } from "../../../slash-commands/SlashCommand.js";
import { SlashCommandParser } from "../../../slash-commands/SlashCommandParser.js";

// ============================================================
// CONSTANTS
// ============================================================
const MODULE_NAME = "st-tracker";
const CONTAINER_CLASS = "stt-card-container";
const CODE_BLOCK_ID = "tracker"; // default identifier

const log = (msg) => console.log(`[STT] ${msg}`);

// Secret keys for SillyTavern's secrets system
const SECRET_KEYS = {
  OPENAI: "api_key_openai",
  CLAUDE: "api_key_claude",
  OPENROUTER: "api_key_openrouter",
  MAKERSUITE: "api_key_makersuite",
};

const PROVIDER_CONFIG = {
  openai: {
    name: "OpenAI",
    endpoint: "https://api.openai.com/v1/chat/completions",
    secretKey: SECRET_KEYS.OPENAI,
    placeholder: "gpt-4o-mini",
    format: "openai",
  },
  anthropic: {
    name: "Anthropic Claude",
    endpoint: "https://api.anthropic.com/v1/messages",
    secretKey: SECRET_KEYS.CLAUDE,
    placeholder: "claude-3-5-haiku-latest",
    format: "anthropic",
  },
  openrouter: {
    name: "OpenRouter",
    endpoint: "https://openrouter.ai/api/v1/chat/completions",
    secretKey: SECRET_KEYS.OPENROUTER,
    placeholder: "openai/gpt-4o-mini",
    format: "openai",
  },
  google: {
    name: "Google AI Studio",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models",
    secretKey: SECRET_KEYS.MAKERSUITE,
    placeholder: "gemini-2.0-flash",
    format: "google",
  },
  custom: {
    name: "Custom (OpenAI-Compatible)",
    endpoint: "",
    secretKey: null,
    placeholder: "model-name",
    format: "openai",
  },
};

// ============================================================
// DEFAULT SETTINGS
// ============================================================
const DEFAULT_SETTINGS = {
  isEnabled: true,
  codeBlockIdentifier: "tracker",
  hideTrackerBlocks: true,
  retainTrackerCount: 3,

  // Prompt
  systemPrompt: `You are a character state tracker. After every response, output a tracker block that tracks the current state of all characters in the scene.

Output the tracker in this exact format:
{{stt_format}}

Rules:
- Track ALL characters present in the scene, including {{user}}
- Update fields based on what happens in the narrative
- Keep values concise but descriptive
- "present" lists other characters who are nearby/in the scene
- "state" describes emotional/physical state
- "topics" tracks current conversation topics
- Time and weather are global (shared across all characters)
- Always place the tracker block at the END of your response`,

  // Secondary LLM
  useSecondaryLLM: false,
  secondaryLLMAPI: "openai",
  secondaryLLMModel: "",
  secondaryLLMEndpoint: "",
  secondaryLLMAPIKey: "",
  secondaryLLMTemperature: 0.7,
  secondaryLLMMessageCount: 5,
  secondaryLLMStreaming: true,
};

// ============================================================
// SETTINGS MANAGEMENT
// ============================================================
function getSettings(key) {
  if (!extension_settings[MODULE_NAME]) return DEFAULT_SETTINGS[key];
  const val = extension_settings[MODULE_NAME][key];
  return val !== undefined ? val : DEFAULT_SETTINGS[key];
}

function setSettings(key, value) {
  if (!extension_settings[MODULE_NAME]) {
    extension_settings[MODULE_NAME] = { ...DEFAULT_SETTINGS };
  }
  extension_settings[MODULE_NAME][key] = value;
  saveSettingsDebounced();
}

function initSettings() {
  if (!extension_settings[MODULE_NAME]) {
    extension_settings[MODULE_NAME] = { ...DEFAULT_SETTINGS };
  } else {
    // Fill in any missing defaults
    for (const [key, val] of Object.entries(DEFAULT_SETTINGS)) {
      if (extension_settings[MODULE_NAME][key] === undefined) {
        extension_settings[MODULE_NAME][key] = val;
      }
    }
  }
}

// ============================================================
// TRACKER DATA PARSING
// ============================================================
function parseTrackerFromMessage(messageText) {
  if (!messageText) return null;

  const identifier = getSettings("codeBlockIdentifier");
  const regex = new RegExp("```" + identifier + "\\s*([\\s\\S]*?)```", "m");

  // Also check wrapped blocks (hidden divs)
  const wrappedRegex = new RegExp(
    `<div style="display: none;">\\s*\`\`\`${identifier}\\s*([\\s\\S]*?)\`\`\`\\s*</div>`,
    "m"
  );

  let match = messageText.match(wrappedRegex);
  if (match && match[1]) {
    try {
      return JSON.parse(match[1].trim());
    } catch (e) {
      log(`Failed to parse wrapped tracker JSON: ${e.message}`);
    }
  }

  match = messageText.match(regex);
  if (match && match[1]) {
    try {
      return JSON.parse(match[1].trim());
    } catch (e) {
      log(`Failed to parse tracker JSON: ${e.message}`);
    }
  }

  return null;
}

// ============================================================
// CARD RENDERING
// ============================================================
function escapeHtml(str) {
  if (!str || typeof str !== "string") return str || "";
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderField(icon, label, value) {
  if (!value && value !== 0) return "";
  return `
    <div class="stt-field">
      <span class="stt-field-icon">${icon}</span>
      <span class="stt-field-label">${escapeHtml(label)}</span>
      <span class="stt-field-value">${escapeHtml(String(value))}</span>
    </div>`;
}

function renderCharacterCard(character) {
  const name = character.name || "Unknown";
  const initial = name.charAt(0).toUpperCase();

  let fieldsHtml = "";
  fieldsHtml += renderField("&#128205;", "Location", character.location);
  fieldsHtml += renderField("&#128090;", "Clothing", character.clothing);
  fieldsHtml += renderField("&#129485;", "Position", character.position);
  fieldsHtml += renderField("&#128172;", "Topics", character.topics);
  fieldsHtml += renderField("&#128101;", "Present", character.present);
  fieldsHtml += renderField("&#128135;", "Hair", character.hair);
  fieldsHtml += renderField("&#128132;", "Makeup", character.makeup);
  fieldsHtml += renderField("&#127919;", "State", character.state);

  return `
    <div class="stt-character-card">
      <div class="stt-char-header">
        <div class="stt-char-avatar">${escapeHtml(initial)}</div>
        <div class="stt-char-name">${escapeHtml(name)}</div>
      </div>
      <div class="stt-char-fields">
        ${fieldsHtml}
      </div>
    </div>`;
}

function renderTrackerCard(data) {
  if (!data) return "";

  const time = data.time || "";
  const weather = data.weather || "";
  const characters = data.characters || [];

  if (characters.length === 0) return "";

  let headerHtml = "";
  if (time || weather) {
    headerHtml = `
      <div class="stt-header">
        ${time ? `<span class="stt-header-item">&#128336; ${escapeHtml(time)}</span>` : ""}
        ${weather ? `<span class="stt-header-item">&#127780; ${escapeHtml(weather)}</span>` : ""}
      </div>`;
  }

  const charactersHtml = characters.map(renderCharacterCard).join("");

  return `
    <div class="${CONTAINER_CLASS}">
      ${headerHtml}
      <div class="stt-characters">
        ${charactersHtml}
      </div>
    </div>`;
}

// ============================================================
// DOM MANIPULATION - Render cards into messages
// ============================================================
let lastRenderedMessageId = null;
let lastTrackerData = null;

function renderCardInMessage(mesId) {
  const context = getContext();
  if (!context.chat || !context.chat[mesId]) return;

  const message = context.chat[mesId];
  if (message.is_user || message.is_system) return;

  const data = parseTrackerFromMessage(message.mes);
  if (!data) return;

  const mesElement = document.querySelector(`div[mesid="${mesId}"] .mes_text`);
  if (!mesElement) return;

  // Remove existing tracker card if any
  const existing = mesElement.querySelector(`.${CONTAINER_CLASS}`);
  if (existing) existing.remove();

  const cardHtml = renderTrackerCard(data);
  if (!cardHtml) return;

  // Insert card at the end of the message
  mesElement.insertAdjacentHTML("beforeend", cardHtml);

  lastRenderedMessageId = parseInt(mesId);
  lastTrackerData = data;
}

function refreshAllCards() {
  const context = getContext();
  if (!context.chat) return;

  for (let i = 0; i < context.chat.length; i++) {
    renderCardInMessage(i);
  }
}

// ============================================================
// HIDE TRACKER CODE BLOCKS
// ============================================================
function hideTrackerBlocks() {
  if (!getSettings("isEnabled") || !getSettings("hideTrackerBlocks")) return;

  const identifier = getSettings("codeBlockIdentifier");
  const codeElements = document.querySelectorAll(
    `#chat code[class*="${identifier}"]`
  );

  codeElements.forEach((codeEl) => {
    const pre = codeEl.closest("pre");
    if (pre && pre.style.display !== "none") {
      pre.style.display = "none";
    }
  });
}

// ============================================================
// GENERATION INTERCEPTOR - Clean old tracker blocks from context
// ============================================================
let generationInProgress = false;

globalThis.stTrackerGenInterceptor = async function (
  chat,
  contextSize,
  abort,
  type
) {
  log(`Generation interceptor called (type: ${type})`);

  const retainCount = parseInt(getSettings("retainTrackerCount")) || 3;
  const identifier = getSettings("codeBlockIdentifier");

  // Clone chat to avoid mutating original
  const clonedChat = chat.map((msg) => structuredClone(msg));

  // Find cutoff - keep only last N assistant messages with tracker data
  let assistantCount = 0;
  let cutoffIndex = 0;

  for (let i = clonedChat.length - 1; i >= 0; i--) {
    const msg = clonedChat[i];
    if (!msg.mes || msg.is_user || msg.is_system) continue;
    assistantCount++;
    if (assistantCount >= retainCount) {
      cutoffIndex = i;
      break;
    }
  }

  if (cutoffIndex > 0) {
    for (let i = 0; i < cutoffIndex; i++) {
      const msg = clonedChat[i];
      if (!msg.mes) continue;

      const regex = new RegExp("```" + identifier + "[\\s\\S]*?```", "g");
      if (regex.test(msg.mes)) {
        msg.mes = msg.mes.replace(regex, "").trim();
        // Clean wrapper divs
        msg.mes = msg.mes
          .replace(/<div style="display: none;">\s*\n?\s*<\/div>/g, "")
          .trim();
      }
    }
  }

  return { chat: clonedChat, contextSize, abort };
};

// ============================================================
// SECONDARY LLM
// ============================================================
function getRequestHeaders() {
  return {
    "Content-Type": "application/json",
    "X-CSRF-Token": SillyTavern.getContext().csrf_token || "",
  };
}

async function fetchSecretKey(secretKey) {
  if (!secretKey) return null;
  try {
    const response = await fetch("/api/secrets/find", {
      method: "POST",
      headers: getRequestHeaders(),
      body: JSON.stringify({ key: secretKey }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.value || null;
  } catch (e) {
    log(`Error fetching secret key: ${e.message}`);
    return null;
  }
}

async function callSecondaryLLM(prompt, provider, model, opts = {}) {
  const config = PROVIDER_CONFIG[provider];
  if (!config) throw new Error(`Unknown provider: ${provider}`);

  let apiKey = opts.apiKey || null;
  const streaming = opts.streaming !== false;
  const temperature = opts.temperature || 0.7;

  // Fetch API key from ST secrets for known providers
  if (provider !== "custom" && config.secretKey) {
    apiKey = await fetchSecretKey(config.secretKey);
    if (!apiKey) {
      throw new Error(
        `No API key found for ${config.name}. Configure it in SillyTavern API settings.`
      );
    }
  }

  let url, headers, body;

  if (config.format === "anthropic") {
    url = config.endpoint;
    headers = {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    };
    body = {
      model,
      max_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
      temperature,
      stream: streaming,
    };
  } else if (config.format === "google") {
    const action = streaming ? "streamGenerateContent" : "generateContent";
    url = `${config.endpoint}/${model}:${action}?key=${apiKey}`;
    headers = { "Content-Type": "application/json" };
    body = {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      generationConfig: { temperature, maxOutputTokens: 4096 },
    };
  } else {
    // OpenAI-compatible (openai, openrouter, custom)
    url = provider === "custom" ? opts.endpoint : config.endpoint;
    headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    };
    body = {
      model,
      messages: [{ role: "user", content: prompt }],
      temperature,
      stream: streaming,
    };
    if (provider === "openrouter") {
      headers["HTTP-Referer"] = window.location.origin;
      headers["X-Title"] = "ST Tracker";
    }
  }

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`LLM request failed: ${res.status} - ${errText}`);
  }

  if (streaming) {
    return await readStreamResponse(res, config.format);
  } else {
    return await readNonStreamResponse(res, config.format);
  }
}

async function readStreamResponse(res, format) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let fullText = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith(":")) continue;
        if (!trimmed.startsWith("data: ")) continue;

        const data = trimmed.slice(6);
        if (data === "[DONE]") continue;

        try {
          const parsed = JSON.parse(data);
          let content = "";
          if (parsed.choices?.[0]?.delta?.content)
            content = parsed.choices[0].delta.content;
          else if (parsed.delta?.text) content = parsed.delta.text;
          else if (parsed.candidates?.[0]?.content?.parts?.[0]?.text)
            content = parsed.candidates[0].content.parts[0].text;
          fullText += content;
        } catch (e) {
          // Skip unparseable chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return fullText;
}

async function readNonStreamResponse(res, format) {
  const data = await res.json();
  if (data.choices?.[0]?.message?.content)
    return data.choices[0].message.content;
  if (data.content && Array.isArray(data.content)) {
    const textBlock = data.content.find((b) => b.type === "text");
    return textBlock?.text || "";
  }
  if (data.candidates?.[0]?.content?.parts?.[0]?.text)
    return data.candidates[0].content.parts[0].text;
  return "";
}

async function generateTrackerWithSecondaryLLM() {
  const context = getContext();
  const chat = context.chat;
  if (!chat || chat.length === 0) return null;

  const provider = getSettings("secondaryLLMAPI");
  const model = getSettings("secondaryLLMModel");
  const messageCount = parseInt(getSettings("secondaryLLMMessageCount")) || 5;
  const temperature =
    parseFloat(getSettings("secondaryLLMTemperature")) || 0.7;
  const streaming = getSettings("secondaryLLMStreaming") !== false;

  if (!model) {
    toastr.warning("Secondary LLM model not configured.");
    return null;
  }

  // Get recent messages
  const recentMessages = chat
    .filter((msg) => !msg.is_system)
    .slice(-messageCount);

  const identifier = getSettings("codeBlockIdentifier");
  const userName = context.name1 || "User";
  const charName = context.name2 || "Character";

  // Find previous tracker data
  let prevTracker = null;
  for (let i = chat.length - 2; i >= 0; i--) {
    const data = parseTrackerFromMessage(chat[i]?.mes);
    if (data) {
      prevTracker = JSON.stringify(data, null, 2);
      break;
    }
  }

  // Build prompt
  let prompt = getSettings("systemPrompt") || DEFAULT_SETTINGS.systemPrompt;
  const formatContent = generateFormatContent();
  prompt = prompt.replace(/\{\{stt_format\}\}/g, formatContent);
  prompt = prompt.replace(/\{\{user\}\}/gi, userName);
  prompt = prompt.replace(/\{\{char\}\}/gi, charName);

  prompt += "\n\n";
  if (prevTracker) {
    prompt += "Previous tracker state:\n" + prevTracker + "\n\n";
  }
  prompt += "Recent conversation:\n\n";
  recentMessages.forEach((msg) => {
    const role = msg.is_user ? userName : msg.name || charName;
    // Clean out existing tracker blocks
    let content = msg.mes || "";
    content = content
      .replace(new RegExp("```" + identifier + "[\\s\\S]*?```", "g"), "")
      .trim();
    prompt += `${role}: ${content}\n\n`;
  });

  prompt += `\nBased on the above conversation, generate ONLY the raw JSON data (without code fences or backticks). Output ONLY the JSON structure directly.`;

  try {
    log("Calling secondary LLM...");
    let text = await callSecondaryLLM(prompt, provider, model, {
      temperature,
      streaming,
      apiKey: getSettings("secondaryLLMAPIKey"),
      endpoint: getSettings("secondaryLLMEndpoint"),
    });

    // Clean up response
    text = text
      .trim()
      .replace(/^```(?:json)?\s*/i, "")
      .replace(/\s*```\s*$/, "")
      .trim();

    log("Secondary LLM response received");
    return text;
  } catch (error) {
    log(`Secondary LLM error: ${error.message}`);
    toastr.error(`Secondary LLM failed: ${error.message}`);
    return null;
  }
}

// ============================================================
// MACROS
// ============================================================
function generateFormatContent() {
  const identifier = getSettings("codeBlockIdentifier");

  return (
    "```" +
    identifier +
    `
{
  "time": "[CURRENT_TIME]",
  "weather": "[CURRENT_WEATHER]",
  "characters": [
    {
      "name": "[CHARACTER_NAME]",
      "location": "[WHERE_THEY_ARE]",
      "clothing": "[WHAT_THEY_ARE_WEARING]",
      "position": "[BODY_POSITION_OR_POSE]",
      "topics": "[CURRENT_CONVERSATION_TOPICS]",
      "present": "[OTHER_CHARACTERS_NEARBY]",
      "hair": "[HAIR_STYLE_AND_STATE]",
      "makeup": "[MAKEUP_DESCRIPTION]",
      "state": "[EMOTIONAL_AND_PHYSICAL_STATE]"
    }
  ]
}
\`\`\``
  );
}

function registerMacros() {
  // {{stt_tracker}} - Injects the system prompt
  MacrosParser.registerMacro("stt_tracker", () => {
    if (!getSettings("isEnabled")) return "";
    log("Processed {{stt_tracker}} macro");

    let output = getSettings("systemPrompt") || "";

    // Replace nested {{stt_format}}
    if (output.includes("{{stt_format}}")) {
      output = output.replace(/\{\{stt_format\}\}/g, generateFormatContent());
    }

    // Replace {{user}} and {{char}}
    const context = getContext();
    const userName = context.name1 || "User";
    const charName =
      context.name2 || (context.groupId ? "Characters" : "Character");

    output = output.replace(/\{\{user\}\}/gi, userName);
    output = output.replace(/\{\{char\}\}/gi, charName);

    return output;
  });

  // {{stt_format}} - Injects just the format example
  MacrosParser.registerMacro("stt_format", () => {
    if (!getSettings("isEnabled")) return "";
    log("Processed {{stt_format}} macro");
    return generateFormatContent();
  });

  // {{stt_last}} - Returns the last tracker JSON
  MacrosParser.registerMacro("stt_last", () => {
    if (!getSettings("isEnabled")) return "";
    return lastTrackerData ? JSON.stringify(lastTrackerData) : "{}";
  });

  log("Macros registered: {{stt_tracker}}, {{stt_format}}, {{stt_last}}");
}

// ============================================================
// SLASH COMMANDS
// ============================================================
function registerSlashCommands() {
  SlashCommandParser.addCommandObject(
    SlashCommand.fromProps({
      name: "stt-refresh",
      callback: async () => {
        refreshAllCards();
        return "Tracker cards refreshed.";
      },
      helpString: "Refresh all ST Tracker cards in the chat.",
    })
  );

  SlashCommandParser.addCommandObject(
    SlashCommand.fromProps({
      name: "stt-toggle",
      callback: async () => {
        const current = getSettings("isEnabled");
        setSettings("isEnabled", !current);
        const checkbox = document.getElementById("sttIsEnabled");
        if (checkbox) checkbox.checked = !current;
        if (!current) refreshAllCards();
        return `ST Tracker ${!current ? "enabled" : "disabled"}.`;
      },
      helpString: "Toggle ST Tracker on/off.",
    })
  );

  log("Slash commands registered: /stt-refresh, /stt-toggle");
}

// ============================================================
// SETTINGS UI
// ============================================================
async function loadSettingsHtml() {
  const extensionDir = getExtensionDir();
  const response = await fetch(`${extensionDir}/settings.html`);
  if (!response.ok) {
    log("Failed to load settings.html");
    return;
  }
  const html = await response.text();

  // Add settings panel to ST's extension settings area
  const container = document.getElementById("extensions_settings");
  if (container) {
    container.insertAdjacentHTML("beforeend", html);
  }

  // Populate UI with current values
  populateSettingsUI();

  // Attach listeners
  attachSettingsListeners();
}

function populateSettingsUI() {
  const fields = {
    sttIsEnabled: { type: "checkbox", key: "isEnabled" },
    sttCodeBlockId: { type: "text", key: "codeBlockIdentifier" },
    sttHideBlocks: { type: "checkbox", key: "hideTrackerBlocks" },
    sttRetainCount: { type: "number", key: "retainTrackerCount" },
    sttSystemPrompt: { type: "textarea", key: "systemPrompt" },
    sttUseSecondaryLLM: { type: "checkbox", key: "useSecondaryLLM" },
    sttSecondaryAPI: { type: "select", key: "secondaryLLMAPI" },
    sttSecondaryModel: { type: "text", key: "secondaryLLMModel" },
    sttSecondaryEndpoint: { type: "text", key: "secondaryLLMEndpoint" },
    sttSecondaryAPIKey: { type: "text", key: "secondaryLLMAPIKey" },
    sttSecondaryTemp: { type: "number", key: "secondaryLLMTemperature" },
    sttSecondaryMsgCount: { type: "number", key: "secondaryLLMMessageCount" },
    sttSecondaryStreaming: { type: "checkbox", key: "secondaryLLMStreaming" },
  };

  for (const [id, { type, key }] of Object.entries(fields)) {
    const el = document.getElementById(id);
    if (!el) continue;
    const value = getSettings(key);
    if (type === "checkbox") {
      el.checked = !!value;
    } else {
      el.value = value ?? "";
    }
  }

  // Show/hide custom API fields
  toggleCustomAPIFields();
}

function toggleCustomAPIFields() {
  const provider = getSettings("secondaryLLMAPI");
  const customFields = document.getElementById("sttCustomAPIFields");
  if (customFields) {
    customFields.style.display = provider === "custom" ? "block" : "none";
  }
}

function attachSettingsListeners() {
  // Checkbox listeners
  const checkboxes = [
    { id: "sttIsEnabled", key: "isEnabled" },
    { id: "sttHideBlocks", key: "hideTrackerBlocks" },
    { id: "sttUseSecondaryLLM", key: "useSecondaryLLM" },
    { id: "sttSecondaryStreaming", key: "secondaryLLMStreaming" },
  ];

  checkboxes.forEach(({ id, key }) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("change", () => {
        setSettings(key, el.checked);
        if (key === "isEnabled") refreshAllCards();
        if (key === "hideTrackerBlocks") hideTrackerBlocks();
      });
    }
  });

  // Text/number/select listeners
  const inputs = [
    { id: "sttCodeBlockId", key: "codeBlockIdentifier" },
    { id: "sttRetainCount", key: "retainTrackerCount", parse: parseInt },
    { id: "sttSystemPrompt", key: "systemPrompt" },
    { id: "sttSecondaryAPI", key: "secondaryLLMAPI" },
    { id: "sttSecondaryModel", key: "secondaryLLMModel" },
    { id: "sttSecondaryEndpoint", key: "secondaryLLMEndpoint" },
    { id: "sttSecondaryAPIKey", key: "secondaryLLMAPIKey" },
    {
      id: "sttSecondaryTemp",
      key: "secondaryLLMTemperature",
      parse: parseFloat,
    },
    {
      id: "sttSecondaryMsgCount",
      key: "secondaryLLMMessageCount",
      parse: parseInt,
    },
  ];

  inputs.forEach(({ id, key, parse }) => {
    const el = document.getElementById(id);
    if (el) {
      el.addEventListener("input", () => {
        setSettings(key, parse ? parse(el.value) : el.value);
        if (key === "secondaryLLMAPI") toggleCustomAPIFields();
      });
    }
  });
}

function getExtensionDir() {
  const indexPath = new URL(import.meta.url).pathname;
  return indexPath.substring(0, indexPath.lastIndexOf("/"));
}

// ============================================================
// EVENT HANDLERS
// ============================================================
function setupEventHandlers() {
  const context = getContext();

  // After message is rendered
  const eventSource = context.eventSource;
  const eventTypes = context.eventTypes;

  if (eventSource && eventTypes) {
    // When a message is received/rendered
    eventSource.on(eventTypes.MESSAGE_RECEIVED, (mesId) => {
      if (!getSettings("isEnabled")) return;
      log(`Message received: ${mesId}`);

      // Small delay to let DOM update
      setTimeout(() => {
        renderCardInMessage(mesId);
        hideTrackerBlocks();
      }, 100);
    });

    // When message is edited/swiped
    eventSource.on(eventTypes.MESSAGE_UPDATED, (mesId) => {
      if (!getSettings("isEnabled")) return;
      log(`Message updated: ${mesId}`);
      setTimeout(() => {
        renderCardInMessage(mesId);
        hideTrackerBlocks();
      }, 100);
    });

    // When message is swiped
    eventSource.on(eventTypes.MESSAGE_SWIPED, (mesId) => {
      if (!getSettings("isEnabled")) return;
      log(`Message swiped: ${mesId}`);
      setTimeout(() => {
        renderCardInMessage(mesId);
        hideTrackerBlocks();
      }, 100);
    });

    // When chat is changed
    eventSource.on(eventTypes.CHAT_CHANGED, () => {
      if (!getSettings("isEnabled")) return;
      log("Chat changed - refreshing all cards");
      setTimeout(() => {
        refreshAllCards();
        hideTrackerBlocks();
      }, 200);
    });

    // Generation started
    eventSource.on(eventTypes.GENERATION_STARTED, () => {
      generationInProgress = true;
    });

    // Generation ended - handle secondary LLM
    eventSource.on(eventTypes.GENERATION_ENDED, async (mesId) => {
      generationInProgress = false;

      if (!getSettings("isEnabled")) return;

      // Check if secondary LLM should generate tracker
      if (getSettings("useSecondaryLLM")) {
        const context = getContext();
        const lastMsg = context.chat[context.chat.length - 1];

        // Only generate if the last message doesn't already have tracker data
        if (lastMsg && !lastMsg.is_user) {
          const existing = parseTrackerFromMessage(lastMsg.mes);
          if (!existing) {
            log("No tracker in message, using secondary LLM...");
            const trackerJson = await generateTrackerWithSecondaryLLM();

            if (trackerJson) {
              try {
                // Validate it's valid JSON
                JSON.parse(trackerJson);

                const identifier = getSettings("codeBlockIdentifier");
                const trackerBlock = `\n\n\`\`\`${identifier}\n${trackerJson}\n\`\`\``;

                // Append to the last message
                const lastMesId = context.chat.length - 1;
                context.chat[lastMesId].mes += trackerBlock;

                // Save and re-render
                await context.saveChat();
                renderCardInMessage(lastMesId);
                hideTrackerBlocks();

                log("Secondary LLM tracker appended to message");
              } catch (e) {
                log(`Invalid JSON from secondary LLM: ${e.message}`);
              }
            }
          }
        }
      }
    });

    log("Event handlers registered");
  }
}

// ============================================================
// MUTATION OBSERVER - Hide blocks during streaming
// ============================================================
function setupMutationObserver() {
  const chatElement = document.getElementById("chat");
  if (!chatElement) {
    log("Chat element not found, will retry...");
    setTimeout(setupMutationObserver, 1000);
    return;
  }

  const observer = new MutationObserver((mutations) => {
    if (!getSettings("isEnabled") || !getSettings("hideTrackerBlocks")) return;

    const identifier = getSettings("codeBlockIdentifier");

    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (node.nodeType !== Node.ELEMENT_NODE) return;

        let codeElements = [];
        if (
          node.tagName === "CODE" &&
          node.className &&
          node.className.includes(identifier)
        ) {
          codeElements = [node];
        } else if (node.querySelectorAll) {
          codeElements = Array.from(
            node.querySelectorAll(`code[class*="${identifier}"]`)
          );
        }

        codeElements.forEach((codeEl) => {
          const pre = codeEl.closest("pre");
          if (pre && pre.style.display !== "none") {
            pre.style.display = "none";
          }
        });
      });
    });
  });

  observer.observe(chatElement, {
    childList: true,
    subtree: true,
  });

  log("MutationObserver set up for tracker block hiding");
}

// ============================================================
// ENTRY POINT
// ============================================================
jQuery(async () => {
  try {
    log("Initializing ST Tracker...");

    initSettings();
    await loadSettingsHtml();
    registerMacros();
    registerSlashCommands();
    setupEventHandlers();

    // Small delay to ensure DOM is ready
    setTimeout(() => {
      setupMutationObserver();
      refreshAllCards();
      hideTrackerBlocks();
    }, 500);

    log("ST Tracker initialized successfully!");
  } catch (error) {
    log(`Initialization error: ${error.message}`);
    console.error("[STT] Init error:", error);
  }
});
