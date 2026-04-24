'use strict';

// ── Example configs ───────────────────────────────────────────────────────────

const EXAMPLES = {
  kubernetes: `apiVersion: apps/v1
kind: Deployment
metadata:
  name: api-server
  namespace: production
spec:
  replicas: 3
  selector:
    matchLabels:
      app: api-server
  template:
    metadata:
      labels:
        app: api-server
    spec:
      containers:
      - name: api-server
        image: myapp/api:latest
        ports:
        - containerPort: 8080
        env:
        - name: DATABASE_URL
          value: "postgres://postgres:secret123@postgres:5432/myapp"
        - name: REDIS_URL
          value: "redis://cache:6379"
        - name: STRIPE_SECRET_KEY
          value: "sk_live_4xTs3cretK3yH4rdC0d3d"
        - name: JWT_SECRET
          value: "mysupersecretjwtsigningkey"
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: worker
  namespace: production
spec:
  replicas: 2
  template:
    spec:
      containers:
      - name: worker
        image: myapp/worker:latest
        env:
        - name: DATABASE_URL
          value: "postgres://postgres:secret123@postgres:5432/myapp"
        - name: RABBITMQ_URL
          value: "amqp://guest:guest@rabbitmq:5672"
---
apiVersion: v1
kind: Service
metadata:
  name: api-server
  namespace: production
spec:
  selector:
    app: api-server
  ports:
  - port: 80
    targetPort: 8080
  type: LoadBalancer
---
apiVersion: apps/v1
kind: StatefulSet
metadata:
  name: postgres
  namespace: production
spec:
  serviceName: postgres
  replicas: 1
  selector:
    matchLabels:
      app: postgres
  template:
    metadata:
      labels:
        app: postgres
    spec:
      containers:
      - name: postgres
        image: postgres:14
        env:
        - name: POSTGRES_PASSWORD
          value: "secret123"
        ports:
        - containerPort: 5432
---
apiVersion: apps/v1
kind: Deployment
metadata:
  name: cache
  namespace: production
spec:
  replicas: 1
  selector:
    matchLabels:
      app: cache
  template:
    metadata:
      labels:
        app: cache
    spec:
      containers:
      - name: redis
        image: redis:7-alpine
        ports:
        - containerPort: 6379`,

  terraform: `terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "us-east-1"
}

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true

  tags = {
    Name        = "main-vpc"
    Environment = "production"
  }
}

resource "aws_subnet" "public" {
  vpc_id            = aws_vpc.main.id
  cidr_block        = "10.0.1.0/24"
  availability_zone = "us-east-1a"
}

resource "aws_instance" "web" {
  ami           = "ami-0c55b159cbfafe1f0"
  instance_type = "t3.micro"
  subnet_id     = aws_subnet.public.id

  tags = {
    Name = "web-server"
  }
}

resource "aws_db_instance" "postgres" {
  identifier        = "myapp-db"
  engine            = "postgres"
  engine_version    = "14.9"
  instance_class    = "db.t3.micro"
  db_name           = "myapp"
  username          = "admin"
  password          = "hardcoded_db_password_123"
  allocated_storage = 20

  skip_final_snapshot = true
  publicly_accessible = true

  tags = {
    Name = "myapp-db"
  }
}

resource "aws_elasticache_cluster" "redis" {
  cluster_id           = "myapp-cache"
  engine               = "redis"
  node_type            = "cache.t3.micro"
  num_cache_nodes      = 1
  parameter_group_name = "default.redis7"
  engine_version       = "7.0"
  port                 = 6379
}

resource "aws_s3_bucket" "assets" {
  bucket = "myapp-assets-prod"
}

resource "aws_lambda_function" "processor" {
  filename      = "processor.zip"
  function_name = "myapp-processor"
  role          = aws_iam_role.lambda_exec.arn
  handler       = "index.handler"
  runtime       = "nodejs18.x"
  timeout       = 30

  environment {
    variables = {
      DB_URL    = "postgres://admin:hardcoded_db_password_123@\${aws_db_instance.postgres.endpoint}/myapp"
      CACHE_URL = aws_elasticache_cluster.redis.cache_nodes[0].address
    }
  }
}

resource "aws_iam_role" "lambda_exec" {
  name = "lambda-exec-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}`,

  'docker-compose': `version: '3.8'

services:
  nginx:
    image: nginx:1.24-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./certs:/etc/nginx/certs:ro
    depends_on:
      - api
    restart: always

  api:
    build:
      context: ./api
      dockerfile: Dockerfile
    ports:
      - "8000:8000"
    environment:
      - DATABASE_URL=postgresql://appuser:apppassword@postgres:5432/myapp
      - REDIS_URL=redis://redis:6379/0
      - CELERY_BROKER_URL=redis://redis:6379/1
      - SECRET_KEY=my_super_secret_key_do_not_share
      - SENDGRID_API_KEY=SG.h4rdcod3dS3ndgridKey
      - AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE
      - AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY
      - AWS_S3_BUCKET=myapp-uploads
    depends_on:
      - postgres
      - redis
    restart: on-failure

  worker:
    build:
      context: ./worker
      dockerfile: Dockerfile
    environment:
      - DATABASE_URL=postgresql://appuser:apppassword@postgres:5432/myapp
      - CELERY_BROKER_URL=redis://redis:6379/1
    depends_on:
      - postgres
      - redis
    restart: on-failure

  scheduler:
    build:
      context: ./worker
    command: celery beat -A tasks --schedule=/tmp/celerybeat-schedule
    environment:
      - DATABASE_URL=postgresql://appuser:apppassword@postgres:5432/myapp
      - CELERY_BROKER_URL=redis://redis:6379/1
    depends_on:
      - postgres
      - redis
    restart: on-failure

  postgres:
    image: postgres:15-alpine
    environment:
      - POSTGRES_USER=appuser
      - POSTGRES_PASSWORD=apppassword
      - POSTGRES_DB=myapp
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: always

  redis:
    image: redis:7-alpine
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
    restart: always

volumes:
  postgres_data:`,
};

