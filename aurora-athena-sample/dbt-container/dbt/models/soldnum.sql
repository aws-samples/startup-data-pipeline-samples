with sales as (

    select * from {{source('raw','demodb_sales') }}

),

users as (

    select * from {{source('raw','demodb_users') }}

),

rawdate as (

    select * from {{source('raw','demodb_date') }}

),

sales_per_users as (
    select
        sellerid,
        username,
        city, 
        sum(qtysold) as qtysoldsum

    from sales, rawdate, users
    where sales.sellerid = users.userid
    and sales.dateid = rawdate.dateid
    group by sellerid, username, city
)


select * from sales_per_users