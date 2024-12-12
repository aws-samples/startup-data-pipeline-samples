import { Stack, StackProps, custom_resources as cr, aws_rds as classicrds } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as rds from 'aws-cdk-lib/aws-rds';

export interface ZeroEtlIntegrationStackProps extends StackProps {
  readonly redshiftNameSpaceId: string;
  readonly redshiftWorkspaceName: string;
  readonly dbCluster: rds.IDatabaseCluster;
  // readonly vpcId: string;
  readonly dbClusterArn: string;
}

export class ZeroEtlIntegrationStack extends Stack {
  readonly redshitNameSpaceId: string;
  readonly redshiftWorkspaceName: string;

  constructor(scope: Construct, id: string, props: ZeroEtlIntegrationStackProps) {
    super(scope, id, props);

    // ENV
    this.redshitNameSpaceId = props.redshiftNameSpaceId;
    this.redshiftWorkspaceName = props.redshiftWorkspaceName;

    if (this.redshitNameSpaceId == undefined) {
      throw new Error("REDSHIFT_NAMESPACE_ID is not defined");
    };
    if (this.redshiftWorkspaceName == undefined) {
      throw new Error("REDSHIFT_WORKSPACE_NAME is not defined");
    };

    /** 
     * Create Ingestion
     */
    const cfnIntegration = new classicrds.CfnIntegration(this, 'CreateIngestion', {
      sourceArn: props!.dbClusterArn,
      targetArn: this.formatArn({
        service: 'redshift-serverless',
        resource: 'namespace',
        resourceName: this.redshitNameSpaceId,
      }
      ),
      // the properties below are optional
      // additionalEncryptionContext: {
      //   additionalEncryptionContextKey: 'additionalEncryptionContext',
      // },
      // dataFilter: 'dataFilter',
      description: 'description',
      integrationName: 'sampleIntegration',
      // kmsKeyId: 'kmsKeyId',
    });
  }
}
