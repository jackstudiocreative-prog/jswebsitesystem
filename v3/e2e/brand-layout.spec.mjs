import {test,expect} from '@playwright/test';
import {seed,axe,guard} from './helpers.mjs';
import {mkdir} from 'node:fs/promises';
test.beforeAll(async({request})=>seed(request));
const nav=(page,name)=>page.locator('nav[aria-label="Admin navigation"]').getByRole('button',{name,exact:true}).click();
test('2026 workspace keeps priority metrics, secondary tools and mobile navigation usable',async({page})=>{
 const g=guard(page);
 await page.goto('/admin');
 await expect(page.locator('.dashboard-primary .metric')).toHaveCount(4);
 await expect(page.locator('.dashboard-details')).not.toHaveAttribute('open','');
 await page.locator('.dashboard-details summary').click();
 await expect(page.getByText('All products',{exact:true})).toBeVisible();
 await page.locator('.dashboard-details summary').click();
 await page.evaluate(()=>document.fonts.ready);
 await page.evaluate(()=>scrollTo(0,0));
 await mkdir('test-results/brand-previews',{recursive:true});
 await page.screenshot({path:'test-results/brand-previews/dashboard-desktop.png',fullPage:true});
 await nav(page,'Products');
 await expect(page.locator('.import-tools')).not.toHaveAttribute('open','');
 await page.locator('.import-tools summary').click();
 await expect(page.getByRole('button',{name:'Import products from Shopify'})).toBeVisible();
 await page.locator('.import-tools summary').click();
 await page.screenshot({path:'test-results/brand-previews/products-desktop.png',fullPage:true});
 await nav(page,'Pages');await expect(page.getByRole('button',{name:'Create page',exact:true})).toBeVisible();
 await page.setViewportSize({width:390,height:844});
 for(const name of ['Dashboard','Products','Inventory','Orders','Customers','Media Library','Website','Pages','Settings']){
  if(name==='Inventory')await nav(page,'Products');
  await nav(page,name);await expect(page.locator('.page-heading')).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBeTruthy();
 }
 await nav(page,'Dashboard');await axe(page,'mobile dashboard');
 await page.screenshot({path:'test-results/brand-previews/dashboard-mobile.png',fullPage:true});
 await page.goto('/products/e2e-card-holder');await expect(page.getByRole('button',{name:'Add to bag'})).toBeVisible();
 await page.screenshot({path:'test-results/brand-previews/product-mobile.png',fullPage:true});
 g.check();
});
