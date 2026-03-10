"""
gemini_browser.py — Playwright browser automation for Gemini.

Bypasses the Gemini API free-tier rate limit by driving a real Chrome window
instead of calling the API directly.  Each AI player gets an isolated
BrowserContext with independent conversation history.  All contexts share the
same Google login session saved to backend/browser_session/ so the user only
has to log in once.

Public API
----------
    initialize_browser(player_ids)          # call once before the game
    init_player_chat(player_id, sys_prompt) # call per player after initialize
    query_gemini_browser(prompt, player_id) # call each turn
    shutdown_browser()                      # call after the game ends

Note: phantom tabs may briefly appear when Chrome loads Google auth cookies
into fresh contexts — this is a Chrome-level behaviour outside Playwright's
control and does not affect functionality.
"""

import asyncio
import os
import subprocess
import threading
from playwright.async_api import async_playwright, Browser, BrowserContext, Page, Playwright

# ── Paths ───────────────────────────────────────────────────────────────────
_THIS_DIR   = os.path.dirname(os.path.abspath(__file__))
SESSION_DIR = os.path.join(_THIS_DIR, "browser_session")
STATE_FILE  = os.path.join(SESSION_DIR, "state.json")

GEMINI_URL          = "https://gemini.google.com/app"
RESPONSE_TIMEOUT_MS = 60_000
NAV_TIMEOUT_MS      = 30_000

# ── Module-level state ──────────────────────────────────────────────────────
_playwright:      "Playwright | None"           = None
_browser:         "Browser | None"              = None
_player_contexts: dict[str, BrowserContext]     = {}
_player_pages:    dict[str, Page]               = {}
_loop:            "asyncio.AbstractEventLoop | None" = None
_loop_thread:     "threading.Thread | None"     = None


# ── Event loop bridge (async Playwright from sync callers) ──────────────────

def _start_event_loop() -> None:
    global _loop
    _loop = asyncio.new_event_loop()
    asyncio.set_event_loop(_loop)
    _loop.run_forever()


def _run(coro):
    if _loop is None or not _loop.is_running():
        raise RuntimeError("[GeminiBrowser] Event loop is not running.")
    return asyncio.run_coroutine_threadsafe(coro, _loop).result()


# ── Internal helpers ────────────────────────────────────────────────────────

def _is_login_page(page: Page) -> bool:
    url = page.url
    return "accounts.google.com" in url or "signin.google" in url.lower()


async def _login_flow(pw: Playwright) -> None:
    """Open Chrome so the user can log in; save session cookies to STATE_FILE."""
    os.makedirs(SESSION_DIR, exist_ok=True)
    print("\n[GeminiBrowser] No saved session found. Opening browser for first-time login...")

    ctx = await pw.chromium.launch_persistent_context(
        user_data_dir=SESSION_DIR,
        channel="chrome",
        headless=False,
        viewport={"width": 1280, "height": 800},
        args=["--no-sandbox", "--disable-blink-features=AutomationControlled"],
    )
    page = ctx.pages[0] if ctx.pages else await ctx.new_page()
    await page.goto(GEMINI_URL, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)

    print("\n" + "=" * 65)
    print("  Please log in to Gemini in the browser window that just opened.")
    print("  Once you see the Gemini chat interface (not a sign-in page),")
    print("  come back here and press Enter to save your session.")
    print("=" * 65)
    await asyncio.to_thread(input, "\n  Press Enter when you are fully logged in > ")

    await ctx.storage_state(path=STATE_FILE)
    await ctx.close()
    print(f"[GeminiBrowser] Session saved → {STATE_FILE}\n")