// ── State ─────────────────────────────────────────────────────────────────────

let activeTab = 'paste';
let uploadedFiles = [];  // Array<File>
let lastResult = null;

// ── DOM refs ──────────────────────────────────────────────────────────────────

const analyzeBtn     = document.getElementById('analyze-btn');
const btnText        = analyzeBtn.querySelector('.btn-text');
const btnSpinner     = analyzeBtn.querySelector('.btn-spinner');
const errorMsg       = document.getElementById('error-msg');
const configInput    = document.getElementById('config-input');
const uploadZone     = document.getElementById('upload-zone');
const fileInput      = document.getElementById('file-input');
const fileList       = document.getElementById('file-list');
const fileListCount  = document.getElementById('file-list-count');
const fileNameList   = document.getElementById('file-name-list');
const fileRemove     = document.getElementById('file-remove');
const resultsEl      = document.getElementById('results');
const panelPaste     = document.getElementById('panel-paste');
const panelUpload    = document.getElementById('panel-upload');

// ── Tab switching ─────────────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    activeTab = tab;

    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tab);
      b.setAttribute('aria-selected', b.dataset.tab === tab ? 'true' : 'false');
    });

    panelPaste.classList.toggle('hidden', tab !== 'paste');
    panelUpload.classList.toggle('hidden', tab !== 'upload');
  });
});

// ── File upload ───────────────────────────────────────────────────────────────

uploadZone.addEventListener('click', () => fileInput.click());

uploadZone.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') fileInput.click();
});

uploadZone.addEventListener('dragover', e => {
  e.preventDefault();
  uploadZone.classList.add('dragover');
});

uploadZone.addEventListener('dragleave', () => uploadZone.classList.remove('dragover'));

uploadZone.addEventListener('drop', e => {
  e.preventDefault();
  uploadZone.classList.remove('dragover');
  if (e.dataTransfer.files.length) setFiles(e.dataTransfer.files);
});

fileInput.addEventListener('change', () => {
  if (fileInput.files.length) setFiles(fileInput.files);
});

fileRemove.addEventListener('click', clearFiles);

function setFiles(fileListInput) {
  uploadedFiles = Array.from(fileListInput);
  renderFileList();
  uploadZone.classList.add('hidden');
  fileList.classList.remove('hidden');
}

