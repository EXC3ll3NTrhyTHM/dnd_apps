# Getting Started

## Prerequisites

- Node.js (v18 or higher recommended)
- An OpenAI API key
- A Discord bot application for each NPC

## Installation

1. Navigate to the project folder:
   ```bash
   cd npc-bot
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

## Running a Character

Each character has its own `.env.<name>` file. To run a character:

```bash
node bot.js nibby
node bot.js bonesy
```

The bot will:
1. Load `.env.<character>` for credentials
2. Load character files from `characters/<character>/`
3. Connect to Discord and start responding to mentions

## Running Multiple Characters

Each character needs its own terminal window:

```bash
# Terminal 1
node bot.js nibby

# Terminal 2
node bot.js bonesy
```

### Using PM2 (recommended for always-on)

PM2 keeps bots running in the background and restarts them if they crash:

```bash
# Install PM2 globally
npm install -g pm2

# Start both bots
pm2 start bot.js --name nibby -- nibby
pm2 start bot.js --name bonesy -- bonesy

# View status
pm2 status

# View logs
pm2 logs nibby
pm2 logs bonesy

# Stop a bot
pm2 stop nibby

# Restart a bot
pm2 restart nibby
```

## Interacting with the Bots

Once running, bots respond to:
- **@mentions** in any channel they can see
- **Direct messages**

### Special Commands

When mentioned, these commands work:
- `@Bot !reload` - Reload character files without restarting
- `@Bot !clear` - Clear conversation history for that channel

## Troubleshooting

### "No character specified"
You forgot to pass the character name:
```bash
node bot.js nibby  # not just "node bot.js"
```

### "Environment file not found"
Create the `.env.<character>` file. See [adding-characters.md](adding-characters.md).

### Bot doesn't respond
- Check the bot has permissions to read messages in the channel
- Make sure "Message Content Intent" is enabled in Discord Developer Portal
- Verify the token is correct in `.env.<character>`

### "Error calling OpenAI"
- Check your OpenAI API key is valid
- Verify you have API credits available
