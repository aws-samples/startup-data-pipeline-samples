type Config = {
    troccoIPs:Array<string>,
    sampleDataBucket:string,
    troccoAWSAccountId: string,
    troccoTargetBucket: string,
    troccoExternalId: string,
    isExistDB: boolean
}
export const config:Config = {
    troccoIPs: ['xx.xxx.xxx.xxx/32'],
    sampleDataBucket: "sample-ticket-data-bucket",
    troccoAWSAccountId: '123456789123',
    troccoTargetBucket:'trocco-target-bucket',
    troccoExternalId:'11111111-1111-1111-1111-111111111111',
    isExistDB: false
}

