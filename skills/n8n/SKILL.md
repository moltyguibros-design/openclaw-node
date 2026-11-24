---
name: n8n
description: Manage n8n workflows and automations via API. Use when working with n8n workflows, executions, or automation tasks - listing workflows, activating/deactivating, checking execution status, or debugging automation issues.
triggers:
  - "list my n8n workflows"
  - "check n8n execution status"
  - "activate the workflow"
  - "debug my automation"
negative_triggers:
  - "create a new automation from scratch"
  - "set up a cron job"
  - "build a Zapier integration"
---

# n8n Workflow Management

Interact with n8n automation platform via REST API.

## Setup

**First-time setup:**

1. Base URL and API key must be stored in environment:
```bash
export N8N_BASE_URL="http://localhost:5678"
export N8N_API_KEY="your-api-key-here"
```

The client needs the Python `requests` package; the installer installs it from
`requirements.txt`.

2. Verify connection:
```bash
python3 scripts/n8n_api.py list-workflows --pretty
```

For persistent storage, add to `~/.bashrc` or `~/.zshrc`:
```bash
echo 'export N8N_BASE_URL="http://localhost:5678"' >> ~/.bashrc
echo 'export N8N_API_KEY="your-key"' >> ~/.bashrc
```

## Quick Reference

### List Workflows
```bash
python3 scripts/n8n_api.py list-workflows --pretty
python3 scripts/n8n_api.py list-workflows --active true --pretty
```

### Get Workflow Details
```bash
python3 scripts/n8n_api.py get-workflow --id <workflow-id> --pretty
```

### Activate/Deactivate
```bash
python3 scripts/n8n_api.py activate --id <workflow-id>
python3 scripts/n8n_api.py deactivate --id <workflow-id>
```

### Executions
```bash
# List recent executions
python3 scripts/n8n_api.py list-executions --limit 10 --pretty

# Get execution details
python3 scripts/n8n_api.py get-execution --id <execution-id> --pretty

# Filter by workflow
python3 scripts/n8n_api.py list-executions --id <workflow-id> --limit 20 --pretty
```

### Manual Execution
The n8n public API has no endpoint that runs a workflow. Give the workflow a
Webhook trigger and call its webhook URL instead.

## Python API

For programmatic access:

```python
from scripts.n8n_api import N8nClient

client = N8nClient()

# List workflows
workflows = client.list_workflows(active=True)

# Get workflow
workflow = client.get_workflow('workflow-id')

# Activate/deactivate
client.activate_workflow('workflow-id')
client.deactivate_workflow('workflow-id')

# Executions
executions = client.list_executions(workflow_id='workflow-id', limit=10)
execution = client.get_execution('execution-id')
```

## Common Tasks

### Debug Failed Workflows
1. List recent executions with failures
2. Get execution details to see error
3. Check workflow configuration
4. Deactivate if needed

### Monitor Workflow Health
1. List active workflows
2. Check recent execution status
3. Review error patterns

### Workflow Management
1. List all workflows
2. Review active/inactive status
3. Activate/deactivate as needed
4. Delete old workflows

## API Reference

For detailed API documentation, see [references/api.md](references/api.md).

## Troubleshooting

**Authentication error:**
- Verify N8N_API_KEY is set: `echo $N8N_API_KEY`
- Check API key is valid in n8n UI

**Connection error:**
- Verify N8N_BASE_URL is set to the instance root, without `/api/v1`: `echo $N8N_BASE_URL`

**Command errors:**
- Use `--pretty` flag for readable output
- Check `--id` is provided when required
