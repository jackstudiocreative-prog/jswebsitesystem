import {defineConfig,devices} from '@playwright/test';
// Browser suite. Locally, CHROME_PATH can point at an installed Chrome; CI installs Playwright Chromium.
const launchOptions=process.env.CHROME_PATH?{executablePath:process.env.CHROME_PATH,args:['--no-sandbox']}:{};
export default defineConfig({
 testDir:'e2e',fullyParallel:false,workers:1,retries:process.env.CI?1:0,reporter:process.env.CI?'github':'list',
 use:{baseURL:'http://127.0.0.1:4317',launchOptions,trace:'retain-on-failure'},
 webServer:{command:'node scripts/e2e-server.mjs',url:'http://127.0.0.1:4317/health',env:{E2E_HARNESS:'1'},reuseExistingServer:false,timeout:60000},
 projects:[{name:'desktop',use:{...devices['Desktop Chrome'],viewport:{width:1366,height:900}}},{name:'mobile',use:{...devices['Pixel 7']},testMatch:/storefront/}]
});
