import {test,expect} from '@playwright/test';
import {guard,axe,seed} from './helpers.mjs';
test.beforeAll(async({request})=>seed(request));
const noSideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1);
const CSV=`Customer ID,First Name,Last Name,Email,Accepts Email Marketing,Default Address Company,Default Address Address1,Default Address Address2,Default Address City,Default Address Province Code,Default Address Country Code,Default Address Zip,Default Address Phone,Phone,Accepts SMS Marketing,Total Spent,Total Orders,Note,Tax Exempt,Tags
'8101,Mei Jun,Hoo,meijun.e2e@example.com,yes,,"12, Jalan Cheras",,Cheras,SGR,MY,'56000,,'+60123456789,no,0.00,1,,no,vip
'8102,Wan Mohd,Fitri,wan.e2e@example.com,no,,,,Labu,NSN,MY,,,,no,0.00,0,,no,
'8103,Aresya,Farzana,aresya.e2e@example.com,no,,,,Petaling Jaya,SGR,MY,,,,no,85.68,1,,no,
'8104,,,broken-email,no,,,,,,,,,,no,0.00,0,,no,
`;
test('import Shopify customers from the CSV export, browse, filter and open one',async({page})=>{
 const g=guard(page);
 await page.route('**/api/v3/media/previews*',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
 await page.goto('/admin');await page.getByRole('navigation',{name:'Admin navigation'}).getByRole('button',{name:'Customers'}).click();
 await expect(page.getByRole('heading',{level:1,name:'Customers'})).toBeVisible();
 await page.getByRole('button',{name:'Import from Shopify'}).first().click();
 await expect(page.getByRole('heading',{level:1,name:'Import customers from Shopify'})).toBeVisible();
 await page.getByLabel('Shopify customers CSV').setInputFiles({name:'customers_export.csv',mimeType:'text/csv',buffer:Buffer.from(CSV)});
 await expect(page.getByText('4 customers in the file · 1 subscribed to email')).toBeVisible();
 await axe(page,'customer import');
 await page.getByRole('button',{name:'Import customers'}).click();
 await expect(page.getByText(/^Done: \d+ new, \d+ updated, \d+ unchanged, 1 skipped\.$/)).toBeVisible();
 await page.getByText('1 rows skipped').click();await expect(page.getByText('Line 5: Email “broken-email” is not valid')).toBeVisible();
 await page.screenshot({path:'test-results/customers-import-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'Back to customers'}).click();
 const row=page.getByRole('row',{name:/Aresya Farzana/});await expect(row).toContainText('Petaling Jaya, Selangor, Malaysia');await expect(row).toContainText(/RM\s85\.68/);
 await expect(page.getByRole('row',{name:/Mei Jun Hoo/}).getByText('Subscribed',{exact:true})).toBeVisible();
 await page.getByLabel('Filter by email subscription').selectOption('subscribed');
 await expect(page.getByRole('row',{name:/Mei Jun Hoo/})).toBeVisible();await expect(page.getByRole('row',{name:/Aresya/})).toHaveCount(0);
 await axe(page,'customer list');await page.screenshot({path:'test-results/customers-list-desktop.png',fullPage:true});
 await page.getByRole('button',{name:'Mei Jun Hoo'}).click();
 await expect(page.getByRole('heading',{level:1,name:'Mei Jun Hoo'})).toBeVisible();
 await expect(page.getByText('12, Jalan Cheras')).toBeVisible();await expect(page.getByText('Selangor',{exact:true})).toBeVisible();await expect(page.getByText(/From Shopify customer export/)).toBeVisible();
 await axe(page,'customer detail');
 await page.setViewportSize({width:390,height:844});await page.reload();await page.getByRole('button',{name:'Menu'}).click();await page.getByRole('navigation',{name:'Admin navigation'}).getByRole('button',{name:'Customers'}).click();
 await expect(page.getByRole('row',{name:/Mei Jun Hoo/})).toBeVisible();await page.waitForTimeout(500);expect(await noSideScroll(page)).toBe(true);
 await page.screenshot({path:'test-results/customers-list-mobile.png',fullPage:true});
 g.check();
});
test('viewer cannot import customers',async({page})=>{
 await page.goto('/admin?role=viewer');await page.getByRole('navigation',{name:'Admin navigation'}).getByRole('button',{name:'Customers'}).click();
 await expect(page.getByRole('heading',{level:1,name:'Customers'})).toBeVisible();await expect(page.getByRole('button',{name:'Import from Shopify'})).toHaveCount(0);
});
