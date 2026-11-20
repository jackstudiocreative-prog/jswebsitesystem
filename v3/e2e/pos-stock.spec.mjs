import {test,expect} from '@playwright/test';
import {guard,axe,seed} from './helpers.mjs';
// The e2e server's stand-in mPOS (mPOS format: prefix + model, colour apart) has BAG-E2EPOS1 colour A 4+3 in
// two warehouses, colour B 5, colour C 6 (already correct on the website), BAG-E2ENEW1 (listed, not on the\n// website) and ACC-POSONLY9 (not in the harness product list, so left out).
test.beforeAll(async({request})=>{
 await seed(request);
 const call=async(path,body,method='POST')=>{const r=await request.fetch('/api/v3/'+path,{method,headers:{Authorization:'Bearer editor','Content-Type':'application/json'},data:body});return r.json();};
 if((await call('products?paged=true&q=E2E POS Item',undefined,'GET')).total)return;
 await call('products',{title:'E2E POS Item',status:'active',option_names:['Colour'],variants:[{option_values:['Black'],sku:'E2E POS1 A',price_minor:5000,inventory:1},{option_values:['Brown'],sku:'E2EPOS1-B',price_minor:5000,inventory:0},{option_values:['Tan'],sku:'E2E POS1 C',price_minor:5000,inventory:6}]});
});
test('Inventory: check stock from POS (model + colour), review the lists, then apply',async({page})=>{
 const g=guard(page);
 await page.route('**/api/v3/media/previews*',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
 await page.goto('/admin');
 const nav=page.getByRole('navigation',{name:'Admin navigation'});await nav.getByRole('button',{name:'Products'}).click();await nav.getByRole('button',{name:'Inventory'}).click();
 const card=page.locator('.pos-sync');
 await expect(card.getByRole('heading',{name:'Sync from POS'})).toBeVisible();
 await card.getByRole('button',{name:'Check POS stock'}).click();
 await expect(card.getByText(/^mPOS: 6 stock rows from 2 warehouses\. Counted: all 2 warehouses added together → 4 items \(code \+ colour\) in stock\.$/)).toBeVisible();
 await expect(card.getByText(/set MPOS_WAREHOUSE_ID in Vercel/)).toBeVisible();
 await expect(card.getByText(/^Matched 3 website variants: 2 will change, 1 already correct\.$/)).toBeVisible();
 const changes=card.locator('details',{hasText:'Will change'});
 await expect(changes.getByRole('row',{name:/E2E POS Item Black E2E POS1 A BAG-E2EPOS1 · A 1 7/})).toBeVisible();
 await expect(changes.getByRole('row',{name:/E2E POS Item Brown E2EPOS1-B BAG-E2EPOS1 · B 0 5/})).toBeVisible();
 await card.getByText('Warehouses (2)').click();await expect(card.getByRole('row',{name:/^1 W1 HQ -ONLINE STORE 4 Yes$/})).toBeVisible();
 await expect(card.getByText(/^Only the 2 models in the Product list are synced: 3 website variants\. Left out: \d+ website variants and 1 mPOS items of other models\.$/)).toBeVisible();
 await card.getByText('In mPOS, not on the website (1)').click();await expect(card.getByRole('cell',{name:'BAG-E2ENEW1',exact:true})).toBeVisible();
 await card.getByText('In the list, not on the website (1)').click();await expect(card.getByRole('row',{name:/^E2ENEW1 BAG BACKPACK\(M\) RM99 2$/})).toBeVisible();
 await card.getByText(/^On the website, not in the list \(\d+\)$/).click();await expect(card.getByRole('cell',{name:'E2E Weekender',exact:true})).toBeVisible();
 await expect(card.getByLabel(/Hide the \d+ active website products not in the list \(set to Draft\)/)).not.toBeChecked();
  await card.getByText('Matched (3)').click();await expect(card.getByRole('row',{name:/E2EPOS1-B E2E POS Item Brown BAG-E2EPOS1 B 5 model \+ colour/})).toBeVisible();
 
 await axe(page,'pos sync preview');
 await page.screenshot({path:'test-results/pos-sync-preview.png',fullPage:true});
 page.once('dialog',d=>d.accept());
 await card.getByRole('button',{name:'Apply to website stock'}).click();
 await expect(page.getByText('Stock synced from POS: 2 variants updated.')).toBeVisible();
 await expect(page.locator('.pos-sync').getByText('Done: 2 variants updated, 1 already correct.')).toBeVisible();
 await page.getByLabel('Search product or SKU').fill('E2E POS');await page.getByRole('button',{name:'Apply filters'}).click();
 await expect(page.getByRole('row',{name:/E2E POS Item Black E2E POS1 A 7/})).toBeVisible();
 await expect(page.getByRole('row',{name:/E2E POS Item Brown E2EPOS1-B 5/})).toBeVisible();
 await expect(page.getByText(/POS sync: mPOS available 7/).first()).toBeVisible();
 await page.screenshot({path:'test-results/pos-sync-applied.png',fullPage:true});
 g.check();
});
test('Inventory: viewers do not see Sync from POS',async({page})=>{
 await page.route('**/api/v3/media/previews*',r=>r.fulfill({status:200,contentType:'application/json',body:'{}'}));
 await page.goto('/admin?role=viewer');
 const nav=page.getByRole('navigation',{name:'Admin navigation'});await nav.getByRole('button',{name:'Products'}).click();await nav.getByRole('button',{name:'Inventory'}).click();
 await expect(page.getByRole('heading',{level:1,name:'Inventory'})).toBeVisible();
 await expect(page.locator('.pos-sync')).toHaveCount(0);
});
