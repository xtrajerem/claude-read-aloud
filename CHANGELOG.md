# Changelog

## 2.3.0
- Automatic language detection (Chromium CLD + FR/EN stop-word fallback), per section and per long paragraph.
- Voice switching per language: pinned or auto-picked French (France) Natural voice; best Natural voice for other languages; Multilingual default voices kept.
- EN/FR badge in the player bar; "Code block skipped" announced in the text's language.

## 2.2.0
- Speaker buttons moved from paragraphs to **headings**: H1 reads the whole article, sub-headings read their section (until the next heading of the same or higher level).
- Whole-reply button on claude.ai replies without headings; ▶ reads the main article on other sites.
- Selection button driven by `selectionchange`: follows the extending end and stays pinned on screen while scrolling / Shift+click extending.
- Article `<header>` kept, site masthead excluded.

## 2.1.0
- Buttons and selection reading on all websites, with nav/header/footer/form filtering and a per-site off switch.

## 2.0.0
- Rewrite. Sentence and word highlighting via the CSS Custom Highlight API; auto-contrast colours (WCAG 4.5:1) or manual colours.
- Player bar: previous/next sentence, play/pause from current word, stop, speed presets, settings panel in a shadow DOM.
- Keyboard shortcuts, context menu, settings in `storage.local`.

## 1.1.0
- Per-block speaker buttons and selection button; speech moved from popup to page so it survives the popup closing.

## 1.0.0
- First version: read the latest Claude reply, auto-read, popup settings.