function renderFileList() {
  const count = uploadedFiles.length;
  fileListCount.textContent = `${count} file${count !== 1 ? 's' : ''} selected`;
  fileNameList.innerHTML = '';
  uploadedFiles.forEach(f => {
    const li = document.createElement('li');
    li.textContent = f.name;
    fileNameList.appendChild(li);
  });
}

function clearFiles() {
  uploadedFiles = [];
  fileInput.value = '';
  fileList.classList.add('hidden');
  uploadZone.classList.remove('hidden');
}

// ── Examples ──────────────────────────────────────────────────────────────────

document.querySelectorAll('.example-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.example;
    const config = EXAMPLES[key];
    if (!config) return;

    // Switch to paste tab
    activeTab = 'paste';
    document.querySelectorAll('.tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === 'paste');
      b.setAttribute('aria-selected', b.dataset.tab === 'paste' ? 'true' : 'false');
    });
    panelPaste.classList.remove('hidden');
    panelUpload.classList.add('hidden');

    configInput.value = config;
    clearError();
  });
});

// ── Analyze ───────────────────────────────────────────────────────────────────

analyzeBtn.addEventListener('click', runAnalysis);

async function runAnalysis() {
  clearError();

  const isUploadTab = activeTab === 'upload';

  if (isUploadTab && uploadedFiles.length === 0) {
    showError('Select at least one file first.');
    return;
  }

  if (!isUploadTab && !configInput.value.trim()) {
    showError('Paste a config or select an example first.');
    return;
  }

  setLoading(true);
  resultsEl.classList.add('hidden');

  try {
    const formData = new FormData();

    if (isUploadTab) {
      uploadedFiles.forEach(f => formData.append('files', f));
    } else {
      formData.append('content', configInput.value.trim());
    }

    const res = await fetch('/analyze', {
      method: 'POST',
      body: formData,
    });

    const data = await res.json();

    if (!res.ok) {
      throw new Error(data.detail || `Request failed (${res.status})`);
    }

    lastResult = data;
    renderResults(data);
    resultsEl.classList.remove('hidden');
    resultsEl.scrollIntoView({ behavior: 'smooth', block: 'start' });

  } catch (err) {
    showError(err.message || 'Unexpected error — check the server logs.');
  } finally {
    setLoading(false);
  }
}

// ── Render ────────────────────────────────────────────────────────────────────

function renderResults(data) {
  renderMeta(data);
  renderSummary(data);
  renderDocumentation(data);
  renderServices(data);
  renderIntegrations(data);
  renderRisks(data);
  renderRunbook(data);
  renderJson(data);
}

function renderMeta(data) {
  const meta = document.getElementById('results-meta');
  meta.innerHTML = '';

  const fileTypeBadge = createElement('span', 'badge badge-type',
    escHtml(fileTypeLabel(data.file_type)));
  meta.appendChild(fileTypeBadge);

  if (data.deployment_pattern) {
    const pattern = data.deployment_pattern.split('—')[0].split('–')[0].trim();
    const patternBadge = createElement('span', 'badge badge-pattern', escHtml(pattern));
    meta.appendChild(patternBadge);
  }
}

function renderSummary(data) {
  const el = document.getElementById('architecture-summary');
  el.textContent = data.architecture_summary || '—';
}

function renderDocumentation(data) {
  const el = document.getElementById('documentation');
  el.innerHTML = '';

  if (!data.documentation) {
    el.textContent = '—';
    return;
  }

  data.documentation.split(/\n{2,}/).forEach(paragraph => {
    if (paragraph.trim()) {
      const p = document.createElement('p');
      p.textContent = paragraph.trim();
      el.appendChild(p);
    }
  });
}

function renderServices(data) {
  const grid = document.getElementById('services-grid');
  grid.innerHTML = '';

  const services = data.services || [];
  if (!services.length) {
    grid.textContent = 'No services detected.';
    return;
  }

  services.forEach(svc => {
    const card = document.createElement('div');
    card.className = 'service-card';

    const type = (svc.type || 'other').toLowerCase();
    const typeClass = `type-${type}`;

    card.innerHTML = `
      <div class="service-header">
        <span class="service-name">${escHtml(svc.name || '—')}</span>
        <span class="service-type-badge ${escHtml(typeClass)}">${escHtml(type)}</span>
      </div>
      <p class="service-desc">${escHtml(svc.description || '')}</p>
      <div class="service-meta">
        ${metaRow('Deps', svc.depends_on)}
        ${metaRow('Exposes', svc.exposes)}
        ${metaRow('External', svc.external_dependencies)}
      </div>
    `;

    grid.appendChild(card);
  });
}

