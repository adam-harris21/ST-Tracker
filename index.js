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
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Secret keys for SillyTavern's secrets system
const SECRET_KEYS = {
  OPENAI: "api_key_openai",
  CLAUDE: "api_key_claude",
  OPENROUTER: "api_key_openrouter",
  MAKERSUITE: "api_key_makersuite",
};

const PROVIDER_CONFIG = {
  sillytavern: {
    name: "SillyTavern (Current Connection)",
    endpoint: "/api/backends/chat-completions/generate",
    secretKey: null,
    placeholder: "(uses your current model)",
    format: "sillytavern",
  },
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
// Bump this when systemPrompt changes to force-update saved settings
const PROMPT_VERSION = 5;

const DEFAULT_SETTINGS = {
  isEnabled: true,
  codeBlockIdentifier: "tracker",
  hideTrackerBlocks: true,
  retainTrackerCount: 3,
  promptVersion: PROMPT_VERSION,

  // Prompt
  systemPrompt: `You are a Scene Tracker Assistant, tasked with providing clear, consistent, and structured updates to a scene tracker for a roleplay. Use the latest message, previous tracker details, and context from recent messages to accurately update the tracker. Your response must ensure that each field is filled and complete.

Output the tracker in this exact format:
{{stt_format}}

### Key Instructions:

1. **Track ALL characters present in the scene, including {{user}}.**

2. **Default Assumptions for Missing Information**:
   - If no new details are provided for a character, assume reasonable defaults based on prior descriptions, logical inferences, or default character details.
   - **Clothing**: Describe the complete outfit for each character with specific details for color, fabric, and style (e.g., "fitted black leather jacket with silver studs on the collar"). Underwear must always be included. If underwear is intentionally missing, specify clearly (e.g., "No bra", "No panties"). If the character is undressed, list the entire outfit they had on.

3. **Incremental Time Progression**:
   - Adjust time in small increments, ideally only a few seconds per update, to reflect realistic scene progression. Avoid large jumps unless a significant time skip (e.g., sleep, travel) is explicitly stated.
   - Format time as "HH:MM:SS; MM/DD/YYYY (Day Name)".
   - Ensure time aligns with the setting (e.g., if in a public venue, choose appropriate hours).

4. **Location Format**: Location must always include at minimum: specific area/room, building or place name, city, and state/province/region. Never use vague single-word locations like "Bedroom" or "Park."
   - GOOD: "Master bedroom, second floor, Harrington Estate, Upper East Side, Manhattan, New York, USA"
   - GOOD: "Central fountain area, Westfield Shopping Centre, downtown Melbourne, Victoria, Australia"
   - BAD: "Bedroom" / "Mall" / "Kitchen" / "Park" — these are too vague, always expand
   - BAD: "Harrington Estate, Manhattan" — missing state/region, always include it

5. **Field Guidelines**:
   - "topics": Use one- or two-word keywords relevant to the scene. Avoid long phrases.
   - "state": Describe emotional and physical state, including how put-together or disheveled the character appears and any removed clothing.
   - "position": Current body position or pose.
   - Time, weather, and location are global (shared across all characters).

6. **accent_color**: A hex color (e.g. "#6a5acd") representing the visual theme of the scene. Choose based on the character's personality, mood/atmosphere, and setting. Examples: warm amber (#d4763a) for cozy/romantic, cool blue (#4a90d9) for calm/ocean, deep red (#c0392b) for tense/passionate, forest green (#2d8659) for nature/outdoor, dark purple (#6a5acd) for mysterious/night. Pick ONE color that best represents the overall vibe.

7. **General Rules**:
   - Treat each update as a standalone, complete entry. Respond with the full tracker every time, even for minor updates.
   - Avoid redundancies — use only details provided or logically inferred.
   - Always place the tracker block at the END of your response.`,

  // Custom fields
  customFields: [
    { key: "clothing", label: "Clothing", description: "FULL_OUTFIT_INCLUDING_UNDERWEAR" },
    { key: "position", label: "Position", description: "BODY_POSITION_OR_POSE" },
    { key: "topics", label: "Topics", description: "SHORT_KEYWORDS" },
    { key: "hair", label: "Hair", description: "HAIR_STYLE_AND_STATE" },
    { key: "makeup", label: "Makeup", description: "DESCRIBE_FACE_APPEARANCE_SKIN_AND_MAKEUP_IF_ANY" },
    { key: "state", label: "State", description: "EMOTIONAL_PHYSICAL_STATE_AND_DRESS_STATE" },
  ],
  globalFields: [
    { key: "time", label: "Time", description: "HH:MM:SS; MM/DD/YYYY (Day Name)" },
    { key: "weather", label: "Weather", description: "CURRENT_WEATHER" },
    { key: "location", label: "Location", description: "SPECIFIC_DETAILED_LOCATION" },
    { key: "accent_color", label: "Accent Color", description: "HEX_COLOR_THAT_FITS_THE_RP_MOOD_AND_SETTING" },
  ],

  // Secondary LLM
  useSecondaryLLM: false,
  secondaryLLMAPI: "sillytavern",
  secondaryLLMModel: "",
  secondaryLLMEndpoint: "",
  secondaryLLMAPIKey: "",
  secondaryLLMTemperature: 0.7,
  secondaryLLMMessageCount: 5,
  secondaryLLMStreaming: true,
  secondaryLLMProfile: "", // Connection profile ID (for sillytavern provider)
  secondaryLLMStripHTML: true,

  // Format
  trackerFormat: "json", // "json" or "yaml"
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
    // Check prompt version BEFORE filling defaults (otherwise promptVersion
    // gets set to current by the defaults loop and migration never fires)
    const savedVersion = extension_settings[MODULE_NAME].promptVersion || 0;
    if (savedVersion < PROMPT_VERSION) {
      log(`Prompt version ${savedVersion} → ${PROMPT_VERSION}, updating system prompt`);
      extension_settings[MODULE_NAME].systemPrompt = DEFAULT_SETTINGS.systemPrompt;
      extension_settings[MODULE_NAME].promptVersion = PROMPT_VERSION;
      saveSettingsDebounced();
    }

    // Fill in any missing defaults
    for (const [key, val] of Object.entries(DEFAULT_SETTINGS)) {
      if (extension_settings[MODULE_NAME][key] === undefined) {
        extension_settings[MODULE_NAME][key] = val;
      }
    }
  }
}

