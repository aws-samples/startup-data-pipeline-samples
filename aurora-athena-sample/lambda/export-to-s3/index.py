
import boto3
import os
import logging
import json
import time

logger = logging.getLogger()
logger.setLevel(os.getenv("LOG_LEVEL", logging.INFO))
logger.setLevel(os.getenv("LOG_LEVEL", logging.DEBUG))

AWS_REGION = os.environ["AWS_REGION"]
DB_NAME = os.environ["DB_NAME"]
S3_PREFIX = os.environ["S3_PREFIX"]
SNAPSHOT_BUCKET_NAME = os.environ["SNAPSHOT_BUCKET_NAME"]
SNAPSHOT_TASK_ROLE = os.environ["SNAPSHOT_TASK_ROLE"]
SNAPSHOT_TASK_KEY = os.environ["SNAPSHOT_TASK_KEY"]
PIPELINE_NAME = os.environ["PIPELINE_NAME"]


def start_export_task(export_task_identifier, source_arn, s3_prefix):
    logger.debug(f"exportTaskIdentifier: {export_task_identifier}")
    logger.debug(f"sourceARN: {source_arn}")

    response = boto3.client("rds").start_export_task(
        ExportTaskIdentifier=export_task_identifier,
        SourceArn=source_arn,
        S3BucketName=SNAPSHOT_BUCKET_NAME,
        IamRoleArn=SNAPSHOT_TASK_ROLE,
        KmsKeyId=SNAPSHOT_TASK_KEY,
        S3Prefix=s3_prefix,
        # ExportOnly=[f'postgres.public.{table_name}']
    )

    logger.info("Snapshot export task started")
    logger.info(json.dumps(response))

    return response

## invoke export to s3 task from aurora
def handler(event, context):

    logger.debug(event)

    account_id = boto3.client("sts").get_caller_identity()["Account"]
    source_arn = f"arn:aws:rds:{AWS_REGION}:{account_id}:cluster:{DB_NAME}"
    identifer = str(int(time.time()))
    

    response = start_export_task(f'{PIPELINE_NAME}-{identifer}', source_arn, S3_PREFIX)

    return {
            'ExportTaskIdentifier': response['ExportTaskIdentifier'],
            'identifier':identifer
        }