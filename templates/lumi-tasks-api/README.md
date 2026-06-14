# Lumi Tasks API

The backend service that owns the **Tasks** resource for Lumi.

## Stack
- NestJS (TypeScript)
- In-memory store (no database — data resets on restart)
- Jest + Supertest for tests

## Run locally
```bash
npm ci
npm run start:dev
```
API is served at http://localhost:3000.

## Test
```bash
npm test
```

## Architecture
The Tasks resource follows the standard NestJS layering:
- `tasks.controller.ts` — HTTP routes
- `tasks.service.ts` — business logic + the in-memory store
- `task.entity.ts` — the Task shape
- `dto/` — request validation (class-validator)

## Current API
| Method | Route      | Description    |
|--------|------------|----------------|
| GET    | /tasks     | List all tasks |
| GET    | /tasks/:id | Get one task   |
| POST   | /tasks     | Create a task  |
| PATCH  | /tasks/:id | Update a task  |
| DELETE | /tasks/:id | Delete a task  |

## Conventions
- Validate input with DTOs + `class-validator`.
- Throw `NotFoundException` for missing resources.
- Add/extend tests in `test/` following the existing e2e pattern.
