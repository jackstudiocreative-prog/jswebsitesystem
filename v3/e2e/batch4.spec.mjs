import {test,expect} from '@playwright/test';
import {guard,axe,seed} from './helpers.mjs';
test.beforeAll(async({request})=>seed(request));
const noSideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1);
const nav=page=>page.getByRole('navigation',{name:'Admin navigation'});
async function cardHolder(request){
 const list=await (await request.get('/api/v3/products?paged=true&q=E2E%20Card%20Holder',{headers:{Authorization:'Bearer editor'}})).json();
 const p=await (await request.get('/api/v3/products/'+list.items[0].id,{headers:{Authorization:'Bearer editor'}})).json();
 return p.variants.find(v=>v.inventory>0)??p.variants[0];
}

test('admin: create a discount code, see it listed, and read the combination rules',async({page})=>{
 const g=guard(page);
 await page.route('**/api/v3/media/previews*',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
 await page.goto('/admin');await nav(page).getByRole('button',{name:'Discounts'}).click();
 await expect(page.getByRole('heading',{level:1,name:'Discounts'})).toBeVisible();
 const code='E2E'+Date.now().toString(36).toUpperCase();
 await page.getByRole('button',{name:'Create discount'}).click();
 await page.getByLabel(/^Code/).fill(code.toLowerCase());await page.getByLabel(/^Title/).fill('E2E RM10 off');
 await page.getByRole('combobox',{name:/^Type/}).selectOption('fixed');await page.getByLabel('Amount (MYR)').fill('10.00');
 await page.getByLabel(/^Minimum spend/).fill('50');
 await axe(page,'discount editor');
 await page.getByRole('button',{name:'Create discount'}).click();
 await expect(page.getByRole('heading',{level:1,name:'Edit discount'})).toBeVisible();await expect(page.getByLabel(/^Code/)).toHaveValue(code);
 await page.getByRole('button',{name:'Back to discounts'}).click();
 const row=page.getByRole('row',{name:new RegExp(code)});await expect(row).toContainText(/RM\s10\.00 off · min RM\s50\.00/);await expect(row).toContainText('active');
 await page.getByText('How discounts combine').click();await expect(page.getByText(/One free-shipping discount/)).toBeVisible();
 await axe(page,'discount list');await page.screenshot({path:'test-results/batch4-discounts-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.reload();await page.getByRole('button',{name:'Menu'}).click();await nav(page).getByRole('button',{name:'Discounts'}).click();
 await expect(page.getByRole('row',{name:new RegExp(code)})).toBeVisible();expect(await noSideScroll(page)).toBe(true);await page.waitForTimeout(500);await page.screenshot({path:'test-results/batch4-discounts-mobile.png',fullPage:true});
 g.check();
});

test('storefront: apply a code in the bag, wrong code explained, discount carried to checkout',async({page,request})=>{
 const g=guard(page);
 const code='BAG'+Date.now().toString(36).toUpperCase();
 const made=await request.post('/api/v3/discounts',{headers:{Authorization:'Bearer editor'},data:{title:'E2E 10% off',code,kind:'percentage',value:10}});expect(made.status()).toBe(201);
 const v=await cardHolder(request);
 await page.goto('/');await page.evaluate(id=>{localStorage.setItem('js-bag',JSON.stringify([{variant_id:String(id),quantity:1}]));localStorage.removeItem('js-discount-code');},v.id);
 await page.goto('/cart');await expect(page.getByRole('heading',{name:'Your bag'})).toBeVisible();
 const input=page.getByLabel('Discount code');
 await input.fill('NOPE-123');await page.getByRole('button',{name:'Apply'}).click();await expect(page.getByText('This code is not valid.')).toBeVisible();
 await input.fill(code.toLowerCase());await page.getByRole('button',{name:'Apply'}).click();
 await expect(page.getByText(`Code ${code} applied · E2E 10% off`)).toBeVisible();
 const line=page.locator('.js-summary dd.js-discount');await expect(line).toHaveText(/^−RM\s?\d/);
 await axe(page,'bag with discount');
 await page.screenshot({path:'test-results/batch4-bag-desktop.png',fullPage:true});
 await page.getByRole('link',{name:'Checkout'}).click();await expect(page.getByRole('heading',{name:'Checkout'})).toBeVisible();
 await expect(page.locator('.js-aside .js-discount').first()).toHaveText(`Discount (${code})`);
 await page.setViewportSize({width:390,height:844});await page.goto('/cart');await expect(page.getByText(`Code ${code} applied`)).toBeVisible();
 expect(await noSideScroll(page)).toBe(true);await page.screenshot({path:'test-results/batch4-bag-mobile.png',fullPage:true});
 await page.getByRole('button',{name:'Remove code'}).click();await expect(page.getByLabel('Discount code')).toBeVisible();await expect(page.locator('.js-summary .js-discount')).toHaveCount(0);
 g.check();
});

test('admin: analytics with definitions and no invented conversion rate; email status says it is not sending',async({page})=>{
 const g=guard(page);
 await page.route('**/api/v3/media/previews*',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
 await page.goto('/admin');await nav(page).getByRole('button',{name:'Analytics'}).click();
 await expect(page.getByRole('heading',{level:1,name:'Analytics'})).toBeVisible();
 for(const t of ['Net sales','Orders','Average order value','Refunds'])await expect(page.locator('.metric',{hasText:t}).first()).toBeVisible();
 await expect(page.getByText('Sales breakdown')).toBeVisible();await expect(page.getByText('Best-selling products')).toBeVisible();
 await page.getByLabel('Date range').selectOption('custom');await page.getByLabel('From',{exact:true}).fill('2026-01-01');await page.getByLabel('To',{exact:true}).fill('2026-01-31');await page.getByRole('button',{name:'Show'}).click();
 await expect(page.getByText('2026-01-01 to 2026-01-31 · Malaysia time')).toBeVisible();
 await page.getByText('How these numbers are counted').click();await expect(page.getByText(/no conversion rate yet/)).toBeVisible();
 await expect(page.locator('body')).not.toContainText('Conversion rate');
 await axe(page,'analytics');await page.screenshot({path:'test-results/batch4-analytics-desktop.png',fullPage:true});
 await page.setViewportSize({width:390,height:844});await page.reload();await page.getByRole('button',{name:'Menu'}).click();await nav(page).getByRole('button',{name:'Analytics'}).click();await expect(page.getByText('Sales breakdown')).toBeVisible();
 expect(await noSideScroll(page)).toBe(true);await page.waitForTimeout(500);await page.screenshot({path:'test-results/batch4-analytics-mobile.png',fullPage:true});
 await page.setViewportSize({width:1280,height:900});
 await nav(page).getByRole('button',{name:'Settings'}).click();
 const card=page.locator('.email-card');await expect(card.getByRole('heading',{name:'Customer emails'})).toBeVisible();
 await expect(card.getByText(/^Not sending: No email provider is configured/)).toBeVisible();
 await expect(card.getByRole('button',{name:'Send waiting emails now'})).toHaveCount(0);
 await expect(page.locator('body')).not.toContainText('Email sent');
 await axe(page,'settings email');await page.screenshot({path:'test-results/batch4-settings-desktop.png',fullPage:true});
 g.check();
});
