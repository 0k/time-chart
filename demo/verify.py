"""Real Chrome interaction checks. Start with npm run demo; run via pyenv/bin/python."""
from pathlib import Path
import sys
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "artifacts" / "e2e"
OUT.mkdir(parents=True, exist_ok=True)
URL = sys.argv[1] if len(sys.argv) > 1 else "http://127.0.0.1:5187/demo/"

with sync_playwright() as p:
    browser = p.chromium.launch(channel="chrome", headless=True)
    context = browser.new_context(viewport={"width": 1600, "height": 1200}, color_scheme="light")
    page = context.new_page()
    errors = []
    page.on("console", lambda msg: errors.append(f"{msg.text} @ {msg.location}") if msg.type == "error" else None)
    page.on("pageerror", lambda exc: errors.append(f"{exc}\n{exc.stack}"))
    page.goto(URL, wait_until="networkidle")
    page.wait_for_selector("#stacked canvas")
    page.wait_for_function("window.__charts?.length === 3")
    assert page.evaluate("window.__instances.every(c => c.getOption().animation === false)")
    page.screenshot(path=str(OUT / "initial.png"), full_page=True)
    initial = page.evaluate("window.__charts[0].getWindow()")
    box = page.locator("#stacked").bounding_box()
    assert box
    # Wheel/drag locations are derived from the actual ECharts grid, not screenshots.
    grid = page.evaluate("window.__instances[0].getOption().grid[0]")
    x = box["x"] + grid["left"] + (box["width"] - grid["left"] - grid["right"]) * 0.55
    y = box["y"] + grid["top"] + 70
    page.mouse.move(x, y)
    page.mouse.wheel(0, -500)
    page.wait_for_function("old => window.__charts[0].getWindow().end - window.__charts[0].getWindow().start < old.end - old.start", arg=initial)
    page.wait_for_function("Math.abs(window.__charts[0].getWindow().start - window.__charts[1].getWindow().start) < 10")
    page.wait_for_function("window.__callbackCount() > 0")
    zoom = page.evaluate("window.__charts[0].getWindow()")
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + 100, y, steps=12)
    page.mouse.up()
    page.wait_for_function("old => Math.abs(window.__charts[0].getWindow().start - old.start) > 1000", arg=zoom)
    print("PASS wheel zoom/link and drag pan")

    page.locator("#week").click()
    page.wait_for_function("window.__instances[0].getOption().series.at(-1).markLine.data.some(pair => pair[0].label.show && pair[0].label.fontSize === 10)")
    assert page.evaluate("window.__instances[0].getOption().series.at(-1).markArea.data.length > 0")
    assert page.evaluate("window.__instances[0].getOption().series.at(-1).markLine.data.some(pair => pair[0].label.formatter === 'now')")
    page.screenshot(path=str(OUT / "zoomed-in-week.png"), full_page=True)
    print("PASS day labels, weekend bands and now in week")

    # The scrolling HTML legend owns the user interaction.
    band_row = page.locator('#bands [data-series-id="observation-0"]')
    band_row.click()
    page.wait_for_function("window.__instances[1].getOption().legend[0].selected['observation-0'] === false")
    assert page.evaluate("window.__instances[1].getOption().series.filter(s => s.id.includes('band:observation-0')).every(s => s.data.length === 0)")
    band_row.click()
    page.wait_for_function("window.__instances[1].getOption().legend[0].selected['observation-0'] === true")
    assert page.evaluate("window.__instances[1].getOption().series.filter(s => s.id.includes('band:observation-0')).every(s => s.data.length > 0)")
    print("PASS legend hides/restores series and band")

    page.locator("#year").click()
    page.wait_for_function("!window.__instances[0].getOption().series.at(-1).markLine.data.some(pair => pair[0].label.show && pair[0].label.fontSize === 10)")
    page.screenshot(path=str(OUT / "zoomed-out-year.png"), full_page=True)
    page.locator("#week").click()
    before_dark = page.evaluate("window.__charts[0].getWindow()")
    page.emulate_media(color_scheme="dark")
    page.wait_for_function("window.__instances[0].getOption().tooltip[0].backgroundColor === 'rgba(29,32,39,0.97)'")
    assert page.evaluate("getComputedStyle(document.body).backgroundColor") == "rgb(22, 24, 29)"
    assert page.evaluate("window.__charts[0].getWindow()") == before_dark
    page.screenshot(path=str(OUT / "dark.png"), full_page=True)
    print("PASS year density and live dark theme without window movement")
    assert not errors, f"Browser errors: {errors}"
    browser.close()
print(f"PASS no console errors; screenshots in {OUT}")
