import boto3
import logging
import os

logger = logging.getLogger()
logger.setLevel(os.getenv("LOG_LEVEL", logging.INFO))
logger.setLevel(os.getenv("LOG_LEVEL", logging.DEBUG))

rds = boto3.client('rds')


def handler(event, context):

    logger.debug(event)

    resp = rds.describe_export_tasks(
        ExportTaskIdentifier=event["ExportTaskIdentifier"],
    )

    logger.debug(resp)

    if len(resp['ExportTasks']) == 0:
        logger.error(f'Export tasks was not founded.')
        return False

    if 'FailureCause' in resp["ExportTasks"][0]:
        raise Exception(resp["ExportTasks"][0]['FailureCause'])
    
    if 'Status' in resp["ExportTasks"][0]:
        logger.info(f'jedge: {resp["ExportTasks"][0]["Status"] == "COMPLETE"}')
        return resp["ExportTasks"][0]["Status"] == "COMPLETE"
    else:
        return False