require('dotenv').config();

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');
const { createClient } = require('@supabase/supabase-js');
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
          .setStyle(ButtonStyle.Secondary)
      )
    ));
  }
  return {
    content: '**Categoría: Ventas**\nSelecciona el artículo vendido:',
    embeds: [],
    components: itemRows
  };
}

async function ensurePanel() {
  const channel = await client.channels.fetch(process.env.PANEL_CHANNEL_ID);
  if (!channel?.isTextBased()) throw new Error('El canal de pantalla no es un canal de texto');

  const recent = await channel.messages.fetch({ limit: 100 });
  const existing = recent.find((message) => {
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
  });

  const payload = panelPayload();
  if (existing) await existing.edit(payload);
  else await channel.send(payload);
}

function hasAuthorizedRole(interaction) {
  return interaction.inGuild() && interaction.member.roles.cache.has(process.env.AUTHORIZED_ROLE_ID);
}

async function denyIfUnauthorized(interaction) {
  if (hasAuthorizedRole(interaction)) return false;
  await interaction.reply({ content: 'No tienes el rol autorizado para registrar ventas.', ephemeral: true });
  return true;
}

client.once('ready', async () => {
  console.log(`Bot conectado como ${client.user.tag}`);
  try {
    await ensurePanel();
    console.log('Panel de ventas preparado');
  } catch (error) {
    console.error('No se pudo preparar el panel:', error);
  }
});

client.on('interactionCreate', async (interaction) => {
  try {
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
        .setColor(0x2ecc71)
        .setTitle('Venta registrada')
        .addFields(
          { name: 'Vendedor', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Discord ID', value: interaction.user.id, inline: true },
          { name: 'Item', value: item.name, inline: true },
          { name: 'Cantidad', value: quantity.toLocaleString('es-ES'), inline: true },
          { name: 'Precio unitario', value: money.format(item.price), inline: true },
          { name: 'Total', value: `**${money.format(total)}**`, inline: true }
        )
        .setTimestamp(new Date(sale.created_at))
        .setFooter({ text: `Venta ${sale.id}` });
      const cancel = new ButtonBuilder()
        .setCustomId(`sale:cancel:${sale.id}`)
        .setLabel('Cancelar mi venta')
        .setStyle(ButtonStyle.Danger);
      const salesChannel = await client.channels.fetch(process.env.SALES_CHANNEL_ID);
      const message = await salesChannel.send({
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(cancel)]
      });
      await supabase.from('sales').update({ discord_message_id: message.id }).eq('id', sale.id);
      await interaction.editReply(`Venta registrada correctamente: **${money.format(total)}**.`);
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

      const cancelledEmbed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(0xe74c3c)
        .setTitle('Venta cancelada')
        .addFields({ name: 'Cancelada por', value: `<@${interaction.user.id}>` });
      await interaction.update({ embeds: [cancelledEmbed], components: [] });
    }
  } catch (error) {
    console.error('Error procesando interacción:', error);
    const payload = { content: 'Ocurrió un error al procesar la operación.', ephemeral: true };
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
    else await interaction.reply(payload);
  }
});

client.login(process.env.DISCORD_TOKEN);
