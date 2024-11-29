create database demodb;

create table demodb.users(
    userid integer not null primary key,
    username char(8),
    firstname varchar(30),
    lastname varchar(30),
    city varchar(30),
    state char(2),
    email varchar(100),
    phone char(14),
    likesports boolean,
    liketheatre boolean,
    likeconcerts boolean,
    likejazz boolean,
    likeclassical boolean,
    likeopera boolean,
    likerock boolean,
    likevegas boolean,
    likebroadway boolean,
    likemusicals boolean);
            
create table demodb.venue(
    venueid integer not null primary key,
    venuename varchar(100),
    venuecity varchar(30),
    venuestate char(2),
    venueseats integer);
    
    
create table demodb.category(
    catid integer not null primary key,
    catgroup varchar(10),
    catname varchar(10),
    catdesc varchar(50));
    
    
create table demodb.date (
    dateid integer not null primary key,
    caldate date not null,
    day character(3) not null,
    week smallint not null,
    month character(5) not null,
    qtr character(5) not null,
    year smallint not null,
    holiday boolean default FALSE );
    
    
create table demodb.event(
    eventid integer not null primary key,
    venueid integer not null,
    catid integer not null,
    dateid integer not null,
    eventname varchar(200),
    starttime timestamp);
    
    
create table demodb.listing(
    listid integer not null primary key,
    sellerid integer not null,
    eventid integer not null,
    dateid integer not null,
    numtickets smallint not null,
    priceperticket decimal(8,2),
    totalprice decimal(8,2),
    listtime timestamp);
    
    
create table demodb.sales(
    salesid integer not null primary key,
    listid integer not null,
    sellerid integer not null,
    buyerid integer not null,
    eventid integer not null,
    dateid integer not null,
    qtysold smallint not null,
    pricepaid decimal(8,2),
    commission decimal(8,2),
    saletime timestamp);
              
--- EDIT S3 BUCKET ---
LOAD DATA FROM S3 PREFIX 's3://sample-ticket-data-bucket/allusers_pipe.txt' INTO TABLE demodb.users FIELDS TERMINATED BY '|';    
LOAD DATA FROM S3 PREFIX 's3://sample-ticket-data-bucket/allevents_pipe.txt' INTO TABLE demodb.event FIELDS TERMINATED BY '|';    
LOAD DATA FROM S3 PREFIX 's3://sample-ticket-data-bucket/category_pipe.txt' INTO TABLE demodb.category FIELDS TERMINATED BY '|';    
LOAD DATA FROM S3 PREFIX 's3://sample-ticket-data-bucket/date2008_pipe.txt' INTO TABLE demodb.date FIELDS TERMINATED BY '|';    
LOAD DATA FROM S3 PREFIX 's3://sample-ticket-data-bucket/listings_pipe.txt' INTO TABLE demodb.listing FIELDS TERMINATED BY '|';    
LOAD DATA FROM S3 PREFIX 's3://sample-ticket-data-bucket/venue_pipe.txt' INTO TABLE demodb.venue FIELDS TERMINATED BY '|';    
LOAD DATA FROM S3 PREFIX 's3://sample-ticket-data-bucket/sales_tab.txt' INTO TABLE demodb.sales FIELDS TERMINATED BY '|';