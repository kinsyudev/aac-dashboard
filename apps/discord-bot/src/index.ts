import { LogLevel, SapphireClient } from "@sapphire/framework";
import { GatewayIntentBits } from "discord.js";

import { botEnv } from "./env";

const env = botEnv();

const client = new SapphireClient({
  defaultPrefix: "!",
  intents: [GatewayIntentBits.Guilds],
  logger: {
    level: process.env.NODE_ENV === "production" ? LogLevel.Info : LogLevel.Debug,
  },
});

client.once("ready", () => {
  client.logger.info(`Discord farm bot logged in as ${client.user?.tag}`);
});

await client.login(env.AAC_DISCORD_BOT_TOKEN);
