select
    *
from {{ source('raw','demodb_users') }}