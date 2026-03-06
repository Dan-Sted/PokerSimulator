"""
gemini_browser.py — Playwright browser automation for Gemini.

Bypasses the Gemini API free-tier rate limit (5 req/min) by driving a real
Chromium browser window instead of calling the API directly.

Each AI player gets an isolated BrowserContext with independent conversation
history.  All contexts share the same Google login session saved to disk in
backend/browser_session/ so the user only has to log in once.

Public API
----------
    initialize_browser(player_ids)          # call once before the game
    init_player_chat(player_id, sys_prompt) # call per player after initialize
    query_gemini_browser(prompt, player_id) # call each turn
    shutdown_browser()                      # call after the game ends

Setup
-----
    pip install playwright
    playwright install chromium
"""

import os
import subprocess
import time
from playwright.sync_api import (
    sync_playwright,
    Browser,
    BrowserContext,
    Page,
    Playwright,
)

# ── Paths ──────────────────────────────────────────────────────────────────
_THIS_DIR   = os.path.dirname(os.path.abspath(__file__))
SESSION_DIR = os.path.join(_THIS_DIR, "browser_session")
STATE_FILE  = os.path.join(SESSION_DIR, "state.json")

GEMINI_URL          = "https://gemini.google.com/app"
RESPONSE_TIMEOUT_MS = 60_000   # max wait for a streaming response (60 s)
NAV_TIMEOUT_MS      = 30_000   # max wait for page navigation

# ── Module-level state (one browser shared by all player contexts) ──────────
_playwright: "Playwright | None"            = None
_browser:    "Browser | None"               = None
_player_contexts: dict[str, BrowserContext] = {}
_player_pages:    dict[str, Page]           = {}


# ── Internal helpers ────────────────────────────────────────────────────────

def _ensure_session_dir() -> None:
    os.makedirs(SESSION_DIR, exist_ok=True)


def _is_login_page(page: Page) -> bool:
    """Return True if the page has redirected to a Google sign-in screen."""
    url = page.url
    return "accounts.google.com" in url or "signin.google" in url.lower()


def _login_flow(pw: Playwright) -> None:
    """
    Open a visible Chromium window so the user can log in to Google/Gemini.
    Uses a persistent Chrome profile stored in SESSION_DIR so Google is less
    likely to flag it as automation.  Saves cookies to STATE_FILE once the
    user confirms they are logged in.
    """
    _ensure_session_dir()
    print("\n[GeminiBrowser] No saved session found. Opening browser for first-time login...")

    # launch_persistent_context keeps the full Chrome user-data directory on
    # disk, which Google treats more like a real browser than an ephemeral one.
    # channel="chrome" uses the system-installed Google Chrome instead of the
    # Playwright-bundled "Chrome for Testing" binary (which crashes on newer
    # macOS versions due to ImageIO incompatibilities in the bundled build).
    ctx = pw.chromium.launch_persistent_context(
        user_data_dir=SESSION_DIR,
        channel="chrome",
        headless=False,
        viewport={"width": 1280, "height": 800},
        args=[
            "--no-sandbox",
            "--disable-blink-features=AutomationControlled",
        ],
    )

    page = ctx.pages[0] if ctx.pages else ctx.new_page()
    page.goto(GEMINI_URL, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)

    print("\n" + "=" * 65)
    print("  Please log in to Gemini in the browser window that just opened.")
    print("  Once you see the Gemini chat interface (not a sign-in page),")
    print("  come back here and press Enter to save your session.")
    print("=" * 65)
    input("\n  Press Enter when you are fully logged in > ")

    # Export session cookies + localStorage to a portable JSON file so we can
    # load them into multiple independent browser contexts later.
    ctx.storage_state(path=STATE_FILE)
    ctx.close()
    print(f"[GeminiBrowser] Session saved → {STATE_FILE}\n")


def _create_player_context(player_id: str) -> tuple[BrowserContext, Page]:
    """
    Open a new isolated BrowserContext for one player, navigate to Gemini,
    and return (context, page).
    """
    ctx = _browser.new_context(
        storage_state=STATE_FILE,
        viewport={"width": 1100, "height": 750},
    )
    page = ctx.new_page()
    page.goto(GEMINI_URL, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)

    # Wait for the page to settle; networkidle can be flaky on SPAs so we
    # ignore timeouts here and rely on selector waits later.
    try:
        page.wait_for_load_state("networkidle", timeout=12_000)
    except Exception:
        pass

    return ctx, page


def _focus_and_clear_input(page: Page) -> None:
    """Click the Gemini chat input and wipe any pre-existing content."""
    page.locator("rich-textarea div[contenteditable='true']").first.click()
    page.keyboard.press("Meta+A")   # select all (macOS)
    page.keyboard.press("Backspace")


