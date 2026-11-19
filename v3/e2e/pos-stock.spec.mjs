import {test,expect} from '@playwright/test';
import {guard,axe,seed} from './helpers.mjs';
// The e2e server's stand-in mPOS has: "E2E POS 1" 4+3 in two warehouses, "E2E-POS-2" 5 (website writes it
// "E2E POS 2"), "E2E POS 3" 6 (already correct) and "POS ONLY 9" (not on the website).
test.beforeAll(async({request})=>{
 await seed(request);
 const call=async(path,body,method='POST')=>{const r=await request.fetch('/api/v3/'+path,{method,headers:{Authorization:'Bearer editor','Content-Type':'application/json'},data:body});return r.json();};
 if((await call('products?paged=true&q=E2E POS Item',undefined,'GET')).total)return;
 await call('products',{title:'E2E POS Item',status:'active',option_names:['Size'],variants:[{option_values:['One'],sku:'E2E POS 1',price_minor:5000,inventory:1},{option_values:['Two'],sku:'E2E POS 2',price_minor:5000,inventory:0},{option_values:['Three'],sku:'E2E POS 3',price_minor:5000,inventory:6}]});
});
test('Inventory: check stock from POS, review both missing lists, then apply',async({page})=>{
 const g=guard(page);
 await page.route('**/api/v3/media/previews*',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
 await page.goto('/admin');
 const nav=page.getByRole('navigation',{name:'Admin navigation'});await nav.getByRole('button',{name:'Products'}).click();await nav.getByRole('button',{name:'Inventory'}).click();
 const card=page.locator('.pos-sync');
 await expect(card.getByRole('heading',{name:'Sync from POS'})).toBeVisible();
 await card.getByRole('button',{name:'Check POS stock'}).click();
 await expect(card.getByText(/^mPOS: 5 stock rows from 2 warehouses \(HQ, Mid Valley\) → 4 SKUs in stock\.$/)).toBeVisible();
 await expect(card.getByText(/^Matched 3 website variants: 2 will change, 1 already correct\.$/)).toBeVisible();
 const changes=card.locator('details',{hasText:'Will change'});
 await expect(changes.getByRole('row',{name:/E2E POS Item One E2E POS 1 1 7/})).toBeVisible();
 await expect(changes.getByRole('row',{name:/E2E POS Item Two E2E POS 2 0 5/})).toBeVisible();
 await card.getByText('In mPOS, not on the website (1)').click();await expect(card.getByRole('cell',{name:'POS ONLY 9',exact:true})).toBeVisible();
 await card.getByText(/^On the website, not in mPOS \(\d+\)$/).click();await expect(card.getByRole('cell',{name:'E2E-CH-BLK',exact:true})).toBeVisible();
 await card.getByText('Matched ignoring spaces and dashes (1)').click();await expect(card.getByRole('cell',{name:'E2E-POS-2',exact:true})).toBeVisible();
 await expect(card.getByLabel(/Also set the \d+ website variants not in the mPOS list to 0/)).not.toBeChecked();
 await axe(page,'pos sync preview');
 await page.screenshot({path:'test-results/pos-sync-preview.png',fullPage:true});
 page.once('dialog',d=>d.accept());
 await card.getByRole('button',{name:'Apply to website stock'}).click();
 await expect(page.getByText('Stock synced from POS: 2 variants updated.')).toBeVisible();
 await expect(page.locator('.pos-sync').getByText('Done: 2 variants updated, 1 already correct.')).toBeVisible();
 await page.getByLabel('Search product or SKU').fill('E2E POS');await page.getByRole('button',{name:'Apply filters'}).click();
 await expect(page.getByRole('row',{name:/E2E POS Item One E2E POS 1 7/})).toBeVisible();
 await expect(page.getByRole('row',{name:/E2E POS Item Two E2E POS 2 5/})).toBeVisible();
 await expect(page.getByText(/POS sync: mPOS available 7/).first()).toBeVisible();
 await page.screenshot({path:'test-results/pos-sync-applied.png',fullPage:true});
 g.check();
});
test('Inventory: viewers do not see Sync from POS',async({page,context})=>{
 await context.addInitScript(()=>{window.__E2E_ROLE='viewer';});
 await page.route('**/api/v3/media/previews*',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
 await page.goto('/admin?role=viewer');
 const nav=page.getByRole('navigation',{name:'Admin navigation'});await nav.getByRole('button',{name:'Products'}).click();await nav.getByRole('button',{name:'Inventory'}).click();
 await expect(page.getByRole('heading',{level:1,name:'Inventory'})).toBeVisible();
 await expect(page.locator('.pos-sync')).toHaveCount(0);
});
