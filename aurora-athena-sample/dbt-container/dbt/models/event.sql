{{
    config (
        materialized = 'incremental',
        unique_key = 'starttime'
    )
}}
select
    *
from {{ source('raw','demodb_event') }}
{%- if is_incremental() %}
    where starttime > cast((select max(starttime) from {{ this }}) as timestamp)
{%- endif %}