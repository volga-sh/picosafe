# picosafe-webapp CLAUDE.md

Web application for picosafe SDK. This file captures webapp-specific guidance. See the root [CLAUDE.md](../../CLAUDE.md) for all shared standards.

## Tech Stack

- **React 19** - UI library
- **TanStack Router** - File-based routing with type-safe generated route tree
- **TanStack Query** - Server state and async data caching
- **Tailwind CSS v4** - Utility-first styling
- **Vite** - Build tool and dev server
- **TypeScript** - Type safety
- **Playwright** - End-to-end testing
- **Biome** - Linting and formatting
- **Vitest** - Unit test runner (configured, currently no committed webapp unit tests)

## Key Commands

```bash
# Development
npm run dev            # Start dev server on port 3000
npm run start          # Alias for vite dev server on port 3000
npm run build          # Production build (vite build && tsc)

# Testing
npm run test:e2e       # Run Playwright end-to-end tests
npm run test:e2e:ui    # Run Playwright with UI mode
npm run test:e2e:debug # Debug Playwright tests in debug mode

# Quality
npm run test           # Prints guidance when no unit tests are present
npm run typecheck      # TypeScript type check
npm run lint           # Lint with Biome
npm run check          # Biome lint + format checks
npm run check:write    # Biome auto-fix checks
npm run format         # Format only
```

## Project Structure

```
apps/picosafe-webapp/
├── src/
│   ├── components/      # Reusable React components
│   ├── hooks/           # Custom hooks
│   ├── integrations/    # External integrations (wallets, data clients)
│   ├── lib/             # Shared validators and helpers
│   ├── routes/          # TanStack Router route files
│   ├── routeTree.gen.ts  # Generated route definitions
│   └── main.tsx         # React app entrypoint
├── e2e/                 # Playwright tests
├── public/              # Static assets
├── index.html           # HTML entry point
└── README.md            # App-focused usage docs
```

## Important Notes

- Routes in `src/routes/` are file-based and auto-discovered by TanStack Router.
- `src/routeTree.gen.ts` is generated; do not edit manually.
- The dev server is expected on `localhost:3000`.
- Keep Playwright tests updated for key flows (connect wallet, input safe address, copy actions).

## Route Naming Pattern

Routes are discovered by filename:
- `index.tsx` -> `/`
- `dashboard/index.tsx` -> `/dashboard`
- `__root.tsx` -> Root route wrapper

## Webapp-only Alignment (Universal CLAUDE Rules)

- Prefer short, behavior-focused comments that explain **why**, not obvious restatements of the code.
- Keep new helpers/components small and composable.
- Keep data boundaries clear (UI state, query/cache state, blockchain interactions).
- Prefer explicit interfaces/types for shared props and hook return values.
- Keep file-level scope tight; keep route and integration files thin.
