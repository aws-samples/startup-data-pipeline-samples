#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AthenaPipelineStack } from '../lib/aurora-athena-sample-stack';
import { SampleDataSourceStack } from '../lib/create-sample-database';

import { config } from '../config/config';

const app = new cdk.App();

var dbClusterName = config.dbClusterName;

if (!config.isExistDB) {
  const databaseStack = new SampleDataSourceStack(app, 'SampleDataSourceStack', {
    dbName: config.dbClusterName,
    s3Bucket: config.sampleDataBucketName
  })
  dbClusterName = databaseStack.dbClusterIdentifer;
}

new AthenaPipelineStack(app, 'AuroraAthenaSampleStack', {
  rdsClusterName: dbClusterName,
  pipelineName: config.pipelineName,
  s3BucketName: config.snapshotS3BucketName,
  s3ExportPrefix: config.s3ExportPrefix,
  dbName: config.dbName,
  schemaName: config.schemaName,
  targetTables: config.tables,
  enableSaveExportedData: config.enableBackupExportedData,
  loadSchedule: config.loadSchedule
});
