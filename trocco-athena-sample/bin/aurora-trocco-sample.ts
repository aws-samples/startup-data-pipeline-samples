#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { AuroraTroccoSampleStack } from '../lib/aurora-trocco-sample-stack';
import { SampleDataSourceForTroccoStack } from '../lib/create-sample-database';
import { config } from '../config/config';

const app = new cdk.App();

if (!config.isExistDB) {
    new SampleDataSourceForTroccoStack(app, 'SampleDataSourceForTroccoStack', {
      troccoIPs: config.troccoIPs,
      sampleDataBucket: config.sampleDataBucket
    })
  }


new AuroraTroccoSampleStack(app, 'AuroraTroccoSampleStack', { 
    troccoAWSAccountId: config.troccoAWSAccountId,
    troccoTargetBucket: config.troccoTargetBucket,
    troccoExternalID: config.troccoExternalId,
});
