/**
 * Session-aware scraper runner
 * Reads config from temp JSON file passed as argument
 */

const path = require('path');
const fs = require('fs');

// Get config path from command line
const configPath = process.argv[2];

if (!configPath || !fs.existsSync(configPath)) {
    console.error('❌ Config file not provided or not found');
    process.exit(1);
}

// Load session config
const sessionConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));

// Override the config module
const originalConfig = require('./config');
const config = {
    ...originalConfig,
    username: sessionConfig.username,
    password: sessionConfig.password,
    classUrl: sessionConfig.classUrl,
    submissionUrl: sessionConfig.submissionUrl,
    loginUrl: sessionConfig.loginUrl,
    downloadPath: sessionConfig.downloadPath,
    headless: sessionConfig.headless,
    students: sessionConfig.students,
};

// Import modules
const puppeteer = require('puppeteer');

let browser = null;

async function launchBrowser() {
    if (!fs.existsSync(config.downloadPath)) {
        fs.mkdirSync(config.downloadPath, { recursive: true });
    }

    const isDocker = process.env.PUPPETEER_EXECUTABLE_PATH || fs.existsSync('/usr/bin/chromium');

    const launchOptions = {
        headless: config.headless,
        defaultViewport: { width: 1280, height: 800 },
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-software-rasterizer',
        ],
    };

    if (isDocker && process.env.PUPPETEER_EXECUTABLE_PATH) {
        launchOptions.executablePath = process.env.PUPPETEER_EXECUTABLE_PATH;
    }

    browser = await puppeteer.launch(launchOptions);
    const page = await browser.newPage();

    const client = await page.createCDPSession();
    await client.send('Page.setDownloadBehavior', {
        behavior: 'allow',
        downloadPath: config.downloadPath,
    });

    console.log('✅ Browser launched successfully');
    console.log(`📁 Downloads: ${config.downloadPath}`);

    return page;
}

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

function wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function login(page) {
    console.log('🔐 Navigating to login page...');
    await page.goto(config.loginUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    console.log('📝 Filling credentials...');
    await page.waitForSelector('#username', { timeout: 10000 });
    await page.$eval('#username', (el, value) => { el.value = value; }, config.username);
    await page.$eval('#password', (el, value) => { el.value = value; }, config.password);

    console.log('🔑 Submitting login...');
    await page.click('#loginbtn');

    try {
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
    } catch (e) {
        console.log('⚠️ Navigation timeout, checking login status...');
    }

    await wait(500);

    const currentUrl = page.url();
    console.log(`📍 Current URL: ${currentUrl}`);

    if (currentUrl.includes('login') && !currentUrl.includes('testsession')) {
        const errorMsg = await page.evaluate(() => {
            const alert = document.querySelector('.alert-danger, .loginerrors, #loginerrormessage');
            return alert ? alert.textContent.trim() : null;
        });

        if (errorMsg) {
            throw new Error(`Login failed: ${errorMsg}`);
        }
        throw new Error('Login failed! Please check your credentials.');
    }

    console.log('✅ Login successful!');
}

async function navigateToSubmission(page) {
    console.log('📝 Navigating to submission page...');
    await page.goto(config.submissionUrl, { waitUntil: 'networkidle2' });
    await wait(500);
    console.log('✅ Submission page loaded');
}

function readStudentList() {
    const npmList = config.students
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith('#'));

    console.log(`📋 Loaded ${npmList.length} students from list`);
    return npmList;
}

async function selectStudents(page, npmList) {
    console.log('🔍 Looking for student checkboxes...');

    const result = await page.evaluate((npmsToFind) => {
        let selectedCount = 0;
        const notFound = [];

        const rows = document.querySelectorAll('table tbody tr');

        for (const npm of npmsToFind) {
            let found = false;
            for (const row of rows) {
                if (row.textContent.includes(npm)) {
                    const checkbox = row.querySelector('input[type="checkbox"]');
                    if (checkbox && !checkbox.checked) {
                        checkbox.click();
                    }
                    found = true;
                    selectedCount++;
                    break;
                }
            }
            if (!found) {
                notFound.push(npm);
            }
        }

        return { selectedCount, notFound, total: npmsToFind.length };
    }, npmList);

    console.log(`📊 Selected ${result.selectedCount}/${result.total} students`);
    if (result.notFound.length > 0) {
        console.log(`⚠️ Not found: ${result.notFound.join(', ')}`);
    }

    return result.selectedCount;
}

