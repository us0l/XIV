const express = require("express");
const app = express();

app.get("/", (req, res) => {
    res.send("I'm alive!");
});

function keepAlive() {
    app.listen(3000, () => {
        console.log("Server is ready! 🚀");
    });
}

module.exports = keepAlive;

const {
    Client,
    GatewayIntentBits,
    EmbedBuilder,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    PermissionFlagsBits,
    ChannelType,
    ActivityType,
    SlashCommandBuilder,
    REST,
    Routes,
} = require("discord.js");

const CONFIG = {
    // Bot Token (get from Discord Developer Portal)
    TOKEN: "MTQwODg5MDg0ODA3NDI2ODcxMw.GHhBVN.yY7DMSEhTbRDZzcrDMsIAkrU8u0g7RotJyCmgk",

    // Your Application ID (from Discord Developer Portal)
    APPLICATION_ID: "1408890848074268713",

    // Your Server ID (right-click server icon → Copy ID with Developer Mode on)
    GUILD_ID: "1408991999733792870",

    // Channel IDs (right-click channel → Copy ID with Developer Mode on)
    WELCOME_CHANNEL_ID: "1410058614495776900",
    TICKET_LOG_CHANNEL_ID: "1408992419831222335",
    TICKET_CATEGORY_ID: "1410059249949868062",
    SUPPORT_ROLE_ID: "1408995067867173025",
    PRESENCE: {
        status: "online",
        activity: {
            name: ".gg/xivmods",
            type: ActivityType.Streaming,
        },
    },

    SERVER_NAME: "XIV Mods",
    SERVER_COLOR: "#5865f2", // Discord blurple
    ACCENT_COLOR: "#00d4aa", // Success green
};

const commands = [
    new SlashCommandBuilder()
        .setName("ticket-setup")
        .setDescription("Setup the ticket system with a professional panel")
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    new SlashCommandBuilder()
        .setName("close-ticket")
        .setDescription("Close the current ticket")
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    new SlashCommandBuilder()
        .setName("giveaway-start")
        .setDescription("Start a new giveaway")
        .addStringOption((option) =>
            option
                .setName("time")
                .setDescription("Duration (e.g., 1h, 30m, 1d)")
                .setRequired(true),
        )
        .addIntegerOption((option) =>
            option
                .setName("winners")
                .setDescription("Number of winners")
                .setRequired(true)
                .setMinValue(1),
        )
        .addStringOption((option) =>
            option
                .setName("prize")
                .setDescription("What are you giving away?")
                .setRequired(true),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    new SlashCommandBuilder()
        .setName("giveaway-end")
        .setDescription("End a giveaway early")
        .addStringOption((option) =>
            option
                .setName("message-id")
                .setDescription("The message ID of the giveaway")
                .setRequired(true),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    new SlashCommandBuilder()
        .setName("giveaway-reroll")
        .setDescription("Reroll winners for a giveaway")
        .addStringOption((option) =>
            option
                .setName("message-id")
                .setDescription("The message ID of the giveaway")
                .setRequired(true),
        )
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

    new SlashCommandBuilder()
        .setName("help")
        .setDescription("Show all available commands"),

    new SlashCommandBuilder()
        .setName("ping")
        .setDescription("Check bot latency and status"),
];

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMessageReactions,
    ],
});

// Data storage (in production, use a database)
const activeTickets = new Map();
const activeGiveaways = new Map();
let ticketCounter = 1;

async function registerCommands() {
    try {
        const rest = new REST({ version: "10" }).setToken(CONFIG.TOKEN);

        console.log("🔄 Started refreshing application (/) commands...");

        // Register commands for your specific guild (faster updates during development)
        await rest.put(
            Routes.applicationGuildCommands(
                CONFIG.APPLICATION_ID,
                CONFIG.GUILD_ID,
            ),
            { body: commands },
        );

        console.log("✅ Successfully reloaded application (/) commands!");
    } catch (error) {
        console.error("❌ Error registering slash commands:", error);
    }
}

