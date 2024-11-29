import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as AuroraAthenaSample from '../lib/aurora-athena-sample-stack';

test('SQS Queue and SNS Topic Created', () => {
  const app = new cdk.App();
  // WHEN
  const stack = new AuroraAthenaSample.AthenaPipelineStack(app, 'MyTestStack', {
    dbName: 'sample-ticket-database',
    s3BucketName: 'sample-snapshot-bucket',
    s3ExportPrefix: 's3export',
    targetTables: [
      {table_name: 'sales', condition:'sales_time'}, 
    ],
    enableSaveExportedData:true
    // athenaOutputBucket: 'athena-query-result-20240920'
  });
  // THEN
});
