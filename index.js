require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionsBitField,
  Events,
  SlashCommandBuilder,
  REST,
  Routes,
} = require('discord.js');

/**
 * Discord Ticket Bot (discord.js v14)
 *
 * What it does:
 * - /panel sends an embed with a dropdown called "Open a Ticket"
 * - User picks one of these ticket types:
 *   Support Tickets
 *   External Affairs
 *   Internal Affairs
 *   Management Tickets
 *   Directive Tickets
 *   Ownership
 * - Bot creates a private ticket channel for the user
 * - Adds a close button inside the ticket
 *
 * Setup:
 * 1) npm init -y
 * 2) npm i discord.js dotenv
 * 3) Create a .env file using the example at the bottom of this file
 * 4) Invite the bot with these permissions:
 *    - View Channels
 *    - Send Messages
 *    - Embed Links
 *    - Manage Channels
 *    - Manage Roles
 *    - Read Message History
 *    - Use Slash Commands
 * 5) Run: node index.js
 *
 * Notes:
 * - TICKETS_CATEGORY_ID is optional but recommended.
 * - STAFF_ROLE_ID is optional. If you set it, staff can see every ticket.
 * - You can also assign different roles per ticket type in the TICKET_ROLE_MAP below.
 */

const requiredEnv = ['DISCORD_TOKEN', 'CLIENT_ID', 'GUILD_ID'];
for (const key of requiredEnv) {
  if (!process.env[key]) {
    console.error(`Missing environment variable: ${key}`);
    process.exit(1);
  }
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel],
});

const TICKET_TYPES = [
  {
    value: 'support_tickets',
    label: 'Support Tickets',
    description: 'Get help from the support team.',
    emoji: '🎫',
  },
  {
    value: 'external_affairs',
    label: 'External Affairs',
    description: 'Open an external affairs ticket.',
    emoji: '🌐',
  },
  {
    value: 'internal_affairs',
    label: 'Internal Affairs',
    description: 'Open an internal affairs ticket.',
    emoji: '🗂️',
  },
  {
    value: 'management_tickets',
    label: 'Management Tickets',
    description: 'Contact management privately.',
    emoji: '📌',
  },
  {
    value: 'directive_tickets',
    label: 'Directive Tickets',
    description: 'Open a directive-related ticket.',
    emoji: '📋',
  },
  {
    value: 'ownership',
    label: 'Ownership',
    description: 'Contact ownership privately.',
    emoji: '👑',
  },
];

// Optional: assign a different role to each ticket type.
// Put real role IDs in your .env if you want these roles added automatically.
const TICKET_ROLE_MAP = {
  support_tickets: process.env.SUPPORT_ROLE_ID || null,
  external_affairs: process.env.EXTERNAL_AFFAIRS_ROLE_ID || null,
  internal_affairs: process.env.INTERNAL_AFFAIRS_ROLE_ID || null,
  management_tickets: process.env.MANAGEMENT_ROLE_ID || null,
  directive_tickets: process.env.DIRECTIVE_ROLE_ID || null,
  ownership: process.env.OWNERSHIP_ROLE_ID || null,
};

function prettyTicketName(value) {
  return TICKET_TYPES.find((t) => t.value === value)?.label || 'Ticket';
}

function sanitizeChannelName(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 70);
}

function buildPanelEmbed() {
  return new EmbedBuilder()
    .setColor(0x8ed8ff)
    .setTitle('SERVICES')
    .setDescription(
      [
        '**Welcome to the ticket panel.**',
        'Use the dropdown below to open the correct ticket type.',
        '',
        'Please select one of the available options and the bot will create a private ticket channel for you.',
      ].join('\n')
    )
    .setFooter({ text: 'Open a Ticket • Ticket System' })
    .setTimestamp();
}

function buildTicketMenu() {
  const menu = new StringSelectMenuBuilder()
    .setCustomId('ticket_create_menu')
    .setPlaceholder('Open a Ticket')
    .addOptions(
      TICKET_TYPES.map((ticket) =>
        new StringSelectMenuOptionBuilder()
          .setLabel(ticket.label)
          .setValue(ticket.value)
          .setDescription(ticket.description)
          .setEmoji(ticket.emoji)
      )
    );

  return new ActionRowBuilder().addComponents(menu);
}

function buildCloseButtonRow() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('ticket_close')
      .setLabel('Close Ticket')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔒')
  );
}

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName('panel')
      .setDescription('Send the ticket panel embed.'),
  ].map((cmd) => cmd.toJSON());

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  await rest.put(
    Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
    { body: commands }
  );
}

async function findExistingTicket(guild, userId, ticketType) {
  const expectedTopic = `ticket_owner:${userId};type:${ticketType}`;
  return guild.channels.cache.find(
    (channel) =>
      channel.type === ChannelType.GuildText &&
      channel.topic === expectedTopic
  );
}

