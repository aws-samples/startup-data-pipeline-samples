
import { Stack, StackProps, custom_resources as cr, CfnOutput, aws_rds as classicrds } from 'aws-cdk-lib';
import { Construct } from 'constructs';

import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from 'aws-cdk-lib/aws-rds';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as kms from 'aws-cdk-lib/aws-kms'


export interface ZeroETLRDSStackProps extends StackProps {
    readonly vpcId?: string;
    readonly dbClusterId?: string;
    readonly dbClusterEndpointName?: string;
    readonly dbPort?: number;
    readonly s3Bucket?: string;
}

export class ZeroETLRDSStack extends Stack {
    readonly vpcId: string;
    readonly vpc: ec2.IVpc;
    readonly dbClusterId: string;
    readonly dbCluster: rds.IDatabaseCluster;
    readonly redshiftNameSpace: string;
    readonly redshiftWorkSpace: string;

    constructor(scope: Construct, id: string, props?: ZeroETLRDSStackProps) {
        super(scope, id, props);
         
        /** 
         * VPC 
         */
        if (props?.vpcId) {
            this.vpc = ec2.Vpc.fromLookup(this, 'Vpc', {
                vpcId: props?.vpcId
            })
        } else {
            this.vpc = new ec2.Vpc(this, "ZeroETLSampleVPC1", {
                ipAddresses: ec2.IpAddresses.cidr('10.0.0.0/16'),
                subnetConfiguration: [
                    {
                        cidrMask: 24,
                        name: 'private',
                        subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                    }
                ],
                maxAzs: 3
            })
        }

        /** 
         * EC2 for access to Database 
         */

        // vpc subnet connection care 
        const vpc = this.vpc
        const endpointSG = new ec2.SecurityGroup(this, "EndpointSG", {
            vpc,
            allowAllOutbound: true,
        });

        vpc.addInterfaceEndpoint("SSMEndpoint", {
            service: ec2.InterfaceVpcEndpointAwsService.SSM,
            securityGroups: [endpointSG],
        });
        vpc.addInterfaceEndpoint("SSMMessagesEndpoint", {
            service: ec2.InterfaceVpcEndpointAwsService.SSM_MESSAGES,
            securityGroups: [endpointSG],
        });
        vpc.addInterfaceEndpoint("EC2MessagesEndpoint", {
            service: ec2.InterfaceVpcEndpointAwsService.EC2_MESSAGES,
            securityGroups: [endpointSG],
        });

        const accessRdsSecurityGroup = new ec2.SecurityGroup(this, 'AccessToRDS', {
            vpc,
            allowAllOutbound: true
        });

        endpointSG.addIngressRule(
            ec2.Peer.securityGroupId(accessRdsSecurityGroup.securityGroupId),
            ec2.Port.tcp(443),
            "https from bastion host",
            false
        );

        const ec2Role = new iam.Role(this, `instance-role`, {
            roleName: `ssm-ec2-instance-role`,
            assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromManagedPolicyArn(this, "AmazonEC2ContainerServiceforEC2Role", "arn:aws:iam::aws:policy/service-role/AmazonEC2ContainerServiceforEC2Role"),
                iam.ManagedPolicy.fromManagedPolicyArn(this, "AmazonEC2RoleforSSM", "arn:aws:iam::aws:policy/service-role/AmazonEC2RoleforSSM"),
                iam.ManagedPolicy.fromManagedPolicyArn(this, "AmazonSSMManagedInstanceCore", "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore")
            ]
        })

        const userData = ec2.UserData.forLinux({ shebang: '#!/bin/bash' })
        userData.addCommands(
            'dnf update -y',
            'dnf install mariadb105 -y'
        )

        const rdsAccessInstance = new ec2.Instance(this, 'rdsAccess', {
            vpc: vpc,
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE2, ec2.InstanceSize.MICRO),
            machineImage: new ec2.AmazonLinuxImage({ generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2023 }),
            role: ec2Role,
            securityGroup: accessRdsSecurityGroup,
            userData:userData
        });

        const rdsSecurityGroup = new ec2.SecurityGroup(this, 'rdsSG', {
            vpc,
            allowAllOutbound: true
        });
        rdsSecurityGroup.addIngressRule(ec2.Peer.securityGroupId(accessRdsSecurityGroup.securityGroupId), ec2.Port.tcp(3306), "Allow RDS Access");

        const parameterGroupName = 'ParameterForIntegration'
        
        const zeroETLParameter = new rds.ParameterGroup(this, 'ZeroETLRDSParamterGroup', {
            engine:rds.DatabaseClusterEngine.auroraMysql({version: rds.AuroraMysqlEngineVersion.VER_3_05_2}),
            name:parameterGroupName,
            parameters:{
              binlog_backup:'0',
              binlog_replication_globaldb:'0',
              binlog_format:'ROW',
              aurora_enhanced_binlog:'1',
              binlog_row_metadata:'FULL',
              binlog_row_image:'FULL',
            }
          });

        if(props?.dbClusterId){
            console.log('Retrive exist RDS Cluster...')

            if(!(props?.dbClusterEndpointName && props?.dbPort)){
                throw new Error("dbClusterEndpointName and dbPort must be defined."); 
            }

            this.dbCluster = rds.DatabaseCluster.fromDatabaseClusterAttributes(this, "RDSDataSource", {
                clusterIdentifier: props!.dbClusterId,
                port: props!.dbPort,
                clusterEndpointAddress: props!.dbClusterEndpointName
              })

            // updateParameterGroup
            new cr.AwsCustomResource(this, 'UpdateParameterGroup', {
                onUpdate: { // will also be called for a CREATE event
                    service: '@aws-sdk/client-rds',
                    action: 'ModifyDBCluster',
                    parameters: {
                          DBClusterIdentifier: this.dbCluster.clusterIdentifier, // required
                          DBClusterParameterGroupName: parameterGroupName
                        },
                    physicalResourceId: cr.PhysicalResourceId.of(Date.now().toString()), // Update physical id to always fetch the latest version
                },
                policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
                    resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
                }),
            });
        } else {
            console.log('Create new RDS Cluster...')

            if(!props?.s3Bucket){
                throw new Error('Define sampledata S3Bucket Name')
            }

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

            this.dbCluster = new rds.DatabaseCluster(this, 'RDSDataSource', {
                engine: rds.DatabaseClusterEngine.auroraMysql({ version: rds.AuroraMysqlEngineVersion.VER_3_05_2 }),
                credentials: {
                    username: "admin",
                    secretName: `RDSDataSorce/admin`,
                  },
                parameterGroup:zeroETLParameter,
                securityGroups: [rdsSecurityGroup],
                vpcSubnets: {
                    subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
                },
                s3ImportRole:accessS3Role,
                writer: rds.ClusterInstance.provisioned('writer', {
                    publiclyAccessible: false,
                }),
                vpc
            })

        }
        
        new CfnOutput(this, 'DBClusterHostname', {
            value: this.dbCluster.clusterEndpoint.hostname,
            exportName: 'ZeroETLSampleDBClusterHostname'
          });
      
        new CfnOutput(this, 'RdsCredentialPath', {
            value: 'RDSDataSorce/admin',
            exportName: 'ZeroETLSampleRdsCredentialPath',
        });

        this.dbClusterId = this.dbCluster.clusterIdentifier.toString()

    }

}
