#!/usr/bin/env bash
set -euo pipefail

REGION="eu-north-1"
KEY_NAME="oleksii"
SG_NAME="ai-gateway-sg"
INSTANCE_TYPE="t3.micro"
BUCKET="ai-gateway-data-hackyeah"

# 1. Create key pair if it doesn't already exist (saves private key locally, chmod 400)
if aws ec2 describe-key-pairs --region "$REGION" --key-names "$KEY_NAME" >/dev/null 2>&1; then
  echo "Key pair $KEY_NAME already exists, skipping creation."
else
  aws ec2 create-key-pair \
    --region "$REGION" \
    --key-name "$KEY_NAME" \
    --query 'KeyMaterial' \
    --output text > "${KEY_NAME}.pem"
  chmod 400 "${KEY_NAME}.pem"
fi

# 2. Get default VPC id
VPC_ID=$(aws ec2 describe-vpcs --region "$REGION" \
  --filters Name=isDefault,Values=true \
  --query 'Vpcs[0].VpcId' --output text)

# 3. Create security group if it doesn't already exist
SG_ID=$(aws ec2 describe-security-groups --region "$REGION" \
  --filters Name=group-name,Values="$SG_NAME" Name=vpc-id,Values="$VPC_ID" \
  --query 'SecurityGroups[0].GroupId' --output text 2>/dev/null || echo "None")

if [ "$SG_ID" == "None" ] || [ -z "$SG_ID" ]; then
  SG_ID=$(aws ec2 create-security-group \
    --region "$REGION" \
    --group-name "$SG_NAME" \
    --description "AI gateway docker host" \
    --vpc-id "$VPC_ID" \
    --query 'GroupId' --output text)

  # 4. Open inbound ports: SSH, HTTP, HTTPS, app ports
  for PORT in 22 80 443 8501 5173 8000; do
    aws ec2 authorize-security-group-ingress \
      --region "$REGION" \
      --group-id "$SG_ID" \
      --protocol tcp --port "$PORT" --cidr 0.0.0.0/0
  done
else
  echo "Security group $SG_NAME already exists ($SG_ID), skipping creation."
fi

# 5. Get latest Amazon Linux 2023 AMI
AMI_ID=$(aws ssm get-parameters \
  --region "$REGION" \
  --names /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64 \
  --query 'Parameters[0].Value' --output text)

# 6. User-data: install & enable Docker + compose plugin
cat << 'USERDATA' > /tmp/user-data.sh
#!/bin/bash
dnf update -y
dnf install -y docker
systemctl enable --now docker
usermod -aG docker ec2-user
mkdir -p /usr/local/lib/docker/cli-plugins
curl -SL https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64 \
  -o /usr/local/lib/docker/cli-plugins/docker-compose
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose
USERDATA

# 7. Launch EC2 instance if one with this Name tag doesn't already exist (Free Tier: t2.micro, 30GB gp3 root volume)
INSTANCE_ID=$(aws ec2 describe-instances --region "$REGION" \
  --filters Name=tag:Name,Values=ai-gateway-host Name=instance-state-name,Values=pending,running,stopped,stopping \
  --query 'Reservations[0].Instances[0].InstanceId' --output text 2>/dev/null || echo "None")

if [ "$INSTANCE_ID" == "None" ] || [ -z "$INSTANCE_ID" ]; then
  INSTANCE_ID=$(aws ec2 run-instances \
    --region "$REGION" \
    --image-id "$AMI_ID" \
    --instance-type "$INSTANCE_TYPE" \
    --key-name "$KEY_NAME" \
    --security-group-ids "$SG_ID" \
    --block-device-mappings 'DeviceName=/dev/xvda,Ebs={VolumeSize=30,VolumeType=gp3}' \
    --user-data file:///tmp/user-data.sh \
    --tag-specifications 'ResourceType=instance,Tags=[{Key=Name,Value=ai-gateway-host}]' \
    --query 'Instances[0].InstanceId' --output text)
  echo "Instance launching: $INSTANCE_ID"
else
  echo "Instance ai-gateway-host already exists ($INSTANCE_ID), skipping creation."
fi
aws ec2 wait instance-running --region "$REGION" --instance-ids "$INSTANCE_ID"
PUBLIC_IP=$(aws ec2 describe-instances --region "$REGION" \
  --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' --output text)
echo "SSH: ssh -i ${KEY_NAME}.pem ec2-user@${PUBLIC_IP}"

# 8. Create S3 bucket if it doesn't already exist (eu-north-1 requires LocationConstraint)
if aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  echo "Bucket $BUCKET already exists, skipping creation."
else
  aws s3api create-bucket \
    --region "$REGION" \
    --bucket "$BUCKET" \
    --create-bucket-configuration LocationConstraint="$REGION"
  aws s3api put-bucket-encryption \
    --bucket "$BUCKET" \
    --server-side-encryption-configuration '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
  aws s3api put-public-access-block \
    --bucket "$BUCKET" \
    --public-access-block-configuration BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
fi

# 9. Create DynamoDB tables if they don't already exist (provisioned, free-tier-friendly: 5/5 each = 10/10 of 25/25 limit)
if aws dynamodb describe-table --region "$REGION" --table-name ai-gateway-config >/dev/null 2>&1; then
  echo "Table ai-gateway-config already exists, skipping creation."
else
  aws dynamodb create-table \
    --region "$REGION" \
    --table-name ai-gateway-config \
    --attribute-definitions AttributeName=configId,AttributeType=S \
    --key-schema AttributeName=configId,KeyType=HASH \
    --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5
fi

if aws dynamodb describe-table --region "$REGION" --table-name ai-gateway-request-events >/dev/null 2>&1; then
  echo "Table ai-gateway-request-events already exists, skipping creation."
else
  aws dynamodb create-table \
    --region "$REGION" \
    --table-name ai-gateway-request-events \
    --attribute-definitions AttributeName=pk,AttributeType=S AttributeName=sk,AttributeType=S \
    --key-schema AttributeName=pk,KeyType=HASH AttributeName=sk,KeyType=RANGE \
    --provisioned-throughput ReadCapacityUnits=5,WriteCapacityUnits=5
fi

echo "Done."