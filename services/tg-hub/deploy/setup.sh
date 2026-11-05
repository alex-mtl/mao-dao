#!/bin/sh
# One-time setup of tg-hub in AWS (us-east-1, free tier). Run from services/tg-hub: ./deploy/setup.sh
# Needs the bot token in ./.bot-token (gitignored). Creates: SSM params, DynamoDB table, IAM role, Lambda,
# Function URL, the Telegram webhook. API tokens for Druzhok and Claude are generated into ./.secrets/ (gitignored);
# Claude's copy (url + token) goes to ~/.tg-hub/. Every resource is tagged Project=tg-hub.
set -e
cd "$(dirname "$0")/.."
R="--region us-east-1"
TAG="Key=Project,Value=tg-hub"
[ -s .bot-token ] || { echo "no .bot-token"; exit 1; }
mkdir -p .secrets build
rnd() { head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n'; }
sha() { printf %s "$1" | sha256sum | cut -d' ' -f1; }
[ -s .secrets/webhook-secret ] || rnd > .secrets/webhook-secret
[ -s .secrets/druzhok-token ] || rnd > .secrets/druzhok-token
[ -s .secrets/claude-token ] || rnd > .secrets/claude-token

echo "== SSM"
for p in token webhook-secret; do
  f=.bot-token; [ $p = webhook-secret ] && f=.secrets/webhook-secret
  ./aws.sh ssm put-parameter $R --name /tg-hub/$p --type SecureString --value "$(tr -d '\r\n' < $f)" \
    --overwrite --query Version --output text
  ./aws.sh ssm add-tags-to-resource $R --resource-type Parameter --resource-id /tg-hub/$p --tags $TAG
done

echo "== DynamoDB"
./aws.sh dynamodb describe-table $R --table-name tg-hub --query Table.TableStatus --output text 2>/dev/null || {
  ./aws.sh dynamodb create-table $R --table-name tg-hub \
    --attribute-definitions AttributeName=pk,AttributeType=S AttributeName=sk,AttributeType=S \
    --key-schema AttributeName=pk,KeyType=HASH AttributeName=sk,KeyType=RANGE \
    --provisioned-throughput ReadCapacityUnits=3,WriteCapacityUnits=3 --tags $TAG --query Table.TableStatus --output text
  ./aws.sh dynamodb wait table-exists $R --table-name tg-hub
  ./aws.sh dynamodb update-time-to-live $R --table-name tg-hub \
    --time-to-live-specification Enabled=true,AttributeName=ttl --query TimeToLiveSpecification.Enabled
}

echo "== IAM"
./aws.sh iam get-role --role-name tg-hub-role --query Role.Arn --output text 2>/dev/null || {
  ./aws.sh iam create-role --role-name tg-hub-role --assume-role-policy-document file://deploy/trust.json \
    --tags $TAG --query Role.Arn --output text
  sleep 10
}
./aws.sh iam put-role-policy --role-name tg-hub-role --policy-name tg-hub --policy-document file://deploy/role-policy.json

echo "== Lambda"
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W)":/w -w /w python:3.12-slim python -c "
import zipfile, glob
with zipfile.ZipFile('build/tghub.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for f in glob.glob('tghub/*.py'): z.write(f)"
ENV="Variables={TOKEN_SHA256_DRUZHOK=$(sha "$(cat .secrets/druzhok-token)"),TOKEN_SHA256_CLAUDE=$(sha "$(cat .secrets/claude-token)"),OWNER_IDS=$(cat .secrets/owner-ids 2>/dev/null | tr -d '\r\n' | grep . || echo 0)}"
./aws.sh lambda get-function $R --function-name tg-hub --query Configuration.State --output text 2>/dev/null || {
  ./aws.sh lambda create-function $R --function-name tg-hub --runtime python3.12 --handler tghub.handler.handler \
    --role arn:aws:iam::565905128720:role/tg-hub-role --zip-file fileb://build/tghub.zip \
    --memory-size 128 --timeout 30 --environment "$ENV" --tags Project=tg-hub \
    --logging-config LogFormat=Text,ApplicationLogLevel=WARN --query State --output text 2>/dev/null ||
  ./aws.sh lambda create-function $R --function-name tg-hub --runtime python3.12 --handler tghub.handler.handler \
    --role arn:aws:iam::565905128720:role/tg-hub-role --zip-file fileb://build/tghub.zip \
    --memory-size 128 --timeout 30 --environment "$ENV" --tags Project=tg-hub --query State --output text
  ./aws.sh lambda wait function-active-v2 $R --function-name tg-hub
}
URL=$(./aws.sh lambda get-function-url-config $R --function-name tg-hub --query FunctionUrl --output text 2>/dev/null) || {
  URL=$(./aws.sh lambda create-function-url-config $R --function-name tg-hub --auth-type NONE --query FunctionUrl --output text)
  ./aws.sh lambda add-permission $R --function-name tg-hub --statement-id url --action lambda:InvokeFunctionUrl \
    --principal '*' --function-url-auth-type NONE --query Statement --output text > /dev/null
  ./aws.sh lambda add-permission $R --function-name tg-hub --statement-id url-invoke --action lambda:InvokeFunction \
    --principal '*' --invoked-via-function-url --query Statement --output text > /dev/null
}
URL=$(echo "$URL" | tr -d '\r')
echo "$URL" > .secrets/url

echo "== Telegram"
printf '{"action":"set_webhook","url":"%stg"}' "$URL" > build/ev.json
./aws.sh lambda invoke $R --function-name tg-hub --cli-binary-format raw-in-base64-out --payload file://build/ev.json build/out.json --query StatusCode
cat build/out.json; echo
printf '{"action":"set_commands"}' > build/ev.json
./aws.sh lambda invoke $R --function-name tg-hub --cli-binary-format raw-in-base64-out --payload file://build/ev.json build/out.json --query StatusCode
cat build/out.json; echo

mkdir -p ~/.tg-hub
printf %s "$URL" > ~/.tg-hub/url
cp .secrets/claude-token ~/.tg-hub/token
echo "done: Function URL saved to .secrets/url and ~/.tg-hub/url"
