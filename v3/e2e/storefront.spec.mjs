import {test,expect} from '@playwright/test';
import {guard,axe,seed} from './helpers.mjs';
const buyer={name:'Aisyah Rahman',email:`buyer${Date.now()}@example.com`,phone:'012-345 6789',address_line1:'12 Jalan Kota',postcode:'41000',city:'Klang'};
async function fillCheckout(page,email){
 for(const [k,v] of Object.entries({...buyer,email}))await page.getByLabel(k==='name'?'Full name':k==='address_line1'?'Address':k[0].toUpperCase()+k.slice(1),{exact:true}).fill(v);
 await page.getByLabel('State').selectOption('Selangor');
}
test.beforeAll(async({request})=>seed(request));
test('customer buys a variant, pays through the eGHL flow and sees the confirmed order',async({page})=>{
 const g=guard(page);
 await page.goto('/products/e2e-card-holder');
 await expect(page.getByRole('heading',{level:1,name:'E2E Card Holder'})).toBeVisible();await axe(page,'product');
 await page.getByLabel('Color').selectOption('Black');await page.getByLabel('Quantity').fill('2');
 await page.getByRole('button',{name:'Add to bag'}).click();await expect(page.getByText('Added to your bag.')).toBeVisible();
 await page.goto('/cart');await expect(page.getByText('RM 258.00').first()).toBeVisible();await expect(page.locator('.js-summary')).toContainText('Free');await axe(page,'cart');
 await page.getByRole('link',{name:'Checkout'}).click();await expect(page).toHaveURL(/\/checkout$/);
 await fillCheckout(page,`paid${Date.now()}@example.com`);await axe(page,'checkout');
 await page.getByRole('button',{name:/^Pay RM 258\.00$/}).click();
 await expect(page).toHaveURL(/\/pay\/mock#JSW\d+/);await page.getByRole('button',{name:'Approve payment'}).click();
 await expect(page.getByRole('heading',{level:1})).toHaveText('Thank you — your order is confirmed');await axe(page,'order');
 await expect(page.getByText(/Delivering to Klang, Selangor/)).toBeVisible();
 g.check();
});
test('declined payment can be retried and luggage shipping matches Shopify',async({page})=>{
 const g=guard(page);
 await page.goto('/products/e2e-weekender');await page.getByRole('button',{name:'Add to bag'}).click();
 await page.goto('/cart');await expect(page.locator('.js-summary')).toContainText('RM 26.90');
 await page.getByRole('link',{name:'Checkout'}).click();await fillCheckout(page,`retry${Date.now()}@example.com`);
 await page.getByRole('button',{name:/^Pay RM 725\.90$/}).click();
 await page.getByRole('button',{name:'Decline'}).click();
 await expect(page.getByRole('heading',{level:1})).toHaveText('Awaiting payment');await expect(page.getByRole('alert')).toContainText('not completed');
 await page.getByRole('button',{name:'Try payment again'}).click();await page.getByRole('button',{name:'Approve payment'}).click();
 await expect(page.getByRole('heading',{level:1})).toHaveText('Thank you — your order is confirmed');
 g.check();
});
test('published pages render for visitors; private areas stay out of search',async({page,request})=>{
 const g=guard(page);
 const robots=await (await request.get('/robots.txt')).text();expect(robots).toContain('Disallow: /');
 const headers=(await request.get('/products/e2e-card-holder')).headers();expect(headers['content-security-policy']).toContain("script-src 'self'");expect(headers['x-robots-tag']).toContain('noindex');
 await page.goto('/pages/does-not-exist');await expect(page.getByRole('heading',{name:'Page not found'})).toBeVisible();
 g.check();
});