// ============================================================
// MINIMAL YAML SUPPORT
// ============================================================
function simpleYamlToObject(yamlStr) {
  const lines = yamlStr.split("\n");
  const result = {};
  let inCharacters = false;
  let currentChar = null;

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line.trim() || line.trim().startsWith("#")) continue;

    if (line.match(/^characters:\s*$/)) {
      inCharacters = true;
      result.characters = [];
      continue;
    }

    if (inCharacters) {
      const itemMatch = line.match(/^\s+-\s+(\w+):\s*(.+)/);
      if (itemMatch) {
        // New array item (e.g. "  - name: ...")
        currentChar = {};
        result.characters.push(currentChar);
        currentChar[itemMatch[1]] = stripYamlQuotes(itemMatch[2]);
        continue;
      }
      const propMatch = line.match(/^\s+(\w+):\s*(.+)/);
      if (propMatch && currentChar) {
        currentChar[propMatch[1]] = stripYamlQuotes(propMatch[2]);
        continue;
      }
    } else {
      const topMatch = line.match(/^(\w+):\s*(.+)/);
      if (topMatch) {
        result[topMatch[1]] = stripYamlQuotes(topMatch[2]);
      }
    }
  }
  return result;
}

function stripYamlQuotes(val) {
  val = val.trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    return val.slice(1, -1);
  }
  return val;
}

function objectToSimpleYaml(obj) {
  let yaml = "";
  for (const [key, value] of Object.entries(obj)) {
    if (key === "characters") continue;
    yaml += `${key}: "${String(value)}"\n`;
  }
  if (obj.characters && Array.isArray(obj.characters)) {
    yaml += "characters:\n";
    for (const char of obj.characters) {
      let first = true;
      for (const [key, value] of Object.entries(char)) {
        if (first) {
          yaml += `  - ${key}: "${String(value)}"\n`;
          first = false;
        } else {
          yaml += `    ${key}: "${String(value)}"\n`;
        }
      }
    }
  }
  return yaml;
}

