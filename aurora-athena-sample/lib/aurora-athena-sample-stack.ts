import { Duration, Stack, StackProps, RemovalPolicy, SecretValue} from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as athena from 'aws-cdk-lib/aws-athena';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as events from 'aws-cdk-lib/aws-events';
import * as ecs from 'aws-cdk-lib/aws-ecs';

import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { SfnStateMachine } from 'aws-cdk-lib/aws-events-targets';

import { Construct } from 'constructs';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as sfntasks from 'aws-cdk-lib/aws-stepfunctions-tasks';


export interface AthenaPipelineStackProps extends StackProps {
  /**
   * Name of the S3 bucket to which snapshot exports should be saved.
   *
   * NOTE: Bucket will be created by Cfn.
   */
  readonly s3BucketName: string;


  /**
   * Name of the S3 Export prefix.
   */
  readonly s3ExportPrefix: string;

  /**
   * Name of this pipeline system.
   */
  readonly pipelineName: string;

  /**
   * Name of the tables that are import target.
   */
  // readonly targetTables: Array<any>;

  /**
   * Flag whether the data should be saved in S3.
   */
  readonly enableSaveExportedData: boolean;

  /**
   * Name of the RDS Cluster.
   */
  readonly rdsClusterName: string;

  /**
   * Name of the RDS DB.
   */
  readonly dbName: string;

  /**
   * Name of the RDS Schema.
   */
  readonly schemaName: string;

  /**
   * The schedule of loading data.
   */
  readonly loadSchedule: {[key:string]:string};

  readonly clusterVpc?: ec2.Vpc;

};

