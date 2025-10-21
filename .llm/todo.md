## Telegram Bot Implementation (Plan A)
- [x] Review existing service modules (`config`, `apiClient`, `downloadService`, `jobStore`, `poller`) to confirm reusable entry points for the bot.
- [x] Identify CLI-specific logic in React hooks/components to avoid coupling when wiring the Telegram bot.
- [x] Add third-party dependencies (`telegraf`) and ensure version compatibility.
- [x] Implement `src/telegramBot.ts` that initializes shared services, maps commands to search/job actions, and handles message formatting.
- [x] Introduce configuration for the bot token/env handling and expose an npm script to launch the bot.
- [x] Document usage (README/docs) covering setup, commands, and coexistence with the CLI.
- [x] Validate TypeScript build/lint (`npm run lint`).
- [ ] Manually exercise CLI critical flows to confirm there are no regressions.