client.once("ready", async () => {
    console.log(`🚀 ${client.user.tag} is online and ready!`);
    console.log(`📊 Serving ${client.guilds.cache.size} guilds`);

    // Register slash commands
    await registerCommands();

    // Set bot presence
    client.user.setPresence({
        status: CONFIG.PRESENCE.status,
        activities: [
            {
                name: CONFIG.PRESENCE.activity.name,
                type: CONFIG.PRESENCE.activity.type,
            },
        ],
    });

    console.log(
        `✨ Presence set: ${CONFIG.PRESENCE.activity.type} ${CONFIG.PRESENCE.activity.name}`,
    );
});

client.on("guildMemberAdd", async (member) => {
    const welcomeChannel = client.channels.cache.get(CONFIG.WELCOME_CHANNEL_ID);
    if (!welcomeChannel) return;

    const welcomeEmbed = new EmbedBuilder()
        .setColor(CONFIG.SERVER_COLOR)
        .setTitle(`🎉 Welcome to ${CONFIG.SERVER_NAME}!`)
        .setDescription(
            `Hey ${member}, we're excited to have you here!\n\nMake sure to check out our rules and feel free to introduce yourself.`,
        )
        .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
        .setFooter({
            text: `Member #${member.guild.memberCount}`,
            iconURL: member.guild.iconURL({ dynamic: true }),
        })
        .setTimestamp();

    try {
        await welcomeChannel.send({ embeds: [welcomeEmbed] });
    } catch (error) {
        console.error("Welcome message error:", error);
    }
});

