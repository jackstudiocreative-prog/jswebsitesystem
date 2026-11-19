import {test,expect} from '@playwright/test';
import {guard,axe,seed,placeholderImages} from './helpers.mjs';
test.beforeAll(async({request})=>seed(request));
test.beforeEach(async({page})=>placeholderImages(page));
const nav=async(page,name)=>{const menu=page.getByRole('button',{name:'Menu'});if(await menu.isVisible())await menu.click();await page.getByRole('navigation',{name:'Admin navigation'}).getByRole('button',{name,exact:true}).click();};

test('account menu: who is signed in, change password, keyboard',async({page})=>{
 const g=guard(page);
 await page.goto('/admin');
 const account=page.getByRole('button',{name:'editor@e2e.test'});
 await account.click();await expect(account).toHaveAttribute('aria-expanded','true');
 const menu=page.locator('#account-menu');await expect(menu).toContainText('Editor');
 await page.keyboard.press('Escape');await expect(menu).toBeHidden();await expect(account).toBeFocused();
 await account.click();await menu.getByRole('button',{name:'Change password'}).click();
 await expect(page.locator('#toast')).toContainText('password reset email has been sent');
 await expect(page.getByRole('heading',{name:'Staff sign-in'})).toBeHidden();
 g.check();
});

test('small screens: menu opens and closes; Escape returns focus; no sideways scroll',async({page})=>{
 const g=guard(page);
 await page.setViewportSize({width:390,height:844});await page.goto('/admin');
 const menu=page.getByRole('button',{name:'Menu'});
 await expect(page.getByRole('navigation',{name:'Admin navigation'})).toBeHidden();
 await menu.click();await expect(menu).toHaveAttribute('aria-expanded','true');
 await expect(page.getByRole('navigation',{name:'Admin navigation'}).getByRole('button',{name:'Pages',exact:true})).toBeVisible();
 await page.keyboard.press('Escape');await expect(menu).toHaveAttribute('aria-expanded','false');await expect(menu).toBeFocused();
 await nav(page,'Inventory');await expect(page.getByRole('heading',{level:1,name:'Inventory'})).toBeVisible();
 await expect(page.locator('.breadcrumb')).toHaveText('Products / Inventory');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await axe(page,'mobile inventory');
 g.check();
});

test('product list: sort, filtered count, clear filters, empty and error states',async({page})=>{
 const g=guard(page);
 await page.goto('/admin');await nav(page,'Products');
 await expect(page.getByRole('button',{name:'Add product'})).toHaveClass(/primary/);
 await page.getByLabel('Sort products').selectOption('title');
 const titles=await page.locator('.table-wrap tbody tr td:first-child').allInnerTexts();
 expect([...titles].map(t=>t.toLowerCase()).join('|')).toBe([...titles].map(t=>t.toLowerCase()).sort().join('|'));
 await page.getByLabel('Search').fill('no such product zzz');await page.getByRole('button',{name:'Apply filters'}).click();
 await expect(page.locator('.empty-state')).toContainText('No products match these filters.');
 await page.locator('.empty-state').getByRole('button',{name:'Clear filters'}).click();
 await expect(page.locator('.result-count')).toContainText(/^Showing 1–\d+ of \d+ products$/);
 // A failed load says so and offers Retry (no blank page).
 let fail=true;await page.route('**/api/v3/collections?*',r=>fail?r.fulfill({status:500,contentType:'application/json',body:'{"error":"Database unavailable"}'}):r.fallback());
 await nav(page,'Collections');
 await expect(page.getByRole('alert')).toContainText('This page could not be loaded: Database unavailable');
 fail=false;await page.getByRole('button',{name:'Retry'}).click();
 await expect(page.locator('.table-wrap')).toBeVisible();
 g.check();
});

test('viewer sees a read-only badge and cannot add',async({page})=>{
 await page.goto('/admin?role=viewer');await nav(page,'Products');await nav(page,'Collections');
 await expect(page.locator('.read-only-badge')).toHaveText('Read only');
 await expect(page.getByRole('button',{name:'Add collection'})).toBeDisabled();
});

test('theme editor: tree, preview and settings side by side; a colour set by staff shows in the preview',async({page})=>{
 const g=guard(page);page.on('dialog',d=>d.accept());
 await page.setViewportSize({width:1440,height:900});
 await page.goto('/admin');await nav(page,'Themes');
 await page.getByRole('button',{name:'Add theme'}).click();await expect(page.getByRole('heading',{name:'Edit theme'})).toBeVisible();
 await page.getByRole('button',{name:'Edit Jack Studio Header'}).click();
 const tree=page.getByRole('region',{name:'Sections'}),preview=page.getByRole('region',{name:'Preview'}),settings=page.getByRole('region',{name:'Section settings'});
 await expect(settings).toBeVisible();
 const [a,b,c]=await Promise.all([tree,preview,settings].map(l=>l.boundingBox()));
 expect(a.x<b.x&&b.x<c.x).toBe(true);
 const bg=settings.getByRole('textbox',{name:'Background color'});
 await bg.fill('#123456');await bg.blur();
 await expect(page.getByText('Showing your unsaved changes.')).toBeVisible({timeout:10000});
 const frame=page.frameLocator('.theme-preview iframe');
 await expect.poll(()=>frame.locator('.jh-header').evaluate(n=>getComputedStyle(n).backgroundColor),{timeout:10000}).toBe('rgb(18, 52, 86)');
 await axe(page,'theme editor with settings');
 g.check();
});
