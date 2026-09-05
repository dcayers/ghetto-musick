import { createServer } from "vite";
import { chromium } from "playwright";

const server = await createServer({ root: new URL("..", import.meta.url).pathname, server: { port: 0 }, logLevel: "error" });
await server.listen();
const port = (server.httpServer!.address() as { port: number }).port;
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
await page.goto(`http://localhost:${port}/perf.html?nodes=100&edges=300`, { waitUntil: "load" });
await page.waitForFunction("document.querySelectorAll('.react-flow__edge').length > 0", null, { timeout: 60000 });

const T = "document.querySelector('.react-flow__viewport').style.transform";

const before1 = await page.evaluate(T);
await page.evaluate(`
  (function () {
    var pane = document.querySelector('.react-flow__pane');
    for (var i = 0; i < 5; i++) {
      pane.dispatchEvent(new WheelEvent('wheel', { bubbles: true, cancelable: true, composed: true, clientX: 600, clientY: 400, deltaY: -50, deltaMode: 0 }));
    }
  })()
`);
await page.waitForTimeout(300);
const after1 = await page.evaluate(T);

const before2 = await page.evaluate(T);
await page.mouse.move(600, 400);
for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -50);
await page.waitForTimeout(300);
const after2 = await page.evaluate(T);

console.log(JSON.stringify({
  synthetic: { before: before1, after: after1, moved: before1 !== after1 },
  trusted:   { before: before2, after: after2, moved: before2 !== after2 },
}, null, 1));

await browser.close();
await server.close();