client.on("interactionCreate", async (interaction) => {
    if (interaction.isChatInputCommand()) {
        const { commandName } = interaction;

        if (commandName === "ticket-setup") {
            const setupEmbed = new EmbedBuilder()
                .setColor(CONFIG.SERVER_COLOR)
                .setTitle("🎫 Support Tickets")
                .setDescription(
                    "Need help? Click the button below to create a support ticket!\n\n🔹 Our team will assist you as soon as possible\n🔹 Please be patient and provide detailed information\n🔹 One ticket per user at a time",
                )
                .setFooter({ text: "Support System • Click to create ticket" })
                .setTimestamp();

            const ticketButton = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId("create_ticket")
                    .setLabel("Create Ticket")
                    .setEmoji("🎫")
                    .setStyle(ButtonStyle.Primary),
            );

            await interaction.reply({
                embeds: [setupEmbed],
                components: [ticketButton],
            });
        }

        if (commandName === "close-ticket") {
            const ticketData = [...activeTickets.entries()].find(
                ([userId, ticket]) =>
                    ticket.channelId === interaction.channel.id,
            );
            if (!ticketData) {
                return interaction.reply({
                    content:
                        "❌ This command can only be used in ticket channels.",
                    ephemeral: true,
                });
            }

            const [ticketUserId, ticket] = ticketData;
            const ticketUser = client.users.cache.get(ticketUserId);

            // Create transcript
            const messages = await interaction.channel.messages.fetch({
                limit: 100,
            });
            const transcript = messages
                .reverse()
                .map(
                    (msg) =>
                        `[${new Date(msg.createdTimestamp).toLocaleString()}] ${msg.author.tag}: ${msg.content}`,
                )
                .join("\n");

            const closeEmbed = new EmbedBuilder()
                .setColor("#ff6b6b")
                .setTitle("🔒 Ticket Closed")
                .setDescription(
                    `**Ticket #${String(ticket.ticketNumber).padStart(4, "0")} Closed**\n\n**User:** ${ticketUser?.tag || "Unknown"}\n**Closed by:** ${interaction.user.tag}\n**Duration:** <t:${Math.floor(ticket.createdAt / 1000)}:R>\n**Claimed by:** ${ticket.claimedBy ? `<@${ticket.claimedBy}>` : "Unclaimed"}`,
                )
                .setTimestamp();

            // Log to ticket log channel
            const logChannel = client.channels.cache.get(
                CONFIG.TICKET_LOG_CHANNEL_ID,
            );
            if (logChannel) {
                await logChannel.send({ embeds: [closeEmbed] });

                if (transcript.length > 0) {
                    const transcriptFile = Buffer.from(transcript, "utf-8");
                    await logChannel.send({
                        files: [
                            {
                                attachment: transcriptFile,
                                name: `ticket-${String(ticket.ticketNumber).padStart(4, "0")}-transcript.txt`,
                            },
                        ],
                    });
                }
            }

            await interaction.reply({
                content: "🔒 Ticket will be deleted in 5 seconds...",
            });

            activeTickets.delete(ticketUserId);

            setTimeout(async () => {
                try {
                    await interaction.channel.delete();
                } catch (error) {
                    console.error("Error deleting ticket channel:", error);
                }
            }, 5000);
        }

        if (commandName === "giveaway-start") {
            const time = interaction.options.getString("time");
            const winners = interaction.options.getInteger("winners");
            const prize = interaction.options.getString("prize");

            const timeMs = parseTime(time);
            if (!timeMs) {
                return interaction.reply({
                    content: "❌ Invalid time format. Use: 1m, 1h, 1d, etc.",
                    ephemeral: true,
                });
            }

            const endTime = Date.now() + timeMs;

            const giveawayEmbed = new EmbedBuilder()
                .setColor(CONFIG.ACCENT_COLOR)
                .setTitle("🎉 GIVEAWAY!")
                .setDescription(
                    `**Prize:** ${prize}\n**Winners:** ${winners}\n**Ends:** <t:${Math.floor(endTime / 1000)}:R>\n\nReact with 🎉 to enter!`,
                )
                .setFooter({
                    text: `Hosted by ${interaction.user.tag}`,
                    iconURL: interaction.user.displayAvatarURL(),
                })
                .setTimestamp(endTime);

            const giveawayMsg = await interaction.reply({
                embeds: [giveawayEmbed],
                fetchReply: true,
            });
            await giveawayMsg.react("🎉");

            activeGiveaways.set(giveawayMsg.id, {
                channelId: interaction.channel.id,
                prize,
                winners,
                endTime,
                hostId: interaction.user.id,
            });

            setTimeout(() => endGiveaway(giveawayMsg.id), timeMs);
        }

        if (commandName === "giveaway-end") {
            const messageId = interaction.options.getString("message-id");

            if (!activeGiveaways.has(messageId)) {
                return interaction.reply({
                    content:
                        "❌ No active giveaway found with that message ID.",
                    ephemeral: true,
                });
            }

            await endGiveaway(messageId);
            await interaction.reply({
                content: "✅ Giveaway ended successfully!",
                ephemeral: true,
            });
        }

        if (commandName === "giveaway-reroll") {
            const messageId = interaction.options.getString("message-id");

            await rerollGiveaway(messageId);
            await interaction.reply({
                content: "🎲 Giveaway rerolled!",
                ephemeral: true,
            });
        }

        if (commandName === "help") {
            const helpEmbed = new EmbedBuilder()
                .setColor(CONFIG.SERVER_COLOR)
                .setTitle("🤖 Bot Commands")
                .setDescription("Here are all available slash commands:")
                .addFields(
                    {
                        name: "🎫 Ticket System",
                        value: "`/ticket-setup` - Setup ticket system\n`/close-ticket` - Close current ticket\n**Buttons:** Claim tickets via ticket panel",
                        inline: true,
                    },
                    {
                        name: "🎉 Giveaways",
                        value: "`/giveaway-start` - Start a new giveaway\n`/giveaway-end` - End giveaway early\n`/giveaway-reroll` - Reroll winners",
                        inline: true,
                    },
                    {
                        name: "⚙️ Other",
                        value: "`/help` - Show this menu\n`/ping` - Check bot latency",
                        inline: true,
                    },
                )
                .setFooter({
                    text: "All commands are slash commands! Type / to see them.",
                })
                .setTimestamp();

            await interaction.reply({ embeds: [helpEmbed] });
        }

        if (commandName === "ping") {
            const ping = Date.now() - interaction.createdTimestamp;
            const apiPing = Math.round(client.ws.ping);

            const pingEmbed = new EmbedBuilder()
                .setColor(CONFIG.ACCENT_COLOR)
                .setTitle("🏓 Pong!")
                .setDescription(
                    `**Bot Latency:** ${ping}ms\n**API Latency:** ${apiPing}ms`,
                )
                .setTimestamp();

            await interaction.reply({ embeds: [pingEmbed] });
        }
    }

    if (interaction.isButton()) {
        if (interaction.customId === "create_ticket") {
            // Check if user already has a ticket
            const existingTicket = activeTickets.get(interaction.user.id);
            if (existingTicket) {
                const channel = client.channels.cache.get(
                    existingTicket.channelId,
                );
                if (channel) {
                    return interaction.reply({
                        content: `❌ You already have an open ticket: ${channel}`,
                        ephemeral: true,
                    });
                } else {
                    activeTickets.delete(interaction.user.id);
                }
            }

            const guild = interaction.guild;
            const category = guild.channels.cache.get(
                CONFIG.TICKET_CATEGORY_ID,
            );

            try {
                const ticketChannel = await guild.channels.create({
                    name: `ticket-${String(ticketCounter).padStart(4, "0")}`,
                    type: ChannelType.GuildText,
                    parent: category?.id || null,
                    permissionOverwrites: [
                        {
                            id: guild.id,
                            deny: [PermissionFlagsBits.ViewChannel],
                        },
                        {
                            id: interaction.user.id,
                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.SendMessages,
                                PermissionFlagsBits.ReadMessageHistory,
                            ],
                        },
                        {
                            id: CONFIG.SUPPORT_ROLE_ID,
                            allow: [
                                PermissionFlagsBits.ViewChannel,
                                PermissionFlagsBits.SendMessages,
                                PermissionFlagsBits.ReadMessageHistory,
                            ],
                        },
                    ],
                });

                const ticketEmbed = new EmbedBuilder()
                    .setColor(CONFIG.SERVER_COLOR)
                    .setTitle(
                        `🎫 Ticket #${String(ticketCounter).padStart(4, "0")}`,
                    )
                    .setDescription(
                        `Hello ${interaction.user}!\n\nPlease describe your issue in detail. Our support team will be with you shortly.\n\n**Ticket Information:**\n🔹 Created: <t:${Math.floor(Date.now() / 1000)}:F>\n🔹 Status: Open\n🔹 Assigned: Unassigned`,
                    )
                    .setFooter({
                        text: "Support will respond soon • Please be patient",
                    })
                    .setTimestamp();

                const ticketButtons = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId("claim_ticket")
                        .setLabel("Claim")
                        .setEmoji("✋")
                        .setStyle(ButtonStyle.Secondary),
                    new ButtonBuilder()
                        .setCustomId("close_ticket")
                        .setLabel("Close")
                        .setEmoji("🔒")
                        .setStyle(ButtonStyle.Danger),
                );

                await ticketChannel.send({
                    content: `${interaction.user} <@&${CONFIG.SUPPORT_ROLE_ID}>`,
                    embeds: [ticketEmbed],
                    components: [ticketButtons],
                });

                activeTickets.set(interaction.user.id, {
                    channelId: ticketChannel.id,
                    ticketNumber: ticketCounter,
                    createdAt: Date.now(),
                    claimedBy: null,
                });

                ticketCounter++;

                await interaction.reply({
                    content: `✅ Ticket created! ${ticketChannel}`,
                    ephemeral: true,
                });
            } catch (error) {
                console.error("Ticket creation error:", error);
                await interaction.reply({
                    content:
                        "❌ Failed to create ticket. Please try again later.",
                    ephemeral: true,
                });
            }
        }

        if (interaction.customId === "claim_ticket") {
            const member = interaction.member;
            if (
                !member.roles.cache.has(CONFIG.SUPPORT_ROLE_ID) &&
                !member.permissions.has(PermissionFlagsBits.Administrator)
            ) {
                return interaction.reply({
                    content: "❌ Only support staff can claim tickets.",
                    ephemeral: true,
                });
            }

            const ticketData = [...activeTickets.values()].find(
                (ticket) => ticket.channelId === interaction.channel.id,
            );
            if (!ticketData) {
                return interaction.reply({
                    content: "❌ This is not a valid ticket channel.",
                    ephemeral: true,
                });
            }

            if (ticketData.claimedBy) {
                return interaction.reply({
                    content: "❌ This ticket has already been claimed.",
                    ephemeral: true,
                });
            }

            ticketData.claimedBy = interaction.user.id;

            const claimEmbed = new EmbedBuilder()
                .setColor(CONFIG.ACCENT_COLOR)
                .setDescription(
                    `🎫 **Ticket Claimed**\n${interaction.user} has claimed this ticket and will assist you.`,
                )
                .setTimestamp();

            await interaction.reply({ embeds: [claimEmbed] });
        }

        if (interaction.customId === "close_ticket") {
            const ticketData = [...activeTickets.entries()].find(
                ([userId, ticket]) =>
                    ticket.channelId === interaction.channel.id,
            );
            if (!ticketData) {
                return interaction.reply({
                    content: "❌ This is not a valid ticket channel.",
                    ephemeral: true,
                });
            }

            const [ticketUserId, ticket] = ticketData;
            const ticketUser = client.users.cache.get(ticketUserId);

            // Create transcript
            const messages = await interaction.channel.messages.fetch({
                limit: 100,
            });
            const transcript = messages
                .reverse()
                .map(
                    (msg) =>
                        `[${new Date(msg.createdTimestamp).toLocaleString()}] ${msg.author.tag}: ${msg.content}`,
                )
                .join("\n");

            const closeEmbed = new EmbedBuilder()
                .setColor("#ff6b6b")
                .setTitle("🔒 Ticket Closed")
                .setDescription(
                    `**Ticket #${String(ticket.ticketNumber).padStart(4, "0")} Closed**\n\n**User:** ${ticketUser?.tag || "Unknown"}\n**Closed by:** ${interaction.user.tag}\n**Duration:** <t:${Math.floor(ticket.createdAt / 1000)}:R>\n**Claimed by:** ${ticket.claimedBy ? `<@${ticket.claimedBy}>` : "Unclaimed"}`,
                )
                .setTimestamp();

            // Log to ticket log channel
            const logChannel = client.channels.cache.get(
                CONFIG.TICKET_LOG_CHANNEL_ID,
            );
            if (logChannel) {
                await logChannel.send({ embeds: [closeEmbed] });

                if (transcript.length > 0) {
                    const transcriptFile = Buffer.from(transcript, "utf-8");
                    await logChannel.send({
                        files: [
                            {
                                attachment: transcriptFile,
                                name: `ticket-${String(ticket.ticketNumber).padStart(4, "0")}-transcript.txt`,
                            },
                        ],
                    });
                }
            }

            await interaction.reply({
                content: "🔒 Ticket will be deleted in 5 seconds...",
                ephemeral: true,
            });

            activeTickets.delete(ticketUserId);

            setTimeout(async () => {
                try {
                    await interaction.channel.delete();
                } catch (error) {
                    console.error("Error deleting ticket channel:", error);
                }
            }, 5000);
        }
    }
});

