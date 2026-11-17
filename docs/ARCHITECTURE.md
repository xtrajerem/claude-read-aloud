# Architecture

Claude Read Aloud is a Manifest V3 extension with **no backend**. Everything happens in the page: the content script finds text, segments it, drives the browser's `speechSynthesis` engine and paints highlights with the CSS Custom Highlight API.

## Components

```mermaid
flowchart LR
  subgraph Browser["Browser (Edge / Chrome)"]
    direction LR
    SW["background.js<br/>service worker<br/>context menu · shortcuts"]
    POP["popup.html / popup.js<br/>toolbar popup"]
    subgraph Tab["Each web page"]
      CS["content.js<br/>player · UI · text engine"]
      DOM[("Page DOM")]
      HL["CSS.highlights<br/>cra-sentence · cra-word"]
    end
    TTS["speechSynthesis<br/>(Web Speech API)"]
    ST[("chrome.storage.local<br/>settings")]
    I18N["chrome.i18n.detectLanguage<br/>(CLD)"]
  end
  VOICES["Vendor speech service<br/>(Natural / network voices only)"]

  SW -- "tabs.sendMessage<br/>(inject on demand)" --> CS
  POP -- "tabs.sendMessage<br/>(inject on demand)" --> CS
  POP <--> ST
  CS <--> ST
  CS -- "reads text,<br/>builds Ranges" --> DOM
  CS -- "set / delete" --> HL
  HL -. "paints over" .-> DOM
  CS -- "utterances" --> TTS
  TTS -- "onstart · onboundary · onend" --> CS
  CS --> I18N
  TTS -. "online voices" .-> VOICES
```

| File | Runs in | Responsibility |
|---|---|---|
| `extension/manifest.json` | — | MV3 manifest. Content script on all `http(s)` pages, permissions `storage`, `activeTab`, `scripting`, `contextMenus`, two keyboard commands. |
| `extension/content.js` | Every page (isolated world) | The whole product: text extraction, segmentation, language detection, player state machine, highlighting, on-page UI (player bar, settings panel, heading and selection buttons), auto-read on claude.ai. |
| `extension/background.js` | Service worker | Registers the **Read aloud** context menu and routes the `toggle-reading` / `stop-reading` commands to the active tab. |
| `extension/popup.*` | Toolbar popup | Play/pause, stop, open the settings panel, per-site enable/disable. |

### Why the speech runs in the page, not the popup or service worker

A popup's JavaScript context is destroyed when the popup closes, so speech started there stops (this was the v1.0 bug). MV3 service workers have no `speechSynthesis`, and `chrome.tts` lacks the per-word boundary data needed for highlighting. The content script lives as long as the tab and sits next to the DOM it highlights, so the popup and service worker only **send messages** to it.

If a page loaded before the extension was installed or updated, it has no content script. The popup and service worker then try `tabs.sendMessage`, fall back to `scripting.executeScript({files:["content.js"]})` (allowed by `activeTab`), and resend. A `window.__craLoaded` guard makes injection idempotent, and the listener always calls `sendResponse` so a successful send never triggers a duplicate injection.

## Content script layout

`content.js` is a single IIFE organised in sections:

```mermaid
flowchart TB
  A["Settings<br/>DEFAULTS · S · save() · onSettings()"] --> B
  B["Text engine<br/>buildUnits() · sentencesOf() · rangeFor()"] --> C
  L["Language<br/>detectLang() · assignLangs() · voiceFor()"] --> C
  C["Player<br/>play() · speakCurrent() · pause/resume/skip/stop"] --> D
  D["Highlighter<br/>showSentence() · showWord() · applyColors()"]
  E["Colour engine<br/>autoColors() · contrast()"] --> D
  F["UI (shadow DOM)<br/>bar · panel · heading 🔊 · selection 🔊"] --> C
  G["Scope finders<br/>readSection() · readRange() · readDefault()"] --> B
  F --> G
  H["claude.ai auto-read<br/>MutationObserver"] --> G
```

### On-page UI isolation

