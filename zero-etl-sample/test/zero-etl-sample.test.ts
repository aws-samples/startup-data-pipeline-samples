import * as cdk from 'aws-cdk-lib';
import { Template} from 'aws-cdk-lib/assertions';
import * as aurorastack from '../lib/aurora';

test('SQS Queue and SNS Topic Created', () => {
  const app = new cdk.App();
  // WHEN

const stack = new aurorastack.ZeroETLRDSStack(app, 'MyTestStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  vpcId: 'vpcid',
  dbClusterId: 'clusterid',
  dbClusterEndpointName: 'endpointname',
  dbPort: 3036,
  s3Bucket: 'bucket'
})
  // THEN

  const template = Template.fromStack(stack);

  template.hasResourceProperties('AWS::RDS::DBCluster', {
    VisibilityTimeout: 300
  });
});