function parseTime(timeStr) {
    const time = parseInt(timeStr);
    const unit = timeStr.slice(-1).toLowerCase();

    const multipliers = {
        s: 1000,
        m: 60000,
        h: 3600000,
        d: 86400000,
        w: 604800000,
    };

    return multipliers[unit] ? time * multipliers[unit] : null;
}

async function endGiveaway(messageId) {
    const giveawayData = activeGiveaways.get(messageId);
    if (!giveawayData) return;

    try {
        const channel = client.channels.cache.get(giveawayData.channelId);
        const message = await channel.messages.fetch(messageId);

        const reaction = message.reactions.cache.get("🎉");
        if (!reaction) return;

        const users = await reaction.users.fetch();
        const participants = users.filter((user) => !user.bot);

        if (participants.size === 0) {
            const noWinnersEmbed = new EmbedBuilder()
                .setColor("#ff6b6b")
                .setTitle("🎉 Giveaway Ended!")
                .setDescription(
                    `**Prize:** ${giveawayData.prize}\n**Winners:** No valid entries`,
                )
                .setTimestamp();

            await channel.send({ embeds: [noWinnersEmbed] });
            activeGiveaways.delete(messageId);
            return;
        }

        const winnersArray = participants.random(
            Math.min(giveawayData.winners, participants.size),
        );
        const winners = Array.isArray(winnersArray)
            ? winnersArray
            : [winnersArray];

        const winnerEmbed = new EmbedBuilder()
            .setColor(CONFIG.ACCENT_COLOR)
            .setTitle("🎉 Giveaway Ended!")
            .setDescription(
                `**Prize:** ${giveawayData.prize}\n**Winners:** ${winners.map((w) => `<@${w.id}>`).join(", ")}\n\nCongratulations! 🎊`,
            )
            .setTimestamp();

        await channel.send({
            content: `🎉 **GIVEAWAY ENDED** 🎉\n${winners.map((w) => `<@${w.id}>`).join(" ")}`,
            embeds: [winnerEmbed],
        });

        // Update original message
        const endedEmbed = new EmbedBuilder()
            .setColor("#95a5a6")
            .setTitle("🎉 GIVEAWAY ENDED!")
            .setDescription(
                `**Prize:** ${giveawayData.prize}\n**Winners:** ${winners.map((w) => `<@${w.id}>`).join(", ")}\n\n*This giveaway has ended*`,
            )
            .setFooter({
                text: `Hosted by ${client.users.cache.get(giveawayData.hostId)?.tag || "Unknown"}`,
            })
            .setTimestamp();

        await message.edit({ embeds: [endedEmbed] });
    } catch (error) {
        console.error("Giveaway end error:", error);
    }

    activeGiveaways.delete(messageId);
}

