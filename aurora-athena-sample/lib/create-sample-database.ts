// import * as cdk from 'aws-cdk-lib';
import { Stack, StackProps, CfnOutput} from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as iam from 'aws-cdk-lib/aws-iam';



export interface SampleDataSourceStackProps extends StackProps {
  readonly dbName: string; 
  readonly s3Bucket: string;
}

export class SampleDataSourceStack extends Stack {
  readonly dbClusterIdentifer: string;

  constructor(scope: Construct, id: string, props?: SampleDataSourceStackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'Vpc', {
      subnetConfiguration: [
        {
        name: "private",
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        },
        {
        name: "public",
        subnetType: ec2.SubnetType.PUBLIC,
        mapPublicIpOnLaunch: false
        },
      ]
      
    });


    // Aurora Security Group
    const rdssg = new ec2.SecurityGroup(this, 'RDSSG', {
      vpc: vpc
    });
    rdssg.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), ec2.Port.tcp(Number(3306)));

    //Aurora MySQL
    const accessS3Role = new iam.Role(this, 'S3AccessRole', {
      assumedBy: new iam.ServicePrincipal('rds.amazonaws.com'),
    })

    accessS3Role.addToPolicy(new iam.PolicyStatement({
      actions:[
        "s3:GetObject","s3:ListBucket","s3:GetObjectVersion",
      ],
      resources:[
        `arn:aws:s3:::${props?.s3Bucket}/*`,
        `arn:aws:s3:::${props?.s3Bucket}`,
      ],
      effect:iam.Effect.ALLOW,
    }))

    const dbCluster = new rds.DatabaseCluster(this, 'AthenaPipelineSource', {
      engine: rds.DatabaseClusterEngine.auroraMysql({version: rds.AuroraMysqlEngineVersion.VER_3_05_2}),
      credentials: {
        username: "admin",
        secretName: `AthenaPipelineSource/admin`,
      },
      // parameterGroup:zeroETLParameter,
      securityGroups:[rdssg],
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
      },
      s3ImportRole:accessS3Role,
      writer: rds.ClusterInstance.provisioned('writer', {
        publiclyAccessible: false,
      }),
      cloudwatchLogsExports: ['general'],
      vpc
    }) 

    this.dbClusterIdentifer = dbCluster.clusterIdentifier


    // EC2 for db access.
    const accessRdsSecurityGroup = new ec2.SecurityGroup(this, 'AccessToRDS', {
      vpc,
      allowAllOutbound:true
    });
    
    rdssg.addIngressRule(
      ec2.Peer.securityGroupId(accessRdsSecurityGroup.securityGroupId),
      ec2.Port.tcp(443),
      "https from bastion host",
      false
    );

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
      role:execS3ExportRole,
      securityGroup:accessRdsSecurityGroup,
      userData: userData
    });


    new CfnOutput(this, 'DBClusterHostname', {
      value: dbCluster.clusterEndpoint.hostname,
      exportName: 'DBClusterHostname'
    });

    new CfnOutput(this, 'RdsCredentialPath', {
      value: dbCluster.secret!.secretArn,
      exportName: 'rdsCredentialPath',
    });
  }
}
