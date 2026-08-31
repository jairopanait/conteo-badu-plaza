require('dotenv').config();

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
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
const WEEKLY_REPORT_CHANNEL_ID = '1543062522687393924';
const EMPLOYEE_PANEL_CHANNEL_ID = '1541193810267344997';
const EMPLOYEE_ADMIN_CHANNEL_ID = '1544111826193752175';
const EMPLOYEE_MANAGER_ROLE_ID = '1541197720197406760';
const EMPLOYEE_GRANTED_ROLE_IDS = ['1541197856793305138', '1541198506205913208'];
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
const carts = new Map();

function cartKey(interaction) {
  return `${interaction.guildId}:${interaction.user.id}`;
}

function cartText(cart) {
  return [...cart.values()]
    .map(({ item, quantity }) => `${item.name} x${quantity.toLocaleString('es-ES')} (${money.format(item.price * quantity)})`)
    .join('\n');
}

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
  itemRows[itemRows.length - 1].addComponents(
    new ButtonBuilder()
      .setCustomId('sale:combo')
      .setLabel('Crear combo')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('sale:combo-sandwich-water')
      .setLabel('Combo Sandwich + Agua')
      .setStyle(ButtonStyle.Primary)
  );
  itemRows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('sale:checkout')
      .setLabel('Registrar venta')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId('sale:clear')
      .setLabel('Vaciar selección')
      .setStyle(ButtonStyle.Danger)
  ));
  return {
    content: '**Categoría: Ventas**\nAñade uno o varios artículos y después pulsa **Registrar venta**:',
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

const employeesCommand = new SlashCommandBuilder()
  .setName('empleados')
  .setDescription('Descarga el registro histórico de solicitudes de empleados');

function employeePanelPayload() {
  const button = new ButtonBuilder()
    .setCustomId('employee:request')
    .setLabel('Solicitar rango')
    .setStyle(ButtonStyle.Primary);
  const embed = new EmbedBuilder()
    .setColor(0xf4a7c1)
    .setTitle('👤 Solicitud de rango de empleado')
    .setDescription('Pulsa el botón para solicitar tu rango. Se te pedirá tu **Nombre IC**.')
    .setFooter({ text: 'EMPLOYEE_REQUEST_PANEL_V1' });
  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(button)] };
}

async function ensureEmployeePanel() {
  const channel = await client.channels.fetch(EMPLOYEE_PANEL_CHANNEL_ID);
  if (!channel?.isTextBased()) throw new Error('El canal del panel de empleados no es de texto');
  const recent = await channel.messages.fetch({ limit: 100 });
  let panel = recent.find((message) =>
    message.author.id === client.user.id &&
    message.embeds.some((embed) => embed.footer?.text === 'EMPLOYEE_REQUEST_PANEL_V1')
  );
  if (panel) await panel.edit(employeePanelPayload());
  else panel = await channel.send(employeePanelPayload());
  if (!panel.pinned) {
    await panel.pin().catch((error) => console.error('No se pudo fijar el panel de empleados:', error));
  }
}

async function fetchAllEmployeeRequests() {
  const records = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('employee_requests')
      .select('*')
      .order('requested_at', { ascending: false })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    records.push(...data);
    if (data.length < pageSize) break;
  }
  return records;
}

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

async function fetchSalesBetween(start, end) {
  const allSales = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from('sales')
      .select('id,seller_discord_id,seller_name,quantity,total,discord_message_id')
      .eq('guild_id', process.env.DISCORD_GUILD_ID)
      .eq('status', 'active')
      .gte('created_at', start.toUTC().toISO())
      .lt('created_at', end.toUTC().toISO())
      .range(from, from + pageSize - 1);
    if (error) throw error;
    allSales.push(...data);
    if (data.length < pageSize) break;
  }
  return allSales;
}

