const config = require('./config');

/**
 * Login to EMAS3
 */
async function login(page) {
    console.log('🔐 Navigating to login page...');
    await page.goto(config.loginUrl, { waitUntil: 'networkidle2', timeout: 60000 });

    // Fill username - direct value set (instant)
    console.log('📝 Filling credentials...');
    await page.waitForSelector('#username', { timeout: 10000 });
    await page.$eval('#username', (el, value) => { el.value = value; }, config.username);

    // Fill password - direct value set (instant)
    await page.waitForSelector('#password', { timeout: 10000 });
    await page.$eval('#password', (el, value) => { el.value = value; }, config.password);

    // Click login button
    console.log('🔑 Submitting login...');
    await page.click('#loginbtn');

    // Wait for navigation after login
    try {
        await page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 });
    } catch (e) {
        console.log('⚠️ Navigation timeout, checking login status...');
    }

    // Brief wait for page to stabilize
    await new Promise(resolve => setTimeout(resolve, 500));

    // Check if login was successful
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
    return true;
}

module.exports = {
    login,
};
