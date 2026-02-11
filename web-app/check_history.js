fetch("http://localhost:3420/api/clawdbot/channels/dragons_hollow/messages")
.then(res => res.json())
.then(data => {
  const history = data.history || [];
  console.log("Last 5 messages:");
  history.slice(-5).forEach(m => {
    console.log(`[${m.role}] ${m.playerName || m.npcDisplayName || m.npc}: ${m.text}`);
  });
})
.catch(err => console.error("Error:", err));