async def _create_player_context(player_id: str) -> tuple[BrowserContext, Page]:
    """Open an isolated BrowserContext for one player and navigate to Gemini."""
    ctx = await _browser.new_context(
        storage_state=STATE_FILE,
        viewport={"width": 1100, "height": 750},
    )
    page = await ctx.new_page()
    await page.goto(GEMINI_URL, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
    try:
        await page.wait_for_load_state("networkidle", timeout=5_000)
    except Exception:
        pass
    return ctx, page


async def _focus_and_clear_input(page: Page) -> None:
    await page.locator("rich-textarea div[contenteditable='true']").first.click()
    await page.keyboard.press("Meta+A")
    await page.keyboard.press("Backspace")


async def _inject_text(page: Page, text: str) -> None:
    """Paste text via macOS clipboard to avoid newlines triggering early submit."""
    await asyncio.to_thread(
        subprocess.run, ["pbcopy"], input=text.encode("utf-8"), check=True
    )
    await page.keyboard.press("Meta+V")


async def _submit_message(page: Page) -> None:
    """Re-click the input before Enter to fix focus loss after clipboard paste."""
    await page.locator("rich-textarea div[contenteditable='true']").first.click()
    await page.keyboard.press("Enter")


async def _wait_for_response_done(page: Page) -> None:
    """Block until Gemini finishes streaming its response."""
    stop_selector = (
        "button[aria-label='Stop response'], "
        "button[aria-label='Stop generating'], "
        "button[aria-label='Stop']"
    )
    stop_appeared = False
    try:
        await page.wait_for_selector(stop_selector, timeout=6_000)
        stop_appeared = True
    except Exception:
        pass

    if stop_appeared:
        try:
            await page.wait_for_selector(stop_selector, state="hidden", timeout=RESPONSE_TIMEOUT_MS)
        except Exception:
            raise RuntimeError(f"[GeminiBrowser] Response timed out after {RESPONSE_TIMEOUT_MS // 1000}s.")
    else:
        await asyncio.sleep(1.5)  # fallback for near-instant responses

    await asyncio.sleep(0.5)  # let DOM settle after streaming ends


async def _extract_last_response(page: Page, player_id: str) -> str:
    """Return the text of the most recent Gemini response."""
    result: str = await page.evaluate(
        """() => {
            const selectors = [
                '.response-container-content',
                '.model-response-text',
                'message-content',
                '.markdown',
                '.response-text',
            ];
            for (const sel of selectors) {
                const els = document.querySelectorAll(sel);
                if (els.length > 0) return els[els.length - 1].innerText.trim();
            }
            return '';
        }"""
    )
    if result:
        return result
    raise RuntimeError(
        f"[GeminiBrowser] Could not extract response for '{player_id}'. "
        f"URL: {page.url} — Gemini's DOM structure may have changed."
    )


# ── Async implementations ────────────────────────────────────────────────────

async def _async_initialize_browser(player_ids: list[str]) -> None:
    global _playwright, _browser, _player_contexts, _player_pages

    os.makedirs(SESSION_DIR, exist_ok=True)
    _playwright = await async_playwright().start()

    if not os.path.exists(STATE_FILE):
        await _login_flow(_playwright)

    _browser = await _playwright.chromium.launch(
        channel="chrome",
        headless=False,
        args=["--no-sandbox", "--disable-blink-features=AutomationControlled"],
    )

    async def _open_one(player_id: str) -> tuple:
        print(f"[GeminiBrowser] Opening context for player: {player_id} ...")
        ctx, page = await _create_player_context(player_id)
        try:
            await page.wait_for_selector(
                "rich-textarea div[contenteditable='true']", timeout=30_000
            )
        except Exception:
            if _is_login_page(page):
                await ctx.close()
                return (player_id, None, None)
        print(f"[GeminiBrowser] Ready: {player_id}")
        return (player_id, ctx, page)

    results = await asyncio.gather(*[_open_one(pid) for pid in player_ids])

    if any(ctx is None for _, ctx, _ in results):
        print("[GeminiBrowser] Saved session expired — re-running login flow...")
        for _, ctx, _ in results:
            if ctx is not None:
                await ctx.close()
        _player_contexts.clear()
        _player_pages.clear()
        os.remove(STATE_FILE)
        await _login_flow(_playwright)
        results = await asyncio.gather(*[_open_one(pid) for pid in player_ids])
        if any(ctx is None for _, ctx, _ in results):
            raise RuntimeError("[GeminiBrowser] Login failed after retry.")

    for player_id, ctx, page in results:
        _player_contexts[player_id] = ctx
        _player_pages[player_id]    = page

    print("[GeminiBrowser] All player contexts initialised. Game can begin.\n")


async def _async_init_player_chat(player_id: str, system_prompt: str) -> None:
    if player_id not in _player_pages:
        raise RuntimeError(f"[GeminiBrowser] Unknown player '{player_id}'. Call initialize_browser() first.")

    page = _player_pages[player_id]
    print(f"[GeminiBrowser] Sending system prompt for: {player_id} ...")

    for attempt in range(1, 4):
        if attempt > 1:
            print(f"[GeminiBrowser] Refreshing and retrying for '{player_id}' (attempt {attempt}/3)...")
            await page.goto(GEMINI_URL, wait_until="domcontentloaded", timeout=NAV_TIMEOUT_MS)
            try:
                await page.wait_for_load_state("networkidle", timeout=5_000)
            except Exception:
                pass

        try:
            await page.wait_for_selector("rich-textarea div[contenteditable='true']", timeout=20_000)
        except Exception:
            if attempt == 3:
                raise RuntimeError(f"[GeminiBrowser] Chat input not found for '{player_id}' at {page.url}")
            continue

        await _focus_and_clear_input(page)
        await _inject_text(page, system_prompt)
        await _submit_message(page)

        try:
            await _wait_for_response_done(page)
            print(f"[GeminiBrowser] System prompt set for: {player_id}")
            return
        except Exception as e:
            print(f"[GeminiBrowser] Timeout for '{player_id}': {e}")
            if attempt == 3:
                raise RuntimeError(f"[GeminiBrowser] Failed to send system prompt for '{player_id}' after 3 attempts.")


async def _async_query_gemini_browser(prompt: str, player_id: str) -> str:
    if player_id not in _player_pages:
        raise RuntimeError(f"[GeminiBrowser] Unknown player '{player_id}'. Call initialize_browser() first.")

    page = _player_pages[player_id]

    if _is_login_page(page):
        print(f"\n[GeminiBrowser] WARNING: '{player_id}' is on a login page — manual intervention may be needed.")

    try:
        await page.wait_for_selector("rich-textarea div[contenteditable='true']", timeout=15_000)
    except Exception:
        raise RuntimeError(f"[GeminiBrowser] Chat input not found for '{player_id}' at {page.url}")

    await _focus_and_clear_input(page)
    await _inject_text(page, prompt)
    await _submit_message(page)
    await _wait_for_response_done(page)
    return await _extract_last_response(page, player_id)


async def _async_shutdown_browser() -> None:
    global _playwright, _browser, _player_contexts, _player_pages

    for ctx in _player_contexts.values():
        try:
            await ctx.close()
        except Exception:
            pass
    _player_contexts.clear()
    _player_pages.clear()

    if _browser is not None:
        await _browser.close()
        _browser = None
    if _playwright is not None:
        await _playwright.stop()
        _playwright = None

    print("[GeminiBrowser] Browser shutdown complete.")


# ── Public sync API ──────────────────────────────────────────────────────────

def initialize_browser(player_ids: list[str]) -> None:
    """Launch Chrome and open one isolated tab per player (concurrently)."""
    global _loop_thread
    _loop_thread = threading.Thread(target=_start_event_loop, daemon=True)
    _loop_thread.start()
    while _loop is None or not _loop.is_running():
        pass
    _run(_async_initialize_browser(player_ids))


def init_player_chat(player_id: str, system_prompt: str) -> None:
    """Send the personality system prompt to a player's Gemini session."""
    _run(_async_init_player_chat(player_id, system_prompt))


def query_gemini_browser(prompt: str, player_id: str) -> str:
    """Send a game-state prompt and return Gemini's response as a string."""
    return _run(_async_query_gemini_browser(prompt, player_id))


def shutdown_browser() -> None:
    """Close all player contexts and shut down Chrome."""
    _run(_async_shutdown_browser())
    if _loop is not None:
        _loop.call_soon_threadsafe(_loop.stop)
    if _loop_thread is not None:
        _loop_thread.join(timeout=5)
