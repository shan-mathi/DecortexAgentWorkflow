#!/bin/bash
# Seeds the deployed environment with the ops-ticket-router workflow.
# Idempotent: deletes existing workflows and nodes first, then re-creates.
#
# Usage:
#   ./infra/scripts/seed-deployed.sh
#
# Reads API_URL from:
#   1. Environment variable: API_URL=https://xxx.execute-api.region.amazonaws.com
#   2. infra/.env file (API_URL=... line)
#
# After deploying via CDK, copy the ApiUrl output into infra/.env:
#   API_URL=https://<your-id>.execute-api.<region>.amazonaws.com

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"
if [ -f "$ENV_FILE" ]; then
  export $(grep -v '^#' "$ENV_FILE" | xargs)
fi

API_URL="${API_URL:-}"

if [ -z "$API_URL" ]; then
  echo "ERROR: API_URL is not set."
  echo ""
  echo "Set it in one of these ways:"
  echo "  1. Add API_URL=https://<id>.execute-api.<region>.amazonaws.com to infra/.env"
  echo "  2. Run: API_URL=https://... ./infra/scripts/seed-deployed.sh"
  echo ""
  echo "You can find the URL in the CDK deploy output (AgentEngine.ApiUrl)"
  exit 1
fi

echo "=== Seeding: $API_URL ==="
echo

# --- Cleanup ---
echo "[0] Cleaning existing data..."
for id in $(curl -sS "$API_URL/api/workflows" | python3 -c 'import json,sys;[print(w["id"]) for w in json.load(sys.stdin)]' 2>/dev/null); do
  curl -sS -X DELETE "$API_URL/api/workflows/$id" > /dev/null 2>&1
done
for id in $(curl -sS "$API_URL/api/nodes" | python3 -c 'import json,sys;[print(n["id"]) for n in json.load(sys.stdin)]' 2>/dev/null); do
  curl -sS -X DELETE "$API_URL/api/nodes/$id" > /dev/null 2>&1
done
echo "  Done"
echo

# --- Register Nodes ---
echo "[1] classify-ticket (LLM)..."
N1=$(curl -sS -X POST "$API_URL/api/nodes" -H 'content-type: application/json' \
  -d '{"name":"classify-ticket","nodeTypeId":"10000000-0000-4000-8000-000000000001","category":"llm","config":{"promptTemplate":"Classify the urgency of this support ticket as exactly one of: LOW, MED, or HIGH. Reply with only the label. Subject: {{input.subject}} Description: {{input.description}}","model":"apac.amazon.nova-micro-v1:0"}}')
echo "  $N1" | python3 -c 'import json,sys;d=json.load(sys.stdin);print("  OK:",d.get("id","FAILED: "+d.get("message","unknown")))'

echo "[2] branch-urgency (Branch)..."
N2=$(curl -sS -X POST "$API_URL/api/nodes" -H 'content-type: application/json' \
  -d '{"name":"branch-urgency","nodeTypeId":"10000000-0000-4000-8000-000000000003","category":"branch","config":{"expression":"upper(nodes.classify_ticket.text)","branches":{"HIGH":"draft-urgent","MED":"draft-urgent","LOW":"draft-low"},"default":"draft-low"}}')
echo "  $N2" | python3 -c 'import json,sys;d=json.load(sys.stdin);print("  OK:",d.get("id","FAILED: "+d.get("message","unknown")))'

echo "[3] draft-urgent (LLM)..."
N3=$(curl -sS -X POST "$API_URL/api/nodes" -H 'content-type: application/json' \
  -d '{"name":"draft-urgent","nodeTypeId":"10000000-0000-4000-8000-000000000001","category":"llm","config":{"promptTemplate":"You are a senior support agent. Draft a professional reply for this urgent ticket. Subject: {{input.subject}} Description: {{input.description}} Urgency: {{classify-ticket.text}}. Acknowledge the severity and provide next steps.","model":"apac.amazon.nova-micro-v1:0"}}')
echo "  $N3" | python3 -c 'import json,sys;d=json.load(sys.stdin);print("  OK:",d.get("id","FAILED: "+d.get("message","unknown")))'

echo "[4] draft-low (LLM)..."
N4=$(curl -sS -X POST "$API_URL/api/nodes" -H 'content-type: application/json' \
  -d '{"name":"draft-low","nodeTypeId":"10000000-0000-4000-8000-000000000001","category":"llm","config":{"promptTemplate":"Draft a friendly acknowledgement for this ticket. Subject: {{input.subject}} Description: {{input.description}}. Thank the customer and say we will respond within 2 business days.","model":"apac.amazon.nova-micro-v1:0"}}')
echo "  $N4" | python3 -c 'import json,sys;d=json.load(sys.stdin);print("  OK:",d.get("id","FAILED: "+d.get("message","unknown")))'

# Extract IDs
ID1=$(echo "$N1" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("id",""))' 2>/dev/null)
ID2=$(echo "$N2" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("id",""))' 2>/dev/null)
ID3=$(echo "$N3" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("id",""))' 2>/dev/null)
ID4=$(echo "$N4" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("id",""))' 2>/dev/null)

if [ -z "$ID1" ] || [ -z "$ID2" ] || [ -z "$ID3" ] || [ -z "$ID4" ]; then
  echo "ERROR: Failed to register one or more nodes. Check responses above."
  exit 1
fi

# --- Create Workflow ---
echo
echo "[5] Creating workflow..."
WF_BODY="{\"name\":\"ops-ticket-router\",\"description\":\"Classify ticket urgency then draft reply\",\"nodes\":[{\"nodeId\":\"classify-ticket\",\"registeredNodeId\":\"$ID1\",\"name\":\"Classify Urgency\",\"positionX\":0,\"positionY\":0},{\"nodeId\":\"branch-urgency\",\"registeredNodeId\":\"$ID2\",\"name\":\"Route by Urgency\",\"positionX\":250,\"positionY\":0},{\"nodeId\":\"draft-urgent\",\"registeredNodeId\":\"$ID3\",\"name\":\"Draft Urgent Reply\",\"positionX\":500,\"positionY\":-80},{\"nodeId\":\"draft-low\",\"registeredNodeId\":\"$ID4\",\"name\":\"Draft Low Ack\",\"positionX\":500,\"positionY\":80}],\"edges\":[{\"from\":\"classify-ticket\",\"to\":\"branch-urgency\"},{\"from\":\"branch-urgency\",\"to\":\"draft-urgent\"},{\"from\":\"branch-urgency\",\"to\":\"draft-low\"}]}"
WF=$(curl -sS -X POST "$API_URL/api/workflows" -H 'content-type: application/json' -d "$WF_BODY")
echo "  $WF" | python3 -c 'import json,sys;d=json.load(sys.stdin);print("  Workflow:",d.get("id","FAILED: "+d.get("message","unknown")))'

echo
echo "=== Done! Test with: ==="
echo "  Input: {\"subject\": \"Production API down\", \"description\": \"All requests returning 503\"}"
