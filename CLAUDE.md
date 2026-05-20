# Northwind University Chat — Codebase Guide

## Project Layout

```
apps/
  api/   NestJS SSE backend
  web/   Next.js App Router frontend
docker-compose.yml
```

## Backend Architecture (`apps/api`)

Strict MVC + OOP. Every layer has a single responsibility and communicates only through its direct dependency.

```
HTTP request
  └── ChatController          transport only — parses input, delegates, returns HTTP shape
        └── ChatStreamService  orchestration — owns the SSE lifecycle
              ├── SessionService    reads/writes session turns via KeyValueStore
              ├── StreamStateService reads/writes resumable stream state via KeyValueStore
              └── LlmService        calls Gemini API, streams tokens as AsyncIterable<string>
                    └── DepartmentInfoService  static lookup, injected so it can be swapped
```

### Layer rules

- **Controller** — no business logic. Reads route params and body, calls one service method, handles `NotFoundException` / `GoneException` with typed HTTP status codes.
- **Services** — no HTTP knowledge. Receive plain values, return plain values or throw `ServiceError`. Never access `req`/`res` except `ChatStreamService`, which owns the SSE wire format.
- **Storage** — `KeyValueStore` is an abstract class. `RedisStoreService` is the only concrete implementation. Swap by changing the provider in `ChatModule`.
- **DTOs** — live in `chat/dto/`. One class per request body shape.
- **Types** — shared domain types (`Turn`, `ChatSession`, `ChatRole`) live in `common/chat.types.ts`. Error codes live in `common/service-error.ts`.

### Error handling

`ServiceError` carries a typed code (`LLM_UNAVAILABLE`, `LLM_RATE_LIMITED`, `REDIS_UNAVAILABLE`). `ApiExceptionFilter` maps each code to an HTTP status and logs the cause. Never throw raw `Error` from services — always use `ServiceError` so the filter can classify it correctly.

### LLM integration

`LlmService.streamReply()` is an `AsyncGenerator<string>`. It builds the conversation from history, embeds department contacts in the system prompt, and calls `POST /v1beta/models/{model}:generateContent?alt=sse`. The `alt=sse` parameter is required — `streamGenerateContent` no longer exists in the Gemini v1beta API.

Department contact data is static and lives in `DepartmentInfoService`. It is injected into `LlmService` and embedded in the system prompt on every request — no separate tool-calling round trip.

### SSE contract

```
data: {"token":"..."}       one per streamed word
data: {"done":true,"turnIndex":N}   final success event
data: {"error":"..."}       terminal error event
```

The client sends `Last-Event-ID: N` on reconnect. `ChatStreamService.resumeStream()` polls Redis stream state and replays tokens from index `N+1`.

## Frontend Architecture (`apps/web`)

```
Page (RSC)
  └── ChatBox (client component)
        └── /api/chat (Edge BFF route)   proxies to NestJS, hides backend URL
        └── /api/session (BFF route)     creates/deletes session, sets HttpOnly cookie
```

### BFF routes

- `app/api/chat/route.ts` — Edge runtime. Reads session cookie, enforces per-session rate limit (20 req/hour, sliding window via cookie), proxies to NestJS, pipes SSE stream back.
- `app/api/session/route.ts` — Creates session on first message, deletes on expiry.

### Client streaming

`ChatBox` reads the SSE stream manually (`getReader()`). `FatalStreamError` signals errors that must not be retried (e.g. `LLM unavailable`, rate limit). Network drops retry up to `MAX_STREAM_ATTEMPTS=3` using `Last-Event-ID`.

## TypeScript Standards

- **No `any`** — use `unknown` at boundaries, narrow with type guards or `as` only after a JSON parse.
- All service methods and function parameters must have explicit return types.
- DTOs use `!` (definite assignment) without `class-validator` since the package is not installed. Input validation is handled manually in the controller.
- `Record<string, unknown>` for untyped object shapes from external APIs.

## Running Locally

### Docker (recommended)

```bash
cp env.example .env
# set LLM_API_KEY and LLM_MODEL in .env
docker compose up --build
```

Open `http://localhost:3000`.

Rebuild after any backend change: `docker compose up --build -d`
Restart only (env change): `docker compose up -d`

### Without Docker

```bash
cp env.example .env
# set LLM_API_KEY, LLM_MODEL, REDIS_URL, NESTJS_BASE_URL=http://localhost:3001
npm install
# terminal 1
npm run dev --workspace @domain-chat/api
# terminal 2
npm run dev --workspace @domain-chat/web
```

Requires Redis running at `REDIS_URL`.

## Environment Variables

| Variable | Required | Notes |
|---|---|---|
| `LLM_API_KEY` | yes | Gemini API key from Google AI Studio |
| `LLM_MODEL` | yes | e.g. `gemini-2.0-flash-lite` (higher free-tier quota) or `gemini-2.0-flash` |
| `REDIS_URL` | yes | `redis://localhost:6379` locally; `redis://redis:6379` inside Docker |
| `NESTJS_PORT` | no | default `3001` |
| `NEXTJS_PORT` | no | default `3000` |
| `NESTJS_BASE_URL` | yes for web | `http://localhost:3001` locally; `http://api:3001` inside Docker |

**Docker Compose overrides** `REDIS_URL` and `NESTJS_BASE_URL` automatically — do not set these to localhost values in the container environment.

## Common Errors

| Log message | Cause | Fix |
|---|---|---|
| `Gemini returned HTTP 429` | Free tier rate limit hit | Wait 1 min (RPM) or until midnight PT (RPD); or switch to `gemini-2.0-flash-lite` |
| `Gemini returned HTTP 404` | Model name wrong or `streamGenerateContent` used | Ensure URL uses `:generateContent?alt=sse`; check `LLM_MODEL` value |
| `Session store unavailable` | Redis unreachable | Check Redis container is running; verify `REDIS_URL` |

## Tests

```bash
npm test                                    # all
npm run test --workspace @domain-chat/api   # backend only
npm run test --workspace @domain-chat/web   # frontend only
```