async function downloadSubmissions(page) {
    console.log('⬆️ Scrolling to grading action section...');

    page.on('dialog', async (dialog) => {
        console.log(`📢 Dialog appeared: "${dialog.message()}"`);
        console.log('✅ Clicking OK on dialog...');
        await dialog.accept();
    });

    await page.evaluate(() => {
        window.scrollTo(0, 0);
    });

    await wait(300);

    console.log('🔍 Looking for Grading action dropdown...');

    const dropdownFound = await page.evaluate(() => {
        const selects = document.querySelectorAll('select');

        for (const select of selects) {
            const options = select.querySelectorAll('option');
            for (const option of options) {
                const text = option.textContent.toLowerCase();
                if (text.includes('download') && text.includes('selected')) {
                    select.value = option.value;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    return {
                        found: true,
                        value: option.textContent.trim(),
                        selectId: select.id || select.name || 'unknown'
                    };
                }
            }
        }

        for (const select of selects) {
            const options = select.querySelectorAll('option');
            for (const option of options) {
                const text = option.textContent.toLowerCase();
                if (text.includes('download')) {
                    select.value = option.value;
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                    return {
                        found: true,
                        value: option.textContent.trim(),
                        selectId: select.id || select.name || 'unknown'
                    };
                }
            }
        }

        return { found: false };
    });

    if (dropdownFound.found) {
        console.log(`✅ Selected: "${dropdownFound.value}" from dropdown ${dropdownFound.selectId}`);
    } else {
        console.log('❌ Grading action dropdown not found');
        return false;
    }

    await wait(200);

    console.log('🔘 Looking for Submit button...');

    const submitClicked = await page.evaluate(() => {
        const submitButton =
            document.querySelector('input[type="submit"][value="Go"]') ||
            document.querySelector('input[type="submit"][value="Submit"]') ||
            document.querySelector('button[type="submit"]') ||
            document.querySelector('input.btn[type="submit"]') ||
            document.querySelector('#id_submitbutton') ||
            document.querySelector('.gradingbatchoperationsform input[type="submit"]') ||
            document.querySelector('form input[type="submit"]');

        if (submitButton) {
            submitButton.click();
            return { clicked: true, value: submitButton.value || submitButton.textContent };
        }

        return { clicked: false };
    });

    if (submitClicked.clicked) {
        console.log(`✅ Clicked Submit button: "${submitClicked.value}"`);
    } else {
        console.log('⚠️ Submit button not found');
    }

    console.log('⏳ Waiting for download...');
    await wait(3000);

    console.log('✅ Download process completed');
    return true;
}

async function main() {
    console.log('🚀 Starting EMAS3 Scraper...\n');

    let page = null;

    try {
        page = await launchBrowser();
        await login(page);
        await navigateToSubmission(page);

        const npmList = readStudentList();

        if (npmList.length === 0) {
            console.log('⚠️ No students in list');
            return;
        }

        await selectStudents(page, npmList);
        await downloadSubmissions(page);

        console.log('\n🎉 Process completed successfully!');
        console.log('📁 Check the downloads folder for your files.');

        await wait(2000);

    } catch (error) {
        console.error('\n❌ Error:', error.message);
    } finally {
        await closeBrowser();
    }
}

// Global error handlers
process.on('uncaughtException', (error) => {
    console.error('❌ Uncaught Exception:', error.message);
    closeBrowser().catch(() => { });
});

process.on('unhandledRejection', (reason) => {
    console.error('❌ Unhandled Rejection:', reason);
    closeBrowser().catch(() => { });
});

main().catch((error) => {
    console.error('❌ Fatal error:', error.message);
    process.exit(1);
});
