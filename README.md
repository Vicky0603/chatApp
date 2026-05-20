# Streaming Domain Chat

This repo contains a NestJS backend and a Next.js frontend for a streaming university-support chatbot. The assistant is intentionally scoped to Northwind University topics such as admissions, housing, academic policies, campus services, and department contact details.

## Stack

- `apps/api`: NestJS SSE backend with Redis-backed sessions, resumable stream state, and Gemini LLM integration
- `apps/web`: Next.js App Router frontend with an SSE BFF route and streaming chat UI
- `docker-compose.yml`: starts Redis, NestJS, and Next.js with one command

## Architecture

The backend follows a conventional MVC-style NestJS layout with OOP service boundaries:

- Controllers:
  HTTP transport only, for example [apps/api/src/chat/chat.controller.ts](/mnt/c/Users/vikto/Downloads/test/apps/api/src/chat/chat.controller.ts)
- Services:
  application behavior and orchestration, for example [apps/api/src/chat/chat-stream.service.ts](/mnt/c/Users/vikto/Downloads/test/apps/api/src/chat/chat-stream.service.ts), [apps/api/src/llm/llm.service.ts](/mnt/c/Users/vikto/Downloads/test/apps/api/src/llm/llm.service.ts), and [apps/api/src/sessions/session.service.ts](/mnt/c/Users/vikto/Downloads/test/apps/api/src/sessions/session.service.ts)
- Models/state:
  chat turns, session records, and persisted stream state handled through typed interfaces and storage services

The intent is:

- thin controllers
- encapsulated services with single responsibilities
- explicit dependency injection between collaborating classes
- transport concerns separated from LLM, session, and storage concerns

## Local Setup

1. Copy `env.example` to `.env`.
2. Set:
   - `LLM_API_KEY`
   - `LLM_MODEL=gemini-2.0-flash-lite` (higher free-tier quota) or `gemini-2.0-flash`
   - `REDIS_URL=redis://localhost:6379`
   - optionally `NESTJS_PORT`, `NEXTJS_PORT`, and `NESTJS_BASE_URL=http://localhost:3001`
3. Install dependencies with `npm install`.
4. Start Redis locally.
   - example: `docker run --rm -p 6379:6379 redis:7-alpine`
4. Start the apps in separate terminals:
   - `npm run dev --workspace @domain-chat/api`
   - `npm run dev --workspace @domain-chat/web`
5. Open `http://localhost:3000`.

The web app runs on `http://localhost:3000` and the API runs on `http://localhost:3001`.

## Environment

The backend LLM integration uses only these model-secret environment variables:

- `LLM_API_KEY`
- `LLM_MODEL`

Redis connectivity uses `REDIS_URL`. No API keys or provider secrets are committed to the repo.

## NestJS Streaming Contract

- `LlmService` accepts `{ history: Turn[], newMessage: string }` and forwards the full conversation history to the LLM before streaming.
- `LlmService.streamReply()` returns an `AsyncGenerator<string>` of token chunks.
- Department contact data is embedded in the system prompt — no separate tool-calling round trip.
- `POST /chat/:sessionId/message` responds as `text/event-stream`.
- Each streamed token is emitted as `data: {"token":"..."}`.
- On successful completion the final event is `data: {"done":true,"turnIndex":N}`.
- The assistant reply is stored in session history only after the stream completes successfully.
- If the LLM fails mid-stream, the controller emits `data: {"error":"..."}` and closes the stream.
- The Gemini streaming endpoint is `:generateContent?alt=sse` — the older `:streamGenerateContent` path no longer exists.

Relevant files:

- [apps/api/src/llm/llm.service.ts](/mnt/c/Users/vikto/Downloads/test/apps/api/src/llm/llm.service.ts)
- [apps/api/src/chat/chat.controller.ts](/mnt/c/Users/vikto/Downloads/test/apps/api/src/chat/chat.controller.ts)
- [apps/api/test/llm.service.spec.ts](/mnt/c/Users/vikto/Downloads/test/apps/api/test/llm.service.spec.ts)
- [apps/api/test/chat.controller.spec.ts](/mnt/c/Users/vikto/Downloads/test/apps/api/test/chat.controller.spec.ts)

## Docker

Run:

```bash
docker compose up --build
```

That builds both workspaces and starts Redis, NestJS on port `3001`, and Next.js on port `3000`.

For Docker Compose, the web container talks to the API at `http://api:3001` internally. Do not set `NESTJS_BASE_URL=http://localhost:3001` inside the web container, or the BFF will fail with `ECONNREFUSED`.
For Docker Compose, the API container talks to Redis at `redis://redis:6379` internally. Do not use `REDIS_URL=redis://localhost:6379` inside the API container, or session creation will fail with connection errors.

## Sample Q&A

