#!/bin/sh

## initialize and do some pre-flight checks
if [ -z "$AWS_PROFILE" -o -z "$AWS_REGION" -o -z "$AWS_LAMBDA_ROLE_ARN" ]; then
    echo "Missing environment variables.  Ensure following environment variables are set"
    echo "  AWS_PROFILE"
    echo "  AWS_REGION"
    echo "  AWS_LAMBDA_ROLE_ARN"
    exit 1
fi


## DO NOT MODIFY
sources="node_modules cert index.js package.json"
lambda_name="ring-doorbell-publisher"
lambda_zip="dist/ring-doorbell-publisher.zip"
lambda_export="index.handler"

## initialize and do some pre-flight checks

# if arg count is 1, 2 or greater than 3, then print a usage message
# note that args are optional
#if [ $# -eq 1 -o $# -eq 2 -o $# -gt 3 ]; then
#    echo "Usage: $0 [<aws profile> <webui s3 bucket name> <environment config>"
#    exit 1
#fi

# if 3 args are provided, then overwrite AWS_PROFILE WEBUI_S3_BUCKET DEPLOY_TO_ENV
#if [ $# -eq 3 ]; then
#    AWS_PROFILE="$1"
#    WEBUI_S3_BUCKET="$2"
#    DEPLOY_TO_ENV="$3"
#fi

WORKING_DIR="`pwd`"

# make sure that the working directory is the root project folder
if [ ! -f "${WORKING_DIR}/package.json" -o \
     ! -d "${WORKING_DIR}/cert" -o \
     ! -f "${WORKING_DIR}/index.js" ]; then
   echo "unable to locate required files and folders.  missing one of the following:"
   echo "    ${WORKING_DIR}/package.json"
   echo "    ${WORKING_DIR}/index.js"
   echo "    ${WORKING_DIR}/cert/"
   exit 1
fi

# clean up dist
echo "initializing"
rm -rf dist
mkdir -p dist

# dump some stats
echo "AWS_PROFILE: ${AWS_PROFILE}"
echo "WORKING_DIR: ${WORKING_DIR}"
echo

## build the source code
echo "building lambda"

# update/install npm modules
npm install >& /tmp/$$.npm-install.log
if [ $? -ne 0 ]; then
    echo "build failed: $?"
    echo "build logs:"
    cat > /tmp/$$.build.log
    rm -rf /tmp/$$.*
    exit 2
fi


## copy built contents to dist folder
echo "preparing dist contents"
zip -0r "${lambda_zip}" ${sources} >& /dev/null

# check for error
if [ $? -ne 0 ]; then
    echo "unable prepare dist contents: $?"
    rm -rf /tmp/$$.*
    exit 3
fi

## deploy lambda
echo "create/update lambda"

# check if lambda exits:
# if yes, run "aws update-function-code"
# if no, run "aws create-function"

aws lambda get-function --function-name ${lambda_name} --profile ${AWS_PROFILE} >& /tmp/$$.get.lambda
if [ $? -ne 0 ]; then
    shared_key=`openssl rand -base64 32`
    aws lambda create-function \
        --region ${AWS_REGION} \
        --function-name ${lambda_name} \
        --zip-file fileb://${lambda_zip} \
        --runtime nodejs6.10 \
        --tracing-config Mode=Active \
        --timeout 30 \
        --memory-size 128 \
        --environment Variables={SHARED_KEY=${shared_key}} \
        --role ${AWS_LAMBDA_ROLE_ARN} \
        --handler ${lambda_export} \
        --profile ${AWS_PROFILE} >& /tmp/$$.lambda.create
    echo "shared key is: ${shared_key}"
else
    shared_key=`grep SHARED_KEY /tmp/$$.get.lambda | cut -d ":" -f 2 | sed 's/["\ ]*//g'`
    aws lambda update-function-code \
        --region ${AWS_REGION} \
        --function-name ${lambda_name} \
        --zip-file fileb://${lambda_zip} \
        --profile ${AWS_PROFILE} >& /tmp/$$.lambda.update
    echo "shared key is: ${shared_key}"
fi

# check for error
if [ $? -ne 0 ]; then
    echo "unable to create/update lambda"
    rm -rf /tmp/$$.*
    exit 4
fi

echo "create/update lambda successful"

## clean up
rm -rf /tmp/$$.*