async function sendWeeklyReport(start, end) {
  const channel = await client.channels.fetch(WEEKLY_REPORT_CHANNEL_ID);
  if (!channel?.isTextBased()) throw new Error('El canal del informe semanal no es un canal de texto');

  const marker = `WEEKLY_REPORT:${start.toISODate()}`;
  const recent = await channel.messages.fetch({ limit: 100 });
  const alreadySent = recent.some((message) =>
    message.author.id === client.user.id &&
    message.embeds.some((embed) => embed.footer?.text?.includes(marker))
  );
  if (alreadySent) return;

  const sales = await fetchSalesBetween(start, end);
  const sellers = new Map();
  for (const sale of sales) {
    const current = sellers.get(sale.seller_discord_id) || {
      id: sale.seller_discord_id,
      name: sale.seller_name,
      items: 0,
      money: 0,
      saleIds: new Set()
    };
    current.name = sale.seller_name || current.name;
    current.items += sale.quantity;
    current.money += Number(sale.total);
    current.saleIds.add(sale.discord_message_id || sale.id);
    sellers.set(sale.seller_discord_id, current);
  }

  const ranked = [...sellers.values()].sort((a, b) => b.money - a.money);
  const embeds = [];
  const chunks = ranked.length ? Array.from({ length: Math.ceil(ranked.length / 20) }, (_, index) =>
    ranked.slice(index * 20, index * 20 + 20)
  ) : [[]];

  for (let index = 0; index < chunks.length; index += 1) {
    const embed = new EmbedBuilder()
      .setColor(0xf4a7c1)
      .setTitle(index === 0 ? '📊 Resumen semanal de ventas' : '📊 Resumen semanal de ventas · continuación')
      .setFooter({ text: `Sistema de Ventas · ${marker}` })
      .setTimestamp();
    if (index === 0) {
      embed.setDescription(`Periodo: **${start.toFormat('dd/MM/yyyy')} – ${end.minus({ days: 1 }).toFormat('dd/MM/yyyy')}**`);
    }
    if (!chunks[index].length) {
      embed.addFields({ name: 'Sin ventas', value: 'No hubo ventas activas durante esta semana.' });
    } else {
      embed.addFields(chunks[index].map((seller) => ({
        name: seller.name || 'Usuario desconocido',
        value:
          `Discord ID: \`${seller.id}\`\n` +
          `Ventas: **${seller.saleIds.size.toLocaleString('es-ES')}** · ` +
          `Ítems: **${seller.items.toLocaleString('es-ES')}** · ` +
          `Total: **${money.format(seller.money)}**`
      })));
    }
    embeds.push(embed);
  }

  for (let index = 0; index < embeds.length; index += 10) {
    await channel.send({ embeds: embeds.slice(index, index + 10) });
  }
  console.log(`Informe semanal enviado: ${start.toISODate()}`);
}

async function runPreviousWeekReport() {
  const thisWeek = DateTime.now().setZone(TIMEZONE).startOf('week');
  await sendWeeklyReport(thisWeek.minus({ weeks: 1 }), thisWeek);
}

function scheduleWeeklyReport() {
  const now = DateTime.now().setZone(TIMEZONE);
  const nextMonday = now.startOf('week').plus({ weeks: 1 });
  const delay = Math.max(1000, nextMonday.toMillis() - now.toMillis());
  setTimeout(async () => {
    try {
      await runPreviousWeekReport();
    } catch (error) {
      console.error('No se pudo enviar el informe semanal:', error);
    } finally {
      scheduleWeeklyReport();
    }
  }, delay);
}

async function denyIfUnauthorized(interaction) {
  if (hasAuthorizedRole(interaction)) return false;
  await interaction.reply({ content: 'No tienes el rol autorizado para registrar ventas.', ephemeral: true });
  return true;
}

