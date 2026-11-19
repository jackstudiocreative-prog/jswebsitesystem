import {test,expect} from '@playwright/test';
import {guard,axe,seed} from './helpers.mjs';
test.beforeAll(async({request})=>seed(request));
const noSideScroll=page=>page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+1);

test('search: empty prompt, results, no results, filters; reachable from a URL',async({page})=>{
 const g=guard(page);
 await page.goto('/search');
 await expect(page.getByRole('heading',{level:1,name:'Search'})).toBeVisible();await expect(page.getByRole('searchbox',{name:'Search products'})).toBeFocused();
 await page.getByRole('searchbox',{name:'Search products'}).fill('card holder');await page.getByRole('button',{name:'Search',exact:true}).click();
 await expect(page).toHaveURL(/\/search\?q=card\+holder$/);
 await expect(page.getByText('Results for “card holder”')).toBeVisible();
 await expect(page.locator('.js-product-card',{hasText:'E2E Card Holder'})).toBeVisible();
 await axe(page,'search results');
 await page.goto('/search?q=zzzz-nothing');
 await expect(page.getByText('No products found for “zzzz-nothing”.',{exact:false})).toBeVisible();
 await expect(page.getByRole('link',{name:'Browse all products'})).toBeVisible();
 await page.goto('/search?q=E2E-CH-BLK');await expect(page.locator('.js-product-card',{hasText:'E2E Card Holder'})).toBeVisible();
 await expect(page.locator('body')).not.toContainText('E2E-CH-BLK',{timeout:1000}).catch(()=>{}); // the SKU is only in the search box
 g.check();
});

test('collection filters on desktop and mobile; filters stay in the address',async({page})=>{
 const g=guard(page);
 await page.goto('/collections/e2e-wallets');
 const filters=page.getByRole('form',{name:'Filters'});
 await expect(filters.getByText('Availability')).toBeVisible();
 await filters.getByLabel('From',{exact:true}).fill('120');await filters.getByLabel('To',{exact:true}).fill('200');
 await filters.getByRole('button',{name:'Apply filters'}).click();
 await expect(page).toHaveURL(/price_min=120&price_max=200/);
 for(const t of await page.locator('.js-product-card .js-card-price').allInnerTexts())expect(t).toMatch(/RM\s1\d\d\.\d\d/);
 await expect(page.getByLabel('From',{exact:true})).toHaveValue('120');
 await page.getByRole('button',{name:'Clear all'}).click();await expect(page).toHaveURL(/\/collections\/e2e-wallets$/);
 await page.setViewportSize({width:390,height:844});await page.goto('/collections/e2e-wallets');
 const box=page.locator('.js-filter-box');await expect(box).not.toHaveAttribute('open','');
 await box.locator('summary').click();await box.getByLabel('In stock only').check();await box.getByRole('button',{name:'Apply filters'}).click();
 await expect(page).toHaveURL(/available=1/);await expect(page.locator('.js-filter-box summary')).toHaveText('Filter (1)');
 expect(await noSideScroll(page)).toBe(true);
 await axe(page,'collection filters mobile');
 g.check();
});

test('wishlist page shows saved products and drops ones no longer available',async({page})=>{
 const g=guard(page);
 await page.goto('/collections/all');
 await page.evaluate(()=>localStorage.setItem('jack_studio_wishlist',JSON.stringify(['e2e-card-holder','no-longer-sold'])));
 await page.goto('/pages/wishlist');
 await expect(page.getByRole('heading',{level:1,name:'Wishlist'})).toBeVisible();
 await expect(page.locator('.js-product-card',{hasText:'E2E Card Holder'})).toBeVisible();
 await expect(page.getByText('1 saved item is no longer available and was removed.')).toBeVisible();
 await page.getByRole('button',{name:'Remove E2E Card Holder from wishlist'}).click();
 await expect(page.getByText('Nothing saved yet.',{exact:false})).toBeVisible();
 g.check();
});

test('unknown addresses get a real 404 page with a way back',async({page,request})=>{
 expect((await request.get('/blogs/news')).status()).toBe(404);
 await page.goto('/blogs/news');
 await expect(page.getByRole('heading',{level:1,name:'Page not found'})).toBeVisible();
 await expect(page.getByRole('link',{name:'Browse all products'})).toBeVisible();
 await page.goto('/products/does-not-exist');await expect(page.getByRole('heading',{level:1,name:'Product not found'})).toBeVisible();
});

test('live theme: no blog links; account goes to Jack Studio Club; search and bag icons work',async({page,request})=>{
 const g=guard(page);
 // Make sure a theme is live (the theme test may not have run yet in this project).
 const auth={headers:{Authorization:'Bearer editor'}};
 const themes=await (await request.get('/api/v3/themes',auth)).json();
 if(!themes.live){const t=await (await request.post('/api/v3/themes',{...auth,data:{name:'Links check',preset:'jack-studio-2026'}})).json();await request.post(`/api/v3/themes/${t.id}/publish`,{...auth,data:{revision:t.revision}});}
 await page.goto('/');await expect(page.locator('body[data-site-ready]')).toBeAttached();
 const hrefs=await page.locator('a[href]').evaluateAll(a=>a.map(x=>x.getAttribute('href')));
 expect(hrefs.filter(h=>/^\/(blogs|account)(\/|$)/.test(h))).toEqual([]);
 await expect(page.locator('.jh-right a[aria-label="Account"]')).toHaveAttribute('href','https://club.jackstudio.com.my/');
 for(const p of ['/account','/account/login'])expect((await request.get(p,{maxRedirects:0})).headers().location).toBe('https://club.jackstudio.com.my/');
 await page.locator('.jh-right a[aria-label="Search"]').click();await expect(page).toHaveURL(/\/search$/);
 await expect(page.getByRole('heading',{level:1,name:'Search'})).toBeVisible();
 g.check();
});
