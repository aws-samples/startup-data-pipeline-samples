import boto3 
import os
import datetime 
import zoneinfo
import time
import logging

logger = logging.getLogger()
logger.setLevel(os.getenv("LOG_LEVEL", logging.INFO))
logger.setLevel(os.getenv("LOG_LEVEL", logging.DEBUG))

DATABASE = os.environ["DB_NAME"]
GLUE_DATABASE = os.environ["GLUE_DATABASE"]
SCHEMA_NAME = os.environ["SCHEMA_NAME"]
BUCKET = os.environ["S3_BUCKET"]
ATHENA_OUTPUT_BUCKET = os.environ["ATHENA_OUTPUT_BUCKET"]
ATHENA_WORKGROUP = os.environ["ATHENA_WORKGROUP"]

jst = zoneinfo.ZoneInfo('Asia/Tokyo')
athena = boto3.client('athena')

def handler(event, context):

    table_name = event['table']['table_name']
    if not 'condition' in event['table']:
        return {'message': 'process was not executed.'}
    
    condition = event['table']['condition']

    conditon_date = (datetime.datetime.now(jst) - datetime.timedelta(days=1)).strftime('%Y-%m-%d')

    logger.info(f'checking date range that from {condition} to {conditon_date}.')

    SQL_UNLOAD = f"""
    UNLOAD (SELECT * FROM "{SCHEMA_NAME}_{table_name}" where "{condition}" > cast('{conditon_date}' as timestamp)) 
    TO 's3://{BUCKET}/{DATABASE}/{table_name}/load_time={str(int(time.time()))}/' 
    WITH (format = 'PARQUET',compression = 'SNAPPY')
    """


    logger.debug(f'UNLOAD QUERY : {SQL_UNLOAD}')

    response = athena.start_query_execution(
        QueryString=SQL_UNLOAD,
        QueryExecutionContext={
            'Database':GLUE_DATABASE.replace('-','_')
        },
        ResultConfiguration={
        'OutputLocation': f"s3://{ATHENA_OUTPUT_BUCKET}/{table_name}",
        # 'EncryptionConfiguration': {
        #     'EncryptionOption': 'SSE_S3'|'SSE_KMS'|'CSE_KMS',
        #     'KmsKey': 'string'
        # },
        # 'ExpectedBucketOwner': 'string',
        # 'AclConfiguration': {
        #     'S3AclOption': 'BUCKET_OWNER_FULL_CONTROL'
        },
        WorkGroup=ATHENA_WORKGROUP
    )

    logger.debug(response)

    query_execution_id = response['QueryExecutionId']

    return {'query_execution_id':query_execution_id}
