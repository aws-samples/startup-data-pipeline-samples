type Config = {
    redshiftNameSpaceId?:string,
    redshiftWorkgroup?:string,
    dbClusterId?:string,
    dbClusterEndpointName?:string,
    vpcId?:string,
    dbPort?:number,
    s3Bucket?:string,
}
export const config:Config = {
    dbClusterId: "eroetlrdsstack-rdsdatasource", //AuroraのClusterIDを入力してください
    dbClusterEndpointName: "zeroetlrdsstack-rdsdatasource.us-west-2.rds.amazonaws.com",
    dbPort: 3306, //DB のポート番号を入力してください
    redshiftNameSpaceId:"0204750e-fe7f-4902-949a-3080f7343b0d", // RedshiftのNameSpace名を入力してください
    redshiftWorkgroup:"test", // RedshiftのWorkSpace名を入力してください。
    vpcId:'vpc-083defb57858dbc7f', //RDSもしくはRedshiftが配置されている VPC のID を入力してください
    s3Bucket:'sample-ticket-data-bucket' // サンプルデータを格納したバケットを記載してください
}