def _inject_text(page: Page, text: str) -> None:
    """
    Inject text into the focused Gemini input field via the macOS clipboard.

    execCommand('insertText') cannot be used here because Gemini's rich-textarea
    editor fires a submit event when it encounters a \\n character in the inserted
    text, causing multi-line prompts (like the formatted game state) to be sent
    prematurely after only the first line.

    Pasting via pbcopy bypasses keyboard-event handling entirely: Chrome inserts
    pasted newlines as literal line separators rather than "Enter pressed" signals.
    """
    subprocess.run(["pbcopy"], input=text.encode("utf-8"), check=True)
    page.keyboard.press("Meta+V")


def _submit_message(page: Page) -> None:
    """
    Submit the current message in the Gemini input.

    After pbcopy + Meta+V, Quill's internal event handling can briefly
    shift DOM focus away from the contenteditable div.  Re-clicking it
    before pressing Enter guarantees the keydown event lands on the input
    and triggers submission rather than being swallowed by the page.
    """
    page.locator("rich-textarea div[contenteditable='true']").first.click()
    page.keyboard.press("Enter")


def _wait_for_response_done(page: Page) -> None:
    """
    Block until Gemini has finished streaming its response.

    Strategy:
      1. Wait up to 5 s for a "Stop response" button to appear, which signals
         that Gemini has started generating.
      2. Then wait up to RESPONSE_TIMEOUT_MS for that button to disappear,
         which signals that generation is complete.
      3. If no stop button ever appears, assume the reply was instant and add a
         short fixed wait instead.
    """
    time.sleep(1.5)  # brief pause for Gemini to begin generating

    stop_selector = (
        "button[aria-label='Stop response'], "
        "button[aria-label='Stop generating'], "
        "button[aria-label='Stop']"
    )

    stop_appeared = False
    try:
        page.wait_for_selector(stop_selector, timeout=5_000)
        stop_appeared = True
    except Exception:
        pass  # already done, or response was near-instant

    if stop_appeared:
        # Wait for the stop button to vanish → generation is complete
        try:
            page.wait_for_selector(
                stop_selector,
                state="hidden",
                timeout=RESPONSE_TIMEOUT_MS,
            )
        except Exception:
            raise RuntimeError(
                f"[GeminiBrowser] Response timed out after "
                f"{RESPONSE_TIMEOUT_MS // 1000} s."
            )
    else:
        # Fallback: wait a bit longer for fast responses
        time.sleep(4)

    # Short extra wait for any post-animation DOM stabilisation
    time.sleep(1.5)


def _extract_last_response(page: Page, player_id: str) -> str:
    """
    Return the text of the most recent Gemini response from the page DOM.
    Tries a JavaScript pass first (handles shadow DOM), then falls back to
    Playwright's query_selector_all for common Gemini response selectors.
    """
    # JavaScript pass — works even inside custom web components
    result: str = page.evaluate(
        """() => {
            const candidates = [
                '.response-container-content',
                '.model-response-text',
                'message-content',
                '.markdown',
                '.response-text',
            ];
            for (const sel of candidates) {
                const els = document.querySelectorAll(sel);
                if (els.length > 0) return els[els.length - 1].innerText.trim();
            }
            return '';
        }"""
    )
    if result:
        return result

    # Playwright fallback
    for selector in [
        ".response-container-content",
        ".model-response-text",
        "message-content",
    ]:
        els = page.query_selector_all(selector)
        if els:
            text = els[-1].inner_text().strip()
            if text:
                return text

    raise RuntimeError(
        f"[GeminiBrowser] Could not extract response for '{player_id}'. "
        f"Current URL: {page.url}. "
        "Gemini's page structure may have changed — check the browser window."
    )


# ── Public API ──────────────────────────────────────────────────────────────

