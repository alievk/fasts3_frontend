### Product

Frontend for searching, downloading and watching films legally via fast S3 infrastructure. It has command line interface, Telegram bot and web player.

### Tech stack

It searches torrents and uploads them on S3 storage. User can download a film using S3 HTTPS link, stream it online and broadcast via AirPlay. It's written on Node.js 20+ runtime with a TypeScript codebase executed via tsx. The CLI is built on Ink 6 with React 19. Telegram bot layer is powered by telegraf, reusing the same service context as the CLI.