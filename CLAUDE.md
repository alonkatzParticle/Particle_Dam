# Asset Library — Engineering Guidelines

These rules govern how this project is built, debugged, and extended.
Read this before writing a single line of code.

---

## 1. Observe Before You Build

Before touching any code, take a step back and fully understand the problem:

- **Read the existing code** in the relevant area — don't assume you know what it does.
- **Map the data flow** from source (Dropbox / Monday) → storage (DB) → API → UI.
- **Identify the object types involved** at every boundary.
- **Ask: what is the simplest correct model for this?** Not the fastest to implement — the most correct.
- Only after fully understanding the landscape should you start designing a solution.

> If you catch yourself writing code before you understand the problem, stop.

---

## 2. Type Everything, Every Time

This project is built in TypeScript. Types are not optional documentation — they are the contract.

- Every object that crosses a boundary (API response, DB row, Dropbox item, function argument) **must have an explicit named type or interface**.
- No `any`. No `object`. No untyped `JSON.parse()` results.
- Types live in a dedicated `types/` directory and are imported everywhere they're needed.
- If a type is used in more than one file, it belongs in `types/` — not inline.
- Use **discriminated unions** for objects that can be one of several shapes (e.g. `AssetType = 'video' | 'image' | 'document'`).
- Prefer `interface` for object shapes, `type` for unions and aliases.

```ts
// ✅ Good
interface DropboxAsset {
  id: string
  path: string
  mediaType: MediaType
  size: number
  modifiedAt: string
}

// ❌ Bad
const asset: any = getAsset()
```

---

## 3. Architecture: Extensible by Design

The system must be easy to extend without rewriting existing logic.

- **Separate concerns strictly**: data fetching, transformation, storage, and presentation are distinct layers.
- **No business logic in API routes.** Routes are thin — they validate input, call a service, and return the result.
- **No direct DB calls in UI components or API routes.** All DB access goes through a repository/service layer.
- Design for multiple media types, multiple Dropbox roots, and multiple Monday boards from day one — even if only one exists today.
- Configuration (board IDs, column keys, folder paths) lives in `config/` — never hardcoded.
- When adding a feature, ask: *"If we added a third media type tomorrow, would this code need to change?"* If yes, refactor first.

---

## 4. Clean Code Standards

- **Functions do one thing.** If a function name needs "and" in it, split it.
- **Name things clearly.** `syncDropboxAssets()` beats `doSync()`. `assetId` beats `id` when context isn't obvious.
- **No magic strings or magic numbers.** Use constants or enums.
- **Keep files small.** If a file exceeds ~300 lines, it's doing too much.
- **Delete dead code.** Don't comment it out — that's what git is for.
- **Write self-documenting code first**, add comments only when the *why* isn't obvious from the *what*.

---

## 5. Debugging Protocol — Don't Spiral

When something is broken, follow this order. Do not skip steps.

### Step 1: Observe
- Read the error message completely before doing anything.
- Identify **where** in the stack it originated (UI / API route / service / DB / external API).
- Do not guess at the fix until you know the cause.

### Step 2: Isolate with a Test
- Before changing any code, write a minimal test or script that **reproduces the bug**.
- This can be a unit test, a one-off `test.mjs` script, or a `curl` command — whatever surfaces the failure cleanly.
- If you can't reproduce it in isolation, you don't understand it yet.

### Step 3: Fix the Cause, Not the Symptom
- Fix the root cause identified in Step 2.
- Do not add workarounds, `try/catch` swallowers, or fallback hacks that paper over the real issue.

### Step 4: Verify
- Run the test from Step 2 again. It should pass.
- Confirm no regressions in adjacent behaviour.

> If you've made 3 changes and the bug is still there, **stop**. Re-read the error. Start Step 1 again.

---

## 6. Project Structure

```
backend/
  routes/         # Thin Express route handlers only
  services/       # Business logic (sync, tagging, search)
  repositories/   # All DB access
  types/          # Shared TypeScript interfaces and enums
  config/         # Config loading and validation
  lib/            # Pure utility functions (no side effects)

frontend/
  src/
    pages/        # Route-level components
    components/   # Reusable UI components
    hooks/        # Custom React hooks
    lib/          # Frontend utilities and API clients
    types/        # Frontend-specific types (can import from backend types if shared)
```

---

## 7. API Design

- Routes follow REST conventions: `GET /api/assets`, `POST /api/assets/:id/tags`, etc.
- Every route returns a typed response — document the shape above the handler.
- Errors always return `{ error: string, code?: string }` — never raw exception messages to the client.
- Pagination is always cursor or page-based — never return unbounded lists.

---

## 8. Working Agreement

- **Plan before you implement.** For any non-trivial task, describe the approach first.
- **One concern per PR / change set.** Don't mix a bug fix with a refactor.
- **If requirements are ambiguous, ask.** Don't assume and build something wrong.
- **Never deploy broken code** — even locally, the Docker container should always be in a working state.
