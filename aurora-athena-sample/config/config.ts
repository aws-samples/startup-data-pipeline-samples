type Config = {
    pipelineName: string,
    isExistDB?: boolean,
    dbClusterName: string,
    dbName: string,
    schemaName: string,
    sampleDataBucketName: string,
    snapshotS3BucketName: string,
    s3ExportPrefix: string,
    enableBackupExportedData: boolean,
    loadSchedule: {[key:string]:string} // refer to Eventbridge cron format (https://docs.aws.amazon.com/eventbridge/latest/userguide/eb-scheduled-rule-pattern.html)

}
export const config: Config = {
    pipelineName: "sample-ticket-database",
    isExistDB: false, //既存 DB を使う場合は true にしてください
    dbClusterName: "sample-ticket-database",
    dbName: 'demodb',
    schemaName: 'demodb',
    sampleDataBucketName:"sample-ticket-data-bucket",
    snapshotS3BucketName: "sample-snapshot-bucket", 
    s3ExportPrefix: "s3export",
    enableBackupExportedData:true,
    loadSchedule: {minute:'30', hour:'3', weekDay:'MON-FRI', month:'*', year:'*'}
}