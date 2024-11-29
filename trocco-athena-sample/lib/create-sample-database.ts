import { RemovalPolicy, Stack, StackProps, CfnOutput } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from 'aws-cdk-lib/aws-rds';
import * as iam from 'aws-cdk-lib/aws-iam';

export interface SampleDataSourceForTroccoProps extends StackProps {
  readonly sampleDataBucket: string; 
  readonly troccoIPs: Array<string>;
}


export class SampleDataSourceForTroccoStack extends Stack {
  constructor(scope: Construct, id: string, props?: SampleDataSourceForTroccoProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, "TroccoAuroraSample", {
      ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
      subnetConfiguration:[
        {
          cidrMask:24,
          name: 'public',
          subnetType: ec2.SubnetType.PUBLIC
        }
      ],
      maxAzs:3
    })


    //EC2 for access to Database
    const accessRdsSecurityGroup = new ec2.SecurityGroup(this, 'AccessToRDS', {
      vpc,
    });
    
    const execS3ExportRole = new iam.Role(this, "EC2InstanceRole",{
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com')
    })

    execS3ExportRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonEC2ContainerServiceforEC2Role"))
    execS3ExportRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AmazonEC2RoleforSSM"))
    execS3ExportRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonSSMManagedInstanceCore"))
    
    const userData = ec2.UserData.forLinux({ shebang: '#!/bin/bash' })
    userData.addCommands(
        'dnf update -y',
        'dnf install mariadb105 -y'
    )

    const rdsAccessInstance = new ec2.Instance(this, 'rdsAccess', {
      vpc:vpc,
      instanceType:ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE2, ec2.InstanceSize.MICRO),
      machineImage: new ec2.AmazonLinuxImage({ generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2023 }),
      securityGroup:accessRdsSecurityGroup,
      userData: userData
    });

    
    // role for access S3 
    const accessS3Role = new iam.Role(this, 'S3AccessRole', {
      assumedBy: new iam.ServicePrincipal('rds.amazonaws.com'),
    })

    accessS3Role.addToPolicy(new iam.PolicyStatement({
      actions:[
        "s3:GetObject","s3:ListBucket","s3:PutObject","s3:GetObjectVersion",
      ],
      resources:[
        `arn:aws:s3:::${props?.sampleDataBucket}/*`,
        `arn:aws:s3:::${props?.sampleDataBucket}`,
      ],
      effect:iam.Effect.ALLOW,
    }))

    const rdssg = new ec2.SecurityGroup(this, 'RDSSG', {
      vpc: vpc
    });
    rdssg.addIngressRule(
      ec2.Peer.securityGroupId(accessRdsSecurityGroup.securityGroupId), 
      ec2.Port.tcp(Number(3306))
    );
    rdssg.addIngressRule(
      ec2.Peer.securityGroupId(accessRdsSecurityGroup.securityGroupId),
      ec2.Port.tcp(443),
      "https from bastion host",
      false
    );

    for(let ip of props!.troccoIPs) {
      rdssg.addIngressRule(
        ec2.Peer.ipv4(ip),
        ec2.Port.tcp(443)
      );

      rdssg.addIngressRule(
        ec2.Peer.ipv4(ip),
        ec2.Port.tcp(Number(3306))
      );
    }

    accessRdsSecurityGroup.addEgressRule(
      ec2.Peer.securityGroupId(rdssg.securityGroupId), 
      ec2.Port.tcp(Number(443))
    )
    accessRdsSecurityGroup.addEgressRule(
      ec2.Peer.securityGroupId(rdssg.securityGroupId), 
      ec2.Port.tcp(Number(3306))
    )
    
    const dbCluster = new rds.DatabaseCluster(this, 'PublicDBCluster', {
      engine: rds.DatabaseClusterEngine.auroraMysql({version: rds.AuroraMysqlEngineVersion.VER_3_04_1}),
      credentials: {
        username: "admin",
        secretName: `TroccoPipelineSample/admin`,
      },
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC,
      },
      s3ImportRole:accessS3Role,
      writer: rds.ClusterInstance.provisioned('writer', {
        publiclyAccessible: true,
      }),
      securityGroups:[rdssg],
      vpc
    });

    new CfnOutput(this, 'TroccoDBClusterHostname', {
      value: dbCluster.clusterEndpoint.hostname,
      exportName: 'TroccoDBClusterHostname'
    });

    new CfnOutput(this, 'TroccoRdsCredentialPath', {
      value: dbCluster.secret!.secretArn,
      exportName: 'TroccordsCredentialPath',
    });

  }
}
