<p align="center">
  <a href="README.md"><img src="public/kairos-en.jpg" alt="Read in English" width="410"></a>
  &nbsp;&nbsp;
  <a href="README.fr.md"><img src="public/kairos-fr.jpg" alt="Lire en français" width="410"></a>
</p>

<p align="center"><b>English</b> · <a href="README.fr.md">Français</a></p>

# Kairos

**A voice-first, 100% on-device task manager. The AI never leaves your phone.**

Hold the orb, speak naturally, and Kairos understands you, files the task, and answers out loud — all locally, with **nothing sent to the cloud**. The language model (Gemma 4 · E2B, ~3 GB) runs directly on the device via `llama.rn`.

> The screen is a safety net — the **voice orb is the product**.
> Core loop: **hold → speak → understood → spoken back**.

---

## Highlights

- 🎙️ **Voice-first** — a push-to-talk orb; speak commands in natural language.
- 📴 **100% offline & private** — on-device LLM + local SQLite. **0 data sent by the app.** The ~3 GB model is fetched once, then everything runs offline.
- 🧠 **On-device AI** — Gemma 4 E2B via `llama.rn` (CPU-only, `n_ctx` 4096). The model only *proposes* an intent; deterministic code *executes* it.
- 🗣️ **Natural-language task management** — create, reschedule, rename, reprioritize, complete, postpone, delete — by voice.
- 🗂️ **Auto-filing** — tasks are sorted into folders (categories) and subfolders, with person, place, time and urgency inferred automatically.
- 📝 **Dictated notes** — attach / append / read aloud / erase a free-text note on any task.
- 📅 **Graphical calendar** (landscape) — day / week / month / year, swipe to page through time, ± to zoom, tap to drill down — all controllable by voice too.
- 🔁 **Everything is reversible** — say **“undo”** / **« annule »** to revert the last action.
- 🌍 **Bilingual FR / EN** — one toggle switches the interface, the voice (STT + TTS) **and** the model's prompt.
- 🎨 **Three live-switchable themes** — Signal (bright), Local (warm/analog), On-Device (technical/dark).
- 🔗 **Optional Google Calendar sync** — push your dated tasks to a Google calendar of your choice, without the app ever making a network call (see below).

---

## How it works

```
Voice ──▶ on-device STT ──▶ Gemma 4 E2B ──▶ deterministic dispatch ──▶ SQLite
  (expo-speech-recognition)   (JSON intent)     (plain switch, no LLM)     (tasks)
                                                          │
                                                          └──▶ spoken confirmation (TTS)
```

- **Gemma is an ontology translator**: it maps a free-form sentence to *(intent, entities, attributes)* as a compact JSON object, resolves fuzzy references (“the dentist task”) and relative dates (“tomorrow 2pm” → an absolute date).
- **Deterministic execution**: a plain `switch` turns that JSON into a real database mutation or a view change. The LLM never touches your data directly — so a misunderstanding can’t corrupt anything, and every action is reversible.
- **Re-anchored ontology**: the current date/time and the numbered on-screen task list are injected on **every** command. This compensates for a small model’s lack of chain-of-thought — it never has to “remember,” it always has fresh context.

---

## Using Kairos

**Home** — hold the central **orb**, speak a command, release. Kairos echoes what it understood on screen and confirms out loud.
**Header** — ☰ list · ▦ calendar · ⚙ settings · 🇫🇷/🇺🇸 language toggle.

### Example voice commands

**Create & organize**
- *“add call Paul tomorrow 10am at the office, it’s urgent”*
- *“add buy bread tonight at home”*
- *“add a dentist appointment Friday 2pm”*

**Show / filter** (compose any of the 6 dimensions)
- *“show all tasks”* · *“what’s overdue”* · *“show this week’s tasks”*
- *“show the urgent overdue tasks for Paul”*

**Change**
- *“postpone task 2 to Friday 9am”* · *“move the hairdresser appointment from July 7 to July 8”*
- *“rename 1 to buy a baguette”* · *“make 1 urgent”* · *“move 1 to the Work folder”*
- *“mark 1 as done”* · *“delete 2”* · *“delete all of Monday’s tasks”* · *“undo”*

