# Infra Docs Generator

Drop in your infrastructure files. Get back documentation that's actually useful.

Built by [Andrei Dirlau](https://github.com/andreidirlau).

---

## The problem

Infrastructure repositories accumulate complexity faster than documentation can keep up. A Terraform repo that started with a VPC and an RDS instance now spans dozens of modules, environment overlays, and implicit dependencies between resources. A Kubernetes namespace that once had three deployments now has fifteen, with service meshes, init containers, and config maps referenced across files no one fully remembers.

New engineers spend days piecing together what connects to what. Incident responders dig through files to find which service owns a database. Teams inherit systems from other teams with no handover documentation at all.

The documentation is either missing, outdated, or so high-level it's useless.

---

## What this does

Infra Docs Generator reads your infrastructure config files — Terraform, Kubernetes manifests, Docker Compose stacks, or any combination — and produces structured documentation that answers the questions teams actually ask:

- What services exist and what role does each one play?
- What depends on what?
- What external systems are involved?
- What's misconfigured or risky?
- What does a new engineer need to know to operate this safely?

Upload a single file or an entire project's worth of configs at once. The tool infers cross-file relationships and produces a unified view, not a per-file summary.

---

## Use cases

**Onboarding engineers** — Instead of scheduling a two-hour knowledge transfer, point a new hire at the repo. They get a service map, dependency graph, and a list of operational notes before their first standup.

**Understanding legacy infrastructure** — When you inherit a system with no documentation, this gives you a starting point. It won't replace reading the code, but it will tell you where to start reading.

**Incident response** — When something breaks at 2am, knowing that `payment-worker` depends on both Postgres and RabbitMQ, and that there's only one replica of each, is information you want immediately, not after digging through YAML.

**Internal platform documentation** — Platform teams maintain infrastructure used by multiple product teams. Keeping that documentation accurate is a maintenance burden. Running this against the repo on every significant change keeps the docs in sync.

---

## Example

**Input** (`docker-compose.yml`):

```yaml
services:
  api:
    build: ./api
    environment:
      - DATABASE_URL=postgresql://user:password@postgres:5432/myapp
      - STRIPE_API_KEY=sk_live_abc123
    depends_on:
      - postgres
      - redis

  worker:
    build: ./worker
    environment:
      - DATABASE_URL=postgresql://user:password@postgres:5432/myapp
      - CELERY_BROKER_URL=redis://redis:6379/1
    depends_on:
      - postgres
      - redis

  postgres:
    image: postgres:15-alpine
    volumes:
      - postgres_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
```

**Output (excerpt)**:

```
Architecture Summary
A four-service application stack built around a FastAPI backend and a Celery
task queue. The api service handles synchronous request processing while worker
handles async jobs, both sharing a Postgres database. Redis serves dual purpose:
cache for the api and message broker for Celery.
```

```json
{
  "services": [
    {
      "name": "api",
      "type": "api",
      "description": "Synchronous request handler. Connects to Postgres for persistence and Redis for caching. Processes Stripe webhooks based on the API key present.",
      "depends_on": ["postgres", "redis"],
      "exposes": ["8000/HTTP"],
      "external_dependencies": ["Stripe API"]
    },
    {
      "name": "worker",
      "type": "worker",
      "description": "Celery task queue consumer. Handles async workloads offloaded by the api service, with Redis as the broker on database 1.",
      "depends_on": ["postgres", "redis"],
      "exposes": [],
      "external_dependencies": []
    }
  ],
  "risks": [
    "STRIPE_API_KEY is a live key hardcoded in the compose file — it will be committed to version control and appear in docker inspect output; move to a secrets manager or .env file excluded from git",
    "redis has no resource limits — under load it can exhaust host memory, taking down both the broker and any caching layer simultaneously",
    "worker has no health check — compose cannot detect a stuck Celery process and will not restart it"
  ],
  "runbook_notes": [
    "Both api and worker share DATABASE_URL credentials — rotating the database password requires redeploying both services simultaneously",
    "Redis is used as both a cache (db 0) and Celery broker (db 1) — a Redis restart will drop in-flight tasks, not just cached data; check the worker queue depth before restarting"
  ]
}
```

---

## Features

- **Terraform** — resources, providers, modules, variable resolution, cross-resource references
- **Kubernetes** — deployments, StatefulSets, services, ingress, ConfigMaps, environment injection
- **Docker Compose** — full service graph, volume topology, dependency chains, restart policies
- **Multi-file projects** — upload an entire directory; relationships across files are inferred
- **Risk detection** — hardcoded secrets, missing health checks, single points of failure, exposed databases, no backup configuration
- **Structured output** — machine-readable JSON alongside human-readable documentation
- **Runbook notes** — operational context written for engineers who didn't build the system

---

## Setup

**Requirements:** Python 3.11+, an OpenAI API key.

```bash
git clone https://github.com/andreidirlau/infra-docs-generator
cd infra-docs-generator

python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\activate

pip install -r backend/requirements.txt

cp .env.example .env        # set OPENAI_API_KEY inside

uvicorn backend.main:app --reload --port 8000
```

Open [http://localhost:8000](http://localhost:8000).

**Environment variables:**

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENAI_API_KEY` | Yes | — | Your OpenAI API key |
| `OPENAI_MODEL` | No | `gpt-4o-mini` | Model to use (`gpt-4o` for higher quality) |

---

## API

```
GET  /health
POST /analyze
```

`POST /analyze` accepts `multipart/form-data`:
- `files` — one or more uploaded config files
- `content` — raw pasted text (alternative to file upload)

Returns a JSON object with `services`, `architecture_summary`, `deployment_pattern`, `external_integrations`, `risks`, and `runbook_notes`.

---

## Troubleshooting

**`__init__() got an unexpected keyword argument 'proxies'`**

Caused by `httpx >= 0.28.0`, which removed an argument the OpenAI SDK passes internally. The pin in `requirements.txt` prevents this, but if you see it after a fresh install:

```bash
pip install --force-reinstall -r backend/requirements.txt
```

**`ModuleNotFoundError: No module named 'analyzer'`**

Run uvicorn from the project root, not from inside `backend/`:

```bash
uvicorn backend.main:app --reload --port 8000  # correct
```

---

## Contributing

Bug reports and pull requests are welcome.

1. Fork the repo and create a branch: `git checkout -b your-feature`
2. Make your changes and add tests if applicable
3. Open a pull request with a clear description of what changed and why

---

## License

MIT — see [LICENSE](LICENSE). Copyright (c) 2026 Andrei Dirlau.
