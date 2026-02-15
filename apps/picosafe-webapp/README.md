# picosafe-webapp

Frontend for interacting with the picosafe example workflows.

## Getting started

```bash
npm install
npm run dev
```

The app starts on `http://localhost:3000`.

## Available scripts

```bash
npm run dev             # Start local dev server
npm run build           # Production build
npm run typecheck       # TypeScript check
npm run lint            # Biome lint
npm run check           # Biome checks (lint + format)
npm run format          # Format files
npm run test:e2e        # Run Playwright tests
npm run test:e2e:ui     # Run tests with Playwright UI
```

`npm run test` intentionally points to unit tests guidance because this package currently uses Playwright-focused coverage for app flows.

## Notes

- Routing is handled by TanStack Router with file-based routes under `src/routes/`.
- Styling is via Tailwind CSS v4 + Vite.
- End-to-end validation should be updated in `apps/picosafe-webapp/e2e/` for critical wallet, address parsing, and submit flows.
