import {test,expect} from '@playwright/test';
import {guard,axe,seed} from './helpers.mjs';
test.beforeAll(async({request})=>seed(request));
const noSideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1);

test('imported HTML description is shown as formatted text, never as markup or script; no sideways scroll',async({page})=>{
 const g=guard(page);
 for(const width of [390,768,1280]){
  await page.setViewportSize({width,height:900});
  await page.goto('/products/e2e-engraved-wallet');
  await expect(page.locator('h1.js-product-title')).toBeVisible();
  expect(await noSideScroll(page),`no horizontal scroll at ${width}px`).toBe(true);
  const size=await page.locator('h1.js-product-title').evaluate(n=>parseFloat(getComputedStyle(n).fontSize));
  expect(size).toBeLessThanOrEqual(34);
 }
 const d=page.locator('.js-product .js-rich');
 await expect(d.getByRole('listitem')).toHaveText('Max 5 letters');
 await expect(d.locator('h4')).toHaveText('Engrave limitation');
 await expect(d).not.toContainText('<p>');await expect(d).not.toContainText('<br>');
 expect(await d.locator('img').count()).toBe(0);
 expect(await page.evaluate(()=>window.__pwned)).toBeUndefined();
 await axe(page,'product-rich');
 g.check();
});

test('engraving: required text, rules, separate bag lines, checkout and order',async({page})=>{
 const g=guard(page);
 await page.setViewportSize({width:390,height:844});
 await page.goto('/products/e2e-engraved-wallet');
 const add=page.getByRole('button',{name:'Add to bag'}),field=page.getByLabel('Engraving',{exact:true});
 await add.click();await expect(page.getByText('Enter the engraving for this item.')).toBeVisible();await expect(field).toBeFocused();
 await field.fill('ja-k');await add.click();await expect(page.getByText(/Capital letters and numbers/).last()).toBeVisible();
 await field.fill('jack8');await expect(field).toHaveValue('JACK8');await add.click();
 await expect(page.getByText('Added to your bag with engraving “JACK8”.')).toBeVisible();
 await field.fill('AMY');await add.click();
 await page.goto('/cart');
 const lines=page.locator('.js-line');await expect(lines).toHaveCount(2);
 await expect(lines.nth(0)).toContainText('Engraving: JACK8');await expect(lines.nth(1)).toContainText('Engraving: AMY');
 await page.getByLabel('Quantity for E2E Engraved Wallet With A Deliberately Long Product Name For Layout Checks engraved AMY').fill('2');
 await page.getByLabel('Quantity for E2E Engraved Wallet With A Deliberately Long Product Name For Layout Checks engraved AMY').blur();
 await expect(lines.nth(0)).toContainText('RM 99.00');await expect(lines.nth(1)).toContainText('RM 198.00');
 expect(await noSideScroll(page)).toBe(true);
 await axe(page,'cart-engraving');
 await page.getByRole('link',{name:'Checkout'}).click();
 await expect(page.locator('.js-aside')).toContainText('Engraving: JACK8');
 for(const [l,v] of [['Full name','Engrave Test'],['Email',`engrave${Date.now()}@example.com`],['Phone','012-345 6789'],['Address','1 Jalan Klang'],['Postcode','41000'],['City','Klang']])await page.getByLabel(l,{exact:true}).fill(v);
 await page.getByLabel('State').selectOption('Selangor');
 await page.getByRole('button',{name:/^Pay RM 297\.00$/}).click();
 await page.getByRole('button',{name:'Approve payment'}).click();
 await expect(page.getByRole('heading',{level:1})).toHaveText('Thank you — your order is confirmed');
 await expect(page.getByText('Engraving: JACK8')).toBeVisible();await expect(page.getByText('Engraving: AMY')).toBeVisible();
 g.check();
});

test('collection: featured and newest are different orders',async({page})=>{
 const g=guard(page);
 await page.goto('/collections/e2e-wallets');
 const first=await page.locator('.js-product-card .js-card-title').allTextContents();
 await page.goto('/collections/e2e-wallets?sort=newest');
 const newest=await page.locator('.js-product-card .js-card-title').allTextContents();
 expect(first.length).toBeGreaterThan(1);expect(newest).not.toEqual(first);
 g.check();
});

test('home: "no published theme" and "could not load" are different messages',async({page})=>{
 await page.route('**/api/v3/storefront/theme/pages/home',r=>r.fulfill({status:404,contentType:'application/json',body:JSON.stringify({error:'No live theme'})}));
 await page.goto('/');
 await expect(page.getByRole('heading',{name:'Our online store is being prepared'})).toBeVisible();
 await expect(page.getByRole('link',{name:'Browse all products'})).toHaveAttribute('href','/collections/all');
 await expect(page.getByText('under development')).toHaveCount(0);await expect(page.getByText('Staff workspace')).toHaveCount(0);
 await axe(page,'home-no-theme');
 await page.unroute('**/api/v3/storefront/theme/pages/home');
 let fail=true;await page.route('**/api/v3/storefront/theme/pages/home',r=>fail?r.fulfill({status:503,contentType:'application/json',body:'{"error":"Service unavailable"}'}):r.fallback());
 await page.goto('/');
 await expect(page.getByRole('heading',{name:'This page could not be loaded'})).toBeVisible();
 fail=false;await page.unroute('**/api/v3/storefront/theme/pages/home');
 await page.getByRole('button',{name:'Try again'}).click();
 await expect(page.getByRole('heading',{name:'This page could not be loaded'})).toHaveCount(0);
});

test('admin: dashboard tasks open the matching filtered lists; engraving and collection order are editable',async({page})=>{
 const g=guard(page);
 await page.route('**/api/v3/media/previews*',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
 await page.goto('/admin');await expect(page.getByRole('button',{name:'editor@e2e.test'})).toBeVisible();
 const tasks=page.locator('.dashboard-tasks');
 const out=tasks.locator('.task-row',{hasText:'Variants out of stock'});
 if(await out.count()){const n=Number(await out.locator('strong').textContent());await out.getByRole('button').click();
  await expect(page.getByLabel('Filter by stock level')).toHaveValue('out');await expect(page.getByText(new RegExp(`^${n} active variants`))).toBeVisible();}
 await page.getByRole('navigation',{name:'Admin navigation'}).getByRole('button',{name:'Products',exact:true}).click();
 await page.getByLabel('Search').fill('E2E Engraved Wallet');await page.getByRole('button',{name:'Apply filters'}).click();
 await page.getByRole('row',{name:/E2E Engraved Wallet/}).getByRole('button',{name:'Edit'}).click();
 await expect(page.getByLabel('Offer engraving')).toBeChecked();await expect(page.getByLabel('Maximum characters')).toHaveValue('5');
 await page.getByText('Preview description as customers see it').click();
 await expect(page.locator('.description-preview').getByRole('listitem')).toHaveText('Max 5 letters');
 await axe(page,'product-engraving-settings');
 await page.getByRole('navigation',{name:'Admin navigation'}).getByRole('button',{name:'Collections',exact:true}).click();
 await page.getByRole('row',{name:/E2E Wallets/}).getByRole('button',{name:'Edit'}).click();
 const order=page.locator('.collection-order li');const firstBefore=await order.first().locator('span').first().textContent();
 await page.getByRole('button',{name:'Move down '+firstBefore}).click();
 await page.getByRole('button',{name:'Save product order'}).click();await expect(page.getByText('Product order saved.')).toBeVisible();
 await expect(page.locator('.collection-order li').nth(1).locator('span').first()).toHaveText(firstBefore);
 g.check();
});
