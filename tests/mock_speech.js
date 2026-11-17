// Test double for the Web Speech API and the chrome.* APIs used by the content script.
// speechSynthesis records every utterance in window.__log ("<voice> | <text>") and lets the
// test drive playback: speechSynthesis.boundary(charIndex, len) and speechSynthesis.end().
window.__log = [];
const V = (name, lang) => ({ name, lang, default: false });
const voices = [
  V("Microsoft Christopher Online (Natural) - English (United States)", "en-US"),
  V("Microsoft Denise Online (Natural) - French (France)", "fr-FR"),
  V("Microsoft Henri Online (Natural) - French (France)", "fr-FR"),
  V("Microsoft Sylvie Online (Natural) - French (Canada)", "fr-CA"),
  V("Microsoft Katja Online (Natural) - German (Germany)", "de-DE"),
];
window.chrome = {
  storage: { local: { get: (d, cb) => cb(d), set: () => {} }, onChanged: { addListener() {} } },
  runtime: { onMessage: { addListener() {} } },
};
Object.defineProperty(window, "speechSynthesis", { value: {
  speaking: false, pending: false, _u: null,
  getVoices: () => voices, addEventListener() {}, resume() {}, pause() {},
  cancel() { this.speaking = false; },
  speak(u) {
    this.speaking = true; this._u = u;
    window.__log.push((u.voice ? u.voice.name.replace(/Microsoft | Online.*/g, "") : "?") + " | " + u.text);
    u.onstart && u.onstart({});
  },
  boundary(i, len) { this._u.onboundary({ name: "word", charIndex: i, charLength: len }); },
  end() { this.speaking = false; const u = this._u; u.onend && u.onend({}); },
}});
window.SpeechSynthesisUtterance = function (t) { this.text = t; };
