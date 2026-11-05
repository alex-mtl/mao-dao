#!/bin/sh
# Package tghub/ into build/tghub.zip and update the Lambda code. Usage: ./deploy.sh
cd "$(dirname "$0")" && rm -rf build && mkdir -p build
MSYS_NO_PATHCONV=1 docker run --rm -v "$(pwd -W)":/w -w /w python:3.12-slim python -c "
import zipfile, glob
with zipfile.ZipFile('build/tghub.zip', 'w', zipfile.ZIP_DEFLATED) as z:
    for f in glob.glob('tghub/*.py'): z.write(f)"
./aws.sh lambda update-function-code --region us-east-1 --function-name tg-hub --zip-file fileb://build/tghub.zip --query LastUpdateStatus --output text
