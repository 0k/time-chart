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
    page.wait_for_function("window.__charts?.length === 4")
    assert page.evaluate("window.__instances.every(c => c.getOption().animation === false)")
    assert page.evaluate("window.__instances[0].getOption().series[0].data[0][0] !== window.__instances[1].getOption().series[0].data[0][0]")
    assert page.evaluate("new Set(window.__charts.slice(0, 3).map(c => JSON.stringify(c.getWindow()))).size === 1")
    page.screenshot(path=str(OUT / "initial.png"), full_page=True)

    # Auto legends: the unlinked temperature column fits its widest label
    # exactly; the three linked charts share one column, capped at maxWidth.
    legends = page.evaluate("""() => window.__instances.map((c, i) => {
        const root = document.querySelectorAll('[data-time-chart-legend]')[i];
        const texts = [...root.querySelectorAll('[data-series-id] span:last-child')];
        return {
            right: c.getOption().grid[0].right, column: root.getBoundingClientRect().width,
            // Room left beside each label's laid-out text (a Range measures
            // the text itself, unlike scrollWidth which never drops below
            // the box width).
            slack: Math.min(...texts.map(t => { const r = document.createRange(); r.selectNodeContents(t); return t.clientWidth - r.getBoundingClientRect().width; })),
            truncated: texts.some(t => t.scrollWidth > t.clientWidth),
        };
    })""")
    temperature = legends[3]
    print("legends", legends)
    assert not temperature["truncated"], temperature
    assert -0.5 <= temperature["slack"] <= 2, f"temperature column not fitted to its widest label: {temperature}"
    assert temperature["right"] == temperature["column"] + 16 + 24, temperature
    assert temperature["right"] < 280 + 24 - 100, f"plot did not gain width over the former 280px legend: {temperature}"
    assert len({l["right"] for l in legends[:3]}) == 1, f"linked plots not aligned: {legends[:3]}"
    assert legends[0]["right"] == 240 + 24 and legends[0]["truncated"], legends[0]
    page.screenshot(path=str(OUT / "time-chart-legend-auto.png"), full_page=True)
    print(f"PASS auto legend widths: temperature column {temperature['column']}px, linked columns {legends[0]['column']}px")
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
    same_windows = """() => {
        const first = window.__charts[0].getWindow();
        return window.__charts.slice(0, 3).every(c => {
            const w = c.getWindow();
            return Math.abs(w.start - first.start) < 10 && Math.abs(w.end - first.end) < 10;
        });
    }"""
    page.wait_for_function(same_windows)
    page.evaluate("window.__instances[1].dispatchAction({type: 'dataZoom', start: 40, end: 60})")
    page.wait_for_function(same_windows)
    print("PASS wheel zoom/link, drag pan and reverse zoom with different data ranges")

    # Linked hover is by time: hovering the stacked chart points each linked
    # chart at the same time, with its tooltip beside its own pointer, or shows
    # nothing where that chart has no data (the bands start mid-range).
    page.evaluate("""() => { window.__pointers = [[], [], []]; window.__instances.slice(0, 3).forEach((c, i) =>
        c.on('updateAxisPointer', e => window.__pointers[i].push((e.axesInfo || []).find(a => a.axisDim === 'x')?.value ?? null))); }""")
    page.locator("#month").click()
    page.wait_for_timeout(300)
    bands_data = page.evaluate("""() => { const t = window.__instances[1].getOption().series.filter(s => !String(s.id).startsWith('\\u0000')).flatMap(s => s.data.map(p => p[0]));
        return [Math.min(...t), Math.max(...t)]; }""")
    stacked = page.locator("#stacked").bounding_box()
    shown, expected = [], []
    for frac in (0.05, 0.5, 0.95):
        page.evaluate("window.__pointers.forEach(p => p.length = 0)")
        page.mouse.move(stacked["x"] + grid["left"] + (stacked["width"] - grid["left"] - grid["right"]) * frac, stacked["y"] + grid["top"] + 70)
        page.wait_for_timeout(200)
        hover = page.evaluate("""() => {
            const tip = id => [...document.querySelectorAll('#' + id + ' div')].find(d => /pointer-events: none/.test(d.getAttribute('style') || '')
                && getComputedStyle(d).display !== 'none' && getComputedStyle(d).opacity !== '0' && d.innerText.trim());
            const box = id => document.getElementById(id).getBoundingClientRect().left;
            return [0, 1, 2].map(i => {
                const t = window.__pointers[i].at(-1) ?? null, id = ['stacked', 'bands', 'gaps'][i];
                const el = tip(id);
                return { t, px: t === null ? null : window.__instances[i].convertToPixel({ xAxisIndex: 0 }, t), tip: el ? el.getBoundingClientRect().left - box(id) : null };
            });
        }""")
        source = hover[0]["t"]
        assert source is not None, hover
        for peer in hover[1:]:
            if peer["t"] is None:
                continue
            shown.append(frac)
            assert abs(peer["t"] - source) <= 2 * 3600_000, f"linked pointer at another time: {hover}"
            assert peer["tip"] is not None and abs(peer["tip"] - peer["px"]) < 160, f"linked tooltip away from its pointer: {hover}"
        inside = bands_data[0] <= source <= bands_data[1]
        expected.append(inside)
        assert (hover[1]["t"] is not None) == inside, f"bands pointer shown outside its data or hidden inside it: {bands_data} {hover}"
    assert set(expected) == {True, False}, f"hover did not cover both inside and outside the bands data: {expected}"
    page.mouse.move(stacked["x"] + 5, stacked["y"] + 5)
    page.wait_for_timeout(200)
    assert page.evaluate("window.__pointers.slice(1).every(p => p.at(-1) === null || p.at(-1) === undefined)")
    print("PASS linked hover points every chart at the hovered time")

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

    for theme in ("light", "dark"):
        page.emulate_media(color_scheme=theme)
        expected_bg = "rgb(255, 255, 255)" if theme == "light" else "rgb(22, 24, 29)"
        page.wait_for_function("bg => getComputedStyle(document.body).backgroundColor === bg", arg=expected_bg)
        page.wait_for_function("dark => window.__instances[3].getOption().tooltip[0].backgroundColor === (dark ? 'rgba(29,32,39,0.97)' : 'rgba(255,255,255,0.97)')", arg=theme == "dark")
        page.wait_for_selector("#temperature canvas")
        assert page.evaluate("""() => {
            const c = window.__instances[3], o = c.getOption();
            const s = id => o.series.find(s => s.id === id);
            return s('target').lineStyle.type === 'dashed' && s('target').lineStyle.width === 1
                && s('selected').lineStyle.type === 'dotted' && s('selected').lineStyle.width === 3
                && s('current').lineStyle.width === 3 && s('current').color === 'black'
                && ['confort', 'reduit', 'hors-gel'].every(id => s(id).areaStyle.origin === 'start' && !s(id).stack)
                && s('confort').areaStyle.opacity === .1 && s('reduit').areaStyle.opacity === .1 && s('hors-gel').areaStyle.opacity === .2
                && s('deficit').lineStyle.width === 0 && s('deficit').tooltip.show === false
                && s('\\u0000band:deficit:1').areaStyle.decal.color === 'red'
                && o.yAxis[0].interval === 1 && o.yAxis[0].minorTick.show && o.yAxis[0].minorTick.splitNumber === 2
                && o.yAxis[0].minorSplitLine.show && o.yAxis[0].minorSplitLine.lineStyle.type === 'dashed'
                && c.getZr().storage.getDisplayList().some(el => el.type === 'ec-polygon' && el.style.decal?.image)
                && o.tooltip[0].formatter([{seriesName: 'deficit', value: [0, 18]}]) === '';
        }""")
        assert page.evaluate("""() => {
            const o = window.__instances[3].getOption(), s = id => o.series.find(s => s.id === id);
            return s('heating').data.every(([t, v], i) => v === Math.max(s('selected').data[i][1] - s('current').data[i][1], 0))
                && s('current').data.at(-1)[0] - s('current').data[0][0] === 2 * 86400000
                && s('\\u0000band:deficit:0').data.every(([t, v], i) => v === (s('current').data[i][1] <= s('selected').data[i][1] ? s('current').data[i][1] : null))
                && s('\\u0000band:deficit:1').data.every(([t, v], i) => v === (s('current').data[i][1] <= s('selected').data[i][1] ? s('selected').data[i][1] - s('current').data[i][1] : null))
                && s('\\u0000band:deficit:0').data.some(p => p[1] === null)
                && s('\\u0000band:deficit:0').data.some(p => p[1] !== null);
        }""")
        row = page.locator('#temperature [data-series-id="deficit"]')
        row.click()
        page.wait_for_function("window.__instances[3].getOption().series.filter(s => s.id.includes('band:deficit')).every(s => s.data.length === 0)")
        row.click()
        page.wait_for_function("window.__instances[3].getOption().series.filter(s => s.id.includes('band:deficit')).every(s => s.data.length > 0)")
        fill_row = page.locator('#temperature [data-series-id="confort"]')
        fill_row.click()
        assert page.evaluate("""() => {
            const c = window.__instances[3], m = c.getModel(), s = m.getSeries().find(s => s.id === 'confort');
            let fills = 0; c.getViewOfSeriesModel(s).group.traverse(el => { if (el.type === 'ec-polygon') fills++; });
            return m.isSeriesFiltered(s) && fills === 0;
        }""")
        fill_row.click()
        assert page.evaluate("""() => {
            const c = window.__instances[3], m = c.getModel(), s = m.getSeries().find(s => s.id === 'confort');
            let fills = 0; c.getViewOfSeriesModel(s).group.traverse(el => { if (el.type === 'ec-polygon') fills++; });
            return !m.isSeriesFiltered(s) && fills === 1;
        }""")
        path = OUT / ("time-chart-demo.png" if theme == "light" else "time-chart-demo-dark.png")
        page.locator("#temperature").screenshot(path=str(path))
        print(f"PASS temperature {theme}: styles, rendered decal, ticks, tooltip, gaps, heating and legend toggles; {path}")
    # A fill-only owner is also selectable, without leaking into the tooltip.
    assert page.evaluate("""() => {
        const c = window.__charts[3], instance = window.__instances[3], w = c.getWindow();
        c.setSeries([{id: 'fill-only', label: 'Fill only', points: [[w.start, 3], [w.end, 4]], fill: .5, line: false}]);
        const s = instance.getOption().series.find(s => s.id === 'fill-only');
        return s.lineStyle.width === 0 && s.lineStyle.opacity === 0 && s.areaStyle.origin === 'start'
            && instance.getOption().tooltip[0].formatter([{seriesName: 'fill-only', value: [w.start, 3]}]) === '';
    }""")
    row = page.locator('#temperature [data-series-id="fill-only"]')
    for visible in (False, True):
        row.click()
        assert page.evaluate("""visible => {
            const c = window.__instances[3], m = c.getModel(), s = m.getSeries().find(s => s.id === 'fill-only');
            let fills = 0; c.getViewOfSeriesModel(s).group.traverse(el => { if (el.type === 'ec-polygon') fills++; });
            return m.isSeriesFiltered(s) === !visible && fills === (visible ? 1 : 0);
        }""", visible)
    assert page.evaluate("""() => {
        window.__charts.forEach(c => { c.destroy(); c.destroy(); });
        return window.__instances.every(c => c.isDisposed()) && !document.querySelector('[data-time-chart-legend]');
    }""")
    print("PASS fill-only legend toggle, tooltip exclusion and idempotent chart cleanup")
    assert not errors, f"Browser errors: {errors}"
    browser.close()
print(f"PASS no console errors; screenshots in {OUT}")
