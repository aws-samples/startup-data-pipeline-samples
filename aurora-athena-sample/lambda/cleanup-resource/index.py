import boto3
import os 
import logging


logger = logging.getLogger()
logger.setLevel(os.getenv("LOG_LEVEL", logging.INFO))
logger.setLevel(os.getenv("LOG_LEVEL", logging.DEBUG))

s3 = boto3.client('s3')
glue = boto3.client('glue')

S3_BUCKET = os.environ['S3_BUCKET']
S3_EXPORT_PREFIX = os.environ['S3_EXPORT_PREFIX']
S3_BUCKUP_PREFIX = os.environ['S3_BUCKUP_PREFIX']
DB_NAME = os.environ['DB_NAME']
S3_EXPORT_CRAWLER = os.environ['S3_EXPORT_CRAWLER']

def handler(event, context):
    identifer = event["ExportTaskIdentifier"]
    enable_buckup = event["EnableBuckup"]
    next_token = ''

    while True:
        if next_token == '':
            response = s3.list_objects_v2(Bucket=S3_BUCKET, Prefix=f'{S3_EXPORT_PREFIX}/{identifer}/')
        else:
            response = s3.list_objects_v2(Bucket=S3_BUCKET, Prefix=f'{S3_EXPORT_PREFIX}/{identifer}/', ContinuationToken=next_token)

        if not 'Contents' in response:
            break
        
        keys = [d['Key'] for d in response['Contents']]
        for key in keys:
            logging.debug(f'source key :{key}, target key :{key.replace(S3_EXPORT_PREFIX, S3_BUCKUP_PREFIX)}' )

            if enable_buckup:
                s3.copy_object(Bucket=S3_BUCKET, Key=key.replace(S3_EXPORT_PREFIX, S3_BUCKUP_PREFIX), CopySource={'Bucket': S3_BUCKET, 'Key': key})

            s3.delete_object(Bucket=S3_BUCKET, Key=key)
           
        if 'NextContinuationToken' in response:
            next_token = response['NextContinuationToken']
        else:
            break

    # delete table

    tables = glue.get_tables(DatabaseName=DB_NAME.replace("-", "_"))
    
    for table in tables["TableList"]:
        if 'Parameters' not in table:
            logging.debug(f'skip delete table{table} due to none parameters')
            continue
        if 'UPDATED_BY_CRAWLER' not in table['Parameters']:
            logging.debug(f'skip delete table{table} due to none  UPDATED_BY_CRAWLER')
            continue
        if table['Parameters']['UPDATED_BY_CRAWLER'] == S3_EXPORT_CRAWLER:
            glue.delete_table(Name=table['Name'], DatabaseName=DB_NAME.replace("-", "_"))


    return {'Status':'SUCCEED'}