client.once('ready', async () => {
  console.log(`Bot conectado como ${client.user.tag}`);
  try {
    await client.application.commands.set(
      [summaryCommand.toJSON(), employeesCommand.toJSON()],
      process.env.DISCORD_GUILD_ID
    );
    console.log('Comandos /resumen y /empleados preparados');
    await removePreviousPanel();
    await ensurePanel();
    console.log('Panel de ventas preparado');
    await ensureEmployeePanel();
    console.log('Panel de solicitudes de empleados preparado');
  } catch (error) {
    console.error('No se pudo preparar el panel:', error);
  }
  try {
    await runPreviousWeekReport();
  } catch (error) {
    console.error('No se pudo enviar el informe semanal pendiente:', error);
  }
  scheduleWeeklyReport();
});

client.on('interactionCreate', async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'empleados') {
      if (!hasSummaryRole(interaction)) {
        await interaction.reply({ content: 'No tienes el rol autorizado para consultar empleados.', flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const records = await fetchAllEmployeeRequests();
      const latestByUser = new Map();
      for (const record of records) {
        if (!latestByUser.has(record.discord_id)) latestByUser.set(record.discord_id, record);
      }
      const employees = [...latestByUser.values()];
      if (!employees.length) {
        await interaction.editReply('Todavía no hay solicitudes de empleados.');
        return;
      }
      const embeds = [];
      for (let index = 0; index < employees.length; index += 20) {
        const chunk = employees.slice(index, index + 20);
        const embed = new EmbedBuilder()
          .setColor(0xf4a7c1)
          .setTitle(index === 0 ? '👥 Registro de empleados' : '👥 Registro de empleados · continuación')
          .addFields(chunk.map((record) => ({
            name: record.ic_name,
            value:
              `Discord: **${record.discord_username}**\n` +
              `User ID: \`${record.discord_id}\``
          })))
          .setFooter({ text: 'Se muestra la solicitud más reciente de cada persona.' });
        if (index === 0) {
          embed.setDescription(`Personas registradas: **${employees.length.toLocaleString('es-ES')}**`);
        }
        embeds.push(embed);
      }
      await interaction.editReply({ embeds: embeds.slice(0, 10) });
      return;
    }

    if (interaction.isButton() && interaction.customId === 'employee:request') {
      const modal = new ModalBuilder()
        .setCustomId('employee:request-modal')
        .setTitle('Solicitar rango de empleado');
      const icName = new TextInputBuilder()
        .setCustomId('ic_name')
        .setLabel('Nombre IC')
        .setPlaceholder('Escribe tu nombre dentro del juego')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(2)
        .setMaxLength(50);
      modal.addComponents(new ActionRowBuilder().addComponents(icName));
      await interaction.showModal(modal);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'employee:request-modal') {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const icName = interaction.fields.getTextInputValue('ic_name').trim();
      const roles = interaction.member.roles.cache
        .filter((role) => role.id !== interaction.guildId)
        .map((role) => role.id);
      const { data: request, error } = await supabase
        .from('employee_requests')
        .insert({
          guild_id: interaction.guildId,
          discord_id: interaction.user.id,
          discord_username: interaction.user.username,
          ic_name: icName,
          roles_at_request: roles
        })
        .select('*')
        .single();
      if (error) throw error;

      const adminChannel = await client.channels.fetch(EMPLOYEE_ADMIN_CHANNEL_ID);
      if (!adminChannel?.isTextBased()) throw new Error('El canal de administración no es de texto');
      const approve = new ButtonBuilder()
        .setCustomId(`employee:approve:${request.id}`)
        .setLabel('Aceptar solicitud')
        .setStyle(ButtonStyle.Success);
      const embed = new EmbedBuilder()
        .setColor(0xf4a7c1)
        .setTitle('📋 Nueva solicitud de empleado')
        .addFields(
          { name: 'Usuario', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Discord ID', value: `\`${interaction.user.id}\``, inline: true },
          { name: 'Nombre IC', value: icName, inline: true },
          { name: 'Roles actuales', value: roles.length ? roles.map((id) => `<@&${id}>`).join(' ') : 'Ninguno' }
        )
        .setTimestamp();
      const adminMessage = await adminChannel.send({
        embeds: [embed],
        components: [new ActionRowBuilder().addComponents(approve)]
      });
      await supabase
        .from('employee_requests')
        .update({ request_message_id: adminMessage.id })
        .eq('id', request.id);
      await interaction.editReply('Tu solicitud se ha enviado correctamente a la administración.');
      return;
    }

    if (interaction.isButton() && interaction.customId.startsWith('employee:approve:')) {
      if (!interaction.inGuild() || !interaction.member.roles.cache.has(EMPLOYEE_MANAGER_ROLE_ID)) {
        await interaction.reply({ content: 'No tienes el rol autorizado para aceptar solicitudes.', flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.deferUpdate();
      const requestId = interaction.customId.slice('employee:approve:'.length);
      const { data: request, error } = await supabase
        .from('employee_requests')
        .select('*')
        .eq('id', requestId)
        .single();
      if (error || !request) throw error || new Error('Solicitud no encontrada');
      if (request.status === 'approved') {
        await interaction.followUp({ content: 'Esta solicitud ya fue aceptada.', flags: MessageFlags.Ephemeral });
        return;
      }

      const member = await interaction.guild.members.fetch(request.discord_id).catch(() => null);
      if (!member) {
        await interaction.followUp({
          content: 'La solicitud queda registrada, pero el usuario ya no está en el servidor y no se le pueden asignar roles.',
          flags: MessageFlags.Ephemeral
        });
        return;
      }
      await member.roles.add(EMPLOYEE_GRANTED_ROLE_IDS, `Solicitud aceptada por ${interaction.user.username}`);
      const rolesAfterApproval = member.roles.cache
        .filter((role) => role.id !== interaction.guildId)
        .map((role) => role.id);
      const { error: updateError } = await supabase
        .from('employee_requests')
        .update({
          status: 'approved',
          granted_roles: EMPLOYEE_GRANTED_ROLE_IDS,
          roles_after_approval: rolesAfterApproval,
          reviewed_by: interaction.user.id,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', requestId);
      if (updateError) throw updateError;

      const approvedEmbed = EmbedBuilder.from(interaction.message.embeds[0])
        .setColor(0x57f287)
        .setTitle('✅ Solicitud aceptada')
        .addFields({ name: 'Aceptada por', value: `<@${interaction.user.id}>` });
      await interaction.editReply({ embeds: [approvedEmbed], components: [] });
      return;
    }

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
        .select('id,item_id,item_name,quantity,total,discord_message_id')
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
          { name: 'Número de ventas', value: new Set(sales.map((sale) => sale.discord_message_id || sale.id)).size.toLocaleString('es-ES'), inline: true },
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

    if (interaction.isButton() && interaction.customId === 'sale:combo') {
      if (await denyIfUnauthorized(interaction)) return;
      const select = new StringSelectMenuBuilder()
        .setCustomId('sale:combo-items')
        .setPlaceholder('Elige exactamente 2 artículos')
        .setMinValues(2)
        .setMaxValues(2)
        .addOptions(ITEMS.map((item) => ({
          label: item.name,
          description: money.format(item.price),
          value: item.id
        })));
      await interaction.reply({
        content: '**Selecciona los dos artículos del combo:**',
        components: [new ActionRowBuilder().addComponents(select)],
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (interaction.isButton() && interaction.customId === 'sale:combo-sandwich-water') {
      if (await denyIfUnauthorized(interaction)) return;
      const modal = new ModalBuilder()
        .setCustomId('sale:combo-sandwich-water-quantity')
        .setTitle('Combo Sandwich + Agua');
      const quantity = new TextInputBuilder()
        .setCustomId('quantity')
        .setLabel('Cantidad de cada artículo')
        .setPlaceholder('Ejemplo: 10 añade 10 Sandwich y 10 Agua')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(1)
        .setMaxLength(7);
      modal.addComponents(new ActionRowBuilder().addComponents(quantity));
      await interaction.showModal(modal);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'sale:combo-sandwich-water-quantity') {
      if (await denyIfUnauthorized(interaction)) return;
      const rawQuantity = interaction.fields.getTextInputValue('quantity').trim();
      const quantity = Number(rawQuantity);
      if (!/^\d+$/.test(rawQuantity) || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > 1000000) {
        await interaction.reply({ content: 'Introduce una cantidad entera entre 1 y 1.000.000.', flags: MessageFlags.Ephemeral });
        return;
      }
      const key = cartKey(interaction);
      const cart = carts.get(key) || new Map();
      for (const itemId of ['sandwich', 'agua']) {
        const item = ITEM_BY_ID.get(itemId);
        const previous = cart.get(itemId);
        cart.set(itemId, { item, quantity: (previous?.quantity || 0) + quantity });
      }
      carts.set(key, cart);
      const comboTotal = (ITEM_BY_ID.get('sandwich').price + ITEM_BY_ID.get('agua').price) * quantity;
      await interaction.reply({
        content: `**Combo añadido:** ${quantity.toLocaleString('es-ES')} Sandwich + ${quantity.toLocaleString('es-ES')} Agua (${money.format(comboTotal)})\n\n**Tu selección:**\n${cartText(cart)}\n\nPulsa **Registrar venta** en el panel cuando termines.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'sale:combo-items') {
      if (await denyIfUnauthorized(interaction)) return;
      const [firstId, secondId] = interaction.values;
      const first = ITEM_BY_ID.get(firstId);
      const second = ITEM_BY_ID.get(secondId);
      if (!first || !second) {
        await interaction.reply({ content: 'Los artículos seleccionados no son válidos.', flags: MessageFlags.Ephemeral });
        return;
      }
      const modal = new ModalBuilder()
        .setCustomId(`sale:combo-quantities:${firstId}:${secondId}`)
        .setTitle('Cantidades del combo');
      const firstQuantity = new TextInputBuilder()
        .setCustomId('first_quantity')
        .setLabel(`Cantidad de ${first.name}`.slice(0, 45))
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(7);
      const secondQuantity = new TextInputBuilder()
        .setCustomId('second_quantity')
        .setLabel(`Cantidad de ${second.name}`.slice(0, 45))
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMaxLength(7);
      modal.addComponents(
        new ActionRowBuilder().addComponents(firstQuantity),
        new ActionRowBuilder().addComponents(secondQuantity)
      );
      await interaction.showModal(modal);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId.startsWith('sale:combo-quantities:')) {
      if (await denyIfUnauthorized(interaction)) return;
      const [firstId, secondId] = interaction.customId.slice('sale:combo-quantities:'.length).split(':');
      const first = ITEM_BY_ID.get(firstId);
      const second = ITEM_BY_ID.get(secondId);
      const firstRaw = interaction.fields.getTextInputValue('first_quantity').trim();
      const secondRaw = interaction.fields.getTextInputValue('second_quantity').trim();
      const firstAmount = Number(firstRaw);
      const secondAmount = Number(secondRaw);
      const valid = (raw, amount) => /^\d+$/.test(raw) && Number.isSafeInteger(amount) && amount >= 1 && amount <= 1000000;
      if (!first || !second || !valid(firstRaw, firstAmount) || !valid(secondRaw, secondAmount)) {
        await interaction.reply({ content: 'Introduce cantidades enteras entre 1 y 1.000.000.', flags: MessageFlags.Ephemeral });
        return;
      }
      const key = cartKey(interaction);
      const cart = carts.get(key) || new Map();
      for (const [item, amount] of [[first, firstAmount], [second, secondAmount]]) {
        const previous = cart.get(item.id);
        cart.set(item.id, { item, quantity: (previous?.quantity || 0) + amount });
      }
      carts.set(key, cart);
      const comboTotal = first.price * firstAmount + second.price * secondAmount;
      await interaction.reply({
        content: `**Combo añadido:** ${first.name} x${firstAmount.toLocaleString('es-ES')} + ${second.name} x${secondAmount.toLocaleString('es-ES')} (${money.format(comboTotal)})\n\n**Tu selección:**\n${cartText(cart)}\n\nPulsa **Registrar venta** en el panel cuando termines.`,
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (interaction.isButton() && interaction.customId === 'sale:clear') {
      if (await denyIfUnauthorized(interaction)) return;
      carts.delete(cartKey(interaction));
      await interaction.reply({ content: 'Tu selección se ha vaciado.', flags: MessageFlags.Ephemeral });
      return;
    }

    if (interaction.isButton() && interaction.customId === 'sale:checkout') {
      if (await denyIfUnauthorized(interaction)) return;
      const key = cartKey(interaction);
      const cart = carts.get(key);
      if (!cart?.size) {
        await interaction.reply({ content: 'Primero selecciona al menos un artículo.', flags: MessageFlags.Ephemeral });
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const entries = [...cart.values()];
      const grandTotal = entries.reduce((sum, entry) => sum + entry.item.price * entry.quantity, 0);
      const records = entries.map(({ item, quantity }) => ({
        guild_id: interaction.guildId,
        seller_discord_id: interaction.user.id,
        seller_name: interaction.user.globalName || interaction.user.username,
        item_id: item.id,
        item_name: item.name,
        unit_price: item.price,
        quantity,
        total: item.price * quantity
      }));
      const { data: sales, error } = await supabase.from('sales').insert(records).select('id,created_at');
      if (error) throw error;
      const firstSale = sales[0];
      const embed = new EmbedBuilder()
        .setColor(0xf4a7c1)
        .setTitle('🛒 Nueva venta')
        .setDescription(
          `**Usuario:** <@${interaction.user.id}>\n` +
          `**Discord ID:** \`${interaction.user.id}\`\n` +
          `**Total:** **${money.format(grandTotal)}**\n\n` +
          `**Items**\n${cartText(cart)}`
        )
        .setTimestamp(new Date(firstSale.created_at))
        .setFooter({ text: `Sistema de Ventas · ${firstSale.id}` });
      const salesChannel = await client.channels.fetch(process.env.SALES_CHANNEL_ID);
      const message = await salesChannel.send({ embeds: [embed], components: [] });
      await supabase.from('sales').update({ discord_message_id: message.id }).in('id', sales.map((sale) => sale.id));
      const cancel = new ButtonBuilder()
        .setCustomId(`sale:cancel:${firstSale.id}`)
        .setLabel('Cancelar mi venta')
        .setStyle(ButtonStyle.Danger);
      carts.delete(key);
      await interaction.editReply({
        content: `Venta registrada correctamente: **${money.format(grandTotal)}**. Solo tú puedes ver este botón.`,
        components: [new ActionRowBuilder().addComponents(cancel)]
      });
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

      const key = cartKey(interaction);
      const cart = carts.get(key) || new Map();
      const previous = cart.get(item.id);
      cart.set(item.id, { item, quantity: (previous?.quantity || 0) + quantity });
      carts.set(key, cart);
      await interaction.reply({
        content: `**Añadido a tu venta:** ${item.name} x${quantity.toLocaleString('es-ES')}\n\n**Tu selección:**\n${cartText(cart)}\n\nAñade más artículos o pulsa **Registrar venta** en el panel.`,
        components: [],
        flags: MessageFlags.Ephemeral
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

      let updateQuery = supabase
        .from('sales')
        .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
        .eq('seller_discord_id', interaction.user.id);
      updateQuery = sale.discord_message_id
        ? updateQuery.eq('discord_message_id', sale.discord_message_id)
        : updateQuery.eq('id', saleId);
      const { error: updateError } = await updateQuery;
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
