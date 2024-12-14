import { RemovalPolicy, Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';

export interface AuroraTroccoSampleStackProps extends StackProps {
  readonly troccoTargetBucket: string;
  readonly troccoAWSAccountId: string;
  readonly troccoExternalID: string;
}


export class AuroraTroccoSampleStack extends Stack {
  constructor(scope: Construct, id: string, props?: AuroraTroccoSampleStackProps) {
    super(scope, id, props);

    // setup the bucket for trocco
    const troccoTargetBucket = new s3.Bucket(this, 'troccoTargetBucket',
      {
        bucketName: props?.troccoTargetBucket,
        removalPolicy: RemovalPolicy.DESTROY,
      }
    );

    const accessS3ForTroccoRole = new iam.Role(this, 'AccessS3ForTroccoRole', {
      assumedBy: new iam.AccountPrincipal(props!.troccoAWSAccountId).withConditions({
        StringEquals: {
          'sts:ExternalId': props!.troccoExternalID,
        },
      })
    })

    troccoTargetBucket.grantReadWrite(accessS3ForTroccoRole)
    accessS3ForTroccoRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AWSGlueConsoleFullAccess"))


    new CfnOutput(this, 'TroccoS3AccessRoleName', {
      value: accessS3ForTroccoRole.roleName,
      exportName: 'troccoS3AccessRoleName',
    });
  }
}
