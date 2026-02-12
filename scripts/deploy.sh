#!/bin/bash

# Deployment script for Google Cloud Functions
# 
# Usage: ./deploy.sh

set -e

echo "=== Deploying Google Cloud Functions ==="

# Check if gcloud is installed
if ! command -v gcloud &> /dev/null; then
    echo "Error: gcloud CLI not found. Please install Google Cloud SDK."
    exit 1
fi

# Get configuration
read -p "Enter Google Cloud Project ID: " PROJECT_ID
read -p "Enter Google Sheets ID: " SHEETS_ID
read -p "Enter Google My Maps ID: " MAPS_ID
read -p "Enter polling interval in seconds (default: 60): " POLLING_INTERVAL
POLLING_INTERVAL=${POLLING_INTERVAL:-60}

# Set project
gcloud config set project $PROJECT_ID

# Deploy function
echo "Deploying Cloud Function..."
cd functions

gcloud functions deploy syncHandler \
  --gen2 \
  --runtime nodejs18 \
  --region us-central1 \
  --trigger-http \
  --allow-unauthenticated \
  --entry-point syncHandler \
  --source . \
  --set-env-vars GOOGLE_SHEETS_ID=$SHEETS_ID,GOOGLE_MAPS_ID=$MAPS_ID,POLLING_INTERVAL=$POLLING_INTERVAL,GOOGLE_CLOUD_PROJECT=$PROJECT_ID \
  --memory 512MB \
  --timeout 540s

echo ""
echo "=== Deployment Complete ==="
echo "Function URL:"
gcloud functions describe syncHandler --gen2 --region us-central1 --format="value(serviceConfig.uri)"

cd ..