export class AthenaPipelineStack extends Stack {
  constructor(scope: Construct, id: string, props: AthenaPipelineStackProps) {
    super(scope, id, props);

    if (props.pipelineName.length > 30) {
      throw new Error('Pipeline name invalid. Pipeline length must be lower than 30 characters.')
    }

    /**
     * Create S3 Bucket
     */
    const bucket = new s3.Bucket(this, "SnapshotExportBucket", {
      bucketName: props.s3BucketName,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });


    const athenaQueryResultBucket = new s3.Bucket(
      this,
      'athenaQueryResultBucket',
      {
        bucketName: `athena-query-result-${this.account}`,
        removalPolicy: RemovalPolicy.DESTROY,
        autoDeleteObjects: true,
      }
    );

    /**
     * Create resource for S3 Export
     */
    const execS3ExportRole = new iam.Role(this, "SnapshotExportTaskRole", {
      assumedBy: new iam.ServicePrincipal("export.rds.amazonaws.com")
    })
    execS3ExportRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: [`${bucket.bucketArn}`, `${bucket.bucketArn}/*`,],
      actions: ["s3:PutObject*", "s3:ListBucket", "s3:DeleteObject*", "s3:GetObject*", "s3:GetBucketLocation"]
    }))

    const exportTaskExecutionRole = new iam.Role(this, "RdsSnapshotExporterLambdaExecutionRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    })
    exportTaskExecutionRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: ['*'],
      actions: ["rds:StartExportTask", "rds:DescribeDBSnapshots"]
    }))

    exportTaskExecutionRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: [execS3ExportRole.roleArn],
      actions: ["iam:PassRole"]
    }))

    const snapshotExportEncryptionKey = new kms.Key(this, "SnapshotExportEncryptionKey", {
      alias: props.pipelineName + "-snapshot-exports",
    })

    snapshotExportEncryptionKey.addToResourcePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["kms:*"],
      resources: ["*"],
      principals: [(new iam.AccountRootPrincipal())]
    }))

    snapshotExportEncryptionKey.addToResourcePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:DescribeKey"],
      resources: ["*"],
      principals: [exportTaskExecutionRole]
    }))

    snapshotExportEncryptionKey.addToResourcePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["kms:CreateGrant", "kms:ListGrants", "kms:RevokeGrant"],
      resources: ["*"],
      principals: [exportTaskExecutionRole],
      conditions: { "Bool": { "kms:GrantIsForAWSResource": true } }
    }))

    const rdsSnapshotExportToS3Function = new lambda.Function(this, 'RdsSnapshotExportToS3Function', {
      code: lambda.Code.fromAsset('lambda/export-to-s3'),
      runtime: lambda.Runtime.PYTHON_3_10,
      handler: 'index.handler',
      role: exportTaskExecutionRole,
      environment: {
        DB_NAME: props.rdsClusterName,
        S3_PREFIX: props.s3ExportPrefix,
        PIPELINE_NAME: props.pipelineName,
        SNAPSHOT_BUCKET_NAME: props.s3BucketName,
        SNAPSHOT_TASK_ROLE: execS3ExportRole.roleArn,
        SNAPSHOT_TASK_KEY: snapshotExportEncryptionKey.keyId,
      },
      timeout: Duration.minutes(15),
    });

    /**
     * Create Lamnda function checking export status.
     */
    const checkExportTaskRole = new iam.Role(this, "CheckExportTaskRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    })
    checkExportTaskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: ["*"],
      actions: ["rds:DescribeExportTasks"]
    }))
    checkExportTaskRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"))

    const checkRdsExportTaskFunction = new lambda.Function(this, 'CheckRdsExportTaskFunction', {
      code: lambda.Code.fromAsset('lambda/check-export-task'),
      runtime: lambda.Runtime.PYTHON_3_10,
      handler: 'index.handler',
      role: checkExportTaskRole,
      timeout: Duration.minutes(15),
    })


    /**
     * Create Crawler for exported data from s3.
     */

    const snapshotExportGlueCrawlerRole = new iam.Role(this, "SnapshotExportsGlueCrawlerRole", {
      assumedBy: new iam.ServicePrincipal("glue.amazonaws.com"),
    })

    snapshotExportGlueCrawlerRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: [`${bucket.bucketArn}`, `${bucket.bucketArn}/*`,],
      actions: ["s3:PutObject*", "s3:GetObject*"]
    }))
    snapshotExportGlueCrawlerRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSGlueServiceRole"))

    snapshotExportEncryptionKey.addToResourcePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:DescribeKey"],
      resources: ["*"],
      principals: [snapshotExportGlueCrawlerRole]
    }))

    const recrawlPolicyProperty: glue.CfnCrawler.RecrawlPolicyProperty = {
      recrawlBehavior: 'CRAWL_EVERYTHING',
    };

    const exportedDataCrawler = new glue.CfnCrawler(this, "SnapshotExportCrawler", {
      name: props.pipelineName + "-rds-snapshot-crawler",
      role: snapshotExportGlueCrawlerRole.roleArn,
      targets: {
        s3Targets: [
          {
            path: `${bucket.bucketName}/${props.s3ExportPrefix}`,
            exclusions: ['**.json'],
          },
        ]
      },
      databaseName: props.pipelineName.replace(/[^a-zA-Z0-9_]/g, "_"),
      schemaChangePolicy: {
        deleteBehavior: 'LOG',
        updateBehavior: 'LOG'
      },
      recrawlPolicy: recrawlPolicyProperty
    });


    /**
     * Create Lamnda function checking Crawler
     */
    const checkCrawlerStatusRole = new iam.Role(this, "CheckCrawlerStatusRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
      description: 'CheckCrawlerStatus',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSGlueServiceRole"),
        iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"),
      ],
    })

    const checkCrawlerStatus = new lambda.Function(this, 'CheckCrawlerStatus', {
      code: lambda.Code.fromAsset('lambda/check-crawler-status'),
      runtime: lambda.Runtime.PYTHON_3_10,
      handler: 'index.handler',
      role: checkCrawlerStatusRole,
      environment: { 'CRAWLER_NAME': exportedDataCrawler.name! },
      timeout: Duration.minutes(15),
    })


    /**
     * Create transport process with dbt 
     */
    const user = new iam.User(this, 'dbtuser');
    user.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonAthenaFullAccess'))
    user.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AWSGlueConsoleFullAccess'))
    user.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: [`${bucket.bucketArn}`, `${bucket.bucketArn}/*`,],
      actions:["s3:*"]
    }))

    snapshotExportEncryptionKey.addToResourcePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:DescribeKey"],
      resources: ["*"],
      principals: [user]
    }))

    user.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: [`${athenaQueryResultBucket.bucketArn}`, `${athenaQueryResultBucket.bucketArn}/*`,],
      actions:[
        "s3:GetBucketLocation",
        "s3:GetObject",
        "s3:ListBucket",
        "s3:ListBucketMultipartUploads",
        "s3:ListMultipartUploadParts",
        "s3:AbortMultipartUpload",
        "s3:CreateBucket",
        "s3:PutObject",
        "s3:PutBucketPublicAccessBlock"
      ]
    }))

    const accessKey = new iam.AccessKey(this, 'AccessKey', { user });
    const accessKeyId = new secretsmanager.Secret(this, 'AwsAccessKeyId', {
        secretStringValue:SecretValue.unsafePlainText(accessKey.accessKeyId)
      }
    )
    const secretAccessKey = new secretsmanager.Secret(this, 'AwsSecretAccessKey', {
      secretStringValue:accessKey.secretAccessKey
    }
  )

    const taskRole = new iam.Role(this, "DbtContainer", {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com')
    });

    const ecrPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: ['*'],
      actions: [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ]
    });

    const secretPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: [secretAccessKey.secretArn],
      actions: ["ssm:GetParameters", "secretsmanager:GetSecretValue", "kms:Decrypt"]
    })
    taskRole.addToPolicy(ecrPolicy)
    taskRole.addToPolicy(secretPolicy)

    const taskDef = new ecs.FargateTaskDefinition(this, "dbt-task", {
      taskRole: taskRole,
      runtimePlatform:{
        operatingSystemFamily: ecs.OperatingSystemFamily.LINUX,
        cpuArchitecture: ecs.CpuArchitecture.ARM64,
      }
    });
    taskDef.addToExecutionRolePolicy(ecrPolicy) 

    const logging = new ecs.AwsLogDriver({
      streamPrefix: "dbt-task-logs"
    });   

    taskDef.addContainer('dbt-container', {
      image: ecs.ContainerImage.fromAsset("dbt-container"),
      memoryLimitMiB: 256,
      cpu: 256,
      secrets: {
        "AWS_ACCESS_KEY_ID": ecs.Secret.fromSecretsManager(accessKeyId),
        "AWS_SECRET_ACCESS_KEY":  ecs.Secret.fromSecretsManager(secretAccessKey)
      },
      environment: {
        "S3_BUCKET": `s3://${bucket.bucketName}/`,
        "S3_ATHENA_LOG_BUCKET": `s3://${athenaQueryResultBucket.bucketName}/result-data/`
      },
      logging
    });

    let vpc;

    if(props.clusterVpc){
      vpc = props.clusterVpc
    } else {
      vpc = new ec2.Vpc(this, 'ECSVpc', {
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
      })
    }

    if (!vpc) {
      throw new Error('VPC ID must be provided in the context.');
    }
    
    vpc.addInterfaceEndpoint("scm-endpoint", {
      service: ec2.InterfaceVpcEndpointAwsService.SECRETS_MANAGER
    })

    vpc.addInterfaceEndpoint("ecr-endpoint", {
      service: ec2.InterfaceVpcEndpointAwsService.ECR
    })

    vpc.addInterfaceEndpoint("ecr-dkr-endpoint", {
      service: ec2.InterfaceVpcEndpointAwsService.ECR_DOCKER
    })

    vpc.addInterfaceEndpoint("logs-endpoint", {
      service: ec2.InterfaceVpcEndpointAwsService.CLOUDWATCH_LOGS
    })

    vpc.addInterfaceEndpoint("glue-endpoint", {
      service: ec2.InterfaceVpcEndpointAwsService.GLUE
    })

    vpc.addInterfaceEndpoint("sts-endpoint", {
      service: ec2.InterfaceVpcEndpointAwsService.STS
    })


    const cluster = new ecs.Cluster(this, 'FargateCPCluster', {
      vpc
    });


    /**
     * Athena database
     */
    new athena.CfnWorkGroup(this, 'athenaWorkGroup', {
      name: 'athenaWorkGroup',
      workGroupConfiguration: {
        resultConfiguration: {
          outputLocation: `s3://${athenaQueryResultBucket.bucketName}/result-data`,
        },
      },
      recursiveDeleteOption: true,
    });

    // Athena DataCatalog
    new athena.CfnDataCatalog(this, 'AuroraDataCatalog', {
      name: 'AuroraDataCatalog',
      type: 'GLUE',

      // the properties below are optional
      description: 'this is table synced from aurora database.',
      parameters: {
        'catalog-id': this.account,
      },
    });


    /**
     * Create Lamnda function cleaning resource
     */

    const cleanupRole = new iam.Role(this, "ExtractDiffDataRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com")
    });
    bucket.grantReadWrite(cleanupRole)
    athenaQueryResultBucket.grantReadWrite(cleanupRole)


    cleanupRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: ["*"],
      actions: ["glue:GetDatabases", "glue:GetDatabase", "glue:GetTables", "glue:GetPartitions", "glue:GetPartition", "glue:GetTable"]
    }))


    snapshotExportEncryptionKey.addToResourcePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:DescribeKey"],
      resources: ["*"],
      principals: [cleanupRole]
    }))
    cleanupRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonAthenaFullAccess"))
    cleanupRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"))
    

    const cleanup = new lambda.Function(this, 'Cleanup', {
      code: lambda.Code.fromAsset('lambda/cleanup-resource'),
      runtime: lambda.Runtime.PYTHON_3_10,
      handler: 'index.handler',
      role: cleanupRole,
      environment: {
        DB_NAME: props.pipelineName,
        S3_BUCKET: props.s3BucketName,
        S3_EXPORT_PREFIX: props.s3ExportPrefix,
        S3_BUCKUP_PREFIX: 'backup',
        S3_EXPORT_CRAWLER: exportedDataCrawler.name!
      },
      timeout: Duration.minutes(15),
    })


    /**
     * Sfn setup for Lambda Invoke
     * 
     */
    const exportS3job = new sfntasks.LambdaInvoke(this, 'RunRDSExportTask', {
      lambdaFunction: rdsSnapshotExportToS3Function,
      resultPath: '$.JobInfo'
    });

    const checkExportTask = new sfntasks.LambdaInvoke(this, 'CheckExportTask', {
      lambdaFunction: checkRdsExportTaskFunction,
      inputPath: '$.JobInfo.Payload',
      resultPath: '$.Status'
    })

    const crawlExportedData = new sfntasks.LambdaInvoke(this, 'CrawlExportedData', {
      lambdaFunction: checkCrawlerStatus,
      payload: sfn.TaskInput.fromObject({ 'crawler': exportedDataCrawler.name }),
      resultPath: '$.CrawlerStatus'
    })

    const dbtDataTask = new sfntasks.EcsRunTask(this, 'RunDbtTask', {
      integrationPattern: sfn.IntegrationPattern.RUN_JOB,
      cluster: cluster,
      taskDefinition: taskDef,
      assignPublicIp: true,
      launchTarget: new sfntasks.EcsFargateLaunchTarget(),
      subnets:vpc.selectSubnets({
        subnetType: ec2.SubnetType.PUBLIC,
      }),
      resultPath: '$.EcsTaskOutput'
    })

    const cleanupTask = new sfntasks.LambdaInvoke(this, 'CleanupTask', {
      lambdaFunction: cleanup,
      payload: sfn.TaskInput.fromObject(
        {
          "ExportTaskIdentifier": sfn.JsonPath.stringAt('$.JobInfo.Payload.ExportTaskIdentifier'),
          "EnableBuckup": sfn.JsonPath.stringAt('$.EnableBuckup')
        }
      )
    })

    const waitExport = new sfn.Wait(this, 'WaitExport', {
      time: sfn.WaitTime.duration(Duration.minutes(1))
    })

    const isExportCompleted = new sfn.Choice(this, 'isExportCompleted?');
  

    const check_status = sfn.Condition.booleanEquals('$.Status.Payload', true)
 
    exportS3job.next(waitExport)
    waitExport.next(checkExportTask)
    checkExportTask.next(isExportCompleted.when(check_status, crawlExportedData).otherwise(waitExport))
    crawlExportedData.next(dbtDataTask)
    dbtDataTask.next(cleanupTask)

    const stateMachine = new sfn.StateMachine(this, 'SampleAthenaPipeline', {
      definition: exportS3job,
    });


    /**
     * EventBridge Schedule
     */
    const sfnTarget = new SfnStateMachine(stateMachine, {
      input: events.RuleTargetInput.fromObject(
        {
          EnableBuckup: props.enableSaveExportedData,
        }),
    });

    new events.Rule(this, 'ScheduleRule', {
      schedule: events.Schedule.cron(props.loadSchedule),
      targets: [sfnTarget],
    });

  }
}