async function rerollGiveaway(messageId) {
    try {
        // Find the message in any channel
        let targetMessage = null;
        let targetChannel = null;

        for (const channel of client.channels.cache.values()) {
            if (channel.type === ChannelType.GuildText) {
                try {
                    targetMessage = await channel.messages.fetch(messageId);
                    targetChannel = channel;
                    break;
                } catch (error) {
                    continue;
                }
            }
        }

        if (!targetMessage) {
            return;
        }

        const reaction = targetMessage.reactions.cache.get("🎉");
        if (!reaction) return;

        const users = await reaction.users.fetch();
        const participants = users.filter((user) => !user.bot);

        if (participants.size === 0) {
            const noWinnersEmbed = new EmbedBuilder()
                .setColor("#ff6b6b")
                .setTitle("❌ Reroll Failed")
                .setDescription(
                    "No valid participants found for this giveaway.",
                )
                .setTimestamp();

            await targetChannel.send({ embeds: [noWinnersEmbed] });
            return;
        }

        const newWinner = participants.random();

        const rerollEmbed = new EmbedBuilder()
            .setColor(CONFIG.ACCENT_COLOR)
            .setTitle("🎲 Giveaway Rerolled!")
            .setDescription(
                `**New Winner:** <@${newWinner.id}>\n\nCongratulations! 🎊`,
            )
            .setTimestamp();

        await targetChannel.send({
            content: `🎲 **REROLL** 🎲\n<@${newWinner.id}>`,
            embeds: [rerollEmbed],
        });
    } catch (error) {
        console.error("Giveaway reroll error:", error);
    }
}

client.on("error", (error) => {
    console.error("Discord client error:", error);
});

process.on("unhandledRejection", (error) => {
    console.error("Unhandled promise rejection:", error);
});

client.login(CONFIG.TOKEN).catch((error) => {
    console.error("Failed to login:", error);
    console.log(
        "Make sure you have set your bot token and application ID in the CONFIG section!",
    );
});