function metaRow(label, items) {
  if (!items || !items.length) return '';
  const tags = items.map(i => `<span class="meta-tag">${escHtml(i)}</span>`).join('');
  return `
    <div class="service-meta-row">
      <span class="meta-label">${escHtml(label)}</span>
      <span class="meta-tags">${tags}</span>
    </div>
  `;
}

function renderIntegrations(data) {
  const list = document.getElementById('integrations-list');
  list.innerHTML = '';

  const items = data.external_integrations || [];
  if (!items.length) {
    list.innerHTML = '<li style="color:var(--text-dim);font-size:0.85rem">None detected</li>';
    return;
  }

  items.forEach(item => {
    const li = document.createElement('li');
    li.textContent = item;
    list.appendChild(li);
  });
}

function renderRisks(data) {
  const list = document.getElementById('risks-list');
  list.innerHTML = '';

  const risks = data.risks || [];
  if (!risks.length) {
    list.innerHTML = '<li style="color:var(--green);font-size:0.85rem">No critical risks detected</li>';
    return;
  }

  risks.forEach(risk => {
    const li = document.createElement('li');
    li.className = 'risk-item';
    li.innerHTML = `<span class="risk-bullet"></span><span>${escHtml(risk)}</span>`;
    list.appendChild(li);
  });
}

function renderRunbook(data) {
  const list = document.getElementById('runbook-list');
  list.innerHTML = '';

  const notes = data.runbook_notes || [];
  if (!notes.length) {
    list.innerHTML = '<li style="color:var(--text-dim);font-size:0.85rem">No runbook notes generated</li>';
    return;
  }

  notes.forEach((note, i) => {
    const li = document.createElement('li');
    li.className = 'runbook-item';
    li.innerHTML = `<span class="runbook-num">${String(i + 1).padStart(2, '0')}</span><span>${escHtml(note)}</span>`;
    list.appendChild(li);
  });
}

function renderJson(data) {
  const output = document.getElementById('json-output');

  // Build the structured JSON matching the spec (exclude internal file_type from main output)
  const structured = {
    services: data.services || [],
    architecture_summary: data.architecture_summary || '',
    deployment_pattern: data.deployment_pattern || '',
    external_integrations: data.external_integrations || [],
    risks: data.risks || [],
    runbook_notes: data.runbook_notes || [],
  };

  output.textContent = JSON.stringify(structured, null, 2);
}

// ── Copy JSON ─────────────────────────────────────────────────────────────────

document.getElementById('copy-json-btn').addEventListener('click', async () => {
  const btn = document.getElementById('copy-json-btn');
  const text = document.getElementById('json-output').textContent;

  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = 'Copied!';
    btn.classList.add('copied');
    setTimeout(() => {
      btn.textContent = 'Copy';
      btn.classList.remove('copied');
    }, 2000);
  } catch {
    // Fallback for browsers without clipboard API
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    btn.textContent = 'Copied!';
    setTimeout(() => { btn.textContent = 'Copy'; }, 2000);
  }
});

// ── UI helpers ────────────────────────────────────────────────────────────────

function setLoading(on) {
  analyzeBtn.disabled = on;
  btnText.textContent = on ? 'Analyzing…' : 'Analyze';
  btnSpinner.classList.toggle('hidden', !on);
}

function showError(msg) {
  errorMsg.textContent = msg;
  errorMsg.classList.remove('hidden');
}

function clearError() {
  errorMsg.textContent = '';
  errorMsg.classList.add('hidden');
}

function escHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function createElement(tag, className, text) {
  const el = document.createElement(tag);
  el.className = className;
  el.textContent = text;
  return el;
}

function fileTypeLabel(type) {
  const map = {
    terraform: 'Terraform',
    kubernetes: 'Kubernetes',
    'docker-compose': 'Docker Compose',
    generic: 'Generic Config',
    'multi-file': 'Multi-file Project',
  };
  return map[type] || type || 'Unknown';
}
