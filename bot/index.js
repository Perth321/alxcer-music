const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require("discord.js");

const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
  StreamType,
} = require("@discordjs/voice");

const ytdlp = require("yt-dlp-exec");
const { Readable } = require("stream");

const TOKEN = process.env.DISCORD_TOKEN;
const PREFIX = process.env.PREFIX || "!";

if (!TOKEN) {
  console.error("❌ DISCORD_TOKEN is not set. Please set it as a GitHub Secret.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const queues = new Map();

function getQueue(guildId) {
  if (!queues.has(guildId)) {
    queues.set(guildId, {
      tracks: [],
      player: null,
      connection: null,
      current: null,
      volume: 1.0,
      loop: false,
    });
  }
  return queues.get(guildId);
}

async function getTrackInfo(url) {
  try {
    const isUrl = url.startsWith("http://") || url.startsWith("https://");
    const searchQuery = isUrl ? url : `ytsearch1:${url}`;

    const info = await ytdlp(searchQuery, {
      dumpSingleJson: true,
      noWarnings: true,
      noCallHome: true,
      noCheckCertificate: true,
      preferFreeFormats: true,
      youtubeSkipDashManifest: true,
    });

    const track = info.entries ? info.entries[0] : info;
    return {
      title: track.title,
      url: track.webpage_url || track.url,
      duration: track.duration,
      thumbnail: track.thumbnail,
      uploader: track.uploader || "Unknown",
    };
  } catch (err) {
    console.error("Error fetching track info:", err.message);
    return null;
  }
}

async function createStream(url) {
  const process = ytdlp.raw(url, {
    output: "-",
    format: "bestaudio[ext=webm]/bestaudio/best",
    noWarnings: true,
    noCheckCertificate: true,
    preferFreeFormats: true,
    limitRate: "100K",
  });
  return process.stdout;
}

async function playNext(guildId, textChannel) {
  const queue = getQueue(guildId);

  if (queue.loop && queue.current) {
    queue.tracks.unshift(queue.current);
  }

  if (queue.tracks.length === 0) {
    queue.current = null;
    if (textChannel) {
      textChannel.send("⏹️ คิวเพลงหมดแล้ว!");
    }
    return;
  }

  const track = queue.tracks.shift();
  queue.current = track;

  try {
    const stream = await createStream(track.url);
    const resource = createAudioResource(stream, {
      inputType: StreamType.WebmOpus,
      inlineVolume: true,
    });

    if (resource.volume) {
      resource.volume.setVolume(queue.volume);
    }

    queue.player.play(resource);

    if (textChannel) {
      const embed = new EmbedBuilder()
        .setColor(0x9b59b6)
        .setTitle("🎵 กำลังเล่น")
        .setDescription(`**[${track.title}](${track.url})**`)
        .addFields(
          {
            name: "⏱ ความยาว",
            value: formatDuration(track.duration),
            inline: true,
          },
          { name: "🎤 ศิลปิน", value: track.uploader, inline: true },
          {
            name: "📋 เหลือในคิว",
            value: `${queue.tracks.length} เพลง`,
            inline: true,
          }
        )
        .setThumbnail(track.thumbnail)
        .setFooter({ text: "Alxcer Music Bot" })
        .setTimestamp();

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId("pause")
          .setLabel("⏸ Pause")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId("skip")
          .setLabel("⏭ Skip")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId("stop")
          .setLabel("⏹ Stop")
          .setStyle(ButtonStyle.Danger),
        new ButtonBuilder()
          .setCustomId("queue")
          .setLabel("📋 Queue")
          .setStyle(ButtonStyle.Secondary)
      );

      textChannel.send({ embeds: [embed], components: [row] });
    }
  } catch (err) {
    console.error("Error playing track:", err.message);
    if (textChannel) {
      textChannel.send(`❌ เล่นเพลง **${track.title}** ไม่ได้: ${err.message}`);
    }
    playNext(guildId, textChannel);
  }
}

function formatDuration(seconds) {
  if (!seconds) return "Live";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

client.once("ready", () => {
  console.log(`✅ Alxcer Music Bot พร้อมใช้งานแล้ว! เข้าสู่ระบบในฐานะ ${client.user.tag}`);
  client.user.setActivity("🎵 เพลงเพราะ | !help", { type: 3 });
});

client.on("messageCreate", async (message) => {
  if (!message.content.startsWith(PREFIX) || message.author.bot) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === "help") {
    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle("🎵 Alxcer Music Bot - คำสั่งทั้งหมด")
      .setDescription("Prefix: `!`")
      .addFields(
        { name: "`!play <ลิงค์/ชื่อเพลง>`", value: "เล่นเพลงจาก YouTube หรือค้นหาเพลง", inline: false },
        { name: "`!skip`", value: "ข้ามเพลงปัจจุบัน", inline: true },
        { name: "`!stop`", value: "หยุดเล่นและออกจาก Voice", inline: true },
        { name: "`!pause`", value: "หยุดชั่วคราว", inline: true },
        { name: "`!resume`", value: "เล่นต่อ", inline: true },
        { name: "`!queue`", value: "แสดงคิวเพลง", inline: true },
        { name: "`!loop`", value: "เปิด/ปิด วนซ้ำ", inline: true },
        { name: "`!volume <0-100>`", value: "ปรับระดับเสียง", inline: true },
        { name: "`!nowplaying`", value: "ดูเพลงที่กำลังเล่น", inline: true },
        { name: "`!clear`", value: "ล้างคิวเพลงทั้งหมด", inline: true }
      )
      .setFooter({ text: "Alxcer Music Bot | รองรับ YouTube URLs และการค้นหา" })
      .setTimestamp();
    return message.reply({ embeds: [embed] });
  }

  if (command === "play" || command === "p") {
    if (!args.length) {
      return message.reply("❌ กรุณาใส่ลิงค์หรือชื่อเพลง เช่น `!play https://youtube.com/watch?v=...`");
    }

    const voiceChannel = message.member?.voice?.channel;
    if (!voiceChannel) {
      return message.reply("❌ คุณต้องอยู่ใน Voice Channel ก่อนนะ!");
    }

    const permissions = voiceChannel.permissionsFor(message.client.user);
    if (!permissions.has("Connect") || !permissions.has("Speak")) {
      return message.reply("❌ บอทไม่มีสิทธิ์เข้า Voice Channel นี้");
    }

    const query = args.join(" ");
    const loadingMsg = await message.reply("🔍 กำลังค้นหาเพลง...");

    const track = await getTrackInfo(query);
    if (!track) {
      return loadingMsg.edit("❌ หาเพลงไม่เจอ ลองใหม่อีกครั้งนะ");
    }

    const queue = getQueue(message.guild.id);

    if (!queue.connection) {
      const connection = joinVoiceChannel({
        channelId: voiceChannel.id,
        guildId: message.guild.id,
        adapterCreator: message.guild.voiceAdapterCreator,
        selfDeaf: true,
      });

      connection.on(VoiceConnectionStatus.Disconnected, async () => {
        try {
          await Promise.race([
            entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
            entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
          ]);
        } catch {
          connection.destroy();
          queues.delete(message.guild.id);
        }
      });

      const player = createAudioPlayer();
      connection.subscribe(player);

      player.on(AudioPlayerStatus.Idle, () => {
        playNext(message.guild.id, message.channel);
      });

      player.on("error", (err) => {
        console.error("Player error:", err.message);
        playNext(message.guild.id, message.channel);
      });

      queue.connection = connection;
      queue.player = player;
    }

    queue.tracks.push(track);

    if (queue.current) {
      await loadingMsg.edit({
        content: null,
        embeds: [
          new EmbedBuilder()
            .setColor(0x3498db)
            .setTitle("✅ เพิ่มเพลงเข้าคิวแล้ว")
            .setDescription(`**[${track.title}](${track.url})**`)
            .addFields(
              { name: "⏱ ความยาว", value: formatDuration(track.duration), inline: true },
              { name: "📋 ตำแหน่งในคิว", value: `#${queue.tracks.length}`, inline: true }
            )
            .setThumbnail(track.thumbnail)
            .setFooter({ text: "Alxcer Music Bot" }),
        ],
      });
    } else {
      await loadingMsg.delete().catch(() => {});
      playNext(message.guild.id, message.channel);
    }
  }

  if (command === "skip" || command === "s") {
    const queue = getQueue(message.guild.id);
    if (!queue.player) return message.reply("❌ ไม่มีเพลงกำลังเล่นอยู่");
    queue.player.stop();
    message.reply("⏭️ ข้ามเพลงแล้ว!");
  }

  if (command === "stop") {
    const queue = getQueue(message.guild.id);
    if (!queue.connection) return message.reply("❌ บอทไม่ได้อยู่ใน Voice Channel");
    queue.tracks = [];
    queue.current = null;
    queue.loop = false;
    queue.connection.destroy();
    queues.delete(message.guild.id);
    message.reply("⏹️ หยุดเล่นเพลงและออกจาก Voice Channel แล้ว!");
  }

  if (command === "pause") {
    const queue = getQueue(message.guild.id);
    if (!queue.player) return message.reply("❌ ไม่มีเพลงกำลังเล่นอยู่");
    if (queue.player.state.status === AudioPlayerStatus.Paused) {
      return message.reply("❌ เพลงหยุดอยู่แล้ว ใช้ `!resume` เพื่อเล่นต่อ");
    }
    queue.player.pause();
    message.reply("⏸️ หยุดชั่วคราวแล้ว! ใช้ `!resume` เพื่อเล่นต่อ");
  }

  if (command === "resume" || command === "r") {
    const queue = getQueue(message.guild.id);
    if (!queue.player) return message.reply("❌ ไม่มีเพลงกำลังเล่นอยู่");
    if (queue.player.state.status !== AudioPlayerStatus.Paused) {
      return message.reply("❌ เพลงกำลังเล่นอยู่แล้ว!");
    }
    queue.player.unpause();
    message.reply("▶️ เล่นต่อแล้ว!");
  }

  if (command === "queue" || command === "q") {
    const queue = getQueue(message.guild.id);
    if (!queue.current && queue.tracks.length === 0) {
      return message.reply("📭 ไม่มีเพลงในคิว");
    }

    const trackList = queue.tracks
      .slice(0, 10)
      .map((t, i) => `**${i + 1}.** [${t.title}](${t.url}) — ${formatDuration(t.duration)}`)
      .join("\n");

    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle("📋 คิวเพลง")
      .addFields(
        {
          name: "🎵 กำลังเล่น",
          value: queue.current
            ? `[${queue.current.title}](${queue.current.url})`
            : "ไม่มี",
        },
        {
          name: `📝 รอเล่น (${queue.tracks.length} เพลง)`,
          value: trackList || "ไม่มีเพลงในคิว",
        }
      )
      .setFooter({
        text: `Loop: ${queue.loop ? "🔁 เปิด" : "❌ ปิด"} | Alxcer Music Bot`,
      });

    message.reply({ embeds: [embed] });
  }

  if (command === "nowplaying" || command === "np") {
    const queue = getQueue(message.guild.id);
    if (!queue.current) return message.reply("❌ ไม่มีเพลงกำลังเล่นอยู่");

    const embed = new EmbedBuilder()
      .setColor(0x9b59b6)
      .setTitle("🎵 กำลังเล่น")
      .setDescription(`**[${queue.current.title}](${queue.current.url})**`)
      .addFields(
        { name: "⏱ ความยาว", value: formatDuration(queue.current.duration), inline: true },
        { name: "🎤 ศิลปิน", value: queue.current.uploader, inline: true },
        { name: "🔁 Loop", value: queue.loop ? "เปิด" : "ปิด", inline: true }
      )
      .setThumbnail(queue.current.thumbnail)
      .setFooter({ text: "Alxcer Music Bot" })
      .setTimestamp();

    message.reply({ embeds: [embed] });
  }

  if (command === "loop" || command === "l") {
    const queue = getQueue(message.guild.id);
    queue.loop = !queue.loop;
    message.reply(`🔁 Loop ${queue.loop ? "**เปิด**" : "**ปิด**"} แล้ว!`);
  }

  if (command === "volume" || command === "vol") {
    const queue = getQueue(message.guild.id);
    const vol = parseInt(args[0]);
    if (isNaN(vol) || vol < 0 || vol > 100) {
      return message.reply("❌ ใส่ระดับเสียง 0-100 นะ เช่น `!volume 50`");
    }
    queue.volume = vol / 100;
    if (
      queue.player?.state?.status === AudioPlayerStatus.Playing &&
      queue.player.state.resource?.volume
    ) {
      queue.player.state.resource.volume.setVolume(queue.volume);
    }
    message.reply(`🔊 ระดับเสียงเป็น **${vol}%** แล้ว!`);
  }

  if (command === "clear") {
    const queue = getQueue(message.guild.id);
    queue.tracks = [];
    message.reply("🗑️ ล้างคิวเพลงทั้งหมดแล้ว!");
  }
});

client.on("interactionCreate", async (interaction) => {
  if (!interaction.isButton()) return;

  const queue = getQueue(interaction.guild.id);

  if (interaction.customId === "pause") {
    if (!queue.player) return interaction.reply({ content: "❌ ไม่มีเพลงเล่นอยู่", ephemeral: true });
    if (queue.player.state.status === AudioPlayerStatus.Paused) {
      queue.player.unpause();
      interaction.reply({ content: "▶️ เล่นต่อแล้ว!", ephemeral: true });
    } else {
      queue.player.pause();
      interaction.reply({ content: "⏸️ หยุดชั่วคราวแล้ว!", ephemeral: true });
    }
  }

  if (interaction.customId === "skip") {
    if (!queue.player) return interaction.reply({ content: "❌ ไม่มีเพลงเล่นอยู่", ephemeral: true });
    queue.player.stop();
    interaction.reply({ content: "⏭️ ข้ามเพลงแล้ว!", ephemeral: true });
  }

  if (interaction.customId === "stop") {
    if (!queue.connection) return interaction.reply({ content: "❌ บอทไม่ได้อยู่ใน Voice", ephemeral: true });
    queue.tracks = [];
    queue.current = null;
    queue.connection.destroy();
    queues.delete(interaction.guild.id);
    interaction.reply({ content: "⏹️ หยุดและออกจาก Voice แล้ว!", ephemeral: true });
  }

  if (interaction.customId === "queue") {
    const trackList = queue.tracks
      .slice(0, 5)
      .map((t, i) => `**${i + 1}.** ${t.title}`)
      .join("\n") || "ไม่มีเพลงในคิว";

    interaction.reply({
      content: `🎵 **กำลังเล่น:** ${queue.current?.title || "ไม่มี"}\n📋 **คิว:**\n${trackList}`,
      ephemeral: true,
    });
  }
});

client.login(TOKEN);
