
import { Stack, StackProps, custom_resources as cr, aws_rds as classicrds } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as rds from 'aws-cdk-lib/aws-rds';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as secretmanager from 'aws-cdk-lib/aws-secretsmanager'
import * as redshiftserverless from 'aws-cdk-lib/aws-redshiftserverless'
import * as kms from 'aws-cdk-lib/aws-kms'

export interface RedshiftStackProps extends StackProps {
    readonly vpc: ec2.IVpc;
    readonly redshiftNameSpaceId?: string;
    readonly dbCluster: rds.IDatabaseCluster;
    readonly redshiftWorkSpace?: string;
}

export class RedshiftStack extends Stack {
    readonly redshiftNameSpaceId: string;
    readonly redshiftWorkspaceName: string;
    readonly vpc: ec2.IVpc;

    constructor(scope: Construct, id: string, props: RedshiftStackProps) {
        super(scope, id, props);
        
        /** 
         * Redshift
         */

        if (props.redshiftNameSpaceId == undefined || props.redshiftWorkSpace == undefined) {

            console.log('Create new Redshift Namespace & workspace')
            /** 
             * VPC 
             */
            if (props?.vpc == undefined) {
                throw new Error("VPC is not defined");
            }

            const vpc = props.vpc


            const redshiftServerlessAdminSecret = new secretmanager.Secret(this, 'RedshiftServerlessAdminSecret', {
                generateSecretString: {
                    secretStringTemplate: JSON.stringify({ username: 'admin' }),
                    generateStringKey: 'password',
                    excludeCharacters: '/@"\\\'',
                    passwordLength: 32
                }
            })

            const redshiftServerlessNCRole = new iam.Role(this, 'RedshiftServerlessNamespaceRole', {
                assumedBy: new iam.CompositePrincipal(
                    new iam.ServicePrincipal('redshift-serverless.amazonaws.com')
                ),
                managedPolicies: [
                    iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonRedshiftAllCommandsFullAccess')
                ]
            })

            redshiftServerlessNCRole.addToPolicy(
                new iam.PolicyStatement({
                    actions: [
                        "s3:GetObject",
                        "s3:GetBucketAcl",
                        "s3:GetBucketCors",
                        "s3:GetEncryptionConfiguration",
                        "s3:GetBucketLocation",
                        "s3:ListBucket",
                        "s3:ListAllMyBuckets",
                        "s3:ListMultipartUploadParts",
                        "s3:ListBucketMultipartUploads",
                        "s3:PutObject",
                        "s3:PutBucketAcl",
                        "s3:PutBucketCors",
                        "s3:DeleteObject",
                        "s3:AbortMultipartUpload",
                        "s3:CreateBucket"
                    ],
                    effect: iam.Effect.ALLOW,
                    resources: [
                        "arn:aws:s3:::*"
                    ]
                })
            )

            const redshiftServerlessKmsKey = new kms.Key(this, 'RedshiftServerlessKmsKey', {
                enabled: true,
                enableKeyRotation: true
            })

            const REDSHIFT_DBNAME = "zeroetldb";

            const cfnNamespace = new redshiftserverless.CfnNamespace(this, 'RedshiftServerlesssNC', {
                namespaceName: 'default2',

                // the properties below are optional
                // adminPasswordSecretKmsKeyId: 'adminPasswordSecretKmsKeyId',
                adminUsername: redshiftServerlessAdminSecret.secretValueFromJson('username').unsafeUnwrap(),
                adminUserPassword: redshiftServerlessAdminSecret.secretValueFromJson('password').unsafeUnwrap(),
                dbName: REDSHIFT_DBNAME,
                defaultIamRoleArn: redshiftServerlessNCRole.roleArn,
                iamRoles: [redshiftServerlessNCRole.roleArn],
                kmsKeyId: redshiftServerlessKmsKey.keyId,
                logExports: ['userlog', 'connectionlog', 'useractivitylog'],
            });

            const redshiftSG = new ec2.SecurityGroup(this, 'RedshiftSecurityGroup', {
                vpc,
                allowAllOutbound: true
            })

            // redshiftSG.addIngressRule(ec2.Peer.securityGroupId(accessRdsSecurityGroup.securityGroupId), ec2.Port.tcp(5432), "Allow RDS Access");
            // console.log(vpc.selectSubnets({subnetGroupName:'rds'}).subnets)

            console.log(vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }).subnetIds)

