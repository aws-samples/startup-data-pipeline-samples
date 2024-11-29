import { Stack, StackProps, custom_resources as cr, aws_rds as classicrds} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { RedshiftServerlessClient, UpdateWorkgroupCommand } from "@aws-sdk/client-redshift-serverless"; // ES Modules import
import { fromIni } from "@aws-sdk/credential-providers";


import * as rds from 'aws-cdk-lib/aws-rds';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface ZeroEtlIntegrationStackProps extends StackProps{
  readonly redshiftNameSpaceId?: string;
  readonly redshiftWorkspaceName?: string;
  readonly dbCluster: rds.IDatabaseCluster;
  // readonly vpcId: string;
  readonly dbClusterArn: string;
}

export class ZeroEtlIntegrationStack extends Stack {
  constructor(scope: Construct, id: string, props?: ZeroEtlIntegrationStackProps) {
    super(scope, id, props);
    
    // ENV
    const REDSHIFT_NAMESPACE_ID = props?.redshiftNameSpaceId;
    const REDSHIFT_WORKSPACE_NAME = props?.redshiftWorkspaceName;
    const ACCOUNT_ID = props?.env?.account;
    const REGION = props?.env?.region;

    if (REDSHIFT_NAMESPACE_ID == undefined){
      throw new Error("REDSHIFT_NAMESPACE_ID is not defined"); 
    };
    if (REDSHIFT_WORKSPACE_NAME == undefined){
      throw new Error("REDSHIFT_WORKSPACE_NAME is not defined");
    };

    /** 
     * Create Ingestion
     */
    const cfnIntegration = new classicrds.CfnIntegration(this, 'CreateIngestion', {
      sourceArn: props!.dbClusterArn,
      targetArn: `arn:aws:redshift-serverless:${REGION}:${ACCOUNT_ID}:namespace/${REDSHIFT_NAMESPACE_ID}`,

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
