const path = require("path");
const fs = require("fs");
const paths = require("../manager/paths");
const botEnvPath = process.env.SHADOW_MC_HOST_BOT_ENV || paths.botEnvPath();

if (fs.existsSync(botEnvPath)) {
  require("dotenv").config({ path: botEnvPath });
} else {
  const localEnv = path.join(__dirname, ".env");
  if (fs.existsSync(localEnv)) {
    require("dotenv").config({ path: localEnv });
  } else {
    require("dotenv").config({ path: botEnvPath });
  }
}

const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const commands = [
  new SlashCommandBuilder()
    .setName("status")
    .setDescription("Check Minecraft server status"),

  new SlashCommandBuilder()
    .setName("startserver")
    .setDescription("Start the Minecraft server"),

  new SlashCommandBuilder()
    .setName("stopserver")
    .setDescription("Stop the Minecraft server gracefully"),

  new SlashCommandBuilder()
    .setName("players")
    .setDescription("List online players"),

  new SlashCommandBuilder()
    .setName("tps")
    .setDescription("Check server TPS"),
].map((cmd) => cmd.toJSON());

const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

(async () => {
  try {
    console.log("⏳ Registering slash commands...");

    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands }
    );

    console.log("✅ Commands registered successfully!");
  } catch (err) {
    console.error("❌ Error registering commands:", err);
  }
})();