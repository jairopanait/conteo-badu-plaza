# Conteo Badu Plaza

Bot de Discord con un panel interactivo de botones para registrar ventas. El usuario puede añadir varios items con sus cantidades a una selección privada y registrarlos juntos como una única venta. El bot publica el total junto con su ID de Discord. Solo funciona para miembros con el rol configurado y permite que el vendedor cancele su propia venta.

El botón **Crear combo** permite elegir exactamente dos artículos y una cantidad diferente para cada uno, calculando automáticamente el total de ambos.

El botón **Combo Sandwich + Agua** añade rápidamente la misma cantidad de ambos artículos.

El comando `/resumen periodo usuario` está limitado al rol de supervisión configurado. Resume el día, la semana o el mes actual de la persona elegida, con cantidades por artículo, número de ventas y dinero total.

Cada lunes a las 00:00 (Europe/Madrid), el bot publica automáticamente en el canal configurado el resumen de la semana anterior por vendedor: nombre, Discord ID, ventas, ítems y dinero total, incluyendo el desglose de cantidad y dinero por cada ítem. Las ventas canceladas no se incluyen.

El panel fijado de empleados permite solicitar rango indicando el Nombre IC. Las solicitudes se revisan en un canal privado y solo el rol de administración puede aceptarlas. Al aprobar, se asignan automáticamente los roles configurados. `/empleados` muestra de forma privada únicamente Nombre IC, usuario de Discord y User ID de cada persona, incluso si ya abandonó el servidor.

Al arrancar, el bot importa sin duplicados a los miembros existentes que ya tienen el rol de empleado, usando su apodo visible en el servidor como Nombre IC. Esta función requiere activar **Server Members Intent** en Discord Developer Portal.

## Requisitos

- Node.js 20 o posterior
- Una aplicación/bot de Discord ya instalada en el servidor
- Un proyecto de Supabase

## Configurar Supabase

1. Crea un proyecto en Supabase.
2. Abre **SQL Editor**, pega el contenido de `supabase/schema.sql` y ejecútalo.
3. En la configuración/API del proyecto, copia la URL y la clave `service_role`.
4. La clave `service_role` es secreta: nunca debe publicarse ni usarse en un navegador.

## Configurar el bot

1. Copia `.env.example` como `.env`.
2. Completa `DISCORD_TOKEN`, `SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY`.
3. Instala y arranca:

```bash
npm install
npm start
```

Al conectarse, el bot publica el panel en el canal configurado o reutiliza el panel existente. No necesita comandos ni intents privilegiados.

## Permisos de Discord

- View Channels
- Send Messages
- Embed Links
- Read Message History

El rol del bot debe poder ver y escribir en ambos canales. Si un canal tiene permisos privados, añádelo explícitamente a ese canal.

## GitHub y despliegue

El archivo `.env` está excluido de Git. Al desplegar, crea las mismas variables como secretos del proveedor de alojamiento. Supabase almacena los datos, pero el proceso de Node.js necesita un alojamiento que permanezca encendido.
