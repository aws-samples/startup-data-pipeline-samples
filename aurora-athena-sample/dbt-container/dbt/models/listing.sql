{{
    config (
        materialized = 'incremental',
        unique_key = 'listtime'
    )
}}
select
    *
from {{ source('raw','demodb_listing') }}
{%- if is_incremental() %}
    where listtime > cast((select max(listtime) from {{ this }}) as timestamp)
{%- endif %}