# ST Tracker

A SillyTavern extension that tracks character state — location, clothing, position, time, weather, topics, present, hair, makeup, and state — for both `{{user}}` and `{{char}}`.

![SillyTavern](https://img.shields.io/badge/SillyTavern-Extension-purple)

## Install

1. Open SillyTavern → **Extensions** panel (puzzle icon)
2. Click **"Install Extension"**
3. Paste: `https://github.com/adam-harris21/ST-Tracker`
4. Restart SillyTavern

## Setup (3 steps)

### Step 1: Enable the extension
Go to **Extensions → ST Tracker** and make sure **"Enable Tracker"** is toggled on.

### Step 2: Add the macro to your prompt
Add `{{stt_tracker}}` somewhere in your **system prompt**, **Author's Note**, or **character card jailbreak**. This tells the AI what format to use for tracker data.

**Example** — paste this into Author's Note or at the end of your system prompt:
```
{{stt_tracker}}
```

That's it. The extension includes a default prompt that instructs the AI to output tracker data. You can customize this prompt in the ST Tracker settings.

### Step 3: Chat!
Start chatting. The AI will include a tracker block at the end of its messages, and ST Tracker will render it as a clean card.

## How it works

The AI outputs a JSON code block tagged with ` ```tracker ``` ` at the end of each message. ST Tracker:
1. **Parses** the JSON data
2. **Renders** it as a visual card in the chat
3. **Hides** the raw JSON so you only see the card

### Data format
```json
{
  "time": "3:00 PM",
  "weather": "Sunny, warm breeze",
  "characters": [
    {
      "name": "Luna",
      "location": "Coffee shop, corner booth",
      "clothing": "White blouse, blue jeans",
      "position": "Sitting cross-legged",
      "topics": "Weekend plans, favorite books",
      "present": "User, barista nearby",
      "hair": "Down, slightly curled",
      "makeup": "Light foundation, pink lip gloss",
      "state": "Relaxed, slightly nervous"
    },
    {
      "name": "User",
      "location": "Coffee shop, corner booth",
      "clothing": "Black t-shirt, shorts",
      "position": "Leaning back in chair",
      "topics": "Weekend plans",
      "present": "Luna, barista",
      "hair": "Messy",
      "makeup": "None",
      "state": "Casual, comfortable"
    }
  ]
}
```

## Available Macros

Use these in your system prompt, Author's Note, or character cards:

| Macro | What it does |
|-------|-------------|
| `{{stt_tracker}}` | Injects the full tracker system prompt (includes format instructions) |
| `{{stt_format}}` | Injects just the data format example |
| `{{stt_last}}` | Returns the last tracker JSON data |

## Settings

Found in **Extensions → ST Tracker**:

| Setting | Description |
|---------|-------------|
| **Enable Tracker** | Master on/off switch |
| **Code Block Identifier** | The keyword after triple backticks (default: `tracker`) |
| **Hide Tracker Blocks** | Hide raw JSON in chat (show only the card) |
| **Retain N Trackers** | How many tracker blocks to keep in LLM context |
| **System Prompt** | The prompt injected by `{{stt_tracker}}` — fully customizable |

## Secondary LLM (Optional)

If your AI doesn't include tracker data in its response, ST Tracker can use a **separate LLM call** to generate it automatically.

1. Enable **"Secondary LLM"** in settings
2. Choose a provider (OpenAI, Claude, OpenRouter, Google, or Custom)
3. Enter the model name
4. API keys are pulled from your existing SillyTavern API settings (no need to enter them again, except for Custom provider)

## Slash Commands

| Command | Description |
|---------|-------------|
| `/stt-refresh` | Refresh all tracker cards in the chat |
| `/stt-toggle` | Toggle the extension on/off |

## Troubleshooting

**Cards not showing?**
- Make sure `{{stt_tracker}}` is in your system prompt or Author's Note
- Check that "Enable Tracker" is toggled on in settings
- Try `/stt-refresh` in the chat

**AI not outputting tracker blocks?**
- Some models need stronger prompting — try putting `{{stt_tracker}}` in the jailbreak/Author's Note instead of system prompt
- Enable Secondary LLM as a fallback

**Want to uninstall?**
- Delete the ST-Tracker folder from `SillyTavern/public/scripts/extensions/third-party/`
- Restart SillyTavern — nothing else is affected