def initialize_browser(player_ids: list[str]) -> None:
    """
    Launch Chromium and open one isolated BrowserContext per player.

    Must be called before init_player_chat() or query_gemini_browser().
    Handles first-time login automatically; reuses the saved session on all
    subsequent runs.  If the saved session has expired, re-runs the login flow.

    Args:
        player_ids: Unique identifier for each player (e.g. personality name).
                    These same strings are used as keys for all later calls.
    """
    global _playwright, _browser, _player_contexts, _player_pages

    _ensure_session_dir()
    _playwright = sync_playwright().start()

    # ── First-time login ──────────────────────────────────────────────────
    if not os.path.exists(STATE_FILE):
        _login_flow(_playwright)

    # ── Launch shared browser process ─────────────────────────────────────
    # channel="chrome" uses the system Google Chrome, which is stable on the
    # current macOS version.  headless=False is important: Google often blocks
    # headless browsers.
    _browser = _playwright.chromium.launch(
        channel="chrome",
        headless=False,
        args=[
            "--no-sandbox",
            "--disable-blink-features=AutomationControlled",
        ],
    )

    # ── Open one context per player ───────────────────────────────────────
    for player_id in player_ids:
        print(f"[GeminiBrowser] Opening context for player: {player_id} ...")
        ctx, page = _create_player_context(player_id)

        # Detect an expired or invalid saved session
        if _is_login_page(page):
            print("[GeminiBrowser] Saved session has expired. Re-running login flow...")
            ctx.close()
            if os.path.exists(STATE_FILE):
                os.remove(STATE_FILE)
            _login_flow(_playwright)

            # Retry with the fresh session
            ctx, page = _create_player_context(player_id)
            if _is_login_page(page):
                ctx.close()
                raise RuntimeError(
                    "[GeminiBrowser] Login failed after retry. "
                    "Please check your Google account and try again."
                )

        _player_contexts[player_id] = ctx
        _player_pages[player_id]    = page
        print(f"[GeminiBrowser] Ready: {player_id}")

    print("[GeminiBrowser] All player contexts initialised. Game can begin.\n")


def init_player_chat(player_id: str, system_prompt: str) -> None:
    """
    Send a player's personality system prompt to their Gemini chat session.

    Call this once per player after initialize_browser() so that subsequent
    query_gemini_browser() calls only need to send the compact game-state
    prompt instead of the full personality description every turn.

    Args:
        player_id:     The player's unique identifier (must match a value
                       passed to initialize_browser()).
        system_prompt: The full personality / role prompt text.
    """
    if player_id not in _player_pages:
        raise RuntimeError(
            f"[GeminiBrowser] Player '{player_id}' has no context. "
            "Call initialize_browser() first."
        )

    page = _player_pages[player_id]
    print(f"[GeminiBrowser] Sending system prompt for: {player_id} ...")

    # Wait for the input field to be available
    try:
        page.wait_for_selector(
            "rich-textarea div[contenteditable='true']",
            timeout=20_000,
        )
    except Exception:
        raise RuntimeError(
            f"[GeminiBrowser] Could not locate the chat input for '{player_id}' "
            f"at URL: {page.url}"
        )

    _focus_and_clear_input(page)
    _inject_text(page, system_prompt)
    _submit_message(page)

    # Wait for Gemini to acknowledge the system prompt before the game starts
    _wait_for_response_done(page)
    print(f"[GeminiBrowser] System prompt set for: {player_id}")


def query_gemini_browser(prompt: str, player_id: str) -> str:
    """
    Type a prompt into the Gemini chat for a specific player and return the
    full response as a plain string.

    Args:
        prompt:    The message to send (typically the formatted game state).
        player_id: Which player's isolated browser context to use.

    Returns:
        The response text as a plain string (same shape as response.text from
        the Gemini SDK).

    Raises:
        RuntimeError: If the input field cannot be found, the response times
                      out, or text extraction fails.
    """
    if player_id not in _player_pages:
        raise RuntimeError(
            f"[GeminiBrowser] No context for '{player_id}'. "
            "Call initialize_browser() before querying."
        )

    page = _player_pages[player_id]

    # Warn if an unexpected page has appeared (CAPTCHA, login redirect, etc.)
    if _is_login_page(page):
        print(
            f"\n[GeminiBrowser] WARNING: '{player_id}' is on a login/CAPTCHA page. "
            "Manual intervention may be required in the browser window."
        )

    # ── Locate the input field ────────────────────────────────────────────
    try:
        page.wait_for_selector(
            "rich-textarea div[contenteditable='true']",
            timeout=15_000,
        )
    except Exception:
        raise RuntimeError(
            f"[GeminiBrowser] Could not find the Gemini chat input for '{player_id}'. "
            f"Current URL: {page.url}"
        )

    # ── Inject the prompt and submit ──────────────────────────────────────
    _focus_and_clear_input(page)
    _inject_text(page, prompt)
    _submit_message(page)

    # ── Wait for the full response ────────────────────────────────────────
    _wait_for_response_done(page)

    # ── Extract and return the response text ──────────────────────────────
    return _extract_last_response(page, player_id)


def shutdown_browser() -> None:
    """
    Close all player browser contexts and shut down the shared browser process.
    Call this after the game finishes (ideally inside a finally block).
    """
    global _playwright, _browser, _player_contexts, _player_pages

    for ctx in _player_contexts.values():
        try:
            ctx.close()
        except Exception:
            pass

    _player_contexts.clear()
    _player_pages.clear()

    if _browser is not None:
        _browser.close()
        _browser = None

    if _playwright is not None:
        _playwright.stop()
        _playwright = None

    print("[GeminiBrowser] Browser shutdown complete.")