async function createTicketChannel(interaction, ticketType) {
  const guild = interaction.guild;
  const member = interaction.member;
  const user = interaction.user;
  const ticketName = prettyTicketName(ticketType);

  const existing = await findExistingTicket(guild, user.id, ticketType);
  if (existing) {
    await interaction.reply({
      content: `You already have an open **${ticketName}** ticket: ${existing}`,
      ephemeral: true,
    });
    return;
  }

  const channelName = sanitizeChannelName(`${ticketType}-${user.username}`);
  const staffRoleId = process.env.STAFF_ROLE_ID || null;
  const typeRoleId = TICKET_ROLE_MAP[ticketType] || null;

  const permissionOverwrites = [
    {
      id: guild.roles.everyone.id,
      deny: [PermissionsBitField.Flags.ViewChannel],
    },
    {
      id: user.id,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.AttachFiles,
        PermissionsBitField.Flags.EmbedLinks,
      ],
    },
  ];

  if (staffRoleId) {
    permissionOverwrites.push({
      id: staffRoleId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.ManageMessages,
      ],
    });
  }

  if (typeRoleId && typeRoleId !== staffRoleId) {
    permissionOverwrites.push({
      id: typeRoleId,
      allow: [
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ReadMessageHistory,
      ],
    });
  }

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: process.env.TICKETS_CATEGORY_ID || null,
    topic: `ticket_owner:${user.id};type:${ticketType}`,
    permissionOverwrites,
  });

  const embed = new EmbedBuilder()
    .setColor(0x8ed8ff)
    .setTitle(`${ticketName}`)
    .setDescription(
      [
        `${member}, your ticket has been created.`,
        '',
        `**Type:** ${ticketName}`,
        `**Opened by:** ${user.tag}`,
        '',
        'Please explain your issue and wait for a staff member to respond.',
      ].join('\n')
    )
    .setTimestamp();

  await channel.send({
    content: [member.toString(), staffRoleId ? `<@&${staffRoleId}>` : null, typeRoleId ? `<@&${typeRoleId}>` : null]
      .filter(Boolean)
      .join(' '),
    embeds: [embed],
    components: [buildCloseButtonRow()],
  });

  await interaction.reply({
    content: `Your **${ticketName}** ticket has been opened: ${channel}`,
    ephemeral: true,
  });
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
  try {
    await registerCommands();
    console.log('Slash command registered: /panel');
  } catch (error) {
    console.error('Failed to register slash command:', error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'panel') {
        await interaction.reply({
          embeds: [buildPanelEmbed()],
          components: [buildTicketMenu()],
        });
      }
      return;
    }

    if (interaction.isStringSelectMenu()) {
      if (interaction.customId !== 'ticket_create_menu') return;

      const selectedType = interaction.values[0];
      if (!TICKET_TYPES.some((t) => t.value === selectedType)) {
        await interaction.reply({
          content: 'That ticket type is not valid.',
          ephemeral: true,
        });
        return;
      }

      await createTicketChannel(interaction, selectedType);
      return;
    }

    if (interaction.isButton()) {
      if (interaction.customId !== 'ticket_close') return;

      const channel = interaction.channel;
      const topic = channel?.topic || '';
      const ownerMatch = topic.match(/ticket_owner:(\d+)/);
      const ownerId = ownerMatch?.[1];

      const canClose =
        interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageChannels) ||
        interaction.user.id === ownerId;

      if (!canClose) {
        await interaction.reply({
          content: 'You do not have permission to close this ticket.',
          ephemeral: true,
        });
        return;
      }

      await interaction.reply({
        content: 'Closing this ticket in 3 seconds...',
      });

      setTimeout(async () => {
        try {
          await channel.delete('Ticket closed');
        } catch (error) {
          console.error('Failed to delete ticket channel:', error);
        }
      }, 3000);
    }
  } catch (error) {
    console.error('Interaction error:', error);

    if (interaction.deferred || interaction.replied) {
      await interaction.followUp({
        content: 'Something went wrong while handling that interaction.',
        ephemeral: true,
      }).catch(() => null);
    } else {
      await interaction.reply({
        content: 'Something went wrong while handling that interaction.',
        ephemeral: true,
      }).catch(() => null);
    }
  }
});

client.login(process.env.DISCORD_TOKEN);

/**
 * Example .env
 *
 * DISCORD_TOKEN=your_bot_token_here
 * CLIENT_ID=your_application_client_id
 * GUILD_ID=your_server_id
 * TICKETS_CATEGORY_ID=optional_category_id_for_ticket_channels
 * STAFF_ROLE_ID=optional_role_id_that_can_see_all_tickets
 * SUPPORT_ROLE_ID=
 * EXTERNAL_AFFAIRS_ROLE_ID=
 * INTERNAL_AFFAIRS_ROLE_ID=
 * MANAGEMENT_ROLE_ID=
 * DIRECTIVE_ROLE_ID=
 * OWNERSHIP_ROLE_ID=
 */
