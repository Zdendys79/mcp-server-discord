// Command handlers for /anketa and /prepis
import { Message, Client, TextChannel, ChannelType, DMChannel } from "discord.js";
import { joinAndRecord, getVoiceStatus } from "./voice.js";
import { insertBotkaMessage } from "./db.js";
import { getPool } from "./db.js";

// Regional indicator emojis A-T (max 20 options)
const REGIONAL_INDICATORS = [
  "\u{1F1E6}", "\u{1F1E7}", "\u{1F1E8}", "\u{1F1E9}", "\u{1F1EA}",
  "\u{1F1EB}", "\u{1F1EC}", "\u{1F1ED}", "\u{1F1EE}", "\u{1F1EF}",
  "\u{1F1F0}", "\u{1F1F1}", "\u{1F1F2}", "\u{1F1F3}", "\u{1F1F4}",
  "\u{1F1F5}", "\u{1F1F6}", "\u{1F1F7}", "\u{1F1F8}", "\u{1F1F9}",
];

/**
 * Detect suspicious words in poll text (common Czech typos).
 * Returns array of warnings for detected issues.
 */
function detectSuspiciousWords(text: string): string[] {
  const suspicious: string[] = [];
  const words = text.toLowerCase().split(/\s+/);

  // Common Czech typos
  const patterns = [
    { pattern: /zů[^v]/, correction: "zú", example: "zůčastnit → zúčastnit" },
    { pattern: /výšastn/, correction: "účastn", example: "výšastnit → zúčastnit" },
    { pattern: /přijt/, correction: "přijít/přijdu", example: "přijt → přijít" },
  ];

  words.forEach(word => {
    patterns.forEach(p => {
      if (p.pattern.test(word)) {
        suspicious.push(`"${word}" (možná ${p.correction}? ${p.example})`);
      }
    });
  });

  return suspicious;
}

/**
 * Handle /anketa command - create poll with emoji reactions.
 *
 * Format: /anketa Otazka | Moznost A | Moznost B | Moznost C
 * Creates formatted message and adds regional indicator reactions for voting.
 */
export async function handleAnketa(message: Message): Promise<void> {
  const anketaText = message.content.substring("/anketa".length).trim();

  if (!anketaText) {
    await message.reply(
      "**Format:** `/anketa Otazka | Moznost A | Moznost B | ...`\n" +
      "Priklad: `/anketa Kam pojedeme na vylet? | Hory | More | Mesto`"
    );
    return;
  }

  const parts = anketaText.split("|").map((p) => p.trim()).filter((p) => p.length > 0);

  if (parts.length < 3) {
    await message.reply(
      "Anketa musi obsahovat otazku a alespon 2 moznosti oddelene znakem `|`.\n" +
      "Priklad: `/anketa Co hrajeme? | Valheim | Sea of Thieves | Baldur's Gate`"
    );
    return;
  }

  if (parts.length > 21) {
    await message.reply("Maximalne 20 moznosti.");
    return;
  }

  // Check for suspicious words
  const suspicious = detectSuspiciousWords(anketaText);

  let finalText = anketaText;

  if (suspicious.length > 0) {
    // Send PM to author with detected issues
    try {
      const warningMsg = await message.author.send(
        `Detekovala jsem možné překlepy v tvé anketě:\n\n` +
        suspicious.map(s => `• ${s}`).join("\n") +
        `\n\nPokud chceš anketu opravit, odpověz na tuto zprávu s opravou do **10 minut**.\n` +
        `Format: Opravená otázka | Možnost A | Možnost B | ...\n\n` +
        `Pokud neodpovíš, použiji původní verzi.`
      );

      // Wait for DM reply (10 min timeout)
      const filter = (m: Message) => m.author.id === message.author.id && m.channel.type === ChannelType.DM;

      try {
        const collected = await (warningMsg.channel as DMChannel).awaitMessages({
          filter,
          max: 1,
          time: 10 * 60 * 1000, // 10 minutes
          errors: ["time"]
        });

        const reply = collected.first();
        if (reply && reply.content.trim().length > 0) {
          finalText = reply.content.trim();
          await message.author.send(`✓ Použiji opravenou verzi.`);
        }
      } catch (timeoutErr) {
        // Timeout - use original
        await message.author.send(`Časový limit vypršel. Použiji původní verzi.`);
      }
    } catch (dmErr) {
      console.error(`[ANKETA] Failed to send DM to ${message.author.tag}:`, dmErr);
      // Continue with original text if DM fails
    }
  }

  // Parse final text
  const finalParts = finalText.split("|").map((p) => p.trim()).filter((p) => p.length > 0);
  const question = finalParts[0];
  const options = finalParts.slice(1);

  // Build poll message
  const displayName = message.member?.displayName || message.author.username;
  let pollText = `Anketa pro @everyone: **${question}**\n_(anketa od ${displayName})_\n\n`;

  for (let i = 0; i < options.length; i++) {
    pollText += `${REGIONAL_INDICATORS[i]}  ${options[i]}\n`;
  }

  pollText += `\n_Hlasuj kliknutim na reakci._`;

  // Send poll message
  const pollMsg = await (message.channel as TextChannel).send(pollText);

  // Add reactions in order
  for (let i = 0; i < options.length; i++) {
    await pollMsg.react(REGIONAL_INDICATORS[i]);
  }

  // Delete original command message
  await message.delete().catch(() => {});

  console.log(
    `[CMD] /anketa by ${displayName}: "${question}" (${options.length} options)`
  );
}

