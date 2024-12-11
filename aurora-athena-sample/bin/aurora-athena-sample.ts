#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AthenaPipelineStack } from '../lib/aurora-athena-sample-stack';
import { SampleDataSourceStack } from '../lib/create-sample-database';

import { config } from '../config/config';

const app = new cdk.App();

var dbClusterName = config.dbClusterName;
var clusterVpc;
if (!config.isExistDB) {
  const databaseStack = new SampleDataSourceStack(app, 'SampleDataSourceStack', {
    env: {
      account: process.env.CDK_DEFAULT_ACCOUNT, 
      region: process.env.CDK_DEFAULT_REGION 
    },
    dbName: config.dbClusterName,
    s3Bucket: config.sampleDataBucketName
  })
  dbClusterName = databaseStack.dbClusterIdentifer;
  clusterVpc = databaseStack.vpc;
}

new AthenaPipelineStack(app, 'AuroraAthenaSampleStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT, 
    region: process.env.CDK_DEFAULT_REGION 
  },
  rdsClusterName: dbClusterName,
  pipelineName: config.pipelineName,
  s3BucketName: config.snapshotS3BucketName,
  s3ExportPrefix: config.s3ExportPrefix,
  dbName: config.dbName,
  schemaName: config.schemaName,
  clusterVpc:clusterVpc,
  enableSaveExportedData: config.enableBackupExportedData,
  loadSchedule: config.loadSchedule
});
