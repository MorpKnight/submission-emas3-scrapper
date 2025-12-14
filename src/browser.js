const puppeteer = require('puppeteer');
const config = require('./config');
const fs = require('fs');
const path = require('path');

let browser = null;

/**
 * Launch browser with configured settings
 */
async function launchBrowser() {
    // Ensure download directory exists
    if (!fs.existsSync(config.downloadPath)) {
        fs.mkdirSync(config.downloadPath, { recursive: true });
    }

    browser = await puppeteer.launch({
        headless: config.headless,
        slowMo: config.slowMo,
        defaultViewport: { width: 1280, height: 800 },
        args: ['--start-maximized'],
    });

    const page = await browser.newPage();

    // Configure download behavior
    const client = await page.createCDPSession();
    await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: config.downloadPath,
    });

    console.log('✅ Browser launched successfully');
    console.log(`📁 Downloads will be saved to: ${config.downloadPath}`);

    return page;
}

/**
 * Close browser instance
 */
async function closeBrowser() {
    if (browser) {
        await browser.close();
        console.log('✅ Browser closed');
    }
}

/**
 * Wait for a specified duration
 */
async function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

module.exports = {
    launchBrowser,
    closeBrowser,
    wait,
};
