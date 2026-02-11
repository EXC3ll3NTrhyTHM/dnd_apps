const WebSocket = require('ws');
const ws = new WebSocket('ws://localhost:3420');

ws.on('open', () => {
  console.log('Connected to server');
  // Trigger a mention after connecting
  setTimeout(() => {
    fetch("http://localhost:3420/api/clawdbot/message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        locationId: "dragons_hollow",
        message: {
          id: "ws-test-" + Date.now(),
          userId: "1374906408046166036",
          playerName: "Tyren",
          text: "WS Test @marcel"
        }
      })
    }).then(r => r.json()).then(d => console.log('Mention enqueued:', d));
  }, 1000);
});

ws.on('message', (data) => {
  console.log('Received:', data.toString());
  process.exit(0);
});

ws.on('error', (err) => {
  console.error('Error:', err.message);
});

setTimeout(() => {
  console.log('Timed out waiting for message');
  process.exit(1);
}, 5000);
