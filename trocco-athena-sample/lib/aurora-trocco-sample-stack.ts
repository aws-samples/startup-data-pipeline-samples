import { RemovalPolicy, Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from 'aws-cdk-lib/aws-rds';
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
    const troccoTargetBucket = new s3.Bucket(this,'troccoTargetBucket',
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


    accessS3ForTroccoRole.addToPolicy(new iam.PolicyStatement({
      actions:[
        "s3:GetObject","s3:ListBucket","s3:PutObject","s3:GetObjectVersion",
      ],
      resources:[
        `arn:aws:s3:::${props?.troccoTargetBucket}/*`,
        `arn:aws:s3:::${props?.troccoTargetBucket}`,
      ],
      effect:iam.Effect.ALLOW,
    }))
    accessS3ForTroccoRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AWSGlueConsoleFullAccess"))


    new CfnOutput(this, 'TroccoS3AccessRoleName', {
      value: accessS3ForTroccoRole.roleName,
      exportName: 'troccoS3AccessRoleName',
    });
  }
}
