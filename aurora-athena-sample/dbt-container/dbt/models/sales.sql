{{
    config (
        materialized = 'incremental',
        unique_key = 'saletime'
    )
}}
select
    *
from {{ source('raw','demodb_sales') }}
{%- if is_incremental() %}
    where saletime > cast((select max(saletime) from {{ this }}) as timestamp)
{%- endif %}