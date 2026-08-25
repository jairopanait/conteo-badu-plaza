require('dotenv').config();

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  ModalBuilder,
  SlashCommandBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
const { DateTime } = require('luxon');
const { ITEMS, ITEM_BY_ID } = require('./items');

const REQUIRED_ENV = [
  'DISCORD_TOKEN',
  'DISCORD_APPLICATION_ID',
  'DISCORD_GUILD_ID',
  'PANEL_CHANNEL_ID',
  'SALES_CHANNEL_ID',
  'AUTHORIZED_ROLE_ID',
  'SUPABASE_URL',
  'SUPABASE_SERVICE_ROLE_KEY'
];

for (const name of REQUIRED_ENV) {
  if (!process.env[name]) throw new Error(`Falta la variable de entorno ${name}`);
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const PANEL_CHANNEL_ID = '1541797314581241916';
const PREVIOUS_PANEL_CHANNEL_ID = '1541196954837581946';
const SUMMARY_ROLE_ID = process.env.SUMMARY_ROLE_ID || '1541197720197406760';
const TIMEZONE = process.env.TIMEZONE || 'Europe/Madrid';
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } }
);

const money = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0
});

function panelPayload() {
  const itemRows = [];
  for (let index = 0; index < ITEMS.length; index += 5) {
    itemRows.push(new ActionRowBuilder().addComponents(
      ITEMS.slice(index, index + 5).map((item) =>
        new ButtonBuilder()
          .setCustomId(`sale:item:${item.id}`)
          .setLabel(item.name)
          .setStyle(ButtonStyle.Primary)
      )
    ));
  }
  return {
    content: '**Categoría: Ventas**\nSelecciona el artículo vendido:',
    embeds: [],
    components: itemRows
  };
}

function isSalesPanelMessage(message) {
  if (message.author.id !== client.user.id) return false;
  const isOldPanel = message.embeds.some(
    (embed) => embed.footer?.text === 'CONTEO_BADU_PLAZA_PANEL_V1'
  );
  const isButtonPanel = message.components.some((row) =>
    row.components.some((component) =>
      component.customId?.startsWith('sale:page:') ||
      component.customId?.startsWith('sale:item:')
    )
  );
  return isOldPanel || isButtonPanel;
}

async function ensurePanel() {
  const channel = await client.channels.fetch(PANEL_CHANNEL_ID);
  if (!channel?.isTextBased()) throw new Error('El canal de pantalla no es un canal de texto');

  const recent = await channel.messages.fetch({ limit: 100 });
  const existing = recent.find(isSalesPanelMessage);

  const payload = panelPayload();
  if (existing) await existing.edit(payload);
  else await channel.send(payload);
}

async function removePreviousPanel() {
  if (PREVIOUS_PANEL_CHANNEL_ID === PANEL_CHANNEL_ID) return;
  const channel = await client.channels.fetch(PREVIOUS_PANEL_CHANNEL_ID).catch(() => null);
  if (!channel?.isTextBased()) return;
  const recent = await channel.messages.fetch({ limit: 100 });
  const panels = recent.filter(isSalesPanelMessage);
  await Promise.all(panels.map((message) => message.delete()));
}

function hasAuthorizedRole(interaction) {
  return interaction.inGuild() && interaction.member.roles.cache.has(process.env.AUTHORIZED_ROLE_ID);
}

function hasSummaryRole(interaction) {
  return interaction.inGuild() && interaction.member.roles.cache.has(SUMMARY_ROLE_ID);
}

const summaryCommand = new SlashCommandBuilder()
  .setName('resumen')
  .setDescription('Consulta el resumen de ventas de una persona')
  .addStringOption((option) =>
    option
      .setName('periodo')
      .setDescription('Periodo que quieres consultar')
      .setRequired(true)
      .addChoices(
        { name: 'Día actual', value: 'dia' },
        { name: 'Semana actual', value: 'semana' },
        { name: 'Mes actual', value: 'mes' }
      )
  )
  .addUserOption((option) =>
    option
      .setName('usuario')
      .setDescription('Persona cuyo resumen quieres consultar')
      .setRequired(true)
  );

