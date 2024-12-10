with sales as (

    select * from "AwsDataCatalog"."sample_ticket_database"."sales"

),

users as (

    select * from "AwsDataCatalog"."sample_ticket_database"."users"

),

rawdate as (

    select * from "AwsDataCatalog"."sample_ticket_database"."date"

),

new_sales as (
    select
        sellerid,
        username,
        -- (firstname ||''|| lastname) as name,
        city, 
        sum(qtysold) as qtysoldsum

    from sales, rawdate, users
    where sales.sellerid = users.userid
    and sales.dateid = rawdate.dateid
    group by sellerid, username, city
   
)


select * from new_sales