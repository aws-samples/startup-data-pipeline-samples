select
    *
from {{ source('raw','demodb_date') }}
