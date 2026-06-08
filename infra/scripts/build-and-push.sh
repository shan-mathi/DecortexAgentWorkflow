#!/bin/bash
# Build the Workflow Engine Docker image and push to ECR.
#
# Prerequisites:
#   - Docker installed and running
#   - AWS CLI configured with credentials
#   - ECR repository created (the script creates it if missing)
#
# Usage:
#   ./infra/scripts/build-and-push.sh
#
# After pushing, update infra/.env with the image URI:
#   ENGINE_IMAGE_URI=141132233781.dkr.ecr.ap-south-1.amazonaws.com/agent-engine/workflow-engine:latest

set -euo pipefail

# Load env
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"
if [ -f "$ENV_FILE" ]; then
  export $(grep -v '^#' "$ENV_FILE" | xargs)
fi

ACCOUNT_ID="${AWS_ACCOUNT_ID:-}"
REGION="${AWS_REGION:-}"

if [ -z "$ACCOUNT_ID" ] || [ -z "$REGION" ]; then
  echo "ERROR: AWS_ACCOUNT_ID and AWS_REGION must be set."
  echo "  Set them in infra/.env or as environment variables."
  exit 1
fi
REPO_NAME="agent-engine/workflow-engine"
IMAGE_TAG="${IMAGE_TAG:-latest}"
FULL_URI="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${REPO_NAME}:${IMAGE_TAG}"

echo "=== Building Workflow Engine Image ==="
echo "  Account: $ACCOUNT_ID"
echo "  Region:  $REGION"
echo "  Repo:    $REPO_NAME"
echo "  Tag:     $IMAGE_TAG"
echo "  URI:     $FULL_URI"
echo

# Create ECR repo if it doesn't exist
echo "[1/4] Ensuring ECR repository exists..."
aws ecr describe-repositories --repository-names "$REPO_NAME" --region "$REGION" 2>/dev/null || \
  aws ecr create-repository --repository-name "$REPO_NAME" --region "$REGION" --image-scanning-configuration scanOnPush=true

# Login to ECR
echo "[2/4] Logging in to ECR..."
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"

# Build image
echo "[3/4] Building Docker image..."
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
docker build \
  -t "$FULL_URI" \
  -f "$REPO_ROOT/services/workflow-engine/Dockerfile" \
  "$REPO_ROOT"

# Push to ECR
echo "[4/4] Pushing to ECR..."
docker push "$FULL_URI"

echo
echo "=== Done ==="
echo "Image URI: $FULL_URI"
echo
echo "Update infra/.env with:"
echo "  ENGINE_IMAGE_URI=$FULL_URI"
