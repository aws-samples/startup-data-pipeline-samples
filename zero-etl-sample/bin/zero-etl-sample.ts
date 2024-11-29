#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { ZeroEtlIntegrationStack } from '../lib/integration';
import { ZeroETLRDSStack } from '../lib/aurora';
import { RedshiftStack } from '../lib/redshift';
import {config} from '../config/config';

const app = new cdk.App();

var redshiftNameSpace = config.redshiftNameSpaceId;
var redshiftWorkSpace = config.redshiftWorkgroup;

const datasourceStack = new ZeroETLRDSStack(app, 'ZeroETLRDSStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  vpcId: config.vpcId,
  dbClusterId: config.dbClusterId,
  dbClusterEndpointName: config.dbClusterEndpointName,
  dbPort: config.dbPort,
  s3Bucket: config.s3Bucket
})

const vpc = datasourceStack.vpc;
const dbCluster = datasourceStack.dbCluster


const redshiftStack = new RedshiftStack(app, 'RedshiftStack', {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
  vpc: vpc,
  dbCluster: dbCluster,
  redshiftNameSpaceId: redshiftNameSpace,
  redshiftWorkSpace: redshiftWorkSpace
})


const zeroEtlIngestionStack = new ZeroEtlIntegrationStack(app, 'ZeroEtlIntegrationStack', {
    env: {
        account: process.env.CDK_DEFAULT_ACCOUNT,
        region: process.env.CDK_DEFAULT_REGION,
      },
    redshiftNameSpaceId: redshiftStack.redshiftNameSpaceId,
    redshiftWorkspaceName: redshiftStack.redshiftWorkspaceName,
    dbCluster: dbCluster,
    dbClusterArn:dbCluster.clusterArn,
});
