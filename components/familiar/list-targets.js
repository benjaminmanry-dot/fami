const path = require("node:path");
const { ChannelType, Client, GatewayIntentBits } = require("discord.js");

require("dotenv").config({ path: path.join(__dirname, ".env") });

const token = process.env.DISCORD_BOT_TOKEN;

if (!token) {
  console.error("DISCORD_BOT_TOKEN is blank in .env. Paste the bot token locally, then rerun npm run targets.");
  process.exit(1);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

client.once("ready", async () => {
  console.log(`Logged in as ${client.user.tag}`);
  console.log(`CLIENT_ID=${client.user.id}`);
  console.log("");

  const guilds = await client.guilds.fetch();
  if (!guilds.size) {
    console.log("The bot is not in any servers yet. Use the invite URL first.");
    await client.destroy();
    return;
  }

  for (const guildSummary of guilds.values()) {
    const guild = await guildSummary.fetch();
    console.log(`Server: ${guild.name}`);
    console.log(`GUILD_ID=${guild.id}`);

    const channels = await guild.channels.fetch();
    const textChannels = [];
    const voiceChannels = [];

    for (const channel of channels.values()) {
      if (!channel) continue;
      if (channel.type === ChannelType.GuildText) {
        textChannels.push(channel);
      } else if (channel.type === ChannelType.GuildVoice) {
        voiceChannels.push(channel);
      }
    }

    console.log("Text channels:");
    for (const channel of textChannels.sort((a, b) => a.rawPosition - b.rawPosition)) {
      console.log(`  TEXT_CHANNEL_ID=${channel.id}  # ${channel.name}`);
    }

    console.log("Voice channels:");
    for (const channel of voiceChannels.sort((a, b) => a.rawPosition - b.rawPosition)) {
      console.log(`  VOICE_CHANNEL_ID=${channel.id}  # ${channel.name}`);
    }

    console.log("");
  }

  await client.destroy();
});

client.login(token).catch((err) => {
  console.error(`Could not log in with the token in .env: ${err.message}`);
  process.exit(1);
});
