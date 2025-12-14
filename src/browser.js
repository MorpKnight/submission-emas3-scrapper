const puppeteer = require('puppeteer');
const config = require('./config');
const fs = require('fs');

let browser = null;

/**
 * Launch browser with configured settings
 */
async function launchBrowser() {
    // Ensure download directory exists
    if (!fs.existsSync(config.downloadPath)) {
        fs.mkdirSync(config.downloadPath, { recursive: true });
    }

    // Check if running in Docker (Chromium path exists)
    const isDocker = process.env.PUPPETEER_EXECUTABLE_PATH || fs.existsSync('/usr/bin/chromium');

    const launchOptions = {
        headless: config.headless,
        slowMo: config.slowMo,
        defaultViewport: { width: 1280, height: 800 },
        args: [
            '--start-maximized',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-software-rasterizer',
        ],
    };

    // Use system Chromium in Docker
    if (isDocker && process.env.PUPPETEER_EXECUTABLE_PATH) {
        launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    browser = await puppeteer.launch(launchOptions);

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
        try {
            await browser.close();
            browser = null;
            console.log('✅ Browser closed');
        } catch (e) {
            console.error('⚠️ Error closing browser:', e.message);
        }
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