/**
 * Handle /prepis command - join voice channel and start transcription.
 *
 * User must be in a voice channel. Bot joins, starts recording,
 * and transcriptions are routed to the text channel where /prepis was called.
 */
export async function handlePrepis(
  message: Message,
  client: Client
): Promise<void> {
  const member = message.member;

  // Parse subcommand FIRST (before voice check)
  const args = message.content.substring("/prepis".length).trim().toLowerCase();

  // Stop/status commands don't require being in voice
  if (args === "stop" || args === "konec") {
    await handlePrepisStop(message);
    return;
  }

  if (args === "status" || args === "stav") {
    const status = getVoiceStatus();
    if (status.activeSessions.length === 0) {
      await message.reply("Zadny prepis momentalne neprobiha.");
    } else {
      const lines = status.activeSessions.map(
        (s) =>
          `Session ${s.sessionId}: ${s.chunkCount} chunks, ${s.durationSec}s`
      );
      await message.reply(`Aktivni prepisy:\n${lines.join("\n")}`);
    }
    return;
  }

  // For starting recording, user must be in voice
  if (!member?.voice.channel) {
    await message.reply(
      "Musis byt v hlasovem kanalu, abych se mohla pripojit a prepisovat."
    );
    return;
  }

  const voiceChannel = member.voice.channel;
  const voiceChannelId = voiceChannel.id;
  const voiceChannelName = voiceChannel.name;
  const textChannelId = message.channel.id;
  const textChannelName =
    "name" in message.channel ? message.channel.name : "unknown";
  const displayName = member.displayName || message.author.username;

  // Check if already recording in this guild
  const status = getVoiceStatus();
  const guildId = message.guild?.id;
  if (guildId) {
    const existing = status.activeSessions.find((s) => s.guildId === guildId);
    if (existing) {
      await message.reply(
        `Uz nahravam v tomto serveru (session ${existing.sessionId}). ` +
        `Pouzij \`/prepis stop\` pro ukonceni.`
      );
      return;
    }
  }

  // Join voice channel and start recording
  try {
    const info = await joinAndRecord(client, voiceChannelId);
    // Store output channel for live transcription routing
    await getPool().execute(
      "UPDATE voice_sessions SET output_channel_id = ?, requested_by = ? WHERE id = ?",
      [textChannelId, message.author.id, info.sessionId]
    );

    await message.reply(
      `Pripojuji se do **#${voiceChannelName}** a zacinam prepis (session ${info.sessionId}).\n` +
      `Uzivatele v kanalu dostanou DM s zadosti o souhlas s nahravkou.\n` +
      `Pro ukonceni: \`/prepis stop\``
    );

    // Notify Claude about the transcription request
    await insertBotkaMessage({
      source: "system",
      author_id: null,
      author_name: null,
      content:
        `Voice transcription started by ${displayName} in #${voiceChannelName} ` +
        `(session ${info.sessionId}). Output channel: #${textChannelName} (${textChannelId}).`,
    });

    console.log(
      `[CMD] /prepis by ${displayName}: joined #${voiceChannelName}, ` +
      `session ${info.sessionId}, output to #${textChannelName}`
    );
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await message.reply(`Nepodarilo se pripojit: ${errMsg}`);
    console.error(`[CMD] /prepis error:`, errMsg);
  }
}

/**
 * Handle /prepis stop - leave voice channel and stop recording.
 */
async function handlePrepisStop(message: Message): Promise<void> {
  const { leaveAndStop } = await import("./voice.js");
  const guildId = message.guild?.id;

  if (!guildId) {
    await message.reply("Tento prikaz lze pouzit pouze na serveru.");
    return;
  }

  const result = await leaveAndStop(guildId);

  if (result) {
    await message.reply(
      `Prepis ukoncen. Session ${result.sessionId}: ${result.chunks} nahravek, ${result.duration}s.\n` +
      `Transkripce budou k dispozici po zpracovani.`
    );

    // Notify Claude
    await insertBotkaMessage({
      source: "system",
      author_id: null,
      author_name: null,
      content:
        `Voice session ${result.sessionId} ended by /prepis stop. ` +
        `${result.chunks} chunks, ${result.duration}s.`,
    });

    console.log(
      `[CMD] /prepis stop: session ${result.sessionId} ended`
    );
  } else {
    await message.reply("Zadny prepis momentalne neprobiha.");
  }
}

/**
 * Check if a message is a known command and handle it.
 * Returns true if handled (caller should not process further).
 */
export function isCommand(content: string): boolean {
  const lower = content.toLowerCase();
  return lower.startsWith("/anketa") || lower.startsWith("/prepis");
}
