import boto3
import time
import os
import logging

logger = logging.getLogger()
logger.setLevel(os.getenv("LOG_LEVEL", logging.INFO))
logger.setLevel(os.getenv("LOG_LEVEL", logging.DEBUG))



## check S3 export status & update glue crawler new bucket
glue_client = boto3.client('glue')

def start_crawler(crawler_name):
    glue_client.start_crawler(
        Name=crawler_name
    )


def get_crawler(crawler_name):
    resp = glue_client.get_crawler(
        Name=crawler_name
    )
    return resp


def is_ready(resp):
    state = resp['Crawler']['State']
    if state in ['READY']:
        return True
    return False


def is_succeeded(resp):
    state = resp['Crawler']['State']
    if not state in ['RUNNING']:
        return True
    return False


def wait_for_crawler_until_ready(crawler_name):
    while(True):
        resp = get_crawler(crawler_name)
        if is_ready(resp):
            return resp
        time.sleep(10)

def wait_for_crawler_until_complete(crawler_name):
    while(True):
        resp = get_crawler(crawler_name)
        if is_succeeded(resp):
            return resp
        time.sleep(10)


def handler(event, context):

    crawler_name = event['crawler']
    logger.info("Wait until READY before starting crawler: %s\n", crawler_name)
    wait_for_crawler_until_ready(crawler_name)
    logger.info("Start glue crawler: %s\n", crawler_name)
    start_crawler(crawler_name)
    time.sleep(10)
    logger.info("Wait for crawler to complete: %s\n", crawler_name)
    resp = wait_for_crawler_until_complete(crawler_name)

    return is_succeeded(resp)