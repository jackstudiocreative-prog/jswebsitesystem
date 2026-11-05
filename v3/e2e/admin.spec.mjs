import {test,expect} from '@playwright/test';
import {guard,axe,seed,placeholderImages} from './helpers.mjs';
test.beforeAll(async({request})=>seed(request));
test.beforeEach(async({page})=>placeholderImages(page));
const nav=(page,name)=>page.getByRole('navigation',{name:'Admin navigation'}).getByRole('button',{name,exact:true}).click();
test('staff create a product with variants, adjust stock and see it in inventory',async({page})=>{
 const g=guard(page);const title='E2E Sling '+Date.now();
 await page.goto('/admin');await expect(page.getByText('Signed in as editor')).toBeVisible();await axe(page,'dashboard');
 await nav(page,'Products');await page.getByRole('button',{name:'Add product'}).click();
 await page.getByLabel('Title',{exact:true}).fill(title);await page.getByLabel('Price (MYR)').fill('189.00');await page.getByLabel('SKU (unique, optional for drafts)').fill('SL-'+Date.now());await page.getByLabel('Inventory',{exact:true}).fill('4');
 await page.getByLabel('E2E Wallets').check();await page.getByLabel('Status').first().selectOption('active');await axe(page,'product editor');
 await page.getByRole('button',{name:'Save product'}).click();await expect(page.getByText('Product saved to database.')).toBeVisible();
 await expect(page.getByRole('row',{name:new RegExp(title)})).toContainText('RM 189.00');
 await nav(page,'Inventory');await page.getByLabel('Search product or SKU').fill(title);await page.getByRole('button',{name:'Apply filters'}).click();
 const stockTable=page.locator('.table-wrap').first(),row=stockTable.getByRole('row',{name:new RegExp(title)});await expect(row).toContainText('Low stock');
 await row.getByRole('button',{name:'Adjust'}).click();await page.locator('.adjust-panel').getByLabel('Quantity',{exact:true}).fill('6');await page.getByLabel('Reason').selectOption('received');await page.getByRole('button',{name:'Apply adjustment'}).click();
 await expect(page.getByText(new RegExp(`now 10\\.`))).toBeVisible();await expect(stockTable.getByRole('row',{name:new RegExp(title)})).toContainText('In stock');await axe(page,'inventory');
 g.check();
});
test('staff build a page from a template, preview it and publish it to the website',async({page})=>{
 const g=guard(page);const title='E2E Story '+Date.now();
 await page.goto('/admin');await nav(page,'Website');await axe(page,'pages list');
 await page.getByLabel('Start from').selectOption('brand-story');await page.getByLabel('Page title (optional for templates)').fill(title);await page.getByRole('button',{name:'Create page'}).click();
 await expect(page.getByRole('heading',{name:'Edit page'})).toBeVisible();
 await page.locator('.section-adder select').selectOption('banner');await page.getByRole('button',{name:'Add section'}).click();
 await page.locator('.section-form').getByLabel('Text *').fill('Free engraving this month');
 await expect(page.frameLocator('.preview-stage iframe').getByText('Free engraving this month')).toBeVisible();
 await page.getByRole('button',{name:'Mobile · 390px'}).click();await axe(page,'page editor');
 await page.getByRole('button',{name:'Publish',exact:true}).click();await expect(page.getByText('Page published to the website.')).toBeVisible();
 const slug=(await page.getByLabel('Page URL (letters, numbers, hyphens)').inputValue());
 await page.goto('/pages/'+slug);
 await expect(page.getByText('Free engraving this month')).toBeVisible();await axe(page,'public page');
 g.check();
});
test('staff see a paid order, fulfil it and the customer email is queued',async({page,request})=>{
 const g=guard(page);
 // A paid order through the public API and the signed mock gateway.
 const p=await (await request.get('/api/v3/storefront/products/e2e-card-holder')).json();
 const token='t'.repeat(40),key=crypto.randomUUID();
 const order=await (await request.post('/api/v3/storefront/checkout',{data:{idempotency_key:key,access_token:token,customer:{name:'Order Tester',email:`staff${Date.now()}@example.com`,phone:'0123456789',address_line1:'1 Jalan',city:'Klang',postcode:'41000',state:'Selangor'},lines:[{variant_id:p.product.variants[0].id,quantity:1}]}})).json();
 expect((await request.post('/api/v3/payments/mock/complete',{data:{number:order.order.number,access_token:token,outcome:'approve'}})).ok()).toBeTruthy();
 await page.goto('/admin');await nav(page,'Orders');await page.getByLabel('Search order, name, email or phone').fill(order.order.number);await page.getByRole('button',{name:'Apply filters'}).click();
 await page.getByRole('row',{name:new RegExp(order.order.number)}).getByRole('button',{name:'View'}).click();
 await expect(page.getByRole('heading',{name:'Order '+order.order.number})).toBeVisible();await expect(page.getByText(/callback · verified · paid/)).toBeVisible();await axe(page,'order detail');
 await page.getByLabel('Tracking number (optional)').fill('MY-E2E-1');await page.getByRole('button',{name:'Mark as fulfilled'}).click();
 await expect(page.getByText('Order marked as fulfilled.')).toBeVisible();await expect(page.getByText(/is on its way/)).toBeVisible();
 g.check();
});
test('viewer role can read but not change anything',async({page})=>{
 const g=guard(page);
 await page.goto('/admin?role=viewer');await nav(page,'Products');
 await expect(page.getByRole('button',{name:'Add product'})).toBeDisabled();
 await page.getByRole('button',{name:'View'}).first().click();await expect(page.getByRole('button',{name:'Save product'})).toBeDisabled();
 g.check();
});
