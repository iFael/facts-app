# Facts App

Facts App is an assistant-first personal records PWA built with Next.js, React, TypeScript, shadcn/ui, Tailwind CSS and Supabase.

The Web/PWA surface is intentionally read-only for domain data. Creation, editing, deletion and document ingestion are performed through the Facts MCP/plugin layer, while the app focuses on consultation, statements, reports, documents and offline-capable viewing.

## Stack

- Next.js App Router
- React + TypeScript
- shadcn/ui + Tailwind CSS
- Supabase Auth, PostgreSQL and private Storage
- Model Context Protocol (MCP)
- Vitest + Playwright
- Vercel

## Local setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Configure these public environment variables in `.env.local`:

```text
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

## Validation

```bash
npm test
npm run typecheck
npm run build
npm run test:e2e
```

## Production

https://facts-app-nu.vercel.app

## Privacy

Production data, local environment files, operational project notes and temporary document artifacts are intentionally excluded from this repository.
