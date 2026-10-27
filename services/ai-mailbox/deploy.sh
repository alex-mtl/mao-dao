#!/bin/sh
# Package aimail/ into build/aimail.zip and update the Lambda code. Usage: ./deploy.sh
cd "$(dirname "$0")" && rm -rf build && mkdir -p build
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W)":/w -w /w python:3.12-slim python -c "
import zipfile, glob
with zipfile.ZipFile('build/aimail.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for f in glob.glob('aimail/*.py'): z.write(f)"
./aws.sh lambda update-function-code --region us-east-1 --function-name ai-mailbox --zip-file fileb://build/aimail.zip --query LastUpdateStatus --output text
