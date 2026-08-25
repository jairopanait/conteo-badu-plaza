# Conteo Badu Plaza

Bot de Discord con un panel interactivo de botones para registrar ventas. El usuario pulsa un item, introduce la cantidad y el bot publica el total junto con su ID de Discord. Solo funciona para miembros con el rol configurado y permite que el vendedor cancele su propia venta.

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