function periodRange(period) {
  const now = DateTime.now().setZone(TIMEZONE);
  const starts = {
    dia: now.startOf('day'),
    semana: now.startOf('week'),
    mes: now.startOf('month')
  };
  const start = starts[period];
  const end = period === 'dia'
    ? start.plus({ days: 1 })
    : period === 'semana'
      ? start.plus({ weeks: 1 })
      : start.plus({ months: 1 });
  return { start, end };
}

async function denyIfUnauthorized(interaction) {
  if (hasAuthorizedRole(interaction)) return false;
  await interaction.reply({ content: 'No tienes el rol autorizado para registrar ventas.', ephemeral: true });
  return true;
}

client.once('ready', async () => {
  console.log(`Bot conectado como ${client.user.tag}`);
  try {
    await client.application.commands.set([summaryCommand.toJSON()], process.env.DISCORD_GUILD_ID);
    console.log('Comando /resumen preparado');
    await removePreviousPanel();
    await ensurePanel();
    console.log('Panel de ventas preparado');
  } catch (error) {
    console.error('No se pudo preparar el panel:', error);
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'resumen') {
      if (!hasSummaryRole(interaction)) {
        await interaction.reply({ content: 'No tienes el rol autorizado para consultar resúmenes.', ephemeral: true });
        return;
      }
      await interaction.deferReply();
      const period = interaction.options.getString('periodo', true);
      const target = interaction.options.getUser('usuario', true);
      const { start, end } = periodRange(period);
      const { data: sales, error } = await supabase
        .from('sales')
        .select('item_id,item_name,quantity,total')
        .eq('guild_id', interaction.guildId)
        .eq('seller_discord_id', target.id)
        .eq('status', 'active')
        .gte('created_at', start.toUTC().toISO())
        .lt('created_at', end.toUTC().toISO());
      if (error) throw error;

      const totalsByItem = new Map();
      let totalUnits = 0;
      let totalMoney = 0;
      for (const sale of sales) {
        totalUnits += sale.quantity;
        totalMoney += Number(sale.total);
        const current = totalsByItem.get(sale.item_id) || { name: sale.item_name, quantity: 0 };
        current.quantity += sale.quantity;
        totalsByItem.set(sale.item_id, current);
      }
      const itemLines = [...totalsByItem.values()]
        .sort((a, b) => b.quantity - a.quantity)
        .map((item) => `• **${item.name}:** ${item.quantity.toLocaleString('es-ES')}`)
        .join('\n') || 'No hay artículos registrados en este periodo.';
      const periodNames = { dia: 'Día actual', semana: 'Semana actual', mes: 'Mes actual' };
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`📊 Resumen · ${periodNames[period]}`)
        .setDescription(`**Usuario:** <@${target.id}>\n**Discord ID:** \`${target.id}\``)
        .addFields(
          { name: 'Total de artículos', value: totalUnits.toLocaleString('es-ES'), inline: true },
          { name: 'Número de ventas', value: sales.length.toLocaleString('es-ES'), inline: true },
          { name: 'Dinero total', value: `**${money.format(totalMoney)}**`, inline: true },
          { name: 'Artículos vendidos', value: itemLines }
        )
        .setFooter({
          text: `${start.toFormat('dd/MM/yyyy')} – ${end.minus({ milliseconds: 1 }).toFormat('dd/MM/yyyy')}`
        })
        .setTimestamp();
      await interaction.editReply({ embeds: [embed] });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('sale:item:')) {
      if (await denyIfUnauthorized(interaction)) return;
      const item = ITEM_BY_ID.get(interaction.customId.slice('sale:item:'.length));
      if (!item) return interaction.reply({ content: 'Item no válido.', ephemeral: true });

      const modal = new ModalBuilder()
        .setCustomId(`sale:quantity:${item.id}`)
        .setTitle(`Venta: ${item.name}`);
      const quantity = new TextInputBuilder()
        .setCustomId('quantity')
        .setLabel('Cantidad vendida')
        .setPlaceholder('Ejemplo: 2')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(7);
      modal.addComponents(new ActionRowBuilder().addComponents(quantity));
      await interaction.showModal(modal);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('sale:quantity:')) {
      if (await denyIfUnauthorized(interaction)) return;
      const itemId = interaction.customId.slice('sale:quantity:'.length);
      const item = ITEM_BY_ID.get(itemId);
      const rawQuantity = interaction.fields.getTextInputValue('quantity').trim();
      const quantity = Number(rawQuantity);

      if (!item || !/^\d+$/.test(rawQuantity) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000) {
        await interaction.reply({ content: 'Introduce una cantidad entera entre 1 y 1.000.000.', ephemeral: true });
        return;
      }

      await interaction.deferReply({ ephemeral: true });
      const total = item.price * quantity;
      const { data: sale, error } = await supabase
        .from('sales')
        .insert({
          guild_id: interaction.guildId,
          seller_discord_id: interaction.user.id,
          seller_name: interaction.user.globalName || interaction.user.username,
          item_id: item.id,
          item_name: item.name,
          unit_price: item.price,
          quantity,
          total
        })
        .select('id, created_at')
        .single();
      if (error) throw error;

      const embed = new EmbedBuilder()
        .setColor(0xf4a7c1)
        .setTitle('🛒 Nueva venta')
        .setDescription(
          `**Usuario:** <@${interaction.user.id}>\n` +
          `**Discord ID:** \`${interaction.user.id}\`\n` +
          `**Total:** **${money.format(total)}**\n\n` +
          `**Items**\n${item.name} x${quantity.toLocaleString('es-ES')} (${money.format(total)})`
        )
        .setTimestamp(new Date(sale.created_at))
        .setFooter({ text: `Sistema de Ventas · ${sale.id}` });
      const cancel = new ButtonBuilder()
        .setCustomId(`sale:cancel:${sale.id}`)
        .setLabel('Cancelar mi venta')
        .setStyle(ButtonStyle.Danger);
      const salesChannel = await client.channels.fetch(process.env.SALES_CHANNEL_ID);
      const message = await salesChannel.send({
        embeds: [embed],
        components: []
      });
      await supabase.from('sales').update({ discord_message_id: message.id }).eq('id', sale.id);
      await interaction.editReply({
        content: `Venta registrada correctamente: **${money.format(total)}**. Solo tú puedes ver este botón.`,
        components: [new ActionRowBuilder().addComponents(cancel)]
      });
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('sale:cancel:')) {
      const saleId = interaction.customId.slice('sale:cancel:'.length);
      const { data: sale, error } = await supabase.from('sales').select('*').eq('id', saleId).single();
      if (error || !sale) {
        await interaction.reply({ content: 'No se encontró esta venta.', ephemeral: true });
        return;
      }
      if (sale.seller_discord_id !== interaction.user.id) {
        await interaction.reply({ content: 'Solo el vendedor puede cancelar esta venta.', ephemeral: true });
        return;
      }
      if (sale.status === 'cancelled') {
        await interaction.reply({ content: 'Esta venta ya estaba cancelada.', ephemeral: true });
        return;
      }

      const { error: updateError } = await supabase
        .from('sales')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('id', saleId)
        .eq('seller_discord_id', interaction.user.id);
      if (updateError) throw updateError;

      if (sale.discord_message_id) {
        const salesChannel = await client.channels.fetch(process.env.SALES_CHANNEL_ID);
        const publicMessage = await salesChannel.messages.fetch(sale.discord_message_id).catch(() => null);
        if (publicMessage?.embeds[0]) {
          const cancelledEmbed = EmbedBuilder.from(publicMessage.embeds[0])
            .setColor(0xe74c3c)
            .setTitle('Venta cancelada')
            .addFields({ name: 'Cancelada por', value: `<@${interaction.user.id}>` });
          await publicMessage.edit({ embeds: [cancelledEmbed], components: [] });
        }
      }
      await interaction.update({
        content: 'Tu venta ha sido cancelada correctamente.',
        embeds: [],
        components: []
      });
    }
  } catch (error) {
    console.error('Error procesando interacción:', error);
    const payload = { content: 'Ocurrió un error al procesar la operación.', ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
    else await interaction.reply(payload);
  }
});

client.login(process.env.DISCORD_TOKEN);
