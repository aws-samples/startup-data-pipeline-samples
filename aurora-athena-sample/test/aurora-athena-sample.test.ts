import * as cdk from 'aws-cdk-lib';
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as AuroraAthenaSample from '../lib/aurora-athena-sample-stack';

test('SQS Queue and SNS Topic Created', () => {
  const app = new cdk.App();
  // WHEN
  new AuroraAthenaSample.AthenaPipelineStack(app, 'MyTestStack', {
    dbName: 'sample-ticket-database',
    s3BucketName: 'sample-snapshot-bucket',
    s3ExportPrefix: 's3export',
    enableSaveExportedData:true,
    rdsClusterName: 'cluster',
    pipelineName: 'pipeline',
    schemaName: 'schema',
    clusterVpc: new ec2.Vpc(app, 'testvpc'),
    loadSchedule:{'xx':"xx"}
  });
  // THEN
});
