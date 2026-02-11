const payload = {
  locationId: "dragons_hollow",
  message: {
    id: "test-" + Date.now(),
    userId: "1374906408046166036",
    playerName: "Tyren",
    text: "Hey @marcel, how is the tavern today?"
  }
};

fetch("http://localhost:3420/api/clawdbot/message", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(payload)
})
.then(res => res.json())
.then(data => console.log("Response:", data))
.catch(err => console.error("Error:", err));
