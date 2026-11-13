import {test,expect} from '@playwright/test';
import {guard,axe,placeholderImages} from './helpers.mjs';
test.beforeEach(async({page})=>placeholderImages(page));
const nav=(page,name)=>page.getByRole('navigation',{name:'Admin navigation'}).getByRole('button',{name,exact:true}).click();

test('staff add the Jack Studio 2026 theme, edit it, publish it and see it on the storefront',async({page})=>{
 const g=guard(page);page.on('dialog',d=>d.accept());const heading='E2E Journey '+Date.now();
 await page.goto('/admin');await nav(page,'Website');
 await expect(page.getByRole('heading',{name:'Theme library'})).toBeVisible();await axe(page,'online store');
 await page.getByRole('button',{name:'Add theme'}).click();
 await expect(page.getByRole('heading',{name:'Edit theme'})).toBeVisible();await expect(page.getByText('Showing the saved theme.')).toBeVisible();
 await axe(page,'theme editor');
 // Edit the hero heading and an announcement, then save.
 await page.getByRole('button',{name:'Edit Hero banner'}).click();
 await page.getByLabel('Heading',{exact:true}).fill(heading);
 await expect(page.getByText('Showing your unsaved changes. Save to keep them.')).toBeVisible();
 await page.getByRole('button',{name:'Close settings'}).click();
 await page.getByRole('button',{name:'Edit Announcement bar'}).click();
 await page.locator('.list-item summary').first().click();
 await page.getByLabel('Text *').first().fill('FREE NAME ENGRAVING ON EVERY WALLET');
 await page.getByRole('button',{name:'Save',exact:true}).click();await expect(page.getByText('Theme saved.')).toBeVisible();
 // Publish from the editor; the overview now shows it as the current theme.
 await page.getByRole('button',{name:'Publish',exact:true}).click();
 await expect(page.getByText('Jack Studio 2026 is now live.')).toBeVisible();
 await expect(page.locator('.theme-current')).toContainText('Jack Studio 2026');
 // Storefront home renders the live theme within the strict storefront CSP.
 await page.goto('/');
 await expect(page.getByRole('heading',{level:1,name:heading})).toBeVisible();
 await expect(page.getByText('FREE NAME ENGRAVING ON EVERY WALLET')).toBeVisible();
 await expect(page).toHaveTitle('Jack Studio Leather Shop | Premium Bag & Wallets & Belts in Malaysia');
 await expect(page.getByRole('heading',{name:'Explore Our Collections'})).toBeVisible();
 await expect(page.locator('.vs-stage[data-showroom="/showroom/"] iframe.vs-frame')).toHaveAttribute('src','/showroom/');await expect(page.locator('.vs-stage')).toHaveClass(/is-live/,{timeout:20000});
 await expect(page.locator('.cc-btn').first()).toHaveCSS('background-color','rgb(118, 124, 130)');
 await page.getByRole('tab',{name:'Leather Bag'}).click();await expect(page.getByRole('tab',{name:'Leather Bag'})).toHaveAttribute('aria-selected','true');
 await page.getByRole('button',{name:'Show About Us menu'}).click();await expect(page.getByRole('link',{name:'Brand Story',exact:true})).toBeVisible();
 await axe(page,'storefront home');
 // Published pages use the theme header and footer.
 // Menu pages are built from the original Shopify sections and keep working (links, scripts, CSP).
 await page.goto('/');await page.locator('.jh-nav').getByRole('link',{name:'Our Services',exact:true}).first().click();
 await expect(page).toHaveURL(/\/pages\/our-services$/);await expect(page.locator('.lq-page [data-section-type="service-hero"]')).toBeVisible();
 await page.goto('/pages/outlets');await expect(page.getByRole('heading',{name:'Aeon Bukit Tinggi'}).first()).toBeVisible();
 await page.goto('/pages/privacy-policy');await expect(page.getByRole('heading',{level:1,name:'Privacy Policy'})).toBeVisible();
 await page.goto('/pages/does-not-exist');await expect(page.locator('.jh-header')).toBeVisible();await expect(page.locator('.jf-footer')).toBeVisible();
 // Mobile: the menu opens as a drawer.
 await page.setViewportSize({width:390,height:844});await page.goto('/');
 await page.getByRole('button',{name:'Open menu'}).click();await expect(page.getByRole('navigation',{name:'Main menu'})).toBeVisible();
 await page.getByRole('button',{name:'Close menu'}).click();await expect(page.getByRole('navigation',{name:'Main menu'})).toBeHidden();
 g.check();
});

test('Preview opens the real storefront with the edited theme; links keep the preview until Exit preview',async({page,context})=>{
 const g=guard(page);await page.goto('/admin');await nav(page,'Website');
 await page.locator('.theme-current').getByRole('button',{name:'Edit theme'}).click();
 await page.getByRole('button',{name:'Edit Hero banner'}).click();
 await page.getByLabel('Heading',{exact:true}).fill('Unsaved preview heading');
 const [tab]=await Promise.all([context.waitForEvent('page'),page.getByRole('button',{name:'Preview',exact:true}).click()]);
 await expect(tab.getByRole('heading',{level:1,name:'Unsaved preview heading'})).toBeVisible();
 await expect(tab.getByRole('status').filter({hasText:'Previewing theme'})).toBeVisible();
 expect(new URL(tab.url()).search).toBe('');
 await axe(tab,'storefront preview');
 await tab.getByRole('button',{name:'Show About Us menu'}).click();await tab.getByRole('link',{name:'Brand Story',exact:true}).click();
 await expect(tab).toHaveURL(/\/pages\/brand-story$/);await expect(tab.locator('.jt-preview-bar')).toBeVisible();await expect(tab.locator('.jh-header')).toBeVisible();
 await tab.getByRole('button',{name:'Exit preview'}).click();await expect(tab.locator('.jt-preview-bar')).toHaveCount(0);
 // Customers (no preview flag) always get the live theme.
 const visitor=await context.newPage();await visitor.goto('/');await expect(visitor.locator('.jh-header')).toBeVisible();await expect(visitor.locator('.jt-preview-bar')).toHaveCount(0);await expect(visitor.getByRole('heading',{level:1,name:'Unsaved preview heading'})).toHaveCount(0);await visitor.close();
 g.check();
});