            const cfnWorkgroup = new redshiftserverless.CfnWorkgroup(this, 'RedshiftWorkingGroup', {
                workgroupName: 'redshift-zeroetl-test2',

                // the properties below are optional
                baseCapacity: 8,
                namespaceName: cfnNamespace.namespaceName,
                configParameters: [{
                    parameterKey: 'enable_case_sensitive_identifier',
                    parameterValue: '1'
                }],
                enhancedVpcRouting: true,
                publiclyAccessible: false,
                securityGroupIds: [redshiftSG.securityGroupId],
                subnetIds: vpc.selectSubnets({ subnetType: ec2.SubnetType.PRIVATE_ISOLATED }).subnetIds,
            });

            cfnWorkgroup.addDependsOn(cfnNamespace)

            this.redshiftNameSpaceId = cfnNamespace.attrNamespaceNamespaceId
            this.redshiftWorkspaceName = cfnWorkgroup.workgroupName

        } else {
            this.redshiftNameSpaceId = props?.redshiftNameSpaceId
            this.redshiftWorkspaceName = props?.redshiftWorkSpace

            /** 
             * Define Redshift Serverless workgroup parameter.
             */
            const newParameters = [
                {
                    parameterKey: 'enable_case_sensitive_identifier',
                    parameterValue: '1'
                }
            ];

            new cr.AwsCustomResource(this, 'UpdateWorkgroup', {
                onCreate: { // will also be called for a CREATE event
                    service: '@aws-sdk/client-redshift-serverless',
                    action: 'UpdateWorkgroup',
                    parameters: {
                        workgroupName: props.redshiftWorkSpace,
                        configParameters: newParameters
                    },
                    physicalResourceId: cr.PhysicalResourceId.of(Date.now().toString()), // Update physical id to always fetch the latest version
                },
                policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
                    resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
                }),
            });

        }

        /** 
         * Setup ResourcePolicy
        */
        const redshiftIntegrationRole = new iam.Role(this, 'RedshiftIntegrationRole', {
            assumedBy: new iam.ServicePrincipal('redshift.amazonaws.com'),
        })

        redshiftIntegrationRole.addToPolicy(new iam.PolicyStatement({
            actions: [
                "redshift:CreateInboundIntegration",
                "redshift:DescribeInboundIntegration",
                "redshift:DeleteInboundIntegration",
                "redshift:AuthorizeInboundIntegration",

            ],
            resources: [
                this.formatArn({
                    service: 'redshift-serverless',
                    resource: 'namespace',
                    resourceName: `${this.redshiftNameSpaceId}'/*'`
                })
            ],
            effect: iam.Effect.ALLOW,
        }))



        // Define the resource policy
        const resourcePolicy = new iam.PolicyDocument({
            statements: [
                new iam.PolicyStatement({
                    principals: [
                        new iam.ServicePrincipal("redshift:AuthorizeInboundIntegration"),
                    ],
                    actions: ["redshift:AuthorizeInboundIntegration"],
                    conditions: {
                        StringEquals: {
                            "aws:SourceArn": props.dbCluster.clusterArn,
                        },
                    },
                }),
                new iam.PolicyStatement({
                    principals: [new iam.AccountRootPrincipal()],
                    actions: ["redshift:CreateInboundIntegration"],
                }),
            ],
        });


        // Convert the policy to a JSON string
        const policyJson = JSON.stringify(resourcePolicy);

        new cr.AwsCustomResource(this, 'PutResourcePolicy', {
            onCreate: { // will also be called for a CREATE event
                service: '@aws-sdk/client-redshift',
                action: 'PutResourcePolicy',
                parameters: {
                    ResourceArn: this.formatArn({
                        service: 'redshift-serverless',
                        resource: 'namespace',
                        resourceName: this.redshiftNameSpaceId
                    }),
                    Policy: policyJson
                },
                physicalResourceId: cr.PhysicalResourceId.of(Date.now().toString()), // Update physical id to always fetch the latest version
            },
            policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
                resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
            }),
        });
    }
}