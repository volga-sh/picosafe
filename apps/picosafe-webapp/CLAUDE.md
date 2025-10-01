# picosafe-webapp CLAUDE.md

Web application for picosafe SDK. This file documents webapp-specific tech stack and commands. See the main [CLAUDE.md](../../CLAUDE.md) for general coding standards and guidelines.

## Tech Stack

- **React 19** - UI library
- **TanStack Router** - File-based routing with automatic route generation
- **TanStack Query** - Data fetching and state management
- **TanStack Form** - Type-safe form handling with Zod validation
- **Tailwind CSS v4** - Utility-first styling with Vite plugin
- **Vite** - Build tool and dev server
- **TypeScript** - Type safety
- **Playwright** - End-to-end testing
- **Vitest** - Unit testing (not currently used)
- **Biome** - Linting and formatting

## Key Commands

```bash
# Development
npm run dev              # Start dev server on port 3000
npm run build            # Build for production

# Testing
npm run test:e2e         # Run Playwright e2e tests
npm run test:e2e:ui      # Run e2e tests with UI
npm run test:e2e:debug   # Debug e2e tests

# Code Quality
npm run typecheck        # TypeScript type checking
npm run check            # Lint with Biome
npm run check:write      # Lint and auto-fix with Biome
npm run format           # Format code with Biome
```

## Project Structure

```
apps/picosafe-webapp/
├── src/
│   ├── routes/          # File-based routes (auto-generated routing)
│   ├── components/      # React components
│   ├── hooks/           # Custom React hooks
│   ├── integrations/    # Third-party integrations
│   └── main.tsx         # Entry point
├── e2e/                 # Playwright e2e tests
├── public/              # Static assets
└── index.html           # HTML entry point
```

## Important Notes

- **Routes**: TanStack Router uses file-based routing. Routes in `src/routes/` are automatically discovered and type-safe
- **Route Tree**: `src/routeTree.gen.ts` is auto-generated - do not edit manually
- **Styling**: Uses Tailwind CSS v4 with the Vite plugin
- **Port**: Dev server runs on port 3000
- **Testing**: Focus on e2e tests with Playwright; unit tests are minimal

## TanStack Router Patterns

Routes are file-based and use naming conventions:
- `index.tsx` → `/`
- `about.tsx` → `/about`
- `demo.form.simple.tsx` → `/demo/form/simple`
- `__root.tsx` → Root layout wrapping all routes

Each route file exports a Route object created with `createFileRoute()`.