1. Q: `What GPA do I need to keep my merit scholarship?`
   A: The assistant answers from the Northwind University policy domain and explains the minimum GPA rule and where students can confirm it.

2. Q: `Who should I contact in the Computer Science department?`
   A: The assistant answers from department contact data embedded in the system prompt, streaming back the contact person, email, office, and hours.

3. Q: `Tell me the best way to season a cast-iron pan.`
   A: The assistant refuses because the system prompt limits it to Northwind University support topics.

These three examples are intentional:

- one in-domain policy question
- one tool-triggering department lookup
- one off-topic refusal

## BFF Design

The browser never calls NestJS directly. The frontend posts user messages to `app/api/chat/route.ts`, which reads the HTTP-only session cookie, forwards the request to NestJS with `fetch({ cache: 'no-store' })`, and pipes the NestJS SSE stream straight back to the browser.

That design keeps the backend base URL and LLM integration hidden from browser network traces, centralizes session-expiry handling, and lets the frontend consume one stable same-origin API.

## Edge Runtime Bonus

`app/api/chat/route.ts` exports `runtime = 'edge'`. In this mode the proxy stays lightweight and can begin forwarding the SSE stream with low overhead close to the user. The main change is that the route handler avoids Node-specific APIs and only uses Web Platform primitives such as `fetch`, `Response`, and `ReadableStream`.

## Bonus Features

- Edge Runtime:
  [apps/web/app/api/chat/route.ts](/mnt/c/Users/vikto/Downloads/test/apps/web/app/api/chat/route.ts) runs on the Edge runtime.
- Reconnect:
  the frontend retries a dropped stream with `Last-Event-ID`, and NestJS resumes from the stored token offset using Redis-backed stream state.
- Redis sessions:
  [apps/api/src/sessions/session.service.ts](/mnt/c/Users/vikto/Downloads/test/apps/api/src/sessions/session.service.ts) persists sessions in Redis via [apps/api/src/storage/redis-store.service.ts](/mnt/c/Users/vikto/Downloads/test/apps/api/src/storage/redis-store.service.ts).
- Rate limiting:
  the Edge BFF enforces a per-session sliding window limit of `20` chat requests per hour using an HTTP-only cookie and returns `429` with `Retry-After`.

## Tests

- API: `npm run test --workspace @domain-chat/api`
- Web: `npm run test --workspace @domain-chat/web`
- All: `npm test`

### Mandatory Coverage Matrix

#### NestJS unit tests — Jest + NestJS testing utilities

`SessionService` in [apps/api/test/session.service.spec.ts](/mnt/c/Users/vikto/Downloads/test/apps/api/test/session.service.spec.ts)

- create
- retrieve turns
- expire after 30 minutes with mocked `Date.now`
- delete

`LlmService` in [apps/api/test/llm.service.spec.ts](/mnt/c/Users/vikto/Downloads/test/apps/api/test/llm.service.spec.ts)

- mocked HTTP
- full history passed correctly
- token stream forwarded

`ChatController` in [apps/api/test/chat.controller.spec.ts](/mnt/c/Users/vikto/Downloads/test/apps/api/test/chat.controller.spec.ts)

- `POST /session` returns a `201`-style creation result with a `sessionId`
- unknown id returns `404`
- idle-expired id returns `410`
- SSE response sets `Content-Type: text/event-stream`

Additional backend assertions in the same controller spec:

- emits `{"done":true,"turnIndex":N}` on success
- persists the assistant turn only after successful completion
- emits `{"error":"LLM unavailable"}` on mid-stream failure
- does not persist an assistant turn after mid-stream failure

#### Next.js tests — Jest + @testing-library/react

`ChatBox` in [apps/web/__tests__/ChatBox.test.tsx](/mnt/c/Users/vikto/Downloads/test/apps/web/__tests__/ChatBox.test.tsx)

- renders `initialMessages`
- optimistic bubble appears before fetch resolves
- rollback on error

Screenshots
<img width="1582" height="756" alt="image" src="https://github.com/user-attachments/assets/0d6936bb-cda1-4bd0-b9c2-d69b3943a4b9" />
<img width="1248" height="245" alt="image" src="https://github.com/user-attachments/assets/0bd2c33d-8703-4aaf-9ce3-e7a8ac5f0f3b" />
<img width="1166" height="848" alt="image" src="https://github.com/user-attachments/assets/166e545d-7594-4165-93dc-5cd78af31c12" />




`/api/chat` Route Handler in [apps/web/__tests__/api-chat-route.test.ts](/mnt/c/Users/vikto/Downloads/test/apps/web/__tests__/api-chat-route.test.ts)

- proxies the stream correctly
- returns `sessionExpired` on `410` from NestJS

Additional BFF assertions in the same route test:

- returns `sessionExpired` when the session cookie is missing
- returns `502` on non-session upstream failures
