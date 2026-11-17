"""End-to-end tests for the content script in headless Chromium.

The real speech engine is replaced by tests/mock_speech.js so playback is deterministic:
the test advances sentences itself and inspects what was "spoken" and with which voice.

    pip install playwright && python -m playwright install chromium
    python tests/test_extension.py
"""
import pathlib, sys
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).resolve().parent.parent
CONTENT = (ROOT / "extension/content.js").read_text()
MOCK = ROOT / "tests/mock_speech.js"
FIX = ROOT / "tests/fixtures"
OUT = ROOT / "tests/output"; OUT.mkdir(exist_ok=True)
failures = 0


def check(name, cond, detail=""):
    global failures
    print(("PASS " if cond else "FAIL ") + name + ("" if cond else f"\n     {detail}"))
    failures += 0 if cond else 1


def open_page(browser, fixture, as_claude=False, viewport=(900, 600)):
    pg = browser.new_page(viewport={"width": viewport[0], "height": viewport[1]})
    pg.add_init_script(path=str(MOCK))
    pg.goto((FIX / fixture).as_uri())
    src = CONTENT.replace('location.hostname === "claude.ai"', "true") if as_claude else CONTENT
    pg.add_script_tag(content=src)
    pg.wait_for_timeout(300)
    return pg


def drain(pg):
    for _ in range(40):
        pg.evaluate("speechSynthesis.speaking && speechSynthesis.end()")
    return pg.evaluate("__log.splice(0)")


def texts(log):
    return [l.split(" | ", 1)[1] for l in log]


def shadow(pg, el_id, expr):
    return pg.evaluate(f"(() => {{ const e = document.getElementById('cra-host').shadowRoot.getElementById('{el_id}'); return {expr}; }})()")


def click_heading(pg, selector):
    pg.hover(selector, position={"x": 5, "y": 5}); pg.wait_for_timeout(60)
    pg.click("#cra-host >> css=#blockBtn"); pg.wait_for_timeout(150)


with sync_playwright() as p:
    b = p.chromium.launch()

    # --- section buttons on headings --------------------------------------------------
    pg = open_page(b, "sections.html")
    btn = lambda: shadow(pg, "blockBtn", "getComputedStyle(e).display")
    pg.hover("header h2"); pg.wait_for_timeout(60)
    check("no button on site-header heading", btn() == "none")
    pg.hover("article p >> nth=0"); pg.wait_for_timeout(60)
    check("no button on plain paragraphs", btn() == "none")
    pg.hover("h2 >> nth=1"); pg.wait_for_timeout(60)
    check("button on article H2", btn() == "block")
    pg.screenshot(path=str(OUT / "heading-button.png"))

    click_heading(pg, "h2 >> nth=1")
    t = texts(drain(pg))
    check("H2 reads its chapter incl. H3 sub-section", t[0] == "Data Collection" and "It operates read-only." in t, t)
    check("H2 stops at next H2", "Data Processing" not in t, t)

    click_heading(pg, "h3")
    t = texts(drain(pg))
    check("H3 reads only its sub-section", t == ["Sensor details", "The sensor is built on eBPF technology.", "It operates read-only."], t)

    click_heading(pg, "h1")
    t = texts(drain(pg))
    check("H1 reads the whole article", t[0] == "Attribute Security Overview" and t[-1].startswith("Far away"), t)
    check("footer is never read", not any("Footer" in x for x in t), t)

    # --- selection button persists while scrolling / extending -----------------------
    pg.evaluate("() => { const t = document.querySelector('article p').firstChild; getSelection().setBaseAndExtent(t, 0, t, 4); }")
    pg.wait_for_timeout(100)
    sel = lambda: shadow(pg, "selBtn", "getComputedStyle(e).display")
    check("selection button appears", sel() == "block")
    pg.mouse.wheel(0, 1200); pg.wait_for_timeout(200)
    check("selection button survives scrolling", sel() == "block")
    pg.click("#far", modifiers=["Shift"]); pg.wait_for_timeout(150)
    check("selection button survives shift-click extend", sel() == "block")
    pg.close()

    # --- claude.ai reply: sentences, code skip, highlights ---------------------------
    pg = open_page(b, "claude-reply.html", as_claude=True)
    pg.click("#cra-host >> css=#play"); pg.wait_for_timeout(150)
    has_hl = pg.evaluate("CSS.highlights.has('cra-sentence')")
    pg.evaluate("speechSynthesis.boundary(25, 2)")
    has_word = pg.evaluate("CSS.highlights.has('cra-word')")
    pg.screenshot(path=str(OUT / "claude-reply-highlight.png"))
    t = texts(drain(pg))
    check("sentence highlight is set", has_hl)
    check("word highlight follows boundary events", has_word)
    check("reply split into sentences", t[:2] == ["Reading aloud works with no Claude tokens at all.", "The browser does the speaking."], t)
    check("code block skipped", "Code block skipped." in t, t)
    pg.close()

    # --- language detection & voice switching ----------------------------------------
    pg = open_page(b, "mixed-language.html")
    click_heading(pg, "h1")
    log = drain(pg)
    fr = [l for l in log if l.endswith("surpris.")]
    en = [l for l in log if "motorway" in l]
    check("French paragraph uses a fr-FR voice", fr and fr[0].startswith("Denise"), log)
    check("English paragraph uses the default voice", en and en[0].startswith("Christopher"), log)
    pg.close()

    b.close()

print(f"\n{'All tests passed' if not failures else f'{failures} test(s) failed'}")
sys.exit(1 if failures else 0)
