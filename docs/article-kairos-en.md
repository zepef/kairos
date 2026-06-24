# Kairos — a 100% voice-driven task assistant that fits on a mid-range phone

### What the app does

**Kairos** is a **voice-first** task manager. You hold the central logo, speak ("add call Paul tomorrow 10am, it's urgent"), and the app **understands, acts, then answers out loud**. You can create, edit, postpone, complete and delete tasks, file them into folders and sub-folders, show filtered lists (by due date, person, place, urgency, status), open a **graphical landscape calendar** (day / week / month / year) with zoom and finger-swipe paging, attach a **dictated note** to any task, delete several tasks at once — all of it **reversible** ("undo"). At launch it even flags **overdue** tasks.

The defining trait: **everything runs on the device, offline**. No data leaves for the cloud. Language understanding comes from a **small on-device language model** (Gemma 4 "E2B") running directly on the phone.

### How it works

The pipeline is deliberately simple and robust:

```
Voice → Speech-to-text (STT) → Gemma 4 (→ JSON) → Deterministic dispatch → SQLite → Text-to-speech (TTS)
```

The model does **exactly one thing**: turn a sentence into a JSON object `{tool, params}`. From there, **deterministic code** (a plain `switch`) runs the action on a local **SQLite** database and produces the spoken confirmation. That separation is the key to reliability: the model never writes to the database — it only *proposes an intent*.

### The tricks that make it fit a mid-range phone

The test phone (S96, Helio G95 SoC) has **no usable GPU**: everything runs on the **CPU**. Running an LLM under those constraints took a series of engineering trade-offs:

- **A tiny, quantized model.** Gemma 4 "E2B" (the efficient variant) in GGUF format, **CPU-only** (`n_gpu_layers: 0`), on **4 threads**. That's what makes inference possible without an accelerator.
- **Turn reasoning off.** Gemma 4 is a "thinking" model: by default it writes a long reasoning trace (~48 s) before answering. We **disable** it (`enable_thinking: false`) → straight JSON, in a few seconds.
- **An ontology re-grounded on every request, to make up for the missing reasoning.** Since we turned thinking off, we spare the model from having to *infer* its context: we feed it **fresh on every command**. The intent skeleton (tools + dimensions + vocabulary) is fixed, but each call automatically grafts on the **current state** — the **present date and time** (to resolve "tomorrow", "Friday 9am") and the **numbered list of on-screen tasks** (to resolve "number 2"). This automatic context refresh **makes up for the absence of reasoning**: the model only ever has to *translate* the sentence, never to *reason* about time or about the app's state.
- **Constrained decoding.** We force **valid JSON** output (`response_format: json_object`) and **cap generation** (`n_predict: 120`): we only need a small object, not a paragraph.
- **Warm-up.** On load, we **pre-compute the system prompt** into the KV cache. The **first** command is no longer penalized by that work (from ~15 s down to ~6 s), and later commands reuse the shared prefix.
- **A disciplined context budget.** The system prompt (the whole command "ontology") grew; we had to size the window (`n_ctx: 4096`) to cover *prompt + utterance + generation*. Below that, we hit "Context is full" on **every** command. Lesson: always keep headroom.
- **Determinism around the model.** Regular expressions map the model's (and the user's) free-form wording back to canonical values (status, time span, calendar level). This tolerates vocabulary variation — **and works in English as well as French**.
- **Numbered tasks.** Whatever is on screen is numbered: "delete 2" resolves by **number** (exact, free) before any fuzzy title match. Less load on the model.
- **Dictation bypasses the LLM.** When you dictate a **note**, the text is stored verbatim **without going through the model**: it saves an inference and avoids the note being mistaken for a command.
- **Loading stays smooth.** The loading indicator is Android's *native spinner*: the system animates it, so it never stutters while the JavaScript thread freezes in bursts loading the ~3 GB model file.
- **"JS-embedded" build.** The app is compiled in **release** with JavaScript bundled in: no dev server needed on the phone, the app is self-contained.

### Installation

The app ships as an **APK** (outside the Play Store): download the file from the share link, then allow **"install unknown apps"** for your browser or for Drive when prompted.
On **first launch**, wait while the model (~3 GB) loads; after that, everything works **offline**, with no account and no connection.

### In short

Kairos shows you can deliver a **fully voice-driven, private, offline** experience on **mid-range** hardware — provided you treat the small language model as an **intent translator** (fast, constrained, pre-warmed) and hand execution to deterministic, reliable, reversible code.
