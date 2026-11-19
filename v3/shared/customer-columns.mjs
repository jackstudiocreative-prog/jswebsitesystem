// Shopify customer CSV export headers (current names first, older names after), shared by the admin
// import screen (which sends only these columns) and the server.
export const CUSTOMER_COLUMNS={
 shopify_customer_id:['customer id','id'],first_name:['first name'],last_name:['last name'],email:['email'],
 company:['default address company','company'],address1:['default address address1','address1'],address2:['default address address2','address2'],
 city:['default address city','city'],province_code:['default address province code','province code'],country_code:['default address country code','country code'],
 zip:['default address zip','zip'],address_phone:['default address phone'],phone:['phone'],
 accepts_email_marketing:['accepts email marketing','accepts marketing'],accepts_sms_marketing:['accepts sms marketing'],
 total_spent:['total spent'],total_orders:['total orders'],note:['note'],tags:['tags']
};
export const CUSTOMER_HEADERS=[...new Set(Object.values(CUSTOMER_COLUMNS).flat())];
// Malaysian state codes used by Shopify addresses.
export const MY_STATES={JHR:'Johor',KDH:'Kedah',KTN:'Kelantan',MLK:'Malacca',NSN:'Negeri Sembilan',PHG:'Pahang',PNG:'Penang',PRK:'Perak',PLS:'Perlis',SGR:'Selangor',TRG:'Terengganu',SBH:'Sabah',SWK:'Sarawak',KUL:'Kuala Lumpur',LBN:'Labuan',PJY:'Putrajaya'};
