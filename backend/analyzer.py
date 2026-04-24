import os
import json
import yaml
from openai import OpenAI

_client = None

def get_client() -> OpenAI:
    global _client
    if _client is None:
        _client = OpenAI(api_key=os.environ["OPENAI_API_KEY"])
    return _client


MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o-mini")

SYSTEM_PROMPT = """You are a senior DevOps and platform engineering expert analyzing infrastructure-as-code.

Your job: produce precise, opinionated technical documentation. Not descriptions of syntax — interpretations of intent, architecture, and risk.

You may receive a single file or multiple files from the same infrastructure project, separated by --- FILE: filename --- headers. When multiple files are present, infer cross-file relationships: variables defined in one file and consumed in another, modules referenced across files, services that depend on resources from sibling configs.

Rules:
- Never describe file format or syntax ("this is a YAML file", "this defines a resource")
- Never state obvious facts visible in the config without adding insight
- Always infer purpose, relationships, and operational implications
- Identify service roles explicitly: api, worker, database, queue, cache, proxy, scheduler, gateway
- Map dependency chains: which services call or rely on which, and why that matters
- Detect external integrations: cloud providers, managed services, third-party APIs, SaaS
- When multiple files are present, synthesize a unified view — do not treat each file independently
- Flag concrete risks with specific consequences:
    - Missing resource limits or requests → OOM kills or noisy neighbors
    - Hardcoded secrets or passwords in env vars or config → credential exposure in logs and version control
    - Missing liveness/readiness probes → undetectable hangs, bad traffic routing
    - Single points of failure → replicas=1 for stateful services, no multi-AZ
    - Exposed ports without auth context → attack surface
    - skip_final_snapshot = true on databases → data loss on destroy
    - publicly_accessible = true on databases → direct internet exposure
    - No persistent volumes for stateful workloads → data loss on pod restart
- Write runbook notes that a new team member would need on day one

Return ONLY a valid JSON object. No markdown, no code fences, no explanation outside the JSON.

Required structure:
{
  "documentation": "Multi-paragraph human-readable documentation. Name specific services, ports, environment variables, and their operational implications. When multiple files are provided, explain how they relate and what the combined system does.",
  "services": [
    {
      "name": "exact name from the config",
      "type": "api|worker|database|cache|queue|proxy|scheduler|gateway|other",
      "description": "What this service does in context of this architecture and why it exists",
      "depends_on": ["service names this directly depends on"],
      "exposes": ["port/protocol combinations or notable endpoints"],
      "external_dependencies": ["external services, cloud APIs, or managed resources this connects to"]
    }
  ],
  "architecture_summary": "One paragraph: what this system does, how components relate, and its deployment model",
  "deployment_pattern": "microservices|monolith|event-driven|serverless|hybrid|pipeline|other — followed by a brief explanation of why",
  "external_integrations": ["specific external systems detected, named precisely: AWS RDS, ElastiCache, S3, SendGrid, Stripe, etc."],
  "risks": ["Each as a specific actionable sentence. Bad: 'missing health checks'. Good: 'api-server has no liveness probe — Kubernetes cannot detect hung processes and will not restart them, causing silent failures under load'"],
  "runbook_notes": ["Practical, standalone operational tip. Each note is actionable by a new engineer without additional context"]
}"""


def detect_file_type(content: str, filename: str = "") -> str:
    fn = filename.lower()

    if fn.endswith(".tf") or fn.endswith(".tfvars"):
        return "terraform"

    if "docker-compose" in fn or fn in ("compose.yml", "compose.yaml"):
        return "docker-compose"

    terraform_signals = [
        'resource "aws_', 'resource "google_', 'resource "azurerm_',
        'resource "kubernetes_', 'provider "aws"', 'provider "google"',
        'terraform {', 'variable "', 'output "', 'module "',
    ]
    if any(sig in content for sig in terraform_signals):
        return "terraform"

    try:
        docs = [d for d in yaml.safe_load_all(content) if d is not None]
        if docs:
            if any(isinstance(d, dict) and ("apiVersion" in d or "kind" in d) for d in docs):
                return "kubernetes"

            first = docs[0]
            if isinstance(first, dict) and "services" in first:
                services = first["services"]
                if isinstance(services, dict) and any(
                    isinstance(v, dict) and ("image" in v or "build" in v)
                    for v in services.values()
                ):
                    return "docker-compose"
    except Exception:
        pass

    return "generic"


def analyze(content: str, filename: str = "", is_multi: bool = False) -> dict:
    if is_multi:
        file_type = "multi-file"
        user_msg = f"Analyze this infrastructure project spanning multiple files:\n\n{content}"
    else:
        file_type = detect_file_type(content, filename)
        labels = {
            "terraform": "Terraform infrastructure configuration",
            "kubernetes": "Kubernetes manifests",
            "docker-compose": "Docker Compose stack",
            "generic": "infrastructure configuration file",
        }
        label = labels.get(file_type, "configuration")
        user_msg = f"Analyze this {label}:\n\n```\n{content}\n```"
        if filename:
            user_msg += f"\n\nFilename: {filename}"

    client = get_client()
    response = client.chat.completions.create(
        model=MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ],
        response_format={"type": "json_object"},
        temperature=0.2,
    )

    result = json.loads(response.choices[0].message.content)
    result["file_type"] = file_type

    for key in ("services", "external_integrations", "risks", "runbook_notes"):
        if not isinstance(result.get(key), list):
            result[key] = []
    for key in ("architecture_summary", "deployment_pattern", "documentation"):
        if not isinstance(result.get(key), str):
            result[key] = ""

    for svc in result.get("services", []):
        for list_key in ("depends_on", "exposes", "external_dependencies"):
            if not isinstance(svc.get(list_key), list):
                svc[list_key] = []

    return result