All controls live in a single `<div id="cra-host">` with an **open shadow root**, attached to `<html>`:

- Site CSS can't restyle the controls, and the controls' CSS can't leak into the site.
- `keydown` is stopped at the shadow root, so typing in the settings panel doesn't trigger site shortcuts. claude.ai, for example, focuses its composer on keypress.
- `mousedown` on the bar and floating buttons calls `preventDefault()` so clicking them doesn't clear the user's text selection.
- The host is `position:fixed; 0×0`. Its children use `position:fixed`, so the host itself never covers page content.

Highlight styling (`::highlight(cra-sentence)`, `::highlight(cra-word)`) has to apply to page text, so it goes in a `<style id="cra-hl-style">` in the document head instead.

## Player state machine

```mermaid
stateDiagram-v2
  [*] --> idle
  idle --> playing: play(units)
  playing --> paused: pause()
  paused --> playing: resume() — restart sentence from last word
  playing --> playing: onend → next sentence\nskip(±1)\nrate/voice change → restart from last word
  playing --> idle: queue exhausted / stop() / Esc
  paused --> idle: stop()
```

State lives in one object `P`:

| Field | Meaning |
|---|---|
| `queue`, `idx` | Sentence items for the current **scope** and the one being spoken. ⏮ / ⏭ move `idx` inside this queue, which is why they never leave the section, reply or selection. |
| `gen` | Generation counter. Every speak, cancel or skip increments it, and each utterance captures its own value. Late `onend` / `onboundary` events from cancelled utterances compare `gen` and are ignored. That's how stale callbacks are prevented. |
| `cur` | `{item, base, text}`. `base` is the character offset inside the unit where the current utterance starts (non-zero after resume). |
| `lastWord` | Absolute offset of the last highlighted word, used to resume or restart mid-sentence. |
| `utt` | Strong reference to the live utterance. Chrome can garbage-collect an unreferenced utterance and never fire `onend`. |
| `voice`, `noBoundary` | Voice in use, and the set of voices observed not to emit word boundaries (enables the timing estimator immediately). |
| `startBlock` | Element that started playback (heading or reply), so its button shows ⏹. |

Only one utterance is ever queued in `speechSynthesis`. The next one is spoken from `onend`. This keeps skip, speed and voice changes immediate and avoids `speechSynthesis.pause()`, which is unreliable with network voices.

## Data model

```mermaid
classDiagram
  class Unit {
    owner: Element  // paragraph, li, heading… (or scope root)
    text: string    // concatenated text, whitespace normalised 1:1
    map: Piece[]    // where each slice of text lives in the DOM
    lang?: string   // "en", "fr"…
    spoken?: string // synthetic utterance (e.g. "Code block skipped.")
  }
  class Piece {
    node: Text
    nodeStart: int  // offset inside the text node
    len: int
    textStart: int  // offset inside Unit.text
  }
  class Sentence {
    unit: Unit
    start: int
    end: int        // offsets inside Unit.text
  }
  Unit "1" *-- "many" Piece
  Unit "1" <-- "many" Sentence
```

Because `Unit.text` maps back to text nodes character for character, any `(start, end)` offset converts to a DOM `Range` (`rangeFor`). That conversion is the basis for both highlighting and resuming from a word.

## Settings

`chrome.storage.local` holds a flat object (see `DEFAULTS` in `content.js`). Local rather than sync storage is deliberate: sliders and colour pickers write on every `input` event, which would hit the `storage.sync` write quota (120 per minute). Every tab listens to `storage.onChanged`, so a change made in one tab's panel applies everywhere, including to an utterance already playing (restarted from the current word after a 250 ms debounce).

## Permissions

| Permission | Why |
|---|---|
| content script on `http://*/*`, `https://*/*` | Heading and selection buttons on every site. |
| `storage` | Settings. |
| `activeTab` + `scripting` | Inject the content script into a tab that predates installation, when the user clicks the popup, uses the context menu or presses a shortcut. |
| `contextMenus` | **Read aloud** on right-click. |

No `host_permissions`, no network requests, no remote code.
