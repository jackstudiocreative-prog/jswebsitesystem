import {test,expect} from '@playwright/test';
import {guard,axe,seed} from './helpers.mjs';
test.beforeAll(async({request})=>seed(request));
const noSideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1);
async function paidOrder(request,qty=2){
 const p=await (await request.get('/api/v3/storefront/products/e2e-card-holder')).json();
 const variant=p.product.variants.find(v=>v.available);
 const token='b'.repeat(40)+Date.now(),key=crypto.randomUUID();
 const order=await (await request.post('/api/v3/storefront/checkout',{data:{idempotency_key:key,access_token:token,customer:{name:'Batch Five',email:`b5-${Date.now()}@example.com`,phone:'0123456789',address_line1:'1 Jalan',city:'Klang',postcode:'41000',state:'Selangor'},lines:[{variant_id:variant.id,quantity:qty}]}})).json();
 expect((await request.post('/api/v3/payments/mock/complete',{data:{number:order.order.number,access_token:token,outcome:'approve'}})).ok()).toBeTruthy();
 return {number:order.order.number,token,total:order.order.total_minor};
}
async function openOrder(page,number,mobile=false){
 await page.goto('/admin');if(mobile)await page.getByRole('button',{name:'Menu'}).click();await page.getByRole('navigation',{name:'Admin navigation'}).getByRole('button',{name:'Orders',exact:true}).click();
 await page.getByLabel('Search order, name, email or phone').fill(number);await page.getByRole('button',{name:'Apply filters'}).click();
 await page.getByRole('row',{name:new RegExp(number)}).getByRole('button',{name:'View'}).click();
 await expect(page.getByRole('heading',{name:'Order '+number})).toBeVisible();if(mobile)await page.waitForTimeout(500);
}

test('order: ship with carrier and link, edit tracking, return received to stock; customer sees tracking',async({page,request})=>{
 const g=guard(page);
 await page.route('**/api/v3/media/previews*',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
 const o=await paidOrder(request);
 await openOrder(page,o.number);
 await page.getByRole('combobox',{name:/^Carrier/}).selectOption('J&T Express');
 await page.getByLabel('Tracking number').fill('JT-E2E-1');await page.getByLabel(/^Tracking link/).fill('https://track.example/JT-E2E-1');
 await page.getByRole('button',{name:'Mark as fulfilled'}).click();await expect(page.getByText(/Order marked as fulfilled/)).toBeVisible();
 const ship=page.locator('.order-action',{hasText:'Shipment'});await expect(ship.getByText('J&T Express · JT-E2E-1')).toBeVisible();
 await ship.getByText('Edit tracking').click();await ship.getByLabel('Tracking number').fill('JT-E2E-2');await ship.getByRole('button',{name:'Save tracking'}).click();
 await expect(page.getByText('Tracking updated.')).toBeVisible();await expect(page.locator('.order-action',{hasText:'Shipment'}).getByText('J&T Express · JT-E2E-2')).toBeVisible();
 const ret=()=>page.locator('.order-action',{hasText:'Return'}).first();
 await ret().getByLabel('Note (optional)').fill('Customer changed mind');await ret().getByRole('button',{name:'Start return'}).click();
 await expect(page.locator('.badge',{hasText:'Return requested'})).toBeVisible();
 await expect(ret().getByLabel('Put the items back in stock')).toBeChecked();await ret().getByRole('button',{name:'Items received'}).click();
 await expect(page.locator('.badge',{hasText:'Return received'})).toBeVisible();
 await expect(page.locator('.activity-list')).toContainText('Return received · 2 units back to stock');
 await axe(page,'order after return');
 // Customer's order page shows the carrier and tracking link.
 await page.goto('/');await page.evaluate(([n,t])=>localStorage.setItem('js-orders',JSON.stringify({[n]:t})),[o.number,o.token]);
 await page.goto('/order/'+o.number);await expect(page.getByText(/Shipped with J&T Express · Tracking JT-E2E-2/)).toBeVisible();
 await expect(page.getByRole('link',{name:'Track your parcel'})).toHaveAttribute('href','https://track.example/JT-E2E-1');
 g.check();
});

test('order: two kinds of refund are clearly separate; refund through the staging gateway moves no real money',async({page,request})=>{
 const g=guard(page);
 await page.route('**/api/v3/media/previews*',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
 const o=await paidOrder(request,1);
 await openOrder(page,o.number);
 const refund=page.locator('.order-action',{hasText:'Refund'}).last();
 await expect(refund.getByRole('heading',{name:'Refund through eGHL'})).toBeVisible();
 await expect(refund.getByRole('heading',{name:'Record a refund made in the eGHL portal'})).toBeVisible();
 await expect(refund.getByText('Staging test gateway: no real money moves.')).toBeVisible();
 await axe(page,'order refund options');
 await page.screenshot({path:'test-results/batch5-order-desktop.png',fullPage:true});
 const via=refund.locator('form',{hasText:'Refund through eGHL'});
 await via.getByLabel('Amount (MYR)').fill('10.00');await via.getByLabel('Reason (optional)').fill('Goodwill');
 page.once('dialog',d=>{expect(d.message()).toMatch(/Refund RM\s10\.00 to the customer through eGHL/);d.accept();});
 await via.getByRole('button',{name:'Refund through eGHL'}).click();
 await expect(page.getByText('eGHL refunded the customer.')).toBeVisible();
 await expect(page.locator('.event-list:not(.activity-list)').filter({hasText:'through eGHL'})).toContainText(/RM\s10\.00 · through eGHL · MOCKRF/);
 const rec=page.locator('form',{hasText:'Record a refund made in the eGHL portal'});
 await rec.getByLabel('Amount refunded (MYR)').fill('5.00');await rec.getByLabel('eGHL refund reference').fill('PORTAL-E2E');await rec.getByRole('button',{name:'Record refund'}).click();
 await expect(page.getByText('Refund recorded.')).toBeVisible();
 await expect(page.locator('.event-list:not(.activity-list)').filter({hasText:'PORTAL-E2E'})).toContainText(/RM\s5\.00 · recorded \(eGHL portal\) · PORTAL-E2E/);
 await expect(page.locator('.activity-list')).toContainText('Refund confirmed by eGHL');await expect(page.locator('.activity-list')).toContainText('Refund recorded (eGHL portal)');
 await page.setViewportSize({width:390,height:844});await openOrder(page,o.number,true);expect(await noSideScroll(page)).toBe(true);
 await page.screenshot({path:'test-results/batch5-order-mobile.png',fullPage:true});
 g.check();
});

test('unpaid order: staging gateway cannot be asked for a status, and says so',async({page,request})=>{
 const g=guard(page);
 await page.route('**/api/v3/media/previews*',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
 const p=await (await request.get('/api/v3/storefront/products/e2e-card-holder')).json();
 const order=await (await request.post('/api/v3/storefront/checkout',{data:{idempotency_key:crypto.randomUUID(),access_token:'u'.repeat(40),customer:{name:'Unpaid',email:`u-${Date.now()}@example.com`,phone:'0123456789',address_line1:'1 Jalan',city:'Klang',postcode:'41000',state:'Selangor'},lines:[{variant_id:p.product.variants.find(v=>v.available).id,quantity:1}]}})).json();
 await openOrder(page,order.order.number);
 await expect(page.locator('.order-action',{hasText:'Payment'}).getByText(/cannot be asked for a payment status/)).toBeVisible();
 await expect(page.getByRole('button',{name:'Check payment with eGHL'})).toHaveCount(0);
 await expect(page.getByRole('button',{name:'Cancel order and release stock'})).toBeVisible();
 g.check();
});
