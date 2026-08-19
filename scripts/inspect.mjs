/**
 * Dev helper: attaches to a running Lume over the Chrome DevTools Protocol and
 * evaluates an expression inside a chosen window.
 *   node scripts/inspect.mjs <port> <targetMatch> "<js expression>"
 * Start the app with --remote-debugging-port=<port> first.
 */
const [port = '9333', match = 'renderer', expr = '1'] = process.argv.slice(2)

const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json()
const page = targets.find((t) => t.type === 'page' && (t.url.includes(match) || t.title.includes(match)))
if (!page) {
  console.error('no target matching', match, '\navailable:', targets.map((t) => t.type + ' ' + t.url))
  process.exit(1)
}

const ws = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => (ws.onopen = r))

const result = await new Promise((resolve, reject) => {
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.id === 1) resolve(msg.result)
  }
  ws.onerror = reject
  ws.send(
    JSON.stringify({
      id: 1,
      method: 'Runtime.evaluate',
      params: { expression: expr, returnByValue: true, awaitPromise: true },
    }),
  )
})
ws.close()
console.log(JSON.stringify(result.result?.value ?? result, null, 2))
