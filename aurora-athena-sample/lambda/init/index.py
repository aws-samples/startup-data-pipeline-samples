import boto3
import os 
import time
import logging

logger = logging.getLogger()
logger.setLevel(os.getenv("LOG_LEVEL", logging.INFO))
logger.setLevel(os.getenv("LOG_LEVEL", logging.DEBUG))

S3_BUCKET = os.environ['S3_BUCKET']
S3_PREFIX = os.environ['S3_PREFIX']
PIPELINE_NAME = os.environ['PIPELINE_NAME']
DB_NAME = os.environ['DB_NAME']
SCHEMA = os.environ['SCHEMA_NAME']

s3 = boto3.client('s3')

def handler(event,context):

    logger.debug(event)

    identifer = event["ExportTaskIdentifier"]
    tables = event["Tables"]

    loadtime = str(int(time.time()))

    ## move s3 dir
    for table in tables:

        logger.info(identifer)
        source_key = f'{S3_PREFIX}/{identifer}/{DB_NAME}/{SCHEMA}.{table["table_name"]}/1/'


        response = s3.list_objects(
                Bucket=S3_BUCKET, Prefix=source_key
            )
        
        if 'Contents' not in response:
            logger.info(f'no data {table}')
            continue

        if len(response['Contents']) == 0:
            logger.info(f'no data {table}')
            continue
        
        keys = [d['Key'] for d in response['Contents']]

        logger.info(keys)
        
        for key in keys:
            if 'SUCCESS' in key:
                continue 

            file = key.split('/')[-1]
            logger.info(file)

            s3.copy_object(
                    Bucket=S3_BUCKET, 
                    Key=f'{DB_NAME}/{table["table_name"]}/load_time={loadtime}/{file}', 
                    CopySource={"Bucket": S3_BUCKET, "Key": key}
                )

    return {'status':'SUCCEED'}