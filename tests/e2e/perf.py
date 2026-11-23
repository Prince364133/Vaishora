"""Rough performance measurement on a production build (Chromium, local network).
Usage: python tests/e2e/perf.py BASE_URL"""
import sys, json
from playwright.sync_api import sync_playwright
base = sys.argv[1]
JS = """() => new Promise(res => {
  const out = {};
  new PerformanceObserver(l => { const e = l.getEntries(); out.lcp = Math.round(e[e.length-1].startTime); }).observe({type:'largest-contentful-paint', buffered:true});
  let cls = 0; new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) cls += e.value; out.cls = +cls.toFixed(4); }).observe({type:'layout-shift', buffered:true});
  setTimeout(() => {
    const n = performance.getEntriesByType('navigation')[0];
    out.ttfb = Math.round(n.responseStart); out.dcl = Math.round(n.domContentLoadedEventEnd);
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]; out.fcp = fcp ? Math.round(fcp.startTime) : null;
    const r = performance.getEntriesByType('resource');
    out.js_kb = Math.round(r.filter(x => x.name.endsWith('.js')).reduce((a,x)=>a+(x.transferSize||0),0)/1024);
    out.glb = r.filter(x => x.name.endsWith('.glb')).map(x => ({file: x.name.split('/').pop(), kb: Math.round((x.transferSize||x.encodedBodySize)/1024), ms: Math.round(x.responseEnd)}));
    out.total_kb = Math.round(r.reduce((a,x)=>a+(x.transferSize||0),0)/1024);
    res(out);
  }, 6000);
})"""
with sync_playwright() as p:
    b = p.chromium.launch(headless=True, args=['--use-angle=d3d11', '--ignore-gpu-blocklist'])
    for name, vp, mobile, cpu in [('desktop', (1366, 900), False, 1), ('mobile-4x-cpu', (390, 844), True, 4)]:
        ctx = b.new_context(viewport={'width': vp[0], 'height': vp[1]}, is_mobile=mobile, has_touch=mobile)
        pg = ctx.new_page()
        cdp = ctx.new_cdp_session(pg); cdp.send('Emulation.setCPUThrottlingRate', {'rate': cpu})
        pg.goto(base + '/', wait_until='load')
        print(name, json.dumps(pg.evaluate(JS)))
        ctx.close()
    b.close()