**Notes**
- *“add a note to task 1: bring the blue folder”* · *“append to the note of 1: and plan for parking”*
- *“read the note of 1”* · *“erase the note of 1”*

**Calendar**
- *“show the weekly calendar”* · *“show the monthly / yearly / daily calendar”*
- *“zoom in”* · *“zoom out”*

**Sync**
- *“synchronize”* — push dated tasks to your Google calendar (must be enabled first, see below).

> Every command works identically in French — flip the flag and speak: *« ajoute appeler Paul demain 10h au bureau, c’est urgent »*, *« reporte la 2 à vendredi 9h »*, *« annule »*…

### The 6 ontology dimensions

Every command can freely combine these — for creating **and** for filtering:

| Dimension | Question | Field | Example |
|---|---|---|---|
| **WHAT** | which folder/project | `category` | “in Health”, “for project X” |
| **WHEN** | which window / due date | `scope` / `due` | “today”, “overdue”, “Friday 2pm” |
| **WHO** | which person | `person` | “with Paul”, “for mom” |
| **WHERE** | which place | `place` | “at the office”, “at home” |
| **STATE** | which status | `status` | to do · pending · done · postponed · archived |
| **URGENT** | high priority | `priority` | “urgent”, “important” |

---

## Themes

Choose a look during the one-time model download, or change it anytime in **Settings** — the whole app re-skins instantly:

- **Signal** — bright, confident, a living blue→teal voice orb.
- **Local** — warm, analog, paper tones, a humanist serif, a clay “press-stone.”
- **On-Device** — dark, engineering-forward, mint accents, `gemma-4-e2b` on the orb.

---

## Google Calendar sync (opt-in)

Kairos can **feed a Google calendar** with your dated tasks, while staying true to its offline-first promise.

- **Setup (non-voice):** Settings → **Sync** → enable → grant calendar permission → pick one of your writable Google calendars.
- **Run:** say **“synchronize”** or tap **Sync now**.
- **Behavior:** one-way (Kairos → Google), idempotent. Dated open tasks become events; completed/deleted tasks remove their events. No duplicates.
- **Privacy:** Kairos writes the event to the **device** calendar; **Android’s Google account sync adapter** uploads it. The app performs **no OAuth and no network request** — the “app sends nothing” invariant holds. Requires a Google account added on the device with Calendar sync enabled.

---

## Tech stack

| Area | Choice |
|---|---|
| Framework | Expo SDK 56 · React Native 0.85 · TypeScript · Hermes |
| On-device LLM | **Gemma 4 E2B** (GGUF) via `llama.rn` — CPU, `n_ctx` 4096 |
| Voice | `expo-speech-recognition` (STT) · `expo-speech` (TTS) |
| Storage | `expo-sqlite` |
| UI | `react-native-svg` (animated orb), `expo-linear-gradient`, bundled Google fonts via `expo-font` |
| Calendar sync | `expo-calendar` (writes to the device calendar) |

---

## Build & run (Android)

A real device is required — the ~3 GB model rules out Expo Go, and the release build embeds the JS bundle (no Metro).

1. Install dependencies: `npm install`.
2. Provide the model: place the Gemma GGUF on the device at
   `/storage/emulated/0/Android/data/com.zepef.kairos/files/gemma-4-E2B.gguf`
   (see `MODEL_PATH` in `llm.ts`).
3. Generate the native project and build:
   ```bash
   npx expo prebuild -p android
   cd android && ./gradlew assembleRelease
   ```
4. Install the APK: `adb install -r android/app/build/outputs/apk/release/app-release.apk`.

On first launch the model loads (one-time), then Kairos runs fully offline.

---

## Privacy

- **The app sends nothing.** Speech recognition, understanding, storage and speech synthesis all happen on-device.
- Tasks live in a **local SQLite** database on your phone.
- The **only** optional outbound flow is Google Calendar sync — and even then the app just writes to the local device calendar; your **OS** (not Kairos) syncs it to your Google account.

---

*Kairos — talk to your to-do list. It listens on your phone, and nowhere else.*
