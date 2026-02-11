/**
 * Discord OAuth2 Authentication
 * 
 * Handles the OAuth2 flow:
 * 1. Redirect user to Discord login
 * 2. Discord redirects back with a code
 * 3. Exchange code for access token
 * 4. Fetch user profile from Discord
 * 5. Issue JWT for session
 */

const DISCORD_API = 'https://discord.com/api/v10';
const DISCORD_OAUTH_AUTHORIZE = 'https://discord.com/oauth2/authorize';

/**
 * Generate the Discord OAuth2 authorization URL
 * Uses the user-facing URL (not the API endpoint) so mobile OSes
 * can deep-link into the Discord app.
 */
function getAuthorizationUrl() {
  const params = new URLSearchParams({
    client_id: process.env.DISCORD_CLIENT_ID,
    redirect_uri: process.env.DISCORD_REDIRECT_URI,
    response_type: 'code',
    scope: 'identify'
  });
  return `${DISCORD_OAUTH_AUTHORIZE}?${params.toString()}`;
}

/**
 * Exchange an authorization code for an access token
 */
async function exchangeCode(code) {
  const response = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID,
      client_secret: process.env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: process.env.DISCORD_REDIRECT_URI
    })
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Discord token exchange failed: ${err}`);
  }

  return response.json();
}

/**
 * Fetch the Discord user profile using an access token
 */
async function fetchUser(accessToken) {
  const response = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` }
  });

  if (!response.ok) {
    throw new Error('Failed to fetch Discord user');
  }

  return response.json();
}

/**
 * Get the user's avatar URL
 */
function getAvatarUrl(user) {
  if (user.avatar) {
    const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}`;
  }
  // Default avatar
  const index = (BigInt(user.id) >> 22n) % 6n;
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

module.exports = {
  getAuthorizationUrl,
  exchangeCode,
  fetchUser,
  getAvatarUrl
};
