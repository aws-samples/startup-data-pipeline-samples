import { Duration, Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as athena from 'aws-cdk-lib/aws-athena';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as events from 'aws-cdk-lib/aws-events'
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
  readonly targetTables: Array<any>;

  /**
   * Flag whether the data should be saved in S3.
   */
  readonly enableSaveExportedData: Boolean;

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
  readonly loadSchedule: any;

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
    });


    const athenaQueryResultBucket = new s3.Bucket(
      this,
      'athenaQueryResultBucket',
      {
        bucketName: `athena-query-result-${this.account}`,
        removalPolicy: RemovalPolicy.DESTROY,
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

    const crawlconf = {
      "Version": 1.0,
      "CrawlerOutput": {
        "Partitions": { "AddOrUpdateBehavior": "InheritFromTable" }
      }
    }
    const crawconfjson = JSON.stringify(crawlconf);

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

    const masterRecrawlPolicyProperty: glue.CfnCrawler.RecrawlPolicyProperty = {
      recrawlBehavior: 'CRAWL_NEW_FOLDERS_ONLY',
    };

    const targets = props.targetTables.map(table => {
      return {
        path: `${bucket.bucketName}/${props.dbName}/${table["table_name"]}`,
        exclusions: ['**.json'],
      }
    })
    const masterDataCrawler = new glue.CfnCrawler(this, "MasterDataCrawler", {
      name: props.pipelineName + "-master-crawler",
      role: snapshotExportGlueCrawlerRole.roleArn,
      targets: {
        s3Targets:targets
      },
      databaseName: props.pipelineName.replace(/[^a-zA-Z0-9_]/g, "_"),
      configuration: crawconfjson,
      schemaChangePolicy: {
        deleteBehavior: 'LOG',
        updateBehavior: 'LOG'
      },
      recrawlPolicy: masterRecrawlPolicyProperty
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
     * Create Lamnda function extract difference data.
     */
    const extractDiffDataRole = new iam.Role(this, "ExtractDiffDataRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com")
    });
    bucket.grantReadWrite(extractDiffDataRole)
    athenaQueryResultBucket.grantReadWrite(extractDiffDataRole)


    extractDiffDataRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: ["*"],
      actions: ["glue:GetDatabases", "glue:GetDatabase", "glue:GetTables", "glue:GetPartitions", "glue:GetPartition", "glue:GetTable"]
    }))


    snapshotExportEncryptionKey.addToResourcePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:DescribeKey"],
      resources: ["*"],
      principals: [extractDiffDataRole]
    }))
    extractDiffDataRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("AmazonAthenaFullAccess"))
    extractDiffDataRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"))


    const extractDiffData = new lambda.Function(this, 'ExtractDiffData', {
      code: lambda.Code.fromAsset('lambda/extract-diff-data'),
      runtime: lambda.Runtime.PYTHON_3_10,
      handler: 'index.handler',
      role: extractDiffDataRole,
      environment: {
        DB_NAME: props.dbName,
        GLUE_DATABASE: props.pipelineName,
        S3_BUCKET: props.s3BucketName,
        ATHENA_OUTPUT_BUCKET: athenaQueryResultBucket.bucketName,
        SCHEMA_NAME:props.schemaName,
        ATHENA_WORKGROUP: 'athenaWorkGroup'
      },
      timeout: Duration.minutes(15),
    })


    /**
     * Create Lamnda function moving exported data (All data load mode)
     */
    const moveAllDataRole = new iam.Role(this, "MoveAllDataRole", {
      assumedBy: new iam.ServicePrincipal("lambda.amazonaws.com"),
    })

    moveAllDataRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: ["*"],
      actions: ["glue:GetDatabases", "glue:GetDatabase", "glue:GetTables", "glue:GetPartitions", "glue:GetPartition", "glue:GetTable"]
    }))

    snapshotExportEncryptionKey.addToResourcePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ["kms:Encrypt", "kms:Decrypt", "kms:ReEncrypt*", "kms:GenerateDataKey*", "kms:DescribeKey"],
      resources: ["*"],
      principals: [moveAllDataRole]
    }))
    moveAllDataRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName("service-role/AWSLambdaBasicExecutionRole"))
    bucket.grantReadWrite(moveAllDataRole)

    const moveAllData = new lambda.Function(this, 'MoveAllData', {
      code: lambda.Code.fromAsset('lambda/init'),
      runtime: lambda.Runtime.PYTHON_3_10,
      handler: 'index.handler',
      role: moveAllDataRole,
      environment: {
        PIPELINE_NAME: props.pipelineName,
        S3_BUCKET: props.s3BucketName,
        S3_PREFIX: props.s3ExportPrefix,
        DB_NAME: props.dbName,
        SCHEMA_NAME: props.schemaName
      },
      timeout: Duration.minutes(15),
    })

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
    const cfnDataCatalog = new athena.CfnDataCatalog(this, 'AuroraDataCatalog', {
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

    const cleanup = new lambda.Function(this, 'Cleanup', {
      code: lambda.Code.fromAsset('lambda/cleanup-resource'),
      runtime: lambda.Runtime.PYTHON_3_10,
      handler: 'index.handler',
      role: extractDiffDataRole,
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

    const crawlMasterData = new sfntasks.LambdaInvoke(this, 'CrawlMasterData', {
      lambdaFunction: checkCrawlerStatus,
      payload: sfn.TaskInput.fromObject({ 'crawler': masterDataCrawler.name }),
      resultPath: '$.CrawlerStatus'
    })

    const extractDataTask = new sfntasks.LambdaInvoke(this, 'ExtractData', {
      lambdaFunction: extractDiffData,
    })

    const moveAllDataTask = new sfntasks.LambdaInvoke(this, 'MoveAllDataTask', {
      lambdaFunction: moveAllData,
      payload: sfn.TaskInput.fromObject(
        {
          "ExportTaskIdentifier": sfn.JsonPath.stringAt('$.JobInfo.Payload.ExportTaskIdentifier'),
          "Tables": sfn.JsonPath.stringAt('$.Tables')
        }
      ),
      resultPath: '$.MovedStatus'
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
    const ifLoadingAllData = new sfn.Choice(this, 'ifLoadingAllData?');

    const maps = new sfn.Map(this, 'ExtractDataMap', {
      itemsPath: '$.Tables',
      maxConcurrency: (props.targetTables.length),
      resultPath: '$.mapOutput',
      parameters: {
        'table.$': '$$.Map.Item.Value',
        'prefix.$': '$.JobInfo.Payload.identifier'
      }
    })

    const check_status = sfn.Condition.booleanEquals('$.Status.Payload', true)
    const is_all = sfn.Condition.stringEquals('$.mode', 'all')

    exportS3job.next(waitExport)
    waitExport.next(checkExportTask)
    checkExportTask.next(isExportCompleted.when(check_status, ifLoadingAllData).otherwise(waitExport))
    ifLoadingAllData.when(is_all, moveAllDataTask).otherwise(crawlExportedData)
    moveAllDataTask.next(crawlMasterData)
    crawlExportedData.next(maps.itemProcessor(extractDataTask))
    maps.next(crawlMasterData)
    crawlMasterData.next(cleanupTask)

    const stateMachine = new sfn.StateMachine(this, 'SampleAthenaPipeline', {
      definition: exportS3job,
    });


    /**
     * EventBridge Schedule
     */
    const sfnTarget = new SfnStateMachine(stateMachine, {
      input: events.RuleTargetInput.fromObject(
        {
          Tables: props.targetTables,
          EnableBuckup: props.enableSaveExportedData,
          mode: "diff"
        }),
    });

    new events.Rule(this, 'ScheduleRule', {
      schedule: events.Schedule.cron(props.loadSchedule),
      targets: [sfnTarget],
    });

  }
}