// ============================================================
// TRACKER DATA PARSING
// ============================================================
function parseTrackerFromMessage(messageText) {
  if (!messageText) return null;

  const identifier = getSettings("codeBlockIdentifier");
  const regex = new RegExp("```" + escapeRegex(identifier) + "\\s*([\\s\\S]*?)```", "m");

  // Also check wrapped blocks (hidden divs)
  const wrappedRegex = new RegExp(
    `<div style="display: none;">\\s*\`\`\`${escapeRegex(identifier)}\\s*([\\s\\S]*?)\`\`\`\\s*</div>`,
    "m"
  );

  let match = messageText.match(wrappedRegex);
  if (!match) match = messageText.match(regex);

  if (match && match[1]) {
    const raw = match[1].trim();
    // Try JSON first
    try {
      return JSON.parse(raw);
    } catch (e) {
      // Fall back to YAML parser
      try {
        const parsed = simpleYamlToObject(raw);
        if (parsed && parsed.characters && Array.isArray(parsed.characters)) {
          return parsed;
        }
      } catch (e2) {
        log(`Failed to parse tracker data: ${e.message}`);
      }
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

function darkenColor(hex) {
  hex = hex.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  const r = Math.round(parseInt(hex.substring(0, 2), 16) * 0.7);
  const g = Math.round(parseInt(hex.substring(2, 4), 16) * 0.7);
  const b = Math.round(parseInt(hex.substring(4, 6), 16) * 0.7);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

function renderField(icon, label, value, fieldKey = "", scope = "", charIndex = -1) {
  if (!value && value !== 0) return "";
  let attrs = "";
  if (fieldKey) {
    attrs += ` data-stt-field="${escapeHtml(fieldKey)}"`;
    attrs += ` data-stt-scope="${scope}"`;
    if (scope === "character" && charIndex >= 0) {
      attrs += ` data-stt-char-index="${charIndex}"`;
    }
  }
  return `
    <div class="stt-field"${attrs}>
      <span class="stt-field-icon">${icon}</span>
      <span class="stt-field-label">${label}</span>
      <span class="stt-field-value">${escapeHtml(String(value))}</span>
    </div>`;
}

function renderCharacterCard(character, charIndex = 0) {
  const name = character.name || "Unknown";
  const fields = getSettings("customFields") || DEFAULT_SETTINGS.customFields;

  let fieldsHtml = "";
  for (const field of fields) {
    fieldsHtml += renderField("", field.label, character[field.key], field.key, "character", charIndex);
  }

  return `
    <div class="stt-character-card">
      <div class="stt-char-header">
        <span class="stt-char-name">${escapeHtml(name)}</span>
      </div>
      <div class="stt-char-fields">
        ${fieldsHtml}
      </div>
    </div>`;
}

function renderTrackerCard(data, mesId = -1) {
  if (!data) return "";

  const accentColor = data.accent_color || "";
  const characters = data.characters || [];

  if (characters.length === 0) return "";

  // Build inline style to override accent color if the LLM provided one
  let inlineStyle = "";
  if (accentColor && /^#[0-9a-fA-F]{3,8}$/.test(accentColor)) {
    inlineStyle = `--stt-accent: ${accentColor};`;
  }
  const styleAttr = inlineStyle ? ` style="${inlineStyle}"` : "";
  const mesIdAttr = mesId >= 0 ? ` data-stt-mesid="${mesId}"` : "";

  // Build header from globalFields (skip accent_color — used for styling only)
  const globalFields = getSettings("globalFields") || DEFAULT_SETTINGS.globalFields;
  const headerItems = globalFields
    .filter(f => f.key !== "accent_color" && data[f.key])
    .map(f => {
      const HEADER_ICONS = { time: "🕐", weather: "🌤", location: "📍", season: "🍂", date: "📅" };
      const icon = HEADER_ICONS[f.key] ? `<span class="stt-header-icon">${HEADER_ICONS[f.key]}</span>` : "";
      return `<span class="stt-header-item" data-stt-field="${escapeHtml(f.key)}" data-stt-scope="global">${icon}<span class="stt-header-label">${escapeHtml(f.label)}:</span> <span class="stt-header-value">${escapeHtml(String(data[f.key]))}</span></span>`;
    });

  let headerHtml = "";
  if (headerItems.length > 0) {
    headerHtml = `<div class="stt-header">${headerItems.join("")}</div>`;
  }

  const charactersHtml = characters.map((char, i) => renderCharacterCard(char, i)).join("");

  return `
    <div class="${CONTAINER_CLASS}"${styleAttr}${mesIdAttr}>
      <div class="stt-toggle-bar">
        <span class="stt-toggle-label">Scene Tracker</span>
        ${getSettings("useSecondaryLLM") ? '<button class="stt-regenerate-btn" title="Regenerate tracker">&#8635;</button>' : ''}
        <span class="stt-toggle-chevron">&#9660;</span>
      </div>
      <div class="stt-card-body">
        ${headerHtml}
        <div class="stt-characters">
          ${charactersHtml}
        </div>
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

  const cardHtml = renderTrackerCard(data, mesId);
  if (!cardHtml) return;

  // Insert card at the end of the message
  mesElement.insertAdjacentHTML("beforeend", cardHtml);

  lastRenderedMessageId = parseInt(mesId);
  lastTrackerData = data;
}

function refreshAllCards() {
  const context = getContext();
  if (!context.chat) return;

  const start = Math.max(0, context.chat.length - 50);
  for (let i = start; i < context.chat.length; i++) {
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
    `#chat code[class*="${CSS.escape(identifier)}"]`
  );

  codeElements.forEach((codeEl) => {
    const pre = codeEl.closest("pre");
    if (pre && pre.style.display !== "none") {
      pre.style.display = "none";
    }
  });
}

// ============================================================
// INLINE EDITING - Tap a field value to edit it directly
// ============================================================
async function saveInlineEdit(mesId, fieldKey, scope, charIndex, newValue) {
  const context = getContext();
  const msg = context.chat[mesId];
  if (!msg) return;

  const data = parseTrackerFromMessage(msg.mes);
  if (!data) return;

  // Update the data object
  if (scope === "global") {
    data[fieldKey] = newValue;
  } else if (scope === "character" && charIndex >= 0 && data.characters && data.characters[charIndex]) {
    data.characters[charIndex][fieldKey] = newValue;
  } else {
    return;
  }

  // Detect format from existing block (JSON or YAML) and serialize back in same format
  const identifier = getSettings("codeBlockIdentifier") || DEFAULT_SETTINGS.codeBlockIdentifier;
  const escapedId = escapeRegex(identifier);
  const extractRegex = new RegExp("```" + escapedId + "\\s*([\\s\\S]*?)```", "m");
  const rawMatch = msg.mes.match(extractRegex);
  const isJSON = rawMatch && rawMatch[1] && rawMatch[1].trim().startsWith("{");

  let trackerText;
  if (isJSON) {
    trackerText = JSON.stringify(data, null, 2);
  } else {
    trackerText = objectToSimpleYaml(data);
  }

  // Replace tracker block in message
  const replaceRegex = new RegExp("```" + escapedId + "\\s*[\\s\\S]*?```", "g");
  const newBlock = "```" + identifier + "\n" + trackerText + "\n```";

  // Handle wrapped (hidden div) format
  const wrappedRegex = new RegExp(
    `<div style="display: none;">\\s*\`\`\`${escapedId}\\s*[\\s\\S]*?\`\`\`\\s*</div>`,
    "g"
  );

  if (wrappedRegex.test(msg.mes)) {
    msg.mes = msg.mes.replace(
      new RegExp(`<div style="display: none;">\\s*\`\`\`${escapedId}\\s*[\\s\\S]*?\`\`\`\\s*</div>`, "g"),
      `<div style="display: none;">${newBlock}</div>`
    );
  } else if (replaceRegex.test(msg.mes)) {
    msg.mes = msg.mes.replace(
      new RegExp("```" + escapedId + "\\s*[\\s\\S]*?```", "g"),
      newBlock
    );
  }

  await context.saveChat();
  renderCardInMessage(mesId);
  hideTrackerBlocks();
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
    const hasTracker = parseTrackerFromMessage(msg.mes);
    if (!hasTracker) continue;
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

      const regex = new RegExp("```" + escapeRegex(identifier) + "[\\s\\S]*?```", "g");
      msg.mes = msg.mes.replace(regex, "").trim();
      // Clean wrapper divs
      msg.mes = msg.mes
        .replace(/<div style="display: none;">\s*\n?\s*<\/div>/g, "")
        .trim();
    }
  }

  return { chat: clonedChat, contextSize, abort };
};

// ============================================================
// SECONDARY LLM
// ============================================================
function getRequestHeaders() {
  return SillyTavern.getContext().getRequestHeaders();
}

async function fetchSecretKey(secretKey, secretId) {
  if (!secretKey) return null;
  try {
    const body = { key: secretKey };
    if (secretId) body.id = secretId;
    const response = await fetch("/api/secrets/find", {
      method: "POST",
      headers: getRequestHeaders(),
      body: JSON.stringify(body),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.value || null;
  } catch (e) {
    log(`Error fetching secret key: ${e.message}`);
    return null;
  }
}

// ============================================================
// CONNECTION PROFILES (READ-ONLY)
// ============================================================

/**
 * Read connection profiles from SillyTavern's connection manager.
 * This is READ-ONLY — we never modify, switch, or touch ST's active connection.
 * We only read the profile data to extract API type, model, url, and secret-id
 * so we can make our own SEPARATE API call.
 */
function getConnectionProfiles() {
  try {
    const profiles = extension_settings?.connectionManager?.profiles;
    if (!profiles || typeof profiles !== "object") return [];
    // profiles can be an object keyed by ID or an array
    if (Array.isArray(profiles)) return profiles;
    return Object.values(profiles);
  } catch (e) {
    log(`Error reading connection profiles: ${e.message}`);
    return [];
  }
}

/**
 * Map a SillyTavern connection profile's API type to our provider format.
 * Profile api values come from ST's chat_completion_sources: "openai", "claude", "openrouter", "makersuite", etc.
 */
function mapProfileAPIToFormat(profileAPI) {
  if (!profileAPI) return "openai";
  const api = profileAPI.toLowerCase();
  if (api === "claude") return "anthropic";
  if (api === "makersuite" || api === "google") return "google";
  // Everything else uses OpenAI-compatible format (openai, openrouter, groq, deepseek, mistralai, etc.)
  return "openai";
}

/**
 * Map a ST profile's API type to the correct secret key name.
 * Profile api values come from ST's chat_completion_sources: "openai", "claude", "openrouter", "makersuite", etc.
 */
const API_TO_SECRET = {
  openai: "api_key_openai",
  claude: "api_key_claude",
  openrouter: "api_key_openrouter",
  makersuite: "api_key_makersuite",
  google: "api_key_makersuite",
  vertexai: "api_key_vertexai",
  mistralai: "api_key_mistralai",
  cohere: "api_key_cohere",
  perplexity: "api_key_perplexity",
  groq: "api_key_groq",
  ai21: "api_key_ai21",
  deepseek: "api_key_deepseek",
  custom: "api_key_custom",
  chutes: "api_key_chutes",
};

function mapProfileAPIToSecretKey(profileAPI) {
  if (!profileAPI) return null;
  const api = profileAPI.toLowerCase();
  return API_TO_SECRET[api] || null;
}

/**
 * Get the default API endpoint for a profile's API type.
 * Uses exact ST chat_completion_sources values.
 */
const API_TO_ENDPOINT = {
  openai: "https://api.openai.com/v1/chat/completions",
  claude: "https://api.anthropic.com/v1/messages",
  openrouter: "https://openrouter.ai/api/v1/chat/completions",
  makersuite: "https://generativelanguage.googleapis.com/v1beta/models",
  google: "https://generativelanguage.googleapis.com/v1beta/models",
  groq: "https://api.groq.com/openai/v1/chat/completions",
  deepseek: "https://api.deepseek.com/v1/chat/completions",
  mistralai: "https://api.mistral.ai/v1/chat/completions",
  cohere: "https://api.cohere.com/v2/chat",
  perplexity: "https://api.perplexity.ai/chat/completions",
  chutes: "https://llm.chutes.ai/v1/chat/completions",
};

function getDefaultEndpointForAPI(profileAPI) {
  if (!profileAPI) return null;
  return API_TO_ENDPOINT[profileAPI.toLowerCase()] || null;
}

function populateProfileDropdown() {
  const select = document.getElementById("sttProfileSelect");
  if (!select) return;

  const profiles = getConnectionProfiles();
  const currentValue = getSettings("secondaryLLMProfile");

  // Clear existing options except the first placeholder
  select.innerHTML = '<option value="">(Use ST proxy — current connection)</option>';

  profiles.forEach((profile) => {
    const id = profile.id || "";
    const name = profile.name || id || "Unnamed";
    const option = document.createElement("option");
    option.value = id;
    option.textContent = name;
    if (id === currentValue) option.selected = true;
    select.appendChild(option);
  });
}

async function callSecondaryLLM(prompt, provider, model, opts = {}) {
  const config = PROVIDER_CONFIG[provider];
  if (!config) throw new Error(`Unknown provider: ${provider}`);

  let apiKey = opts.apiKey || null;
  const streaming = opts.streaming !== false;
  const temperature = opts.temperature ?? 0.7;

  let url, headers, body;

  // SillyTavern provider - either use proxy or a connection profile
  if (config.format === "sillytavern") {
    const profileId = opts.profileId || getSettings("secondaryLLMProfile");

    // If a profile is selected, read its data and route through ST's proxy
    // This NEVER touches ST's active connection — we only read the profile to get
    // the api type and model, then pass chat_completion_source to the proxy
    // so ST uses the right provider and API key internally
    if (profileId) {
      const profiles = getConnectionProfiles();
      const profile = profiles.find((p) => p.id === profileId);
      if (!profile) throw new Error(`Connection profile "${profileId}" not found. It may have been deleted.`);

      const profileAPI = profile.api || "";
      const profileModel = model || profile.model || "";

      log(`Using profile "${profile.name}" (api: ${profileAPI}, model: ${profileModel}) via ST proxy — READ-ONLY, no connection switching`);

      if (!profileModel) throw new Error(`No model found for profile "${profile.name}". Set a Model Override in settings.`);

      // Route through ST's proxy with chat_completion_source set to the profile's API type
      // ST handles the API key internally — no need to fetch secrets
      url = config.endpoint;
      headers = getRequestHeaders();
      body = {
        messages: [{ role: "user", content: prompt }],
        model: profileModel,
        temperature,
        stream: false,
        chat_completion_source: profileAPI,
      };

      const profileRes = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (!profileRes.ok) {
        const errText = await profileRes.text().catch(() => "");
        throw new Error(`Profile "${profile.name}" request failed: ${profileRes.status} - ${errText}`);
      }

      const data = await profileRes.json();
      if (data.choices?.[0]?.message?.content) return data.choices[0].message.content;
      if (data.content) return typeof data.content === "string" ? data.content : "";
      throw new Error("Unexpected response format from ST proxy");
    }

    // No profile selected — use ST proxy (current connection)
    url = config.endpoint;
    headers = getRequestHeaders();
    body = {
      messages: [{ role: "user", content: prompt }],
      temperature,
      stream: false, // ST proxy handles streaming differently, keep it simple
    };
    // Only include model if user specified an override
    if (model) {
      body.model = model;
    }

    log(`Using SillyTavern proxy (current connection)${model ? ` with model override: ${model}` : ""}`);

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`ST proxy request failed: ${res.status} - ${errText}`);
    }

    const data = await res.json();
    // ST proxy returns OpenAI-compatible format
    if (data.choices?.[0]?.message?.content) return data.choices[0].message.content;
    if (data.content) return typeof data.content === "string" ? data.content : "";
    throw new Error("Unexpected response format from ST proxy");
  }

  // Fetch API key from ST secrets for known providers
  if (provider !== "custom" && config.secretKey) {
    apiKey = await fetchSecretKey(config.secretKey);
    if (!apiKey) {
      throw new Error(
        `No API key found for ${config.name}. Configure it in SillyTavern API settings.`
      );
    }
  }

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

async function generateTrackerWithSecondaryLLM(targetMesId) {
  const provider = getSettings("secondaryLLMAPI");
  const model = getSettings("secondaryLLMModel");

  if (!model && provider !== "sillytavern") {
    toastr.warning("Secondary LLM model not configured.");
    return null;
  }

  const context = getContext();
  const chat = context.chat;
  if (!chat || chat.length === 0) return null;

  const messageCount = parseInt(getSettings("secondaryLLMMessageCount")) || 5;
  const temperature =
    parseFloat(getSettings("secondaryLLMTemperature")) ?? 0.7;
  const streaming = getSettings("secondaryLLMStreaming") !== false;

  // When targeting a specific message, only consider messages up to that point
  const chatSlice = targetMesId !== undefined ? chat.slice(0, targetMesId + 1) : chat;

  // Get recent messages
  const recentMessages = chatSlice
    .filter((msg) => !msg.is_system)
    .slice(-messageCount);

  const identifier = getSettings("codeBlockIdentifier");
  const userName = context.name1 || "User";
  const charName = context.name2 || "Character";

  // Find previous tracker data (search backwards from target or end)
  const searchStart = targetMesId !== undefined ? targetMesId - 1 : chat.length - 2;
  let prevTracker = null;
  for (let i = searchStart; i >= 0; i--) {
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
  if (!prompt.includes("```" + identifier)) {
    prompt += "\n\n" + formatContent;
  }
  prompt = prompt.replace(/\{\{user\}\}/gi, userName);
  prompt = prompt.replace(/\{\{char\}\}/gi, charName);

  prompt += "\n\n";
  if (prevTracker) {
    prompt += "Previous tracker state:\n" + prevTracker + "\n\n";
  }
  prompt += "Recent conversation:\n\n";
  const stripHTML = getSettings("secondaryLLMStripHTML") !== false;
  recentMessages.forEach((msg) => {
    const role = msg.is_user ? userName : msg.name || charName;
    // Clean out existing tracker blocks
    let content = msg.mes || "";
    content = content
      .replace(new RegExp("```" + escapeRegex(identifier) + "[\\s\\S]*?```", "g"), "")
      .trim();
    if (stripHTML) {
      content = content.replace(/<[^>]*>/g, "");
    }
    prompt += `${role}: ${content}\n\n`;
  });

  const formatName = (getSettings("trackerFormat") || "json").toUpperCase();
  prompt += `\nIMPORTANT: Format time exactly as "HH:MM:SS; MM/DD/YYYY (Day Name)". Every field must be filled — use reasonable assumptions if not stated.`;
  prompt += `\nBased on the above conversation, generate ONLY the raw ${formatName} data (without code fences or backticks). Output ONLY the ${formatName} structure directly.`;

  try {
    log("Calling secondary LLM...");
    let text = await callSecondaryLLM(prompt, provider, model, {
      temperature,
      streaming,
      apiKey: getSettings("secondaryLLMAPIKey"),
      endpoint: getSettings("secondaryLLMEndpoint"),
    });

    // Clean up response (strip code fences for json/yaml)
    text = text
      .trim()
      .replace(/^```(?:json|yaml)?\s*/i, "")
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
  const format = getSettings("trackerFormat") || "json";

  const context = getContext();
  const userName = context.name1 || "User";
  const charName =
    context.name2 || (context.groupId ? "Characters" : "Character");

  const globalFields = getSettings("globalFields") || DEFAULT_SETTINGS.globalFields;
  const customFields = getSettings("customFields") || DEFAULT_SETTINGS.customFields;

  if (format === "yaml") {
    let yaml = "";
    for (const f of globalFields) {
      yaml += `${f.key}: "[${f.description}]"\n`;
    }
    yaml += "characters:\n";
    for (const name of [charName, userName]) {
      yaml += `  - name: "${name}"\n`;
      for (const f of customFields) {
        yaml += `    ${f.key}: "[${f.description}]"\n`;
      }
    }
    return "```" + identifier + "\n" + yaml + "```";
  }

  // JSON format
  const globalObj = {};
  for (const f of globalFields) {
    globalObj[f.key] = `[${f.description}]`;
  }

  const charTemplate = {};
  for (const f of customFields) {
    charTemplate[f.key] = `[${f.description}]`;
  }

  const template = {
    ...globalObj,
    characters: [
      { name: charName, ...charTemplate },
      { name: userName, ...charTemplate },
    ],
  };

  return "```" + identifier + "\n" + JSON.stringify(template, null, 2) + "\n```";
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

    // If saved prompt didn't contain {{stt_format}}, append format template
    if (!output.includes("```" + getSettings("codeBlockIdentifier"))) {
      output += "\n\n" + generateFormatContent();
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

// ============================================================
// FIELD EDITOR
// ============================================================
function renderFieldEditor(containerId, settingsKey, fieldLabel) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const fields = getSettings(settingsKey) || DEFAULT_SETTINGS[settingsKey];
  container.innerHTML = "";

  fields.forEach((field, index) => {
    const row = document.createElement("div");
    row.className = "stt-field-editor-row";
    row.innerHTML = `
      <input type="text" class="stt-input stt-field-key" value="${escapeHtml(field.key)}" placeholder="key" title="Field key (used in JSON)">
      <input type="text" class="stt-input stt-field-label" value="${escapeHtml(field.label)}" placeholder="Label" title="Display label">
      <input type="text" class="stt-input stt-field-desc" value="${escapeHtml(field.description)}" placeholder="Description" title="Placeholder in format template">
      <div class="stt-field-actions">
        <button class="stt-field-move-btn" data-dir="up" title="Move up" ${index === 0 ? "disabled" : ""}>&#9650;</button>
        <button class="stt-field-move-btn" data-dir="down" title="Move down" ${index === fields.length - 1 ? "disabled" : ""}>&#9660;</button>
        <button class="stt-field-delete" title="Delete">&#10005;</button>
      </div>`;

    // Move up/down
    row.querySelectorAll(".stt-field-move-btn").forEach(btn => {
      btn.addEventListener("click", () => {
        const dir = btn.dataset.dir;
        const current = getSettings(settingsKey) || [];
        const newIndex = dir === "up" ? index - 1 : index + 1;
        if (newIndex < 0 || newIndex >= current.length) return;
        [current[index], current[newIndex]] = [current[newIndex], current[index]];
        setSettings(settingsKey, current);
        renderFieldEditor(containerId, settingsKey, fieldLabel);
      });
    });

    // Delete
    row.querySelector(".stt-field-delete").addEventListener("click", () => {
      const current = getSettings(settingsKey) || [];
      current.splice(index, 1);
      setSettings(settingsKey, current);
      renderFieldEditor(containerId, settingsKey, fieldLabel);
    });

    // Input changes
    row.querySelectorAll(".stt-input").forEach(input => {
      input.addEventListener("input", () => {
        const current = getSettings(settingsKey) || [];
        const keyInput = row.querySelector(".stt-field-key");
        const labelInput = row.querySelector(".stt-field-label");
        const descInput = row.querySelector(".stt-field-desc");
        current[index] = {
          key: keyInput.value.trim(),
          label: labelInput.value.trim(),
          description: descInput.value.trim(),
        };
        setSettings(settingsKey, current);
      });
    });

    container.appendChild(row);
  });
}

function addFieldToEditor(containerId, settingsKey) {
  const current = getSettings(settingsKey) || [];
  // Generate a unique key
  let newKey = "new_field";
  let counter = 1;
  while (current.some(f => f.key === newKey)) {
    newKey = `new_field_${counter++}`;
  }
  current.push({ key: newKey, label: "New Field", description: "DESCRIPTION" });
  setSettings(settingsKey, current);
  renderFieldEditor(containerId, settingsKey);
}

function resetFieldsToDefault() {
  setSettings("customFields", JSON.parse(JSON.stringify(DEFAULT_SETTINGS.customFields)));
  setSettings("globalFields", JSON.parse(JSON.stringify(DEFAULT_SETTINGS.globalFields)));
  renderFieldEditor("sttGlobalFieldsList", "globalFields");
  renderFieldEditor("sttCharFieldsList", "customFields");
  toastr.success("Fields reset to defaults.", "ST Tracker");
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

  // Populate tracker format dropdown
  const formatSelect = document.getElementById("sttTrackerFormat");
  if (formatSelect) formatSelect.value = getSettings("trackerFormat") || "json";

  // Populate HTML strip toggle
  const stripHtml = document.getElementById("sttStripHTML");
  if (stripHtml) stripHtml.checked = getSettings("secondaryLLMStripHTML") !== false;

  // Populate field editors
  renderFieldEditor("sttGlobalFieldsList", "globalFields");
  renderFieldEditor("sttCharFieldsList", "customFields");
}

function toggleCustomAPIFields() {
  const provider = getSettings("secondaryLLMAPI");
  const customFields = document.getElementById("sttCustomAPIFields");
  const profileRow = document.getElementById("sttProfileRow");
  const modelDesc = document.getElementById("sttModelDesc");
  const modelInput = document.getElementById("sttSecondaryModel");

  if (customFields) {
    customFields.style.display = provider === "custom" ? "block" : "none";
  }

  // Show profile dropdown only for SillyTavern provider
  if (profileRow) {
    profileRow.style.display = provider === "sillytavern" ? "flex" : "none";
    if (provider === "sillytavern") {
      populateProfileDropdown();
    }
  }

  // Update model field label/placeholder based on provider
  if (modelDesc && modelInput) {
    const profileId = getSettings("secondaryLLMProfile");
    if (provider === "sillytavern" && !profileId) {
      modelDesc.textContent = "Optional — leave empty to use your current model.";
      modelInput.placeholder = "(uses current model)";
    } else if (provider === "sillytavern" && profileId) {
      modelDesc.textContent = "Optional — leave empty to use the profile's model.";
      modelInput.placeholder = "(uses profile model)";
    } else {
      modelDesc.textContent = "Required — specify the model to use.";
      modelInput.placeholder = PROVIDER_CONFIG[provider]?.placeholder || "model-name";
    }
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

  // Profile dropdown listener
  const profileSelect = document.getElementById("sttProfileSelect");
  if (profileSelect) {
    profileSelect.addEventListener("change", () => {
      setSettings("secondaryLLMProfile", profileSelect.value);
      toggleCustomAPIFields(); // Update model placeholder text
    });
  }

  // Reset prompt button
  const resetBtn = document.getElementById("sttResetPrompt");
  if (resetBtn) {
    resetBtn.addEventListener("click", () => {
      const textarea = document.getElementById("sttSystemPrompt");
      if (textarea) textarea.value = DEFAULT_SETTINGS.systemPrompt;
      setSettings("systemPrompt", DEFAULT_SETTINGS.systemPrompt);
      setSettings("promptVersion", PROMPT_VERSION);
      toastr.success("System prompt reset to default.", "ST Tracker");
    });
  }

  // Test connection button
  const testBtn = document.getElementById("sttTestConnection");
  if (testBtn) {
    testBtn.addEventListener("click", async () => {
      testBtn.disabled = true;
      testBtn.textContent = "Testing...";
      await testSecondaryLLMConnection();
      testBtn.disabled = false;
      testBtn.textContent = "Test";
    });
  }

  // Tracker format dropdown
  const formatSelect = document.getElementById("sttTrackerFormat");
  if (formatSelect) {
    formatSelect.addEventListener("change", () => {
      setSettings("trackerFormat", formatSelect.value);
    });
  }

  // HTML strip toggle
  const stripHtml = document.getElementById("sttStripHTML");
  if (stripHtml) {
    stripHtml.addEventListener("change", () => {
      setSettings("secondaryLLMStripHTML", stripHtml.checked);
    });
  }

  // Field editor buttons
  const addGlobal = document.getElementById("sttAddGlobalField");
  if (addGlobal) {
    addGlobal.addEventListener("click", () => addFieldToEditor("sttGlobalFieldsList", "globalFields"));
  }

  const addChar = document.getElementById("sttAddCharField");
  if (addChar) {
    addChar.addEventListener("click", () => addFieldToEditor("sttCharFieldsList", "customFields"));
  }

  const resetFields = document.getElementById("sttResetFields");
  if (resetFields) {
    resetFields.addEventListener("click", resetFieldsToDefault);
  }

  // Danger Zone buttons
  const resetAllBtn = document.getElementById("sttResetAllSettings");
  if (resetAllBtn) {
    resetAllBtn.addEventListener("click", () => {
      if (!confirm("Reset ALL ST Tracker settings to defaults? This cannot be undone.")) return;
      extension_settings[MODULE_NAME] = JSON.parse(JSON.stringify(DEFAULT_SETTINGS));
      saveSettingsDebounced();
      populateSettingsUI();
      toastr.success("All settings reset to defaults.", "ST Tracker");
    });
  }

  const exportBtn = document.getElementById("sttExportSettings");
  if (exportBtn) {
    exportBtn.addEventListener("click", () => {
      const data = JSON.stringify(extension_settings[MODULE_NAME], null, 2);
      const blob = new Blob([data], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "st-tracker-settings.json";
      a.click();
      URL.revokeObjectURL(url);
      toastr.success("Settings exported.", "ST Tracker");
    });
  }

  const importBtn = document.getElementById("sttImportSettings");
  if (importBtn) {
    importBtn.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".json";
      input.addEventListener("change", async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        try {
          const text = await file.text();
          const data = JSON.parse(text);
          if (typeof data !== "object" || data === null) throw new Error("Invalid settings format");
          extension_settings[MODULE_NAME] = { ...DEFAULT_SETTINGS, ...data };
          saveSettingsDebounced();
          populateSettingsUI();
          toastr.success("Settings imported.", "ST Tracker");
        } catch (err) {
          toastr.error(`Import failed: ${err.message}`, "ST Tracker");
        }
      });
      input.click();
    });
  }
}

async function testSecondaryLLMConnection() {
  const provider = getSettings("secondaryLLMAPI");
  const model = getSettings("secondaryLLMModel");

  try {
    const providerName = PROVIDER_CONFIG[provider]?.name || provider;
    toastr.info(`Testing ${providerName}...`, "ST Tracker");

    const text = await callSecondaryLLM(
      'Respond with exactly: {"test": "ok"}',
      provider,
      model,
      {
        temperature: 0,
        streaming: getSettings("secondaryLLMStreaming") !== false,
        apiKey: getSettings("secondaryLLMAPIKey"),
        endpoint: getSettings("secondaryLLMEndpoint"),
      }
    );

    if (text) {
      toastr.success(`Connection works! Response: ${text.substring(0, 100)}`, "ST Tracker", { timeOut: 5000 });
    } else {
      toastr.warning("Connected but got empty response.", "ST Tracker");
    }
  } catch (error) {
    toastr.error(`Connection failed: ${error.message}`, "ST Tracker", { timeOut: 8000 });
  }
}

function getExtensionDir() {
  const indexPath = new URL(import.meta.url).pathname;
  return indexPath.substring(0, indexPath.lastIndexOf("/"));
}

// ============================================================
// EVENT HANDLERS
// ============================================================
function setupEventHandlers() {
  // Toggle card collapse on toggle bar click
  document.addEventListener("click", (e) => {
    // Ignore clicks on the regenerate button
    if (e.target.closest(".stt-regenerate-btn")) return;
    const bar = e.target.closest(".stt-toggle-bar");
    if (!bar) return;
    const card = bar.closest(`.${CONTAINER_CLASS}`);
    if (card) card.classList.toggle("stt-collapsed");
  });

  // Inline editing - tap field value to edit
  document.addEventListener("click", (e) => {
    // Check for character field value or header value
    const fieldValue = e.target.closest(".stt-field-value");
    const headerValue = e.target.closest(".stt-header-value");
    const targetEl = fieldValue || headerValue;
    if (!targetEl) return;

    // Already editing
    if (targetEl.querySelector(".stt-inline-input")) return;

    let fieldKey, scope, charIndex;

    if (fieldValue) {
      const field = fieldValue.closest(".stt-field");
      if (!field || !field.dataset.sttField) return;
      fieldKey = field.dataset.sttField;
      scope = field.dataset.sttScope;
      charIndex = parseInt(field.dataset.sttCharIndex ?? "-1");
    } else if (headerValue) {
      const headerItem = headerValue.closest(".stt-header-item");
      if (!headerItem || !headerItem.dataset.sttField) return;
      fieldKey = headerItem.dataset.sttField;
      scope = "global";
      charIndex = -1;
    }

    const card = targetEl.closest(`.${CONTAINER_CLASS}`);
    if (!card || card.dataset.sttMesid === undefined) return;
    const mesId = parseInt(card.dataset.sttMesid);
    if (isNaN(mesId)) return;

    const currentValue = targetEl.textContent.trim();

    // Create input
    const input = document.createElement("input");
    input.type = "text";
    input.className = "stt-inline-input";
    input.value = currentValue;

    targetEl.textContent = "";
    targetEl.appendChild(input);
    input.focus();

    function confirm() {
      const newValue = input.value.trim();
      input.removeEventListener("blur", confirm);
      if (newValue && newValue !== currentValue) {
        saveInlineEdit(mesId, fieldKey, scope, charIndex, newValue);
      } else {
        targetEl.textContent = currentValue;
      }
    }

    input.addEventListener("blur", confirm);
    input.addEventListener("keydown", (ke) => {
      if (ke.key === "Enter") {
        ke.preventDefault();
        input.blur();
      } else if (ke.key === "Escape") {
        input.removeEventListener("blur", confirm);
        targetEl.textContent = currentValue;
      }
    });
  });

  // Regenerate tracker card
  document.addEventListener("click", async (e) => {
    const btn = e.target.closest(".stt-regenerate-btn");
    if (!btn) return;
    e.stopPropagation();

    const mesBlock = btn.closest("[mesid]");
    if (!mesBlock) return;
    const mesId = parseInt(mesBlock.getAttribute("mesid"));

    btn.classList.add("stt-spinning");
    btn.disabled = true;

    try {
      const context = getContext();
      const trackerText = await generateTrackerWithSecondaryLLM(mesId);
      if (!trackerText) {
        log("Regenerate: secondary LLM returned no data");
        toastr.warning("Regenerate failed: LLM returned no data. Check your secondary LLM settings.");
        return;
      }

      // Validate the LLM response before touching msg.mes
      let parsed;
      try {
        parsed = JSON.parse(trackerText);
      } catch (_) {
        try {
          parsed = simpleYamlToObject(trackerText);
        } catch (_2) {
          parsed = null;
        }
      }
      if (!parsed || !parsed.characters || !Array.isArray(parsed.characters)) {
        log("Regenerate: LLM returned invalid tracker data: " + trackerText.substring(0, 200));
        toastr.warning("Regenerate failed: LLM returned invalid tracker data");
        return;
      }

      const msg = context.chat[mesId];
      const identifier = getSettings("codeBlockIdentifier") || DEFAULT_SETTINGS.codeBlockIdentifier;
      const escapedId = escapeRegex(identifier);
      const regex = new RegExp("```" + escapedId + "\\s*[\\s\\S]*?```", "g");
      const newBlock = "```" + identifier + "\n" + trackerText + "\n```";

      if (regex.test(msg.mes)) {
        msg.mes = msg.mes.replace(new RegExp("```" + escapedId + "\\s*[\\s\\S]*?```", "g"), newBlock);
      } else {
        log("Regenerate: no existing tracker block found, appending new block");
        msg.mes += "\n\n" + newBlock;
      }

      await context.saveChat();
      renderCardInMessage(mesId);
      hideTrackerBlocks();
      toastr.success("Tracker regenerated");
    } catch (err) {
      console.error("[STT] Regenerate failed:", err);
      toastr.error("Failed to regenerate tracker: " + (err.message || "Unknown error"));
    } finally {
      btn.classList.remove("stt-spinning");
      btn.disabled = false;
    }
  });

  const context = getContext();

  // After message is rendered
  const eventSource = context.eventSource;
  const eventTypes = context.eventTypes;

  if (eventSource && eventTypes) {
    function handleMessageEvent(mesId) {
      if (!getSettings("isEnabled")) return;
      setTimeout(() => { renderCardInMessage(mesId); hideTrackerBlocks(); }, 100);
    }

    eventSource.on(eventTypes.MESSAGE_RECEIVED, handleMessageEvent);
    eventSource.on(eventTypes.MESSAGE_UPDATED, handleMessageEvent);
    eventSource.on(eventTypes.MESSAGE_SWIPED, handleMessageEvent);

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
                // Validate it's valid data (JSON or YAML)
                let parsed;
                try {
                  parsed = JSON.parse(trackerJson);
                } catch (_) {
                  parsed = simpleYamlToObject(trackerJson);
                }
                if (!parsed || !parsed.characters) throw new Error("Invalid tracker structure");

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
                log(`Invalid data from secondary LLM: ${e.message}`);
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
