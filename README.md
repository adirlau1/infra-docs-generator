# Infra Docs Generator

Analyze infrastructure-as-code and generate structured technical documentation automatically.

Supports Terraform, Kubernetes, Docker Compose, and generic config files. Extracts services, dependencies, external integrations, deployment patterns, and operational risks — not generic descriptions.

Built by [Andrei Dirlau](https://github.com/andreidirlau).

---

## Features

- **Terraform** — resources, providers, modules, inter-resource dependencies
- **Kubernetes** — deployments, services, statefulsets, ingress, config maps
- **Docker Compose** — service graphs, dependency chains, volume and network topology
- **Generic configs** — environment files, YAML/TOML configuration

**Output includes:**
- Architecture summary and deployment pattern
- Per-service breakdown with role classification (API, worker, database, cache, queue, proxy, scheduler)
- External integrations (cloud services, managed DBs, third-party APIs)
- Risks: hardcoded secrets, missing health checks, single points of failure, exposed ports, no backups
- Runbook notes for day-one engineers
- Structured JSON matching a defined schema

**Multiple file upload:** Select a full Terraform project, a Kubernetes namespace worth of manifests, or a mixed set of configs — the analyzer infers cross-file relationships and produces a unified view of the infrastructure.

---

## Setup

### Prerequisites

- Python 3.11+
- An OpenAI API key

### Install

```bash
git clone https://github.com/andreidirlau/infra-docs-generator
cd infra-docs-generator

python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate

pip install -r backend/requirements.txt
```

### Configure

```bash
cp .env.example .env
# Edit .env and set OPENAI_API_KEY
```

### Run

```bash
uvicorn backend.main:app --reload --port 8000
```

Open [http://localhost:8000](http://localhost:8000) in your browser.

---

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `OPENAI_API_KEY` | Yes | — | Your OpenAI API key |
| `OPENAI_MODEL` | No | `gpt-4o-mini` | Model to use (e.g. `gpt-4o`, `gpt-4o-mini`) |

---

## API

### `GET /health`

Returns `{"status": "ok"}`.

### `POST /analyze`

Accepts `multipart/form-data` with either:
- `file` — uploaded config file
- `content` — raw config text (string)
- `filename` — optional filename hint for type detection

**Response:**

```json
{
  "services": [
    {
      "name": "api-server",
      "type": "api",
      "description": "...",
      "depends_on": ["postgres", "redis"],
      "exposes": ["8080/HTTP"],
      "external_dependencies": ["Stripe API"]
    }
  ],
  "architecture_summary": "...",
  "deployment_pattern": "microservices — ...",
  "external_integrations": ["AWS RDS", "ElastiCache", "Stripe"],
  "risks": [
    "STRIPE_SECRET_KEY is hardcoded in the deployment manifest — rotate immediately and move to a Kubernetes Secret"
  ],
  "runbook_notes": [
    "postgres runs as a StatefulSet with a single replica — there is no read replica or failover; plan for downtime during node maintenance"
  ],
  "file_type": "kubernetes"
}
```

---

## Example Inputs

Three example configs are built into the UI:

**Kubernetes microservice stack** — api-server, worker, postgres StatefulSet, Redis, RabbitMQ. Demonstrates dependency mapping, hardcoded secret detection, missing probe detection.

**Terraform AWS infra** — VPC, EC2, RDS Postgres, ElastiCache Redis, S3, Lambda. Demonstrates `publicly_accessible = true`, `skip_final_snapshot = true`, and hardcoded credential detection.

**Docker Compose app** — Nginx reverse proxy, FastAPI backend, Celery worker, Celery Beat scheduler, Postgres with persistent volume, Redis. Demonstrates full dependency graph and multi-service risk analysis.

---

## Troubleshooting

### `__init__() got an unexpected keyword argument 'proxies'`

This happens when `httpx >= 0.28.0` is installed. That release removed the `proxies` argument that the OpenAI SDK passes internally. The fix is already in `requirements.txt`:

```
httpx>=0.23.0,<0.28.0
```

If you hit this after a fresh install, force a reinstall:

```bash
pip install --force-reinstall -r backend/requirements.txt
```

### `ModuleNotFoundError: No module named 'analyzer'`

Run uvicorn from the project root, not from inside `backend/`:

```bash
# correct
uvicorn backend.main:app --reload --port 8000

# wrong — causes import errors
cd backend && uvicorn main:app ...
```

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m "add your feature"`
4. Push and open a pull request

Bug reports and feature requests are welcome via GitHub Issues.

---

## License

MIT License — see [LICENSE](LICENSE).

Copyright (c) 2026 Andrei Dirlau